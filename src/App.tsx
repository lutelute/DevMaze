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

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'idle' })
  const [selectedNode, setSelectedNode] = useState<MazeNode | null>(null)
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())
  const [recentRepos, setRecentRepos] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('graph')
  const [currentRepoPath, setCurrentRepoPath] = useState<string | null>(null)

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

    const result = await window.electronAPI.analyzeRepo(resolved, forceRefresh)
    handleAnalysisResult(resolved, result)
  }, [handleAnalysisResult])

  const openGithubRepo = useCallback(async (input: string) => {
    setState({ phase: 'loading', progress: 'GitHubリポジトリを確認中...' })
    setSelectedNode(null)

    const result = await window.electronAPI.openGithubRepo(input)
    // GitHub の場合、repoPath は bare clone のローカルパス（resultから取れないのでinputを仮パスとして記録）
    const r = result as { ok: boolean; data?: AnalysisResult; fromCache?: boolean; error?: string }
    if (!r.ok || !r.data) {
      setState({ phase: 'error', message: r.error ?? '不明なエラー' })
      return
    }
    setState({ phase: 'ready', result: r.data, fromCache: r.fromCache ?? false })
    setCurrentRepoPath(r.data.repoPath)
    setRecentRepos(prev => [r.data!.repoPath, ...prev.filter(p => p !== r.data!.repoPath)].slice(0, 10))
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
      />

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
      height: '100%', gap: 16,
    }}>
      <div style={{ fontSize: 32 }}>🌀</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{progress}</div>
      <LoadingDots />
    </div>
  )
}

function LoadingDots() {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
          animation: `bounce 1.2s ${i * 0.2}s infinite ease-in-out`,
        }} />
      ))}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 16, padding: 40,
    }}>
      <div style={{ fontSize: 32 }}>⚠️</div>
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
