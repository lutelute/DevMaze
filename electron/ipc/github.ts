import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// DevMaze が解析する最大コミット数に合わせた上限
const FETCH_DEPTH = 1000

// ファイル内容の取得方針。
// blob:none（内容を一切取らない）にすると軽いが、numstat が動かず
// ファイル単位の差分が取れない ＝ 沼もホットスポットも検出できない（実測: 取得率6%）。
// 100KB 以下だけ取れば、ソースコードはほぼ全部そろって画像や成果物は避けられる
// （AtelierX 896コミットで 15MB → 21MB、6秒）。
const BLOB_FILTER = '--filter=blob:limit=100k'

function githubReposDir(): string {
  return path.join(app.getPath('userData'), 'github-repos')
}

export interface ParsedGithubRepo {
  url: string
  owner: string
  name: string
  localPath: string
}

export function parseGithubInput(input: string): ParsedGithubRepo | null {
  const s = input.trim().replace(/\.git$/, '')

  // user/repo 形式
  const short = s.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/)
  if (short) {
    const [, owner, name] = short
    return {
      url: `https://github.com/${owner}/${name}.git`,
      owner,
      name,
      localPath: path.join(githubReposDir(), owner, `${name}.git`),
    }
  }

  // https://github.com/user/repo
  const url = s.match(/https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\/.*)?$/)
  if (url) {
    const [, owner, name] = url
    return {
      url: `https://github.com/${owner}/${name}.git`,
      owner,
      name,
      localPath: path.join(githubReposDir(), owner, `${name}.git`),
    }
  }

  return null
}

/**
 * bare clone に fetch の refspec を用意する。
 *
 * `git clone --bare` は remote.origin.fetch を設定しない。設定が無いと、
 * fetch はオブジェクトを取ってくるだけで **参照を1つも更新しない**。
 * その結果、キャッシュはクローンした時点で永久に凍結し、
 * 新しいコミットは「オブジェクトはあるのにどの ref からも辿れない」状態になって
 * `git log --all` に現れない（実測: AtelierX が 303 コミットで止まっていた）。
 */
async function ensureFetchRefspec(localPath: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync('git', [
      '--git-dir', localPath, 'config', '--get-all', 'remote.origin.fetch',
    ])
    if (stdout.trim().length > 0) return
  } catch {
    // 未設定のときは exit 1 で来る。そのまま設定しに行く
  }

  await execFileAsync('git', [
    '--git-dir', localPath, 'config', '--add',
    'remote.origin.fetch', '+refs/heads/*:refs/heads/*',
  ])
}

/**
 * 昔 blob:none で取ったキャッシュを、いまの方針（小さい blob は取る）に揃える。
 * 一度だけ --refetch が必要（フィルタを緩めても、既存コミットのぶんは取り直さないため）。
 */
async function upgradeBlobFilter(localPath: string, onProgress: (msg: string) => void): Promise<void> {
  let current = ''
  try {
    const { stdout } = await execFileAsync('git', [
      '--git-dir', localPath, 'config', '--get', 'remote.origin.partialclonefilter',
    ])
    current = stdout.trim()
  } catch {
    return   // 部分クローンでなければ何もしない
  }

  if (current !== 'blob:none') return

  onProgress('ファイル差分を取り直しています（初回のみ）...')
  await execFileAsync('git', [
    '--git-dir', localPath, 'fetch', '--refetch', BLOB_FILTER, '--quiet', 'origin',
  ], {
    timeout: 300_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
  })
}

