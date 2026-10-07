/**
 * 迷路に「何を置くか」を決める。
 *
 * - 絞り込み（種別フィルター）
 * - 表示単位（コミット1件ずつ / 作業のまとまり）
 * - 表示件数の上限と、強調対象の追い出し
 * - 強調・沼の対象を、まとまりの ID に読み替える
 *
 * ここは純粋関数。描画側はこの結果をそのまま置くだけで、選び方には口を出さない。
 */
import type { MazeNode, MazeEdge } from '../types'
import type { MazeItem, MazeLink } from './types'
import { buildSessions, shouldAggregate } from './sessions'

export const DISPLAY_LIMITS = [80, 150, 300, 1000] as const

/**
 * 強調対象は表示件数の外にあっても必ず出す。
 * これが無いと、古いまとまり・沼・ファイルを開いたとき全部が沈んで何も見えない画面になる
 * （実測: 150件表示で 150件すべてが沈んだ）。
 * ただし無制限に足すと、開発フェーズのように数百件を注目したとき重くなる。追い出しはここまで。
 */
export const HIGHLIGHT_OVERFLOW = 300

export type Unit = 'commit' | 'session'

export interface BuildItemsInput {
  nodes: MazeNode[]
  edges: MazeEdge[]
  filterTypes: Set<string>
  /** null なら件数で自動判定 */
  unit: Unit | null
  displayLimit: number
  highlightHashes?: Set<string>
}

export interface BuildItemsResult {
  items: MazeItem[]
  links: MazeLink[]
  unit: Unit
  /** 絞り込み後の総件数（表示上限をかける前） */
  totalCount: number
  /** 絞り込み後を作業のまとまりに切ったときの個数 */
  sessionCount: number
}

/** 時刻順（同時刻は ID 順）。並びが決まっていないと配置が決定的にならない */
const byTime = (a: { timestamp: number; id: string }, b: { timestamp: number; id: string }) =>
  a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function fromNode(n: MazeNode): MazeItem {
  return {
    id: n.id,
    type: n.type,
    timestamp: n.timestamp,
    lane: n.lane,
    isMainBranch: n.isMainBranch,
    filesChanged: n.filesChanged,
    label: n.label,
    message: n.message,
    tagNames: n.tagNames,
    isMilestone: n.isMilestone,
    milestoneReason: n.milestoneReason,
    authorName: n.authorName,
    insertions: n.insertions,
    deletions: n.deletions,
  }
}

export function buildMazeItems(input: BuildItemsInput): BuildItemsResult {
  const { nodes, edges, filterTypes, displayLimit, highlightHashes } = input

  const filtered = filterTypes.size === 0
    ? nodes
    : nodes.filter(n => filterTypes.has(n.type))

  const sessions = buildSessions(filtered)
  const unit: Unit = input.unit ?? (shouldAggregate(filtered.length) ? 'session' : 'commit')

  if (unit === 'session') {
    // まとまり表示では表示件数の上限をかけない。集約が volume を引き受ける
    const items: MazeItem[] = sessions.map(ses => ({
      id: ses.id,
      type: ses.type,
      timestamp: ses.startTimestamp,
      lane: ses.lane,
      isMainBranch: ses.isMainBranch,
      filesChanged: ses.fileCount,
      count: ses.commitCount,
      memberHashes: ses.commitHashes,
      label: `${ses.commitCount}`,
      message: ses.label,
      tagNames: ses.tagNames,
      isMilestone: ses.hasMilestone,
      milestoneReason: ses.tagNames.length > 0 ? 'tag' : undefined,
      authorName: '',
      insertions: ses.insertions,
      deletions: ses.deletions,
    }))
    items.sort(byTime)

    // まとまり同士は時間順につなぐ（1本の道として読めるように）
    const links: MazeLink[] = items.slice(1).map((it, i) => ({
      id: `ses_${i}`,
      source: items[i].id,
      target: it.id,
      type: 'parent' as const,
    }))

    return { items, links, unit, totalCount: filtered.length, sessionCount: sessions.length }
  }

  const newestFirst = [...filtered].sort((a, b) => byTime(b, a))
  const limited = newestFirst.slice(0, displayLimit)

  if (highlightHashes && highlightHashes.size > 0) {
    const shown = new Set(limited.map(n => n.id))
    let added = 0
    for (const n of newestFirst) {
      if (added >= HIGHLIGHT_OVERFLOW) break
      if (highlightHashes.has(n.id) && !shown.has(n.id)) { limited.push(n); added++ }
    }
  }

  const items = limited.map(fromNode).sort(byTime)
  const byId = new Set(items.map(it => it.id))

  const links: MazeLink[] = []
  for (const e of edges) {
    const source = typeof e.source === 'string' ? e.source : e.source.id
    const target = typeof e.target === 'string' ? e.target : e.target.id
    if (!byId.has(source) || !byId.has(target)) continue
    links.push({ id: e.id, source, target, type: e.type })
  }

  return { items, links, unit, totalCount: filtered.length, sessionCount: sessions.length }
}

/**
 * 強調対象はコミットのハッシュで来る。まとまり表示では ID が別物なので、
 * メンバーを見て読み替える。読み替えないと、まとまりに戻った瞬間に
 * どれも一致せず、画面全部が沈む。
 * 該当が1つも無ければ undefined（＝何も沈めない）。
 */
export function mapHighlightToItems(
  items: MazeItem[],
  highlightHashes?: Set<string>,
): Set<string> | undefined {
  if (!highlightHashes || highlightHashes.size === 0) return undefined
  const mapped = new Set<string>()
  for (const it of items) {
    if (it.memberHashes) {
      if (it.memberHashes.some(h => highlightHashes.has(h))) mapped.add(it.id)
    } else if (highlightHashes.has(it.id)) {
      mapped.add(it.id)
    }
  }
  return mapped.size > 0 ? mapped : undefined
}

/**
 * 沼の印も同じ読み替えが要る。
 * まとまり表示で「1件でも含む」で付けると、荒れたリポジトリでは 102 中 85 に付いて
 * ミニマップが真っ赤になり、印として何も言わなくなる（実測）。
 * そのまとまりの**過半**が沼のコミットのときだけ「ここで詰まっていた」と見なす。
 * 値は深刻度（0-100）。有無だけだと一様な印が付いて「どこで詰まったか」を指せない。
 */
export function mapStruggleToItems(
  items: MazeItem[],
  struggleHashes?: Set<string>,
  severityByHash?: Map<string, number>,
): Map<string, number> {
  const mapped = new Map<string, number>()
  if (!struggleHashes || struggleHashes.size === 0) return mapped
  const sev = (h: string) => severityByHash?.get(h) ?? 50

  for (const it of items) {
    if (!it.memberHashes) {
      if (struggleHashes.has(it.id)) mapped.set(it.id, sev(it.id))
      continue
    }
    const members = it.memberHashes
    if (members.length === 0) continue
    const hits = members.filter(h => struggleHashes.has(h))
    if (hits.length * 2 > members.length) {
      mapped.set(it.id, Math.max(...hits.map(sev)))
    }
  }
  return mapped
}

export function nodeRadius(item: MazeItem): number {
  // まとまりは件数で大きさを変える。どこに労力が寄っていたかが形で分かる
  if (item.count && item.count > 1) return Math.min(30, 9 + Math.sqrt(item.count) * 3.2)
  if (item.type === 'merge') return 9
  if (item.type === 'release') return 10
  const base = item.isMainBranch ? 8 : 5.5
  return base + Math.min(4, Math.sqrt(item.filesChanged ?? 0))
}
