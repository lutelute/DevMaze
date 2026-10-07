import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { simpleGit } from 'simple-git'
import type { AnalysisResult } from './types'
import { analyzeRepo, type AnalyzeProgress } from './analyzer/index'
import { repoCacheDir, recentReposFile } from './cache-path'

/**
 * 解析結果のキャッシュ。HEAD が同じなら解析し直さない。
 * アプリと MCP サーバーで共用する（元は Electron 側だけが持っていて、
 * MCP はツールを呼ぶたびに 900 コミットを全解析し直していた）。
 *
 * 2: struggles を追加 / 3: hotspots・activity・remoteUrl・refs / 4: 進捗の段階表示
 * 5: 和文のコミット分類・maze エンジンの分離（v1.0）
 */
export const CACHE_VERSION = 5

export interface CacheEntry {
  version: number
  headCommit: string
  savedAt: string
  data: AnalysisResult
}

function cacheKey(repoPath: string): string {
  return crypto.createHash('sha1').update(repoPath).digest('hex')
}

function cacheFile(repoPath: string): string {
  return path.join(repoCacheDir(), `${cacheKey(repoPath)}.json`)
}

export function loadCache(repoPath: string): CacheEntry | null {
  try {
    const file = cacheFile(repoPath)
    if (!fs.existsSync(file)) return null
    const entry = JSON.parse(fs.readFileSync(file, 'utf-8')) as CacheEntry
    if (entry.version !== CACHE_VERSION) return null
    return entry
  } catch {
    return null
  }
}

export function saveCache(repoPath: string, headCommit: string, data: AnalysisResult): void {
  try {
    fs.mkdirSync(repoCacheDir(), { recursive: true })
    const entry: CacheEntry = { version: CACHE_VERSION, headCommit, savedAt: new Date().toISOString(), data }
    fs.writeFileSync(cacheFile(repoPath), JSON.stringify(entry), 'utf-8')
  } catch {
    // キャッシュは無くても動く
  }
}

export async function headOf(repoPath: string): Promise<string> {
  try {
    return (await simpleGit(repoPath).revparse(['HEAD'])).trim()
  } catch (err) {
    // 元のエラーを添える。「見つかりません」だけでは、git が無いのか・パスが違うのか・
    // 権限なのかが分からず、同じ画面を前に手が止まる
    const why = err instanceof Error ? err.message.split('\n')[0] : String(err)
    throw new Error(`Gitリポジトリが見つかりません: ${repoPath}\n（${why}）`)
  }
}

export interface AnalyzeOptions {
  forceRefresh?: boolean
  onStage?: (p: AnalyzeProgress) => void
  onCacheHit?: () => void
}

/** キャッシュを見てから解析する。bare リポジトリでも動く */
export async function analyzeWithCache(
  repoPath: string,
  opts: AnalyzeOptions = {},
): Promise<{ data: AnalysisResult; fromCache: boolean }> {
  const head = await headOf(repoPath)

  if (!opts.forceRefresh) {
    const cached = loadCache(repoPath)
    if (cached?.headCommit === head) {
      opts.onCacheHit?.()
      return { data: cached.data, fromCache: true }
    }
  }

  const data = await analyzeRepo(repoPath, opts.onStage)
  saveCache(repoPath, head, data)
  return { data, fromCache: false }
}

// ── 最近開いたリポジトリ ─────────────────────────────────
export function loadRecentRepos(): string[] {
  try {
    const f = recentReposFile()
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8')) as string[]
  } catch { /* 壊れていたら空 */ }
  return []
}

export function pushRecentRepo(repoPath: string): string[] {
  const next = [repoPath, ...loadRecentRepos().filter(p => p !== repoPath)].slice(0, 10)
  try {
    fs.mkdirSync(path.dirname(recentReposFile()), { recursive: true })
    fs.writeFileSync(recentReposFile(), JSON.stringify(next), 'utf-8')
  } catch { /* 書けなくても動く */ }
  return next
}
