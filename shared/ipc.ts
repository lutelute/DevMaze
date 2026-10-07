/**
 * レンダラーとメインプロセスの契約。チャンネル名・引数・返り値をここで1回だけ決める。
 * preload / main / renderer がそれぞれ文字列を書いていた元の形では、
 * 名前を1つ変えると3箇所が黙ってずれた。
 */
import type { AnalysisResult } from './types'
import type { AnalyzeStage } from './analyzer/index'

export type Fail = { ok: false; error: string }
export type Ok<T> = { ok: true } & T
export type Result<T> = Ok<T> | Fail

export interface AnalyzeOk {
  data: AnalysisResult
  fromCache: boolean
}

export interface GithubRef { owner: string; name: string }

export interface FetchResult {
  fetched: boolean
  newCommits: number
  error?: string
}

export interface RemoteCheck {
  behind: boolean
  branch: string | null
  localHead: string | null
  remoteHead: string | null
  error?: string
}

export interface RepoStatus {
  prs: number
  issues: number
  ciStatus: 'success' | 'failure' | 'pending' | 'unknown'
  ciName: string | null
}

/** 解析の進捗。段階（実在する工程）か、素の一文か */
export type ProgressMessage =
  | { kind: 'stage'; stage: AnalyzeStage; detail?: string }
  | { kind: 'text'; text: string }

/** invoke（往復あり） */
export interface IpcInvokeMap {
  'repo:pickFolder':   { args: []; result: string | null }
  'repo:analyze':      { args: [repoPath: string, opts?: { forceRefresh?: boolean }]; result: Result<AnalyzeOk> }
  'repo:openGithub':   { args: [input: string]; result: Result<AnalyzeOk & { github: GithubRef }> }
  'repo:refresh':      { args: [repoPath: string]; result: Result<AnalyzeOk & { fetch: FetchResult }> }
  'repo:checkRemote':  { args: [repoPath: string]; result: RemoteCheck }
  'repo:recent':       { args: []; result: string[] }
  'repo:initial':      { args: []; result: string | null }
  'github:status':     { args: [owner: string, name: string]; result: Result<{ data: RepoStatus }> }
  'export:report':     { args: [repoPath: string]; result: Result<{ path: string }> }
  'export:knowledge':  { args: [repoPath: string]; result: Result<{ dir: string; files: number }> }
  'shell:openExternal': { args: [url: string]; result: Result<Record<never, never>> }
}

/** send（片道、レンダラー → メイン） */
export interface IpcSendMap {
  'watch:start': [repoPath: string]
  'watch:stop': []
}

/** メイン → レンダラーの通知 */
export interface IpcEventMap {
  'repo:progress': [message: ProgressMessage]
  'watch:changed': []
}

export type InvokeChannel = keyof IpcInvokeMap
export type SendChannel = keyof IpcSendMap
export type EventChannel = keyof IpcEventMap

/** preload が window に生やす API の形。レンダラーはこれだけを見る */
export interface DevmazeApi {
  invoke<K extends InvokeChannel>(channel: K, ...args: IpcInvokeMap[K]['args']): Promise<IpcInvokeMap[K]['result']>
  send<K extends SendChannel>(channel: K, ...args: IpcSendMap[K]): void
  on<K extends EventChannel>(channel: K, listener: (...args: IpcEventMap[K]) => void): () => void
}
