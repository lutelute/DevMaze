import { create } from 'zustand'
import type { AnalysisResult, StruggleEpisode, Zone } from '@shared/types'
import type { AnalyzeOk, Fail, GithubRef } from '@shared/ipc'
import { api } from '@/api'
import type { StoreState, NavState, Camera, Focus, Unit, ViewMode, SidebarTab } from './types'

const HISTORY_MAX = 50
export const DISPLAY_LIMITS = [80, 150, 300, 1000] as const

interface Actions {
  // ── リポジトリ ──
  init: () => () => void
  openLocal: (repoPath?: string, forceRefresh?: boolean) => Promise<void>
  openGithub: (input: string) => Promise<void>
  refresh: () => Promise<void>
  backToIdle: () => void
  setRemoteBehind: (v: boolean) => void
  setWatchBanner: (v: boolean) => void
  dismissBanner: () => void
  setToast: (t: string | null) => void
  exportReport: () => Promise<void>
  exportKnowledge: () => Promise<void>
  // ── 表示 ──
  setViewMode: (m: ViewMode) => void
  setUnit: (u: Unit) => void
  setDisplayLimit: (n: number) => void
  toggleFilter: (type: string) => void
  clearFilters: () => void
  setSidebarTab: (t: SidebarTab) => void
  setSidebarCollapsed: (v: boolean) => void
  setSidebarWidth: (w: number) => void
  setSearchOpen: (v: boolean) => void
  setHelpOpen: (v: boolean) => void
  setLegendOpen: (v: boolean) => void
  // ── 選択と注目 ──
  selectHash: (hash: string | null) => void
  selectStruggle: (ep: StruggleEpisode | null) => void
  selectFile: (path: string | null) => void
  selectZone: (zone: Zone | null) => void
  drillDown: (hashes: string[]) => void
  clearFocus: () => void
  stepSelection: (dir: -1 | 1) => void
  escape: () => void
  // ── 戻る ──
  registerCamera: (reader: (() => Camera | null) | null) => void
  takePendingCamera: () => Camera | null
  goBack: () => void
  goForward: () => void
}

export type Store = StoreState & Actions

const initialView = {
  viewMode: 'maze' as ViewMode,
  unit: null as Unit,
  displayLimit: 150,
  filterTypes: new Set<string>(),
  focus: null as Focus,
  selectedHash: null as string | null,
  sidebarTab: 'overview' as SidebarTab,
  sidebarCollapsed: false,
  sidebarWidth: 264,
  searchOpen: false,
  helpOpen: false,
  legendOpen: false,   // サイドバーの「種別で絞る」が形と色を兼ねるので、迷路の上は空けておく
}

function parseGithub(input: string): GithubRef | null {
  const s = input.trim().replace(/\.git$/, '')
  const m = s.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/)
    ?? s.match(/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\/.*)?$/)
  return m ? { owner: m[1], name: m[2] } : null
}

