import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { AnalysisResult } from '../shared/types'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import MazeGraph from './components/MazeGraph'
import type { MazeGraphHandle } from './components/MazeGraph'
import MazeModeView from './components/MazeModeView'
import NodeDetail from './components/NodeDetail'
import type { MazeNode, StruggleEpisode } from '../shared/types'
import WelcomeScreen from './components/WelcomeScreen'
import SearchPanel from './components/SearchPanel'

type ViewMode = 'graph' | 'maze'

type AppState =
  | { phase: 'idle' }
  | { phase: 'loading'; progress: string }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; result: AnalysisResult; fromCache: boolean }

interface GithubInfo { owner: string; name: string }

// 迷路の一部だけを浮かび上がらせるための注目対象。
// 沼（時間の軸）とファイル（場所の軸）を同じ仕組みで扱う。
type Focus =
  | { kind: 'struggle'; episode: StruggleEpisode; hashes: string[] }
  | { kind: 'file'; path: string; hashes: string[] }
  | { kind: 'session'; hashes: string[] }
  | null

type Unit = 'commit' | 'session' | null

// 戻るで巻き戻すのは「画面に取り消す手段が無いもの」だけ。
// フィルターや表示件数は現在値がボタンに出ていて1クリックで戻せるので積まない。
interface NavState {
  unit: Unit
  focus: Focus
  selectedHash: string | null
  camera: { x: number; y: number; k: number } | null
}

