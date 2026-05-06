import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { app } from 'electron'
import type { AnalysisResult } from '../../shared/types'

const CACHE_VERSION = 1

interface CacheEntry {
  version: number
  headCommit: string
  savedAt: string
  data: AnalysisResult
}

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'repo-cache')
}

function cacheKey(repoPath: string): string {
  return crypto.createHash('sha1').update(repoPath).digest('hex')
}

export function loadCache(repoPath: string): CacheEntry | null {
  try {
    const file = path.join(cacheDir(), `${cacheKey(repoPath)}.json`)
    if (!fs.existsSync(file)) return null
    const entry: CacheEntry = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (entry.version !== CACHE_VERSION) return null
    return entry
  } catch {
    return null
  }
}

export function saveCache(repoPath: string, headCommit: string, data: AnalysisResult): void {
  try {
    const dir = cacheDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const entry: CacheEntry = { version: CACHE_VERSION, headCommit, savedAt: new Date().toISOString(), data }
    fs.writeFileSync(path.join(dir, `${cacheKey(repoPath)}.json`), JSON.stringify(entry), 'utf-8')
  } catch {}
}
