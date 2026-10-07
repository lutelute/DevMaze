// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useStore } from '../src/store'
import { buildMazeGraph } from '../shared/analyzer/graph'
import { detectStruggles } from '../shared/analyzer/struggle'
import { detectHotspots } from '../shared/analyzer/hotspot'
import { buildActivityProfile } from '../shared/analyzer/activity'
import { calculateScore } from '../shared/analyzer/score'
import { commit, at } from './helpers'
import type { AnalysisResult } from '../shared/types'
import type { DevmazeApi } from '../shared/ipc'

/** 沼が1件出る程度の小さな履歴 */
function makeResult(): AnalysisResult {
  const commits = [
    commit({ hash: 'a'.repeat(40), message: 'feat: start', timestamp: at(0), type: 'feature', files: ['src/a.ts'] }),
    commit({ hash: 'b'.repeat(40), message: 'fix: a', timestamp: at(2), type: 'error_fix', files: ['src/a.ts'] }),
    commit({ hash: 'c'.repeat(40), message: 'fix: a again', timestamp: at(4), type: 'error_fix', files: ['src/a.ts'] }),
    commit({ hash: 'd'.repeat(40), message: 'fix: a once more', timestamp: at(6), type: 'error_fix', files: ['src/a.ts'] }),
    commit({ hash: 'e'.repeat(40), message: 'feat: done', timestamp: at(30), type: 'feature', files: ['src/a.ts', 'src/b.ts'] }),
  ]
  const graph = buildMazeGraph(commits)
  return {
    repoPath: '/tmp/repo', repoName: 'repo', graph,
    score: calculateScore(commits), struggles: detectStruggles(commits), hotspots: detectHotspots(commits),
    activity: buildActivityProfile(commits),
    stats: { totalCommits: 5, authors: ['tester'], dateRange: { start: '', end: '' }, branchCount: 0, mergeCount: 0, revertCount: 0, errorFixCount: 3, wipCount: 0, fileStatsCoverage: 1 },
    summary: '',
  }
}

const invoke = vi.fn()
const api: DevmazeApi = {
  invoke: invoke as unknown as DevmazeApi['invoke'],
  send: vi.fn(),
  on: vi.fn(() => () => {}),
}

beforeEach(() => {
  ;(window as unknown as { devmaze: DevmazeApi }).devmaze = api
  invoke.mockReset()
  useStore.setState({
    phase: { phase: 'idle' }, repoPath: null, github: null, recentRepos: [], focus: null, selectedHash: null,
    unit: null, past: [], ahead: null, pendingCamera: null, cameraReader: null, toast: null, searchOpen: false, helpOpen: false,
  })
})

describe('store: リポジトリを開く', () => {
  it('解析に成功したら ready になり、最近使用の先頭に入る', async () => {
    const result = makeResult()
    invoke.mockResolvedValueOnce({ ok: true, data: result, fromCache: false })
    await useStore.getState().openLocal('/tmp/repo')
    const s = useStore.getState()
    expect(s.phase.phase).toBe('ready')
    expect(s.repoPath).toBe('/tmp/repo')
    expect(s.recentRepos[0]).toBe('/tmp/repo')
    expect(invoke).toHaveBeenCalledWith('repo:analyze', '/tmp/repo', { forceRefresh: false })
  })

  it('失敗したら error になり、同じ対象で再試行できる', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: 'boom' })
    await useStore.getState().openLocal('/tmp/bad')
    const p = useStore.getState().phase
    expect(p.phase).toBe('error')
    if (p.phase !== 'error') return
    expect(p.message).toBe('boom')
    expect(p.target).toBe('/tmp/bad')
    invoke.mockResolvedValueOnce({ ok: true, data: makeResult(), fromCache: true })
    p.retry?.()
    await vi.waitFor(() => expect(useStore.getState().phase.phase).toBe('ready'))
  })

  it('別のリポジトリを開くと注目・選択・履歴が捨てられる', async () => {
    invoke.mockResolvedValue({ ok: true, data: makeResult(), fromCache: false })
    await useStore.getState().openLocal('/tmp/repo')
    useStore.getState().selectHash('a'.repeat(40))
    useStore.getState().selectFile('src/a.ts')
    expect(useStore.getState().past.length).toBe(1)
    await useStore.getState().openLocal('/tmp/other')
    const s = useStore.getState()
    expect(s.focus).toBeNull()
    expect(s.selectedHash).toBeNull()
    expect(s.past).toEqual([])
  })
})