export async function ensureGithubRepo(
  input: string,
  onProgress: (msg: string) => void
): Promise<string> {
  const parsed = parseGithubInput(input)
  if (!parsed) throw new Error(
    `形式が不正です: "${input}"\n例: lutelute/AtelierX または https://github.com/lutelute/AtelierX`
  )

  const { url, owner, name, localPath } = parsed

  if (fs.existsSync(path.join(localPath, 'HEAD'))) {
    // 既に取得済み → 差分のみ fetch
    onProgress(`${owner}/${name} の新着コミットを確認中...`)
    await ensureFetchRefspec(localPath)   // 古いキャッシュには refspec が無い
    await upgradeBlobFilter(localPath, onProgress)
    await execFileAsync('git', [
      '--git-dir', localPath,
      'fetch',
      BLOB_FILTER,
      `--depth=${FETCH_DEPTH}`, // 最大1000件に収める
      '--quiet',
    ], { timeout: 120_000 })
    onProgress('最新化完了')
  } else {
    // 初回 —— commit/tree メタデータのみ、最大1000件
    fs.mkdirSync(path.dirname(localPath), { recursive: true })
    onProgress(`${owner}/${name} のコミット履歴を取得中（最大${FETCH_DEPTH}件）...`)
    await execFileAsync('git', [
      'clone', '--bare',
      BLOB_FILTER,
      `--depth=${FETCH_DEPTH}`, // コミット数を1000に制限
      '--quiet',
      url, localPath,
    ], { timeout: 120_000 })
    await ensureFetchRefspec(localPath)   // 次回から fetch で参照が更新されるように
    onProgress('取得完了')
  }

  return localPath
}

/** このパスが DevMaze の GitHub キャッシュ（bare repo）かどうか */
export function isGithubCache(repoPath: string): boolean {
  return repoPath.startsWith(githubReposDir())
}

/**
 * リモートから取り込む。取り込めた新着コミット数を返す。
 * ネットワークや認証で失敗しても解析は続けたいので、例外にせず error を返す。
 */