const HISTORY_MAX = 50

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'idle' })
  const [selectedNode, setSelectedNode] = useState<MazeNode | null>(null)
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())
  const [recentRepos, setRecentRepos] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('graph')
  const [currentRepoPath, setCurrentRepoPath] = useState<string | null>(null)
  const [githubInfo, setGithubInfo] = useState<GithubInfo | null>(null)
  const [watchBanner, setWatchBanner] = useState(false)
  const [focus, setFocus] = useState<Focus>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [remoteBehind, setRemoteBehind] = useState(false)
  // 表示単位は MazeGraph ではなく App が持つ（戻るで巻き戻す対象なので）
  const [unit, setUnit] = useState<Unit>(null)
  const [past, setPast] = useState<NavState[]>([])
  const [ahead, setAhead] = useState<NavState | null>(null)   // 「さっきの場所へ」1段だけ
  const graphRef = useRef<MazeGraphHandle>(null)

  const snapshot = useCallback((): NavState => ({
    unit, focus, selectedHash: selectedNode?.id ?? null,
    camera: graphRef.current?.getCamera() ?? null,
  }), [unit, focus, selectedNode])

  // 場所が変わる操作の直前に、いまの場所を積む
  const pushHistory = useCallback(() => {
    setPast(p => [...p.slice(-(HISTORY_MAX - 1)), snapshot()])
    setAhead(null)
  }, [snapshot])

  const applyNav = useCallback((s: NavState) => {
    graphRef.current?.queueCamera(s.camera)
    setUnit(s.unit)
    setFocus(s.focus)
    setSelectedNode(null)
    if (s.selectedHash) {
      // ノードの実体は解析結果から引き直す（ID を保存すると集約で意味が変わる）
      setPendingSelect(s.selectedHash)
    }
  }, [])

  // 復元したい選択を、解析結果が揃ってから当てる
  const [pendingSelect, setPendingSelect] = useState<string | null>(null)

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
    setFocus(null)
    // リポジトリが変われば全部のハッシュが別物になる。履歴は捨てる
    setPast([]); setAhead(null); setUnit(null)

    const result = await window.electronAPI.analyzeRepo(resolved, forceRefresh)
    handleAnalysisResult(resolved, result)
  }, [handleAnalysisResult])

  const openGithubRepo = useCallback(async (input: string) => {
    setState({ phase: 'loading', progress: 'GitHubリポジトリを確認中...' })
    setSelectedNode(null)
    setGithubInfo(null)
    setFocus(null)
    // リポジトリが変われば全部のハッシュが別物になる。履歴は捨てる
    setPast([]); setAhead(null); setUnit(null)

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

  // 再スキャンは「リモートから取り込んでから」行う。
  // 手元のコミットだけ見ていても、GitHub 側の新着は永久に反映されない。
  const refreshRepo = useCallback(async () => {
    if (!currentRepoPath) return
    setState({ phase: 'loading', progress: 'リモートから取り込み中...' })
    setSelectedNode(null)
    setFocus(null)
    setPast([]); setAhead(null)

    const res = await window.electronAPI.refreshRepo(currentRepoPath)
    if (!res.ok) {
      setState({ phase: 'error', message: res.error })
      return
    }
    setState({ phase: 'ready', result: res.data, fromCache: false })
    setWatchBanner(false)

    const f = res.fetch
    setToast(
      f?.error ? `リモートから取り込めませんでした（${f.error}）。手元の履歴で解析しました`
      : f?.newCommits ? `新着 ${f.newCommits} 件を取り込みました`
      : f?.fetched ? 'すでに最新でした'
      : '再解析しました（リモートなし）'
    )
  }, [currentRepoPath])

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

  // リモートに新着が無いかを自分から見に行く。
  // 手元のファイル監視だけでは、GitHub 側に積まれたコミットには永久に気づけない。
  useEffect(() => {
    if (!currentRepoPath) { setRemoteBehind(false); return }
    let alive = true

    const check = async () => {
      const res = await window.electronAPI.checkRemote?.(currentRepoPath)
      if (alive && res && !res.error) setRemoteBehind(res.behind)
    }

    setRemoteBehind(false)
    check()
    const timer = setInterval(check, 5 * 60_000)   // 5分ごと
    return () => { alive = false; clearInterval(timer) }
  }, [currentRepoPath])

  // ローカルリポジトリ監視
  useEffect(() => {
    if (!currentRepoPath) { window.electronAPI.stopWatch?.(); return }
    window.electronAPI.startWatch?.(currentRepoPath)
    const off = window.electronAPI.onWatchChanged?.(() => setWatchBanner(true))
    return () => { off?.(); window.electronAPI.stopWatch?.() }
  }, [currentRepoPath])

  const result = state.phase === 'ready' ? state.result : null
  const fromCache = state.phase === 'ready' ? state.fromCache : false

  // 注目対象のコミットだけを迷路上に浮かび上がらせる
  const highlightIds = useMemo(
    () => focus ? new Set(focus.hashes) : undefined,
    [focus],
  )

  // 沼に属するコミット全体（迷路上に常時マーカーを出す）
  const struggleNodeIds = useMemo(
    () => new Set(result?.struggles.flatMap(e => e.commits.map(c => c.hash)) ?? []),
    [result],
  )

  // コミットごとの深刻度（複数の沼に属するなら最大）。迷路の印の強さに使う
  const struggleSeverity = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of result?.struggles ?? []) {
      for (const c of e.commits) {
        m.set(c.hash, Math.max(m.get(c.hash) ?? 0, e.severity))
      }
    }
    return m
  }, [result])

  const exportReport = useCallback(async () => {
    if (!currentRepoPath) return
    setToast('レポートを生成中...')
    const res = await window.electronAPI.exportReport(currentRepoPath)
    if (res.ok) setToast(`保存しました: ${res.path}`)
    else setToast(res.error === 'canceled' ? null : `保存に失敗しました: ${res.error}`)
  }, [currentRepoPath])


  useEffect(() => {
    if (!toast || toast.endsWith('中...')) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  // 選択中のコミットが属する沼（詳細パネルに出す）
  const nodeStruggles = useMemo(() => {
    if (!result || !selectedNode) return []
    return result.struggles.filter(e => e.commits.some(c => c.hash === selectedNode.id))
  }, [result, selectedNode])

  const selectStruggle = useCallback((episode: StruggleEpisode | null) => {
    if (!episode) { setFocus(null); return }
    if (focus?.kind === 'struggle' && focus.episode.id === episode.id) return
    pushHistory()
    setFocus({ kind: 'struggle', episode, hashes: episode.commits.map(c => c.hash) })
    const first = result?.graph.nodes.find(n => n.id === episode.commits[0]?.hash)
    if (first) setSelectedNode(first)
  }, [result, focus, pushHistory])

  // ファイルから辿る: そのファイルを触ったコミットだけを残し、最新を選ぶ
  const selectFile = useCallback((path: string | null) => {
    if (!path || !result) { setFocus(null); return }
    const touching = result.graph.nodes.filter(n => n.files.includes(path))
    if (touching.length === 0) {
      setToast(`${path} を触ったコミットは表示範囲にありません`)
      return
    }
    if (focus?.kind === 'file' && focus.path === path) return
    pushHistory()
    setFocus({ kind: 'file', path, hashes: touching.map(n => n.id) })
    const latest = [...touching].sort((a, b) => b.timestamp - a.timestamp)[0]
    setSelectedNode(latest)
  }, [result, focus, pushHistory])

  // ── 戻る / さっきの場所へ ────────────────────────────────
  // 更新関数の中で副作用を呼ばないこと（StrictMode で2回走って履歴が壊れる）
  const goBack = useCallback(() => {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    setAhead(snapshot())
    setPast(p => p.slice(0, -1))
    applyNav(prev)
  }, [past, snapshot, applyNav])

  const goForward = useCallback(() => {
    if (!ahead) return
    const target = ahead
    setPast(p => [...p, snapshot()])
    setAhead(null)
    applyNav(target)
  }, [ahead, snapshot, applyNav])

  useEffect(() => {
    if (!pendingSelect || !result) return
    const n = result.graph.nodes.find(x => x.id === pendingSelect)
    if (n) setSelectedNode(n)
    setPendingSelect(null)
  }, [pendingSelect, result])

  // ⌘F で検索 / ⌘[ ⌘← で戻る / ⌘] ⌘→ でさっきの場所へ。
  // Esc は検索パネルと GitHub 入力の「閉じる」に使われているので、履歴には割り当てない。
  // goBack より後ろに置くこと（前に置くと dep 配列の評価で TDZ に落ちて画面が真っ白になる）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'f') { e.preventDefault(); setSearchOpen(v => !v) }
      else if (k === '[' || k === 'arrowleft') { e.preventDefault(); goBack() }
      else if (k === ']' || k === 'arrowright') { e.preventDefault(); goForward() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack, goForward])

  // いま何を見ているかの1行（戻るバーに出す）
  const focusLabel = useMemo(() => {
    if (!focus) return null
    if (focus.kind === 'struggle') return `↩︎ ${focus.episode.title} · ${focus.hashes.length}件`
    if (focus.kind === 'file') return `📄 ${focus.path} · ${focus.hashes.length}件`
    return `⊞ まとまりの中 · ${focus.hashes.length}件`
  }, [focus])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg-base)' }}>
      <Header
        repoName={result?.repoName}
        onOpenRepo={() => openRepo()}
        onOpenGithub={openGithubRepo}
        onRecentRepo={openRepo}
        onRefresh={result ? refreshRepo : undefined}
        onExportReport={result ? exportReport : undefined}
        onSearch={result ? () => setSearchOpen(true) : undefined}
        recentRepos={recentRepos}
        fromCache={fromCache}
        githubInfo={githubInfo}
      />
      {(watchBanner || remoteBehind) && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 16px',
          background: 'rgba(212,168,74,0.12)',
          borderBottom: '1px solid rgba(212,168,74,0.25)',
          fontSize: 12, color: 'var(--accent)',
          flexShrink: 0,
        }}>
          <span>
            {remoteBehind
              ? 'リモート（GitHub）に、まだ取り込んでいないコミットがあります'
              : '手元に新しいコミットを検出しました'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setWatchBanner(false); setRemoteBehind(false); refreshRepo() }}
              style={{
                background: 'var(--accent)', color: '#1A1107', border: 'none',
                borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {remoteBehind ? '取り込む' : '再読み込み'}
            </button>
            <button
              onClick={() => { setWatchBanner(false); setRemoteBehind(false) }}
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
          selectedStruggleId={focus?.kind === 'struggle' ? focus.episode.id : undefined}
          onSelectStruggle={selectStruggle}
          selectedFilePath={focus?.kind === 'file' ? focus.path : undefined}
          onSelectFile={selectFile}
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
              {/* 戻る + いまどこ。戻れるものも進めるものも注目も無いときは出さない。
                  ahead を条件に入れないと、戻った直後にバーごと消えて進めなくなる */}
              {(past.length > 0 || focusLabel || ahead) && (
                <div style={{
                  position: 'absolute', top: 12, left: 12, zIndex: 12,
                  display: 'flex', alignItems: 'center', gap: 6, height: 26,
                  background: 'rgba(26,17,7,0.86)', backdropFilter: 'blur(8px)',
                  border: '1px solid var(--border-interactive)', borderRadius: 8, padding: '0 6px',
                  // 上中央のビュー切替（幅150px前後）に食い込まないところで止める
                  maxWidth: 'calc(50% - 100px)',
                }}>
                  <button
                    onClick={goBack}
                    disabled={past.length === 0}
                    title={past.length ? `戻る（⌘[）· 残り ${past.length}` : '戻れる場所がありません'}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 24, height: 20, borderRadius: 5,
                      border: '1px solid var(--border-interactive)', background: 'transparent',
                      color: past.length ? 'var(--text-secondary)' : 'var(--text-disabled)',
                      opacity: past.length ? 1 : 0.35,
                      fontSize: 12, lineHeight: 1, flexShrink: 0,
                    }}
                  >←</button>

                  {focusLabel ? (
                    <>
                      <span style={{
                        fontSize: 11, color: 'var(--accent)',
                        background: 'rgba(212,168,74,0.12)', borderRadius: 5,
                        padding: '2px 8px', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {focusLabel}
                      </span>
                      <button
                        onClick={() => { pushHistory(); setFocus(null) }}
                        title="注目を解除して全体へ"
                        style={{
                          background: 'transparent', border: 'none', padding: '0 3px',
                          color: 'var(--text-dim)', fontSize: 11, flexShrink: 0,
                        }}
                      >✕</button>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', padding: '0 4px' }}>全体</span>
                  )}

                  {ahead && (
                    <button
                      onClick={goForward}
                      title="さっきの場所へ（⌘]）"
                      style={{
                        background: 'transparent', border: '1px solid var(--border-interactive)', borderRadius: 5,
                        padding: '1px 8px', color: 'var(--text-secondary)',
                        fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >さっきの場所へ →</button>
                  )}
                </div>
              )}

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
                  ref={graphRef}
                  graph={result!.graph}
                  filterTypes={filterTypes}
                  onNodeClick={setSelectedNode}
                  selectedNodeId={selectedNode?.id}
                  highlightIds={highlightIds}
                  struggleIds={struggleNodeIds}
                  struggleSeverity={struggleSeverity}
                  unitOverride={unit}
                  onUnitChange={u => { pushHistory(); setUnit(u) }}
                  onClearFocus={() => setFocus(null)}
                  onDrillDown={hashes => {
                    pushHistory()
                    setUnit('commit')
                    setFocus({ kind: 'session', hashes })
                    const first = result!.graph.nodes.find(n => n.id === hashes[0])
                    if (first) setSelectedNode(first)
                  }}
                />
              ) : (
                <MazeModeView
                  graph={result!.graph}
                  filterTypes={filterTypes}
                  onNodeClick={setSelectedNode}
                  selectedNodeId={selectedNode?.id}
                  highlightIds={highlightIds}
                  struggleIds={struggleNodeIds}
                />
              )}
            </>
          )}

          {/* トーストは下部の操作バー（高さ27px・bottom:14）の上に置く。
              fixed のままだとサイドバーぶん中心が126pxずれたうえ 21px 重なっていた */}
          {toast && (
            <div style={{
              position: 'absolute', bottom: 52, left: '50%', transform: 'translateX(-50%)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '9px 16px', zIndex: 500,
              fontSize: 12, color: 'var(--text-primary)',
              boxShadow: '0 8px 28px rgba(0,0,0,0.55)', maxWidth: '80%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {toast}
            </div>
          )}
        </div>

        {searchOpen && result && (
          <SearchPanel
            nodes={result.graph.nodes}
            onSelect={node => { setSelectedNode(node); setFocus(null) }}
            onSelectFile={selectFile}
            onClose={() => setSearchOpen(false)}
          />
        )}

        {selectedNode && (
          <NodeDetail
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            struggles={nodeStruggles}
            hotspots={result?.hotspots}
            onSelectStruggle={selectStruggle}
            onSelectFile={selectFile}
            remoteUrl={result?.remoteUrl}
          />
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
