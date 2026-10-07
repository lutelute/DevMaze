import { simpleGit, type SimpleGit, type DefaultLogFields } from 'simple-git'
import { gitAt } from './gitenv'
import type { CommitNode, CommitType } from '../types'

/**
 * 件名を主、本文を従として分類する。
 * 本文には変更点の箇条書き（"- fix ...", "- add ..."）が並ぶことが多く、
 * 件名と本文を混ぜて判定すると、たとえば初回リリースコミットが
 * 「バグ修正」に化ける。本文は件名で決まらなかったときの補助にとどめる。
 */
export function classifyCommit(subject: string, body: string, parentCount: number): CommitType {
  if (parentCount >= 2) return 'merge'
  const bySubject = classifyText(subject, parentCount)
  if (bySubject !== 'normal') return bySubject
  return classifyText(body, parentCount)
}

function classifyText(message: string, parentCount: number): CommitType {
  const msg = message.toLowerCase()
  if (parentCount >= 2) return 'merge'
  if (msg.startsWith('revert ') || /^revert\b/.test(msg) || /取り消し|巻き戻し|リバート|元に戻/.test(msg)) return 'revert'
  if (/\b(fix|bug|error|issue|hotfix|patch|defect|broken|crash)\b/.test(msg) || /修正|不具合|バグ|エラー|直した|直す|壊れ|落ち|クラッシュ/.test(msg)) return 'error_fix'
  if (/\b(wip|todo|fixme|hack|temp|temporary|draft|poc|prototype)\b/.test(msg) || /作業中|途中|暫定|仮実装|とりあえず|試作/.test(msg)) return 'wip'
  if (/\b(test|spec|coverage|jest|vitest|pytest|e2e|unit test|integration test)\b/.test(msg) || /テスト/.test(msg)) return 'test'
  if (/\b(refactor|restructure|reorganize|clean.?up|simplif|extract|rename|rework|revamp)\b/.test(msg) || /リファクタ|整理|構造|書き直|分割|改名|名前変更|切り出/.test(msg)) return 'refactor'
  if (/\b(docs?|readme|changelog|document|comment|jsdoc|api doc)\b/.test(msg) || /ドキュメント|readme|説明|手順書|資料|コメント|引き継ぎ/.test(msg)) return 'docs'
  if (/\b(chore|ci|cd|build|deps?|dependenc|lint|format|prettier|eslint|webpack|vite|rollup|package|npm|yarn|pip|cargo|gradle|bump)\b/.test(msg) || /環境|設定|依存|ビルド|整形|パッケージ|バージョン/.test(msg)) return 'chore'
  if (/\b(feat|feature|add|new|implement|create|introduce)\b/.test(msg) || /追加|実装|新規|導入|対応|作成|できるように/.test(msg)) return 'feature'
  if (/\b(release|v\d+\.\d+|version|deploy|publish)\b/.test(msg) || /リリース|公開/.test(msg)) return 'release'
  return 'normal'
}

function extractRevertedHash(message: string, allHashes: Set<string>): string | undefined {
  const match = message.match(/This reverts commit ([0-9a-f]{7,40})/i)
  if (!match) return undefined
  const partial = match[1]
  for (const h of allHashes) {
    if (h.startsWith(partial)) return h
  }
  return partial
}

/** origin の URL。取れなければ undefined（リモート無しのリポジトリもある） */
export async function getRemoteUrl(repoPath: string): Promise<string | undefined> {
  try {
    const url = (await simpleGit(repoPath).raw(['remote', 'get-url', 'origin'])).trim()
    return url.length > 0 ? url : undefined
  } catch {
    return undefined
  }
}

/** 解析するコミット数の既定の上限。GitHub の取得深さ（github.ts の FETCH_DEPTH）と揃えている */
export const DEFAULT_MAX_COMMITS = 1000

