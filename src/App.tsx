import { useState, useEffect, useCallback } from 'react'
import type { AnalysisResult } from '../shared/types'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import MazeGraph from './components/MazeGraph'
import NodeDetail from './components/NodeDetail'
import type { MazeNode } from '../shared/types'
import WelcomeScreen from './components/WelcomeScreen'

type AppState =
  | { phase: 'idle' }
  | { phase: 'loading'; progress: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; result: AnalysisResult }

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'idle' })
  const [selectedNode, setSelectedNode] = useState<MazeNode | null>(null)
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())
  const [recentRepos, setRecentRepos] = useState<string[]>([])

  // Declared first so it can be used in effects below
  const openRepo = useCallback(async (repoPath?: string) => {
    const resolvedPath = repoPath ?? await window.electronAPI.openRepoDialog()
    if (!resolvedPath) return

    setState({ phase: 'loading', progress: '初期化中...' })
    setSelectedNode(null)

    const result = await window.electronAPI.analyzeRepo(resolvedPath)
    if (!result.ok) {
      setState({ phase: 'error', message: result.error })
      return
    }
    setState({ phase: 'ready', result: result.data })
    setRecentRepos(prev => [resolvedPath, ...prev.filter(p => p !== resolvedPath)].slice(0, 10))
  }, [])

  useEffect(() => {
    window.electronAPI.getRecentRepos().then(setRecentRepos)
  }, [])

  useEffect(() => {
    const off = window.electronAPI.onProgress(msg => {
      setState(s => s.phase === 'loading' ? { phase: 'loading', progress: msg } : s)
    })
    return off
  }, [])

  // Dev: auto-open repo from env var DEVMAZE_REPO
  useEffect(() => {
    window.electronAPI.getInitialRepo?.().then(p => {
      if (p) openRepo(p)
    })
  }, [openRepo])

  const result = state.phase === 'ready' ? state.result : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-base)' }}>
      <Header
        repoName={result?.repoName}
        onOpenRepo={() => openRepo()}
        onRecentRepo={openRepo}
        recentRepos={recentRepos}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Sidebar */}
        <Sidebar
          result={result}
          filterTypes={filterTypes}
          onFilterChange={setFilterTypes}
        />

        {/* Main Graph Area */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {state.phase === 'idle' && (
            <WelcomeScreen onOpen={() => openRepo()} recentRepos={recentRepos} onOpenRecent={openRepo} />
          )}

          {state.phase === 'loading' && (
            <LoadingScreen progress={state.progress} />
          )}

          {state.phase === 'error' && (
            <ErrorScreen message={state.message} onRetry={() => setState({ phase: 'idle' })} />
          )}

          {state.phase === 'ready' && (
            <MazeGraph
              graph={result!.graph}
              filterTypes={filterTypes}
              onNodeClick={setSelectedNode}
              selectedNodeId={selectedNode?.id}
            />
          )}
        </div>

        {/* Right Panel: Node Detail */}
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
        background: 'var(--accent)', color: '#fff', border: 'none', padding: '8px 20px',
        borderRadius: 6, cursor: 'pointer', fontWeight: 500,
      }}>
        戻る
      </button>
    </div>
  )
}
