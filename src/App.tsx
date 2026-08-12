import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { AnalysisResult } from '../shared/types'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import MazeGraph from './components/MazeGraph'
import type { MazeGraphHandle } from './components/MazeGraph'
import CalendarView from './components/CalendarView'
import NodeDetail from './components/NodeDetail'
import type { MazeNode, StruggleEpisode, Zone } from '../shared/types'
import WelcomeScreen from './components/WelcomeScreen'
import SearchPanel from './components/SearchPanel'

type ViewMode = 'graph' | 'calendar'

type AppState =
  | { phase: 'idle' }
  | { phase: 'loading'; progress: string }
  // 何をしようとして失敗したかを持つ。元は message だけで、
  // 失敗したパスも直前の正常な結果も捨てていたので、同じ条件で再試行できなかった
  | { phase: 'error'; message: string; retry?: () => void; target?: string }
  | { phase: 'ready'; result: AnalysisResult; fromCache: boolean }

interface GithubInfo { owner: string; name: string }

// 迷路の一部だけを浮かび上がらせるための注目対象。
// 沼（時間の軸）とファイル（場所の軸）を同じ仕組みで扱う。
type Focus =
  | { kind: 'struggle'; episode: StruggleEpisode; hashes: string[] }
  | { kind: 'file'; path: string; hashes: string[] }
  | { kind: 'session'; hashes: string[] }
  | { kind: 'zone'; zone: Zone; hashes: string[] }
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

  const handleAnalysisResult = useCallback((
    repoPath: string, result: unknown,
    fail?: { target: string; retry: () => void },
  ) => {
    const r = result as { ok: boolean; data?: AnalysisResult; fromCache?: boolean; error?: string }
    if (!r.ok || !r.data) {
      setState({ phase: 'error', message: r.error ?? '不明なエラー', ...fail })
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
    handleAnalysisResult(resolved, result, { target: resolved, retry: () => openRepo(resolved, forceRefresh) })
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
      setState({
        phase: 'error', message: r.error ?? '不明なエラー',
        target: input, retry: () => openGithubRepo(input),
      })
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
      setState({
        phase: 'error', message: res.error,
        target: currentRepoPath, retry: () => refreshRepo(),
      })
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

  // 開発フェーズは「期間」。押した結果もその期間の強調にする。
  // 元は toggleFilter(zone.theme) で、行に期間と件数を出しているのに
  // 押すと全期間の同種別だけが残っていた。同じ theme のフェーズが2区間あると
  // 両方が同時に点灯するので、選択の見え方も嘘になっていた
  const selectZone = useCallback((zone: Zone | null) => {
    if (!zone || !result) { setFocus(null); return }
    if (focus?.kind === 'zone' && focus.zone.id === zone.id) { setFocus(null); return }
    const hashes = result.graph.nodes
      .filter(n => n.timestamp >= zone.startTimestamp && n.timestamp <= zone.endTimestamp)
      .map(n => n.id)
    if (hashes.length === 0) return
    pushHistory()
    setFocus({ kind: 'zone', zone, hashes })
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

  // 修飾キー無しの操作。← → で時系列を辿り、Esc は「いちばん手前を1つ閉じる」。
  // Esc を履歴の戻るに割り当てないのは、検索と GitHub 入力が既に使っているため
  const [helpOpen, setHelpOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'Escape') {
        // 手前から1つずつ。全部閉じてから注目を解く
        if (helpOpen) { setHelpOpen(false); return }
        if (searchOpen) { setSearchOpen(false); return }
        if (selectedNode) { setSelectedNode(null); return }
        if (focus) { pushHistory(); setFocus(null) }
        return
      }
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault(); setHelpOpen(v => !v); return
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return

      const r = state.phase === 'ready' ? state.result : null
      if (!r) return
      e.preventDefault()

      // 表示中の母集団を時系列で辿る。注目があるならその中だけを行き来する
      const pool = (focus
        ? r.graph.nodes.filter(n => focus.hashes.includes(n.id))
        : r.graph.nodes
      ).slice().sort((a, b) => a.timestamp - b.timestamp)
      if (pool.length === 0) return

      const i = selectedNode ? pool.findIndex(n => n.id === selectedNode.id) : -1
      const next = e.key === 'ArrowRight'
        ? pool[i < 0 ? 0 : Math.min(pool.length - 1, i + 1)]
        : pool[i < 0 ? pool.length - 1 : Math.max(0, i - 1)]
      if (next) setSelectedNode(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, focus, selectedNode, searchOpen, helpOpen, pushHistory])

  // いま何を見ているかの1行（戻るバーに出す）
  const focusLabel = useMemo(() => {
    if (!focus) return null
    if (focus.kind === 'struggle') return `↩︎ ${focus.episode.title} · ${focus.hashes.length}件`
    if (focus.kind === 'file') return `📄 ${focus.path} · ${focus.hashes.length}件`
    if (focus.kind === 'zone') return `⛰ ${focus.zone.label} · ${focus.hashes.length}件`
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
          selectedZoneId={focus?.kind === 'zone' ? focus.zone.id : undefined}
          onSelectZone={selectZone}
        />

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--bg-base)' }}>
          {state.phase === 'idle' && (
            <WelcomeScreen onOpen={() => openRepo()} recentRepos={recentRepos} onOpenRecent={openRepo} />
          )}
          {state.phase === 'loading' && <LoadingScreen progress={state.progress} />}
          {state.phase === 'error' && (
            <ErrorScreen
              message={state.message}
              target={state.target}
              onRetry={state.retry}
              onPickOther={() => openRepo()}
              onBack={() => setState({ phase: 'idle' })}
            />
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
                {(['graph', 'calendar'] as ViewMode[]).map(mode => (
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
                    {mode === 'graph' ? '⬡ 迷路' : '▦ 暦'}
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
                  struggles={result!.struggles}
                  activeStruggleId={focus?.kind === 'struggle' ? focus.episode.id : undefined}
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
                <CalendarView
                  graph={result!.graph}
                  activity={result!.activity}
                  filterTypes={filterTypes}
                  onNodeClick={setSelectedNode}
                  selectedNodeId={selectedNode?.id}
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

        {helpOpen && (
          <div
            onClick={() => setHelpOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 600,
              background: 'rgba(10,6,2,0.55)', backdropFilter: 'blur(2px)',
              display: 'grid', placeItems: 'center',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: 460, background: 'var(--bg-elevated)',
                border: '1px solid var(--border-interactive)', borderRadius: 10,
                padding: '18px 22px', boxShadow: '0 20px 56px rgba(0,0,0,0.75)',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>キーボード操作</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '9px 16px', fontSize: 12.5 }}>
                {([
                  ['← →', '時系列を1つ前後へ（注目中はその中だけ）'],
                  ['⌘[ / ⌘←', '戻る'],
                  ['⌘] / ⌘→', 'さっきの場所へ'],
                  ['⌘F', 'コミットを検索'],
                  ['Esc', '手前から1つ閉じる（検索 → 詳細 → 注目）'],
                  ['?', 'この一覧'],
                ] as const).map(([key, desc]) => (
                  <React.Fragment key={key}>
                    <kbd style={{
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                      background: 'var(--bg-base)', border: '1px solid var(--border-interactive)',
                      borderRadius: 5, padding: '2px 8px', whiteSpace: 'nowrap',
                      color: 'var(--text-primary)', justifySelf: 'start',
                    }}>{key}</kbd>
                    <span style={{ color: 'var(--text-secondary)' }}>{desc}</span>
                  </React.Fragment>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 15 }}>
                クリックか Esc で閉じる
              </div>
            </div>
          </div>
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

// 実在する工程だけを並べる。偽のパーセンテージは出さない
const STAGES: { id: string; label: string }[] = [
  { id: 'git',    label: 'Git履歴を取得' },
  { id: 'graph',  label: 'コミットを分類・グラフを構築' },
  { id: 'detect', label: '沼・場所・働き方を解析' },
  { id: 'layout', label: '迷路を準備' },
]

/** 進捗メッセージが段階の JSON なら段階を、そうでなければ素の文字列を返す */
function parseProgress(msg: string): { stage?: string; detail?: string; text?: string } {
  if (!msg.startsWith('{')) return { text: msg }
  try {
    const o = JSON.parse(msg) as { stage?: string; detail?: string }
    return o.stage ? { stage: o.stage, detail: o.detail } : { text: msg }
  } catch { return { text: msg } }
}

function LoadingScreen({ progress }: { progress: string }) {
  const p = parseProgress(progress)
  const idx = p.stage ? STAGES.findIndex(s => s.id === p.stage) : -1

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 18,
    }}>
      <svg width="34" height="34" viewBox="0 0 40 40" fill="none"
        style={{ animation: 'spin 0.9s linear infinite' }}>
        <circle cx="20" cy="20" r="16" stroke="var(--accent)" strokeWidth="3" opacity="0.12"/>
        <path d="M20 4 A16 16 0 0 1 36 20"
          stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"/>
      </svg>

      {idx < 0 ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{p.text ?? progress}</div>
      ) : (
        <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {STAGES.map((s, i) => {
            const done = i < idx
            const now = i === idx
            return (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5,
                color: done ? 'var(--text-dim)' : now ? 'var(--text-primary)' : 'var(--text-disabled)',
              }}>
                <span style={{
                  width: 14, textAlign: 'center', fontFamily: 'monospace',
                  color: done ? '#7B9E5A' : now ? 'var(--accent)' : 'var(--text-disabled)',
                }}>
                  {done ? '✓' : now ? '●' : '○'}
                </span>
                <span style={{ flex: 1 }}>{s.label}</span>
                {now && p.detail && (
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                    {p.detail}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 失敗した対象と再試行を持つ。元は message だけを出し「戻る」で idle へ帰すだけで、
// 何をしようとして失敗したのかも、同じ条件でやり直す手段も失っていた
function ErrorScreen({ message, target, onRetry, onPickOther, onBack }: {
  message: string
  target?: string
  onRetry?: () => void
  onPickOther: () => void
  onBack: () => void
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 14, padding: 40,
    }}>
      <svg width="30" height="30" viewBox="0 0 16 16" fill="none">
        <path d="M8 2 L14.5 13.5 H1.5 Z" stroke="#C0624B" strokeWidth="1.4" strokeLinejoin="round"/>
        <line x1="8" y1="6.5" x2="8" y2="10" stroke="#C0624B" strokeWidth="1.4" strokeLinecap="round"/>
        <circle cx="8" cy="11.5" r="0.7" fill="#C0624B"/>
      </svg>
      <div style={{ color: '#C0624B', fontWeight: 600, fontSize: 14 }}>解析できませんでした</div>

      {target && (
        <div style={{
          fontSize: 11.5, color: 'var(--text-dim)', fontFamily: 'monospace',
          maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'center',
        }}>
          {target}
        </div>
      )}

      <div style={{
        color: 'var(--text-secondary)', maxWidth: 440, maxHeight: 160, overflowY: 'auto',
        background: 'var(--bg-panel)', padding: '11px 15px', borderRadius: 8,
        fontFamily: 'monospace', fontSize: 11.5, lineHeight: 1.7,
        border: '1px solid var(--border)', whiteSpace: 'pre-wrap',
      }}>
        {message}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
        {onRetry && (
          <button onClick={onRetry} style={{
            background: 'var(--accent)', color: '#1A1107', border: 'none',
            padding: '7px 18px', borderRadius: 6, fontWeight: 600, fontSize: 12,
          }}>
            同じ対象でもう一度
          </button>
        )}
        <button onClick={onPickOther} style={{
          background: 'transparent', color: 'var(--text-secondary)',
          border: '1px solid var(--border-interactive)',
          padding: '7px 16px', borderRadius: 6, fontSize: 12,
        }}>
          別の場所を選ぶ
        </button>
        <button onClick={onBack} style={{
          background: 'transparent', color: 'var(--text-dim)', border: 'none',
          padding: '7px 12px', borderRadius: 6, fontSize: 12,
        }}>
          最近使用へ
        </button>
      </div>

      {target && (
        <button
          onClick={() => navigator.clipboard?.writeText(`${target}\n${message}`)}
          style={{
            background: 'transparent', color: 'var(--text-dim)', border: 'none',
            fontSize: 11, padding: '2px 8px',
          }}
        >
          対象とエラーをコピー
        </button>
      )}
    </div>
  )
}
