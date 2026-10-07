import { useMemo } from 'react'
import { useStore } from './index'
import type { AnalysisResult, MazeNode, StruggleEpisode } from '@shared/types'
import { STRUGGLE_META } from '@shared/theme'

export const useResult = (): AnalysisResult | null =>
  useStore(s => (s.phase.phase === 'ready' ? s.phase.result : null))

export const useFromCache = (): boolean =>
  useStore(s => (s.phase.phase === 'ready' ? s.phase.fromCache : false))

/** 解析結果から導く索引は、結果オブジェクトが同じあいだ使い回す */
const nodeIndexCache = new WeakMap<AnalysisResult, Map<string, MazeNode>>()
export function nodesById(result: AnalysisResult): Map<string, MazeNode> {
  let m = nodeIndexCache.get(result)
  if (!m) { m = new Map(result.graph.nodes.map(n => [n.id, n])); nodeIndexCache.set(result, m) }
  return m
}

export const useSelectedNode = (): MazeNode | null => {
  const result = useResult()
  const hash = useStore(s => s.selectedHash)
  return useMemo(() => (result && hash ? nodesById(result).get(hash) ?? null : null), [result, hash])
}

/** 注目対象のコミット。無ければ undefined */
export const useHighlightIds = (): Set<string> | undefined => {
  const focus = useStore(s => s.focus)
  return useMemo(() => (focus ? new Set(focus.hashes) : undefined), [focus])
}

/** 何らかの沼に属するコミット全体 */
export const useStruggleIds = (): Set<string> => {
  const result = useResult()
  return useMemo(() => new Set(result?.struggles.flatMap(e => e.commits.map(c => c.hash)) ?? []), [result])
}

/** コミットごとの深刻度（複数の沼に属するなら最大）。迷路の印の強さに使う */
export const useSeverityByHash = (): Map<string, number> => {
  const result = useResult()
  return useMemo(() => {
    const m = new Map<string, number>()
    for (const e of result?.struggles ?? []) {
      for (const c of e.commits) m.set(c.hash, Math.max(m.get(c.hash) ?? 0, e.severity))
    }
    return m
  }, [result])
}

/** 選択中のコミットが属する沼 */
export const useNodeStruggles = (): StruggleEpisode[] => {
  const result = useResult()
  const hash = useStore(s => s.selectedHash)
  return useMemo(
    () => (result && hash ? result.struggles.filter(e => e.commits.some(c => c.hash === hash)) : []),
    [result, hash],
  )
}

/** いま何を見ているかの1行 */
export const useFocusLabel = (): string | null => {
  const focus = useStore(s => s.focus)
  return useMemo(() => {
    if (!focus) return null
    const n = focus.hashes.length
    if (focus.kind === 'struggle') return `${STRUGGLE_META[focus.episode.kind].icon} ${focus.episode.title} · ${n}件`
    if (focus.kind === 'file') return `${focus.path} · ${n}件`
    if (focus.kind === 'zone') return `${focus.zone.label} · ${n}件`
    return `まとまりの中 · ${n}件`
  }, [focus])
}