export const useStore = create<Store>()((set, get) => {
  /** リポジトリが変わる操作の前に、場所に依存する状態を全部捨てる */
  const resetForRepo = () => set({
    selectedHash: null, focus: null, github: null, unit: null,
    past: [], ahead: null, pendingCamera: null, watchBanner: false, remoteBehind: false,
  })

  const applyResult = (repoPath: string, r: AnalyzeOk) => set(s => ({
    phase: { phase: 'ready', result: r.data, fromCache: r.fromCache },
    repoPath,
    recentRepos: [repoPath, ...s.recentRepos.filter(p => p !== repoPath)].slice(0, 10),
  }))

  const fail = (f: Fail, target: string, retry: () => void) =>
    set({ phase: { phase: 'error', message: f.error, target, retry } })

  const snapshot = (): NavState => {
    const s = get()
    return { unit: s.unit, focus: s.focus, selectedHash: s.selectedHash, camera: s.cameraReader?.() ?? null }
  }

  /** 場所が変わる操作の直前に、いまの場所を積む */
  const pushHistory = () => set(s => ({ past: [...s.past.slice(-(HISTORY_MAX - 1)), snapshot()], ahead: null }))

  const applyNav = (n: NavState) => set({
    pendingCamera: n.camera, unit: n.unit, focus: n.focus, selectedHash: n.selectedHash,
  })

  const result = (): AnalysisResult | null => {
    const p = get().phase
    return p.phase === 'ready' ? p.result : null
  }

  return {
    // ── state ──
    phase: { phase: 'idle' },
    repoPath: null,
    github: null,
    recentRepos: [],
    remoteBehind: false,
    watchBanner: false,
    toast: null,
    ...initialView,
    past: [],
    ahead: null,
    pendingCamera: null,
    cameraReader: null,

    // ── リポジトリ ──
    init: () => {
      api.invoke('repo:recent').then(recentRepos => set({ recentRepos })).catch(() => {})
      api.invoke('repo:initial').then(p => { if (p) get().openLocal(p) }).catch(() => {})
      const off = api.on('repo:progress', progress => {
        set(s => s.phase.phase === 'loading' ? { phase: { phase: 'loading', progress } } : {})
      })
      return off
    },

    openLocal: async (repoPath, forceRefresh = false) => {
      const target = repoPath ?? await api.invoke('repo:pickFolder')
      if (!target) return
      set({ phase: { phase: 'loading', progress: { kind: 'text', text: '初期化中...' } } })
      resetForRepo()
      const r = await api.invoke('repo:analyze', target, { forceRefresh })
      if (!r.ok) { fail(r, target, () => get().openLocal(target, forceRefresh)); return }
      applyResult(target, r)
    },

    openGithub: async (input) => {
      set({ phase: { phase: 'loading', progress: { kind: 'text', text: 'GitHub リポジトリを確認中...' } } })
      resetForRepo()
      const r = await api.invoke('repo:openGithub', input)
      if (!r.ok) { fail(r, input, () => get().openGithub(input)); return }
      applyResult(r.data.repoPath, r)
      set({ github: r.github ?? parseGithub(input) })
    },

    // 再スキャンは「リモートから取り込んでから」。手元だけ読み直しても GitHub の新着は永久に反映されない
    refresh: async () => {
      const repoPath = get().repoPath
      if (!repoPath) return
      const github = get().github
      set({ phase: { phase: 'loading', progress: { kind: 'text', text: 'リモートから取り込み中...' } } })
      set({ selectedHash: null, focus: null, past: [], ahead: null, watchBanner: false, remoteBehind: false })
      const r = await api.invoke('repo:refresh', repoPath)
      if (!r.ok) { fail(r, repoPath, () => get().refresh()); return }
      applyResult(repoPath, r)
      set({ github })
      const f = r.fetch
      get().setToast(
        f.error ? `リモートから取り込めませんでした（${f.error}）。手元の履歴で解析しました`
        : f.newCommits ? `新着 ${f.newCommits} 件を取り込みました`
        : f.fetched ? 'すでに最新でした'
        : '再解析しました（リモートなし）')
    },

    backToIdle: () => set({ phase: { phase: 'idle' } }),
    setRemoteBehind: remoteBehind => set({ remoteBehind }),
    setWatchBanner: watchBanner => set({ watchBanner }),
    dismissBanner: () => set({ watchBanner: false, remoteBehind: false }),
    setToast: toast => set({ toast }),

    exportReport: async () => {
      const repoPath = get().repoPath
      if (!repoPath) return
      get().setToast('レポートを生成中...')
      const r = await api.invoke('export:report', repoPath)
      if (r.ok) get().setToast(`保存しました: ${r.path}`)
      else get().setToast(r.error === 'canceled' ? null : `保存に失敗しました: ${r.error}`)
    },

    exportKnowledge: async () => {
      const repoPath = get().repoPath
      if (!repoPath) return
      const r = await api.invoke('export:knowledge', repoPath)
      if (r.ok) get().setToast(`ナレッジを ${r.files} ファイル書き出しました: ${r.dir}`)
      else get().setToast(r.error === 'canceled' ? null : `書き出しに失敗しました: ${r.error}`)
    },

    // ── 表示 ──
    setViewMode: viewMode => set({ viewMode }),
    setUnit: unit => { pushHistory(); set({ unit, focus: null }) },
    setDisplayLimit: displayLimit => set({ displayLimit }),
    toggleFilter: type => set(s => {
      const next = new Set(s.filterTypes)
      if (next.has(type)) next.delete(type); else next.add(type)
      return { filterTypes: next }
    }),
    clearFilters: () => set({ filterTypes: new Set() }),
    setSidebarTab: sidebarTab => set({ sidebarTab, sidebarCollapsed: false }),
    setSidebarCollapsed: sidebarCollapsed => set({ sidebarCollapsed }),
    setSidebarWidth: w => set({ sidebarWidth: Math.max(200, Math.min(460, w)) }),
    setSearchOpen: searchOpen => set({ searchOpen }),
    setHelpOpen: helpOpen => set({ helpOpen }),
    setLegendOpen: legendOpen => set({ legendOpen }),

    // ── 選択と注目 ──
    selectHash: selectedHash => set({ selectedHash }),

    selectStruggle: episode => {
      if (!episode) { set({ focus: null }); return }
      const f = get().focus
      if (f?.kind === 'struggle' && f.episode.id === episode.id) return
      pushHistory()
      set({
        focus: { kind: 'struggle', episode, hashes: episode.commits.map(c => c.hash) },
        selectedHash: episode.commits[0]?.hash ?? null,
        sidebarTab: 'struggles',
      })
    },

    // ファイルから辿る: そのファイルを触ったコミットだけを残し、最新を選ぶ
    selectFile: path => {
      const r = result()
      if (!path || !r) { set({ focus: null }); return }
      const touching = r.graph.nodes.filter(n => n.files.includes(path))
      if (touching.length === 0) { get().setToast(`${path} を触ったコミットは表示範囲にありません`); return }
      const f = get().focus
      if (f?.kind === 'file' && f.path === path) return
      pushHistory()
      const latest = [...touching].sort((a, b) => b.timestamp - a.timestamp)[0]
      set({ focus: { kind: 'file', path, hashes: touching.map(n => n.id) }, selectedHash: latest.id })
    },

    // 開発フェーズは「期間」。押した結果もその期間の強調にする
    selectZone: zone => {
      const r = result()
      if (!zone || !r) { set({ focus: null }); return }
      const f = get().focus
      if (f?.kind === 'zone' && f.zone.id === zone.id) { set({ focus: null }); return }
      const hashes = r.graph.nodes
        .filter(n => n.timestamp >= zone.startTimestamp && n.timestamp <= zone.endTimestamp)
        .map(n => n.id)
      if (hashes.length === 0) return
      pushHistory()
      set({ focus: { kind: 'zone', zone, hashes } })
    },

    // まとまりをクリックしたら、その中のコミットに降りる（意味的なズーム）
    drillDown: hashes => {
      pushHistory()
      set({ unit: 'commit', focus: { kind: 'session', hashes }, selectedHash: hashes[0] ?? null })
    },

    clearFocus: () => { if (get().focus) { pushHistory(); set({ focus: null }) } },

    // ← → で時系列を辿る。注目があるならその中だけを行き来する
    stepSelection: dir => {
      const r = result()
      if (!r) return
      const { focus, selectedHash } = get()
      const pool = (focus ? r.graph.nodes.filter(n => focus.hashes.includes(n.id)) : r.graph.nodes)
        .slice().sort((a, b) => a.timestamp - b.timestamp)
      if (pool.length === 0) return
      const i = selectedHash ? pool.findIndex(n => n.id === selectedHash) : -1
      const next = dir > 0
        ? pool[i < 0 ? 0 : Math.min(pool.length - 1, i + 1)]
        : pool[i < 0 ? pool.length - 1 : Math.max(0, i - 1)]
      if (next) set({ selectedHash: next.id })
    },

    // Esc は「いちばん手前を1つ閉じる」。全部閉じてから注目を解く
    escape: () => {
      const s = get()
      if (s.helpOpen) { set({ helpOpen: false }); return }
      if (s.searchOpen) { set({ searchOpen: false }); return }
      if (s.selectedHash) { set({ selectedHash: null }); return }
      if (s.focus) { pushHistory(); set({ focus: null }) }
    },

    // ── 戻る ──
    registerCamera: cameraReader => set({ cameraReader }),
    takePendingCamera: () => { const c = get().pendingCamera; if (c) set({ pendingCamera: null }); return c },

    goBack: () => {
      const { past } = get()
      if (past.length === 0) return
      const prev = past[past.length - 1]
      set({ ahead: snapshot(), past: past.slice(0, -1) })
      applyNav(prev)
    },

    goForward: () => {
      const { ahead } = get()
      if (!ahead) return
      set(s => ({ past: [...s.past, snapshot()], ahead: null }))
      applyNav(ahead)
    },
  }
})
