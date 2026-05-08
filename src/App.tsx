import { useState, useEffect, useCallback } from 'react'
import type { AnalysisResult } from '../shared/types'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import MazeGraph from './components/MazeGraph'
import MazeModeView from './components/MazeModeView'
import NodeDetail from './components/NodeDetail'
import type { MazeNode } from '../shared/types'
import WelcomeScreen from './components/WelcomeScreen'

type ViewMode = 'graph' | 'maze'

type AppState =
  | { phase: 'idle' }
  | { phase: 'loading'; progress: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; result: AnalysisResult; fromCache: boolean }

interface GithubInfo { owner: string; name: string }

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'idle' })
  const [selectedNode, setSelectedNode] = useState<MazeNode | null>(null)
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())
  const [recentRepos, setRecentRepos] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('graph')
  const [currentRepoPath, setCurrentRepoPath] = useState<string | null>(null)
  const [githubInfo, setGithubInfo] = useState<GithubInfo | null>(null)
  const [watchBanner, setWatchBanner] = useState(false)

  const handleAnalysisResult = useCallback((repoPath: string, result: unknown) => {
    const r = result as { ok: boolean; data?: AnalysisResult; fromCache?: boolean; error?: string }
    if (!r.ok || !r.data) {
      setState({ phase: 'error', message: r.error ?? '不明なエラー' })
      return
    }
    setState({ phase: 'ready', result: r.data, fromCache: r.fromCache ?? false })
    setCurrentRepoPath(repoPath)
    setRecentRepos(prev => [repoPath, ...prev.filter(p => p !== repoPath)].slice(0, 10))
  }, [])

  const openRepo = useCallback(async (repoPath?: string, forceRefresh = false) => {
    const resolved = repoPath ?? await window.electronAPI.openRepoDialog()
    if (!resolved) return

    setState({ phase: 'loading', progress: '初期化中...' })
    setSelectedNode(null)
    setGithubInfo(null)

    const result = await window.electronAPI.analyzeRepo(resolved, forceRefresh)
    handleAnalysisResult(resolved, result)
  }, [handleAnalysisResult])

  const openGithubRepo = useCallback(async (input: string) => {
    setState({ phase: 'loading', progress: 'GitHubリポジトリを確認中...' })
    setSelectedNode(null)
    setGithubInfo(null)

    const result = await window.electronAPI.openGithubRepo(input)
    const r = result as { ok: boolean; data?: AnalysisResult; fromCache?: boolean; error?: string }
    if (!r.ok || !r.data) {
      setState({ phase: 'error', message: r.error ?? '不明なエラー' })
      return
    }
    setState({ phase: 'ready', result: r.data, fromCache: r.fromCache ?? false })
    setCurrentRepoPath(r.data.repoPath)
    setRecentRepos(prev => [r.data!.repoPath, ...prev.filter(p => p !== r.data!.repoPath)].slice(0, 10))

    // owner/name を解析して保持
    const s = input.trim().replace(/\.git$/, '')
    const short = s.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/)
    const url = s.match(/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\/.*)?$/)
    const m = short ?? url
    if (m) setGithubInfo({ owner: m[1], name: m[2] })
  }, [])

  const refreshRepo = useCallback(() => {
    if (currentRepoPath) openRepo(currentRepoPath, true)
  }, [currentRepoPath, openRepo])

  useEffect(() => {
    window.electronAPI.getRecentRepos().then(setRecentRepos)
  }, [])

  useEffect(() => {
    const off = window.electronAPI.onProgress(msg => {
      setState(s => s.phase === 'loading' ? { phase: 'loading', progress: msg } : s)
    })
    return off
  }, [])

  useEffect(() => {
    window.electronAPI.getInitialRepo?.().then(p => {
      if (p) openRepo(p)
    })
  }, [openRepo])

  // ローカルリポジトリ監視
  useEffect(() => {
    if (!currentRepoPath) { window.electronAPI.stopWatch?.(); return }
    window.electronAPI.startWatch?.(currentRepoPath)
    const off = window.electronAPI.onWatchChanged?.(() => setWatchBanner(true))
    return () => { off?.(); window.electronAPI.stopWatch?.() }
  }, [currentRepoPath])

  const result = state.phase === 'ready' ? state.result : null
  const fromCache = state.phase === 'ready' ? state.fromCache : false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-base)' }}>
      <Header
        repoName={result?.repoName}
        onOpenRepo={() => openRepo()}
        onOpenGithub={openGithubRepo}
        onRecentRepo={openRepo}
        onRefresh={result ? refreshRepo : undefined}
        recentRepos={recentRepos}
        fromCache={fromCache}
        githubInfo={githubInfo}
      />
      {watchBanner && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 16px',
          background: 'rgba(212,168,74,0.12)',
          borderBottom: '1px solid rgba(212,168,74,0.25)',
          fontSize: 12, color: 'var(--accent)',
          flexShrink: 0,
        }}>
          <span>新しいコミットを検出しました</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setWatchBanner(false); refreshRepo() }}
              style={{
                background: 'var(--accent)', color: '#1A1107', border: 'none',
                borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >
              再読み込み
            </button>
            <button
              onClick={() => setWatchBanner(false)}
              style={{
                background: 'transparent', color: 'var(--text-secondary)', border: 'none',
                borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          result={result}
          filterTypes={filterTypes}
          onFilterChange={setFilterTypes}
          recentRepos={recentRepos}
          currentRepoPath={currentRepoPath}
          onOpenRecent={openRepo}
        />

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--bg-base)' }}>
          {state.phase === 'idle' && (
            <WelcomeScreen onOpen={() => openRepo()} recentRepos={recentRepos} onOpenRecent={openRepo} />
          )}
          {state.phase === 'loading' && <LoadingScreen progress={state.progress} />}
          {state.phase === 'error' && (
            <ErrorScreen message={state.message} onRetry={() => setState({ phase: 'idle' })} />
          )}
          {state.phase === 'ready' && (
            <>
              {/* ビュー切り替えボタン */}
              <div style={{
                position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
                zIndex: 10, display: 'flex', gap: 2,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: 3,
                boxShadow: 'var(--shadow-sm)',
              }}>
                {(['graph', 'maze'] as ViewMode[]).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    style={{
                      padding: '4px 14px', borderRadius: 'var(--radius-md)',
                      fontSize: 11, fontWeight: 500,
                      background: viewMode === mode ? 'var(--accent)' : 'transparent',
                      color: viewMode === mode ? '#1A1107' : 'var(--text-secondary)',
                      transition: 'all var(--t-base)',
                      letterSpacing: '0.2px',
                    }}
                  >
                    {mode === 'graph' ? '⬡ Graph' : '⊞ Maze'}
                  </button>
                ))}
              </div>

              {viewMode === 'graph' ? (
                <MazeGraph
                  graph={result!.graph}
                  filterTypes={filterTypes}
                  onNodeClick={setSelectedNode}
                  selectedNodeId={selectedNode?.id}
                />
              ) : (
                <MazeModeView
                  graph={result!.graph}
                  filterTypes={filterTypes}
                  onNodeClick={setSelectedNode}
                  selectedNodeId={selectedNode?.id}
                />
              )}
            </>
          )}
        </div>

        {selectedNode && (
          <NodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />
        )}
      </div>
    </div>
  )
}

