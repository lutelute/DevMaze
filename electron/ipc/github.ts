import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// DevMaze が解析する最大コミット数に合わせた上限
const FETCH_DEPTH = 1000

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
    await execFileAsync('git', [
      '--git-dir', localPath,
      'fetch',
      '--filter=blob:none',    // ファイル内容は取らない
      `--depth=${FETCH_DEPTH}`, // 最大1000件に収める
      '--quiet',
    ], { timeout: 60_000 })
    onProgress('最新化完了')
  } else {
    // 初回 —— commit/tree メタデータのみ、最大1000件
    fs.mkdirSync(path.dirname(localPath), { recursive: true })
    onProgress(`${owner}/${name} のコミット履歴を取得中（ファイル内容なし、最大${FETCH_DEPTH}件）...`)
    await execFileAsync('git', [
      'clone', '--bare',
      '--filter=blob:none',    // ファイル内容は取らない
      `--depth=${FETCH_DEPTH}`, // コミット数を1000に制限
      '--quiet',
      url, localPath,
    ], { timeout: 120_000 })
    onProgress('取得完了')
  }

  return localPath
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