export async function analyzeGitRepo(
  repoPath: string,
  opts: { maxCommits?: number } = {},
): Promise<CommitNode[]> {
  const maxCount = `--max-count=${opts.maxCommits ?? DEFAULT_MAX_COMMITS}`
  // 遅延取得を止めた git（理由と simple-git 4 の環境ガードの話は gitenv.ts）
  const git: SimpleGit = gitAt(repoPath)

  // bare repository でも動作するように revparse で確認（checkIsRepo は bare で false を返す場合がある）
  try {
    await git.revparse(['HEAD'])
  } catch (err) {
    const why = err instanceof Error ? err.message.split('\n')[0] : String(err)
    throw new Error(`Gitリポジトリが見つかりません: ${repoPath}\n（${why}）`)
  }

  // ===== Step 1: commit metadata via simple-git log =====
  const logResult = await git.log<DefaultLogFields>(['--all', maxCount])

  // ===== Step 2: parent hashes via raw (ASCII-only format) =====
  const rawParents = await git.raw([
    'log', '--all',
    '--format=%H %P',
    maxCount,
  ])

  const parentMap = new Map<string, string[]>()
  for (const line of rawParents.trim().split('\n')) {
    const parts = line.trim().split(' ')
    if (parts.length === 0 || !parts[0]) continue
    const hash = parts[0]
    const parents = parts.slice(1).filter(Boolean)
    parentMap.set(hash, parents)
  }

  // ===== Step 3: ref names (branches/tags) =====
  const rawRefs = await git.raw([
    'log', '--all',
    '--format=%H %D',
    maxCount,
  ])

  const refMap = new Map<string, { branches: string[]; tags: string[] }>()
  for (const line of rawRefs.trim().split('\n')) {
    const idx = line.indexOf(' ')
    if (idx < 0) continue
    const hash = line.slice(0, idx).trim()
    const refsRaw = line.slice(idx + 1).trim()
    if (!hash) continue
    const refs = refsRaw ? refsRaw.split(',').map(r => r.trim()).filter(Boolean) : []
    const branches = refs.filter(r => !r.startsWith('tag:') && r !== 'HEAD' && !r.startsWith('HEAD ->'))
    const tags = refs.filter(r => r.startsWith('tag:')).map(r => r.replace('tag: ', ''))
    refMap.set(hash, { branches, tags })
  }

  // ===== Step 4: body (for revert detection) =====
  const rawBody = await git.raw([
    'log', '--all',
    '--format=%H|BODY|%b|ENDBODY|',
    maxCount,
  ])

  const bodyMap = new Map<string, string>()
  const bodyChunks = rawBody.split('|ENDBODY|')
  for (const chunk of bodyChunks) {
    const sepIdx = chunk.indexOf('|BODY|')
    if (sepIdx < 0) continue
    const hash = chunk.slice(0, sepIdx).trim().split('\n').pop()?.trim() ?? ''
    const body = chunk.slice(sepIdx + 6).trim()
    if (hash) bodyMap.set(hash, body)
  }

  // ===== Build CommitNode list =====
  const allHashes = new Set(logResult.all.map(c => c.hash))
  const commits: CommitNode[] = []

  for (const entry of logResult.all) {
    const parentHashes = parentMap.get(entry.hash) ?? []
    const refs = refMap.get(entry.hash) ?? { branches: [], tags: [] }
    const body = bodyMap.get(entry.hash) ?? ''

    commits.push({
      hash: entry.hash,
      shortHash: entry.hash.slice(0, 7),
      parentHashes,
      authorName: entry.author_name,
      authorEmail: entry.author_email,
      timestamp: new Date(entry.date),
      message: entry.message,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      type: classifyCommit(entry.message, body, parentHashes.length),
      branchNames: refs.branches,
      tagNames: refs.tags,
      revertedHash: undefined,
      files: [],
    })
  }

  // Fill revert targets
  for (const c of commits) {
    if (c.type === 'revert') {
      const body = bodyMap.get(c.hash) ?? ''
      c.revertedHash = extractRevertedHash(c.message + ' ' + body, allHashes)
    }
  }

  // ===== Step 5: file stats =====
  await fillStats(git, commits, maxCount)

  return commits
}

// リネーム表記を新しいパスに正規化する
//   "src/{old.ts => new.ts}"  → "src/new.ts"
//   "old/a.ts => new/a.ts"    → "new/a.ts"
function normalizeRenamePath(raw: string): string {
  const path = raw.trim()
  const brace = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/)
  if (brace) {
    const [, prefix, , to, suffix] = brace
    return (prefix + to + suffix).replace(/\/{2,}/g, '/')
  }
  const arrow = path.split(' => ')
  return (arrow.length === 2 ? arrow[1] : path).trim()
}

// 1コミットあたりに保持するファイル名の上限（巨大コミットでのメモリ肥大を防ぐ）
const MAX_FILES_PER_COMMIT = 200

/** git が途中で失敗したときに、例外に含まれる標準出力の断片を取り出す */
export function salvagePartialOutput(err: unknown): string {
  const e = err as { stdOut?: unknown; message?: unknown } | null
  const buf = e?.stdOut
  if (typeof buf === 'string' && buf.length > 0) return buf
  if (buf && typeof (buf as Buffer).toString === 'function') {
    const s = (buf as Buffer).toString('utf-8')
    if (s.length > 0) return s
  }
  const msg = typeof e?.message === 'string' ? e.message : ''
  // simple-git は stdout をそのまま message に載せてくることがある。
  // numstat の行（"<数字|-> TAB <数字|-> TAB <path>"）が含まれていれば使える。
  return /^[\d-]+\t[\d-]+\t/m.test(msg) ? msg : ''
}