describe('store: 注目と戻る', () => {
  beforeEach(async () => {
    invoke.mockResolvedValue({ ok: true, data: makeResult(), fromCache: false })
    await useStore.getState().openLocal('/tmp/repo')
  })

  it('沼を選ぶと注目と選択が立ち、履歴が1つ積まれる', () => {
    const s = useStore.getState()
    const ep = (s.phase.phase === 'ready' ? s.phase.result.struggles : [])[0]
    expect(ep).toBeDefined()
    s.selectStruggle(ep)
    const after = useStore.getState()
    expect(after.focus?.kind).toBe('struggle')
    expect(after.selectedHash).toBe(ep.commits[0].hash)
    expect(after.past.length).toBe(1)
    // 同じ沼をもう一度選んでも履歴は増えない
    after.selectStruggle(ep)
    expect(useStore.getState().past.length).toBe(1)
  })

  it('ファイルから辿ると触ったコミットだけが注目され、最新が選ばれる', () => {
    useStore.getState().selectFile('src/a.ts')
    const s = useStore.getState()
    expect(s.focus?.kind).toBe('file')
    expect(s.focus?.hashes.length).toBe(5)
    expect(s.selectedHash).toBe('e'.repeat(40))
  })

  it('触っていないファイルは注目を変えずトーストだけ出す', () => {
    useStore.getState().selectFile('nope.ts')
    const s = useStore.getState()
    expect(s.focus).toBeNull()
    expect(s.toast).toContain('nope.ts')
  })

  it('戻る・さっきの場所へ が往復し、カメラも一緒に戻る', () => {
    let cam = { x: 1, y: 2, k: 3 }
    useStore.getState().registerCamera(() => cam)
    useStore.getState().selectFile('src/a.ts')      // ここで {1,2,3} が積まれる
    cam = { x: 9, y: 9, k: 1 }                        // 注目後にユーザーが動かした
    useStore.getState().goBack()
    let s = useStore.getState()
    expect(s.focus).toBeNull()
    expect(s.ahead).not.toBeNull()
    expect(s.pendingCamera).toEqual({ x: 1, y: 2, k: 3 })
    expect(useStore.getState().takePendingCamera()).toEqual({ x: 1, y: 2, k: 3 })
    expect(useStore.getState().pendingCamera).toBeNull()   // 一度取ったら消える
    useStore.getState().goForward()
    s = useStore.getState()
    expect(s.focus?.kind).toBe('file')
    expect(s.pendingCamera).toEqual({ x: 9, y: 9, k: 1 })   // 戻る直前の場所
  })

  it('まとまりに降りると単位が commit になり、その中が注目される', () => {
    useStore.getState().drillDown(['b'.repeat(40), 'c'.repeat(40)])
    const s = useStore.getState()
    expect(s.unit).toBe('commit')
    expect(s.focus?.kind).toBe('session')
    expect(s.selectedHash).toBe('b'.repeat(40))
  })

  it('← → は注目の中だけを時系列で辿る', () => {
    useStore.getState().drillDown(['c'.repeat(40), 'b'.repeat(40)])
    useStore.getState().stepSelection(1)
    expect(useStore.getState().selectedHash).toBe('c'.repeat(40))
    useStore.getState().stepSelection(1)   // 末尾で止まる
    expect(useStore.getState().selectedHash).toBe('c'.repeat(40))
    useStore.getState().stepSelection(-1)
    expect(useStore.getState().selectedHash).toBe('b'.repeat(40))
  })

  it('Esc は手前から1つずつ閉じる（ヘルプ → 検索 → 詳細 → 注目）', () => {
    useStore.getState().selectFile('src/a.ts')
    useStore.setState({ helpOpen: true, searchOpen: true })
    const esc = () => useStore.getState().escape()
    esc(); expect(useStore.getState().helpOpen).toBe(false)
    esc(); expect(useStore.getState().searchOpen).toBe(false)
    esc(); expect(useStore.getState().selectedHash).toBeNull()
    esc(); expect(useStore.getState().focus).toBeNull()
  })
})
