import simpleGit, { SimpleGit, type DefaultLogFields } from 'simple-git'
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
  if (msg.startsWith('revert ') || /^revert\b/.test(msg)) return 'revert'
  if (/\b(fix|bug|error|issue|hotfix|patch|defect|broken|crash)\b/.test(msg)) return 'error_fix'
  if (/\b(wip|todo|fixme|hack|temp|temporary|draft|poc|prototype)\b/.test(msg)) return 'wip'
  if (/\b(test|spec|coverage|jest|vitest|pytest|e2e|unit test|integration test)\b/.test(msg)) return 'test'
  if (/\b(refactor|restructure|reorganize|clean.?up|simplif|extract|rename|rework|revamp)\b/.test(msg)) return 'refactor'
  if (/\b(docs?|readme|changelog|document|comment|jsdoc|api doc)\b/.test(msg)) return 'docs'
  if (/\b(chore|ci|cd|build|deps?|dependenc|lint|format|prettier|eslint|webpack|vite|rollup|package|npm|yarn|pip|cargo|gradle|bump)\b/.test(msg)) return 'chore'
  if (/\b(feat|feature|add|new|implement|create|introduce)\b/.test(msg)) return 'feature'
  if (/\b(release|v\d+\.\d+|version|deploy|publish)\b/.test(msg)) return 'release'
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

export async function analyzeGitRepo(repoPath: string): Promise<CommitNode[]> {
  const git: SimpleGit = simpleGit(repoPath)

  // bare repository でも動作するように revparse で確認（checkIsRepo は bare で false を返す場合がある）
  try {
    await git.revparse(['HEAD'])
  } catch {
    throw new Error(`Gitリポジトリが見つかりません: ${repoPath}`)
  }

  // ===== Step 1: commit metadata via simple-git log =====
  const logResult = await git.log<DefaultLogFields>([
    '--all', '--max-count=1000',
  ])

  // ===== Step 2: parent hashes via raw (ASCII-only format) =====
  const rawParents = await git.raw([
    'log', '--all',
    '--format=%H %P',
    '--max-count=1000',
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
    '--max-count=1000',
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
    '--max-count=1000',
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
  await fillStats(git, commits)

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

async function fillStats(git: SimpleGit, commits: CommitNode[]): Promise<void> {
  let rawStats: string
  try {
    // numstat はファイル単位の増減行を返す。shortstat と違いファイル名が取れるため、
    // 沼（同じファイルの往復）検出に使える。
    rawStats = await git.raw([
      'log', '--all',
      '--format=%H',
      '--numstat',
      '--max-count=1000',
    ])
  } catch (err) {
    // shallow clone (--depth)・--filter=blob:none・オブジェクト欠損のリポジトリでは、
    // git が途中の "fatal: unable to read <sha>" で終了し、simple-git が例外を投げる。
    // このとき既に出力されていた分は例外メッセージの中に残っているので拾い直す。
    // 捨ててしまうと全コミットの stats が 0 になり、ファイル単位の検出（沼）が
    // 「検出なし」に化けて、見た目には正常に見えてしまう。
    rawStats = salvagePartialOutput(err)
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