export interface NumstatEntry {
  filesChanged: number
  insertions: number
  deletions: number
  files: string[]
}

/**
 * `git log --format=%H --numstat` の出力を解析する。
 * 途中で切れた出力（オブジェクト欠損で git が落ちた場合）でも、
 * 読めたところまでを返す。
 */
export function parseNumstat(raw: string): Map<string, NumstatEntry> {
  const statsMap = new Map<string, NumstatEntry>()
  let current: NumstatEntry | null = null

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (/^[0-9a-f]{40}$/.test(trimmed)) {
      current = { filesChanged: 0, insertions: 0, deletions: 0, files: [] }
      statsMap.set(trimmed, current)
      continue
    }

    if (!current) continue

    // "<insertions>\t<deletions>\t<path>"（バイナリは "-\t-\t<path>"）
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const ins = parseInt(parts[0], 10)
    const del = parseInt(parts[1], 10)
    current.filesChanged += 1
    current.insertions += Number.isNaN(ins) ? 0 : ins
    current.deletions  += Number.isNaN(del) ? 0 : del
    if (current.files.length < MAX_FILES_PER_COMMIT) {
      current.files.push(normalizeRenamePath(parts.slice(2).join('\t')))
    }
  }

  return statsMap
}

/**
 * numstat を分割して取り直す。
 *
 * `git log --all --numstat` は**最初に見つからないオブジェクトで止まる**ので、
 * 1件でも欠けていると残り911件ぶんの差分まで一緒に失う。
 * まとめて取る → 失敗したら半分に割る → 1件まで割って駄目ならその1件だけ諦める、
 * とすると、欠けている数が少ないうちはほぼ全速のまま、取れるものは全部取れる。
 */
async function numstatInChunks(git: SimpleGit, hashes: string[]): Promise<string> {
  const out: string[] = []
  const stack: string[][] = []
  const CHUNK = 200
  for (let i = 0; i < hashes.length; i += CHUNK) stack.push(hashes.slice(i, i + CHUNK))

  let dropped = 0
  while (stack.length > 0) {
    const batch = stack.pop()!
    try {
      out.push(await git.raw(['show', '--format=%H', '--numstat', ...batch]))
    } catch {
      if (batch.length === 1) { dropped++; continue }   // この1件だけ諦める
      const mid = Math.floor(batch.length / 2)
      stack.push(batch.slice(0, mid), batch.slice(mid))
    }
  }
  if (dropped > 0) {
    // 取得率は stats.fileStatsCoverage に出るので、ここでは黙って続ける。
    // 「0件」と「見えていない」を取り違えさせないための数字はそちらが持っている。
  }
  return out.join('\n')
}

async function fillStats(git: SimpleGit, commits: CommitNode[], maxCount: string): Promise<void> {
  let rawStats: string
  try {
    // numstat はファイル単位の増減行を返す。shortstat と違いファイル名が取れるため、
    // 沼（同じファイルの往復）検出に使える。
    rawStats = await git.raw([
      'log', '--all',
      '--format=%H',
      '--numstat',
      maxCount,
    ])
  } catch (err) {
    // shallow clone (--depth)・部分クローン・オブジェクト欠損のリポジトリでは、
    // git が途中の "fatal: could not fetch <sha> from promisor remote" で終了する。
    // 捨ててしまうと全コミットの stats が 0 になり、ファイル単位の検出（沼・場所）が
    // 「検出なし」に化けて、見た目には正常に見えてしまう。
    //
    // 例外から部分出力を拾う手を先に試すが、**これは当てにならない**。
    // simple-git はこの失敗で stdOut を持たず task だけを載せてくることがあり、
    // 実測（AtelierX 912コミット）では救出できず取得率0%になっていた。
    // そこで、当たった1件のせいで全部を失わないよう、分割して取り直す。
    rawStats = salvagePartialOutput(err)
    if (!rawStats) {
      rawStats = await numstatInChunks(git, commits.map(c => c.hash))
    }
    if (!rawStats) return
  }

  const statsMap = parseNumstat(rawStats)

  for (const c of commits) {
    const s = statsMap.get(c.hash)
    if (s) {
      c.filesChanged = s.filesChanged
      c.insertions   = s.insertions
      c.deletions    = s.deletions
      c.files        = s.files
    }
  }
}