export async function fetchLatest(repoPath: string): Promise<{
  fetched: boolean
  newCommits: number
  error?: string
}> {
  const bare = isGithubCache(repoPath)
  const gitArgs = bare ? ['--git-dir', repoPath] : ['-C', repoPath]

  const countCommits = async (): Promise<number> => {
    try {
      const { stdout } = await execFileAsync('git', [...gitArgs, 'rev-list', '--all', '--count'])
      return parseInt(stdout.trim(), 10) || 0
    } catch {
      return 0
    }
  }

  // リモートが無いリポジトリでは fetch する意味がない
  try {
    const { stdout } = await execFileAsync('git', [...gitArgs, 'remote'])
    if (stdout.trim().length === 0) return { fetched: false, newCommits: 0 }
  } catch {
    return { fetched: false, newCommits: 0 }
  }

  if (bare) {
    await ensureFetchRefspec(repoPath)
    try { await upgradeBlobFilter(repoPath, () => {}) } catch { /* 失敗しても取り込みは続ける */ }
  }

  const before = await countCommits()

  try {
    await execFileAsync('git', [
      ...gitArgs, 'fetch', '--all', '--quiet', '--prune',
      ...(bare ? [BLOB_FILTER, `--depth=${FETCH_DEPTH}`] : []),
    ], {
      timeout: 90_000,
      // 認証を求められたまま固まらないようにする
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { fetched: false, newCommits: 0, error: msg.split('\n')[0].slice(0, 200) }
  }

  const after = await countCommits()
  return { fetched: true, newCommits: Math.max(0, after - before) }
}

export interface RemoteCheck {
  /** リモートに手元より新しいコミットがあるか */
  behind: boolean
  branch: string | null
  localHead: string | null
  remoteHead: string | null
  error?: string
}

/**
 * リモートに新しいコミットがあるかだけを調べる（取り込みはしない）。
 *
 * ls-remote は参照の一覧を返すだけなので速く、通信量もほぼ無い。
 * 「更新されているのに気づけない」を防ぐために、開いたときと定期的に呼ぶ。
 */
export async function checkRemote(repoPath: string): Promise<RemoteCheck> {
  const bare = isGithubCache(repoPath)
  const gitArgs = bare ? ['--git-dir', repoPath] : ['-C', repoPath]
  const opts = {
    timeout: 20_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
  }

  const run = async (args: string[]): Promise<string> =>
    (await execFileAsync('git', [...gitArgs, ...args], opts)).stdout.trim()

  try {
    if ((await run(['remote'])).length === 0) {
      return { behind: false, branch: null, localHead: null, remoteHead: null }
    }

    let branch: string | null = null
    try {
      const b = await run(['rev-parse', '--abbrev-ref', 'HEAD'])
      branch = b === 'HEAD' ? null : b        // detached HEAD は null
    } catch { /* 参照が取れないリポジトリもある */ }

    const localHead = await run(['rev-parse', 'HEAD'])

    // 現在のブランチに対応するリモート参照を見る。
    // 常に remote HEAD と比べると、別ブランチに居るだけで「新着あり」に化ける。
    const lsArgs = branch ? ['ls-remote', 'origin', `refs/heads/${branch}`] : ['ls-remote', 'origin', 'HEAD']
    const line = (await run(lsArgs)).split('\n')[0] ?? ''
    const remoteHead = line.split(/\s+/)[0] || null

    if (!remoteHead) return { behind: false, branch, localHead, remoteHead: null }

    if (remoteHead === localHead) return { behind: false, branch, localHead, remoteHead }

    // 「オブジェクトを持っているか」では判定できない。
    // 一度 fetch した後に reset した場合など、オブジェクトは残ったまま
    // 履歴には入っていないことがあり、それを「取り込み済み」と誤判定する（実測）。
    // 手元の HEAD から辿り着けるかどうかで見る。
    let reachable = false
    try {
      await run(['merge-base', '--is-ancestor', remoteHead, 'HEAD'])
      reachable = true
    } catch {
      reachable = false   // 到達不能、またはオブジェクトが無い
    }

    return { behind: !reachable, branch, localHead, remoteHead }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      behind: false, branch: null, localHead: null, remoteHead: null,
      error: msg.split('\n')[0].slice(0, 200),
    }
  }
}

// ---- GitHub REST API ステータス取得 ----

export interface RepoStatus {
  prs: number
  issues: number
  ciStatus: 'success' | 'failure' | 'pending' | 'unknown'
  ciName: string | null
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'DevMaze',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

function lastPage(linkHeader: string | null): number | null {
  if (!linkHeader) return null
  const m = linkHeader.match(/page=(\d+)>; rel="last"/)
  return m ? parseInt(m[1]) : null
}

export async function fetchRepoStatus(owner: string, name: string): Promise<RepoStatus> {
  const base = `https://api.github.com/repos/${owner}/${name}`
  const headers = ghHeaders()

  const [repoRes, prsRes, runsRes] = await Promise.all([
    fetch(base, { headers }),
    fetch(`${base}/pulls?state=open&per_page=1`, { headers }),
    fetch(`${base}/actions/runs?per_page=1`, { headers }),
  ])

  // open_issues_count はPRを含む近似値として使う
  let issues = 0
  if (repoRes.ok) {
    const data = await repoRes.json() as { open_issues_count: number }
    issues = data.open_issues_count
  }

  let prs = 0
  if (prsRes.ok) {
    const last = lastPage(prsRes.headers.get('Link'))
    if (last !== null) {
      prs = last
    } else {
      const data = await prsRes.json() as unknown[]
      prs = data.length
    }
  }

  let ciStatus: RepoStatus['ciStatus'] = 'unknown'
  let ciName: string | null = null
  if (runsRes.ok) {
    const data = await runsRes.json() as {
      workflow_runs: Array<{ conclusion: string | null; name: string; status: string }>
    }
    const run = data.workflow_runs[0]
    if (run) {
      ciName = run.name
      if (run.conclusion === 'success') ciStatus = 'success'
      else if (run.conclusion === 'failure') ciStatus = 'failure'
      else if (run.status === 'in_progress' || run.status === 'queued') ciStatus = 'pending'
    }
  }

  return { prs, issues, ciStatus, ciName }
}
