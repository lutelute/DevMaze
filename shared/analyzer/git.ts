import simpleGit, { SimpleGit, type DefaultLogFields } from 'simple-git'
import type { CommitNode, CommitType } from '../types'

function classifyCommit(message: string, parentCount: number): CommitType {
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
    const fullMsg = entry.message + ' ' + body

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
      type: classifyCommit(fullMsg, parentHashes.length),
      branchNames: refs.branches,
      tagNames: refs.tags,
      revertedHash: undefined,
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

async function fillStats(git: SimpleGit, commits: CommitNode[]): Promise<void> {
  let rawStats: string
  try {
    rawStats = await git.raw([
      'log', '--all',
      '--format=%H',
      '--shortstat',
      '--max-count=1000',
    ])
  } catch {
    // shallow clone (--depth) や --filter=blob:none の場合、境界コミットで
    // object が存在しないエラーが起きることがある。stats なしで続行する。
    return
  }

  const statsMap = new Map<string, { filesChanged: number; insertions: number; deletions: number }>()
  let currentHash = ''

  for (const line of rawStats.split('\n')) {
    const trimmed = line.trim()
    if (/^[0-9a-f]{40}$/.test(trimmed)) {
      currentHash = trimmed
    } else if (currentHash && trimmed.includes('changed')) {
      const filesMatch = trimmed.match(/(\d+) files? changed/)
      const insMatch   = trimmed.match(/(\d+) insertion/)
      const delMatch   = trimmed.match(/(\d+) deletion/)
      statsMap.set(currentHash, {
        filesChanged: filesMatch ? parseInt(filesMatch[1]) : 0,
        insertions:   insMatch   ? parseInt(insMatch[1])   : 0,
        deletions:    delMatch   ? parseInt(delMatch[1])   : 0,
      })
    }
  }

  for (const c of commits) {
    const s = statsMap.get(c.hash)
    if (s) {
      c.filesChanged = s.filesChanged
      c.insertions   = s.insertions
      c.deletions    = s.deletions
    }
  }
}