function LoadingScreen({ progress }: { progress: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 14,
    }}>
      {/* SVG spinner — arc rotating around a dim circle */}
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none"
        style={{ animation: 'spin 0.9s linear infinite' }}>
        <circle cx="20" cy="20" r="16" stroke="var(--accent)" strokeWidth="3" opacity="0.12"/>
        <path d="M20 4 A16 16 0 0 1 36 20"
          stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"/>
      </svg>
      <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{progress}</div>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 16, padding: 40,
    }}>
      <svg width="36" height="36" viewBox="0 0 16 16" fill="none">
        <path d="M8 2 L14.5 13.5 H1.5 Z" stroke="#EF4444" strokeWidth="1.4" strokeLinejoin="round"/>
        <line x1="8" y1="6.5" x2="8" y2="10"   stroke="#EF4444" strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="8" cy="11.5" r="0.7" fill="#EF4444"/>
      </svg>
      <div style={{ color: '#EF4444', fontWeight: 600 }}>解析エラー</div>
      <div style={{
        color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 400,
        background: 'var(--bg-panel)', padding: '12px 16px', borderRadius: 8,
        fontFamily: 'monospace', fontSize: 12,
      }}>
        {message}
      </div>
      <button onClick={onRetry} style={{
        background: 'var(--accent)', color: '#1A1107', border: 'none', padding: '8px 20px',
        borderRadius: 6, cursor: 'pointer', fontWeight: 500,
      }}>
        戻る
      </button>
    </div>
  )
}
