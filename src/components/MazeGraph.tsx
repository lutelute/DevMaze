import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import * as d3 from 'd3'
import type { MazeGraph, MazeNode, MazeEdge, CommitType } from '../../shared/types'
import type { Zone } from '../../shared/types'

interface Props {
  graph: MazeGraph
  filterTypes: Set<string>
  onNodeClick: (node: MazeNode) => void
  selectedNodeId?: string
  /** 沼エピソードに属するコミット。指定すると他のノードを沈める */
  highlightIds?: Set<string>
  /** 何らかの沼に属するコミット全体。常時マーカーを出す */
  struggleIds?: Set<string>
}

type D3Node = MazeNode & d3.SimulationNodeDatum
type D3Link = { id: string; source: D3Node; target: D3Node; type: MazeEdge['type'] }

// ── Color palette (Sand/Earth) ─────────────────────────────
const TYPE_COLOR: Record<CommitType, string> = {
  normal:    '#D4A84A',
  feature:   '#7B9E5A',
  error_fix: '#C0624B',
  revert:    '#C88B3A',
  merge:     '#A88B5A',
  wip:       '#B8A06A',
  release:   '#E8C060',
  chore:     '#8B9BAA',
  docs:      '#7A9BB8',
  refactor:  '#9B8EC4',
  test:      '#6AAF9E',
}

const EDGE_COLOR: Record<MazeEdge['type'], string> = {
  parent:       '#4A3018',
  merge_parent: '#C8A060',
  revert_of:    '#C88B3A',
}

const EDGE_DASH: Record<MazeEdge['type'], string> = {
  parent:       'none',
  merge_parent: '6,3',
  revert_of:    '3,4',
}

// Lane band colors (subtle)
const LANE_BAND_COLORS = [
  '#7B9E5A', '#C0624B', '#C88B3A', '#8B7355',
  '#B8A06A', '#9B8570', '#6B9E8A', '#A06A7A',
]

const DISPLAY_LIMITS = [80, 150, 300, 1000] as const
const LANE_HEIGHT = 65          // レーン間隔の基準値（実際は画面高に合わせて伸縮する）

const HOUR = 3600_000
const DAY = 24 * HOUR

// ── 時間軸 ─────────────────────────────────────────────────
//
// コミットを実時間で並べると、開発が集中した数日に全部が固まり、
// 残りが空白になる（779コミットのリポジトリで横一本の帯に潰れる原因）。
// そこで、コミット間隔を対数で圧縮した「体感時間」の軸を作る。
// 密度が均されて読めるようになり、長い空白は縮んでも消えずに残る。
interface TimeTick { x: number; label: string; major: boolean }

interface TimeAxis {
  pos: (t: number) => number
  /** x → 時刻（ルーラーに「いま見えている期間」を出すのに使う） */
  time: (x: number) => number
  total: number
  /** 見えている期間に応じて粒度を変えた目盛り（時 / 日 / 週 / 月 / 年） */
  ticksIn: (t0: number, t1: number) => TimeTick[]
  gaps: { x1: number; x2: number; days: number }[]
}

const STEP_PX = 30        // コミット1件ぶんの基本間隔
const GAP_K = 16          // 空白時間の効き
const GAP_MAX = 240       // 1つの空白が占められる最大幅

function buildTimeAxis(timestamps: number[]): TimeAxis {
  const ts = [...new Set(timestamps)].sort((a, b) => a - b)
  if (ts.length === 0) {
    return { pos: () => 0, time: () => 0, total: 1, ticksIn: () => [], gaps: [] }
  }

  const xs: number[] = [0]
  const gaps: TimeAxis['gaps'] = []

  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1]
    const extra = Math.min(GAP_MAX, GAP_K * Math.log1p(gap / HOUR))
    const x = xs[i - 1] + STEP_PX + extra
    xs.push(x)
    // 3日以上あいた区間は「止まっていた時間」として帯で見せる
    if (gap >= 3 * DAY) {
      gaps.push({ x1: xs[i - 1], x2: x, days: Math.round(gap / DAY) })
    }
  }

  const total = xs[xs.length - 1] || 1

  const pos = (t: number): number => {
    if (t <= ts[0]) return xs[0]
    if (t >= ts[ts.length - 1]) return xs[xs.length - 1]
    let lo = 0, hi = ts.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (ts[mid] <= t) lo = mid
      else hi = mid
    }
    const span = ts[hi] - ts[lo] || 1
    return xs[lo] + ((t - ts[lo]) / span) * (xs[hi] - xs[lo])
  }

  const time = (x: number): number => {
    if (x <= xs[0]) return ts[0]
    if (x >= xs[xs.length - 1]) return ts[ts.length - 1]
    let lo = 0, hi = xs.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (xs[mid] <= x) lo = mid
      else hi = mid
    }
    const span = xs[hi] - xs[lo] || 1
    return ts[lo] + ((x - xs[lo]) / span) * (ts[hi] - ts[lo])
  }

  // 目盛りの粒度は「いま見えている期間」で決める。
  // 全体の期間で固定すると、拡大したときに目盛りが1本も入らなくなる。
  const ticksIn: TimeAxis['ticksIn'] = (t0, t1) => {
    const spanDays = Math.max(0, t1 - t0) / DAY
    const unit: 'hour' | 'day' | 'week' | 'month' | 'year' =
      spanDays > 1100 ? 'year' :
      spanDays > 200  ? 'month' :
      spanDays > 30   ? 'week' :
      spanDays > 2    ? 'day' : 'hour'

    const out: TimeTick[] = []
    let prevKey = ''
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] < t0 || ts[i] > t1) continue
      const d = new Date(ts[i])
      const key =
        unit === 'year'  ? `${d.getFullYear()}` :
        unit === 'month' ? `${d.getFullYear()}-${d.getMonth()}` :
        unit === 'week'  ? `${d.getFullYear()}-${weekOf(d)}` :
        unit === 'day'   ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` :
                           `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`
      if (key === prevKey) continue
      prevKey = key
      out.push({
        x: xs[i],
        label:
          unit === 'year'  ? `${d.getFullYear()}` :
          unit === 'month' ? `${d.getFullYear()}/${d.getMonth() + 1}` :
          unit === 'hour'  ? `${d.getHours()}:00` :
                             `${d.getMonth() + 1}/${d.getDate()}`,
        major: unit === 'hour' ? d.getHours() === 0 : d.getDate() === 1,
      })
    }
    return out
  }

  return { pos, time, total, ticksIn, gaps }
}

function weekOf(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1)
  return Math.floor((d.getTime() - start.getTime()) / (7 * DAY))
}

function nodeRadius(n: D3Node): number {
  if (n.type === 'merge')   return 10
  if (n.type === 'release') return 10
  const base = n.isMainBranch ? 8 : 5
  return base + Math.min(4, Math.sqrt(n.filesChanged ?? 0))
}

// Diamond path (for merge nodes)
function diamond(r: number): string {
  return `M0,${-r} L${r * 0.8},0 L0,${r} L${-r * 0.8},0 Z`
}

// Hexagon path (for release nodes)
function hexagon(r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3 - Math.PI / 6
    return `${i === 0 ? 'M' : 'L'}${Math.cos(a) * r},${Math.sin(a) * r}`
  }).join(' ') + 'Z'
}

// ── Component ──────────────────────────────────────────────
export default function MazeGraph({
  graph, filterTypes, onNodeClick, selectedNodeId, highlightIds, struggleIds,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const nodesRef = useRef<D3Node[]>([])
  const [displayLimit, setDisplayLimit] = useState<number>(150)

  const handleFitView = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return
    const svg = d3.select(svgRef.current)
    const g = svg.select<SVGGElement>('g.zoom-layer')
    const W = svgRef.current.clientWidth
    const H = svgRef.current.clientHeight
    fitView(svg, g, zoomRef.current, nodesRef.current, W, H)
  }, [])

  const { nodes, links, totalCount } = useMemo(() => {
    const filtered = filterTypes.size === 0
      ? graph.nodes
      : graph.nodes.filter(n => filterTypes.has(n.type))

    const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp)
    const limited = sorted.slice(0, displayLimit)
    const activeNodes: D3Node[] = limited.map(n => ({ ...n })) as D3Node[]
    const nodeIds = new Set(activeNodes.map(n => n.id))

    const activeLinks = graph.edges
      .filter(e => {
        const s = typeof e.source === 'string' ? e.source : (e.source as MazeNode).id
        const t = typeof e.target === 'string' ? e.target : (e.target as MazeNode).id
        return nodeIds.has(s) && nodeIds.has(t)
      })
      .map(e => {
        const sId = typeof e.source === 'string' ? e.source : (e.source as MazeNode).id
        const tId = typeof e.target === 'string' ? e.target : (e.target as MazeNode).id
        return {
          id: e.id,
          source: activeNodes.find(n => n.id === sId)!,
          target: activeNodes.find(n => n.id === tId)!,
          type: e.type,
        }
      })
      .filter(l => l.source && l.target)

    return { nodes: activeNodes, links: activeLinks, totalCount: filtered.length }
  }, [graph, filterTypes, displayLimit])

  const handleNodeClick = useCallback((node: D3Node) => {
    onNodeClick(node as MazeNode)
  }, [onNodeClick])

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()

    const container = svgRef.current!
    const W = container.clientWidth || 800
    const H = container.clientHeight || 600
    if (nodes.length === 0) return

    // ── defs ──────────────────────────────────────────────
    const defs = svg.append('defs')

    // Glow filter
    const glow = defs.append('filter').attr('id', 'glow').attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%')
    glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur')
    const fm = glow.append('feMerge')
    fm.append('feMergeNode').attr('in', 'coloredBlur')
    fm.append('feMergeNode').attr('in', 'SourceGraphic')

    // Milestone glow
    const mGlow = defs.append('filter').attr('id', 'milestone-glow').attr('x', '-30%').attr('y', '-50%').attr('width', '160%').attr('height', '200%')
    mGlow.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'b')
    const mfm = mGlow.append('feMerge')
    mfm.append('feMergeNode').attr('in', 'b')
    mfm.append('feMergeNode').attr('in', 'SourceGraphic')

    // Edge markers
    ;(['parent', 'merge_parent', 'revert_of'] as MazeEdge['type'][]).forEach(type => {
      defs.append('marker')
        .attr('id', `arr-${type}`)
        .attr('viewBox', '0 -4 8 8').attr('refX', 20).attr('refY', 0)
        .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
        .append('path').attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', EDGE_COLOR[type])
        .attr('opacity', type === 'parent' ? 0.5 : 0.9)
    })

    svg.style('background', '#1A1107')
    const g = svg.append('g').attr('class', 'zoom-layer')

    // 画面上端に固定する時間ルーラー（中身と一緒に動かず、常に日付が読める）
    let renderRuler: (t: d3.ZoomTransform) => void = () => {}

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.02, 12])
      .on('zoom', event => {
        g.attr('transform', event.transform)
        renderRuler(event.transform)
        const k = event.transform.k
        // Labels visible at k > 0.35
        const lOp = k > 0.35 ? Math.min(1, (k - 0.35) * 3) : 0
        g.selectAll<SVGTextElement, unknown>('text.commit-label').attr('opacity', lOp)
        g.selectAll<SVGTextElement, unknown>('text.lane-label').attr('opacity', Math.min(1, k * 0.8))
        g.selectAll<SVGTextElement, unknown>('.milestone-label').attr('opacity', Math.min(1, k * 1.5))
        g.selectAll<SVGLineElement, unknown>('.milestone-gate').attr('opacity', Math.min(0.6, k * 0.8))
        g.selectAll<SVGTextElement, unknown>('.gap-label').attr('opacity', k > 0.25 ? Math.min(0.75, k) : 0)
        g.selectAll<SVGTextElement, unknown>('.time-label').attr('opacity', Math.min(0.6, k * 1.2))
      })
    svg.call(zoom)
    zoomRef.current = zoom
    nodesRef.current = nodes

    // ── Time & layout ─────────────────────────────────────
    const axis = buildTimeAxis(nodes.map(n => n.timestamp))
    const xPos = axis.pos
    const spreadW = axis.total

    const maxLane = Math.max(1, ...nodes.map(n => Math.abs(n.lane)))
    // レーンが少ないときは縦に広げ、多いときは詰める（キャンバスを使い切る）
    const LH = Math.max(44, Math.min(120, (H * 0.66) / (maxLane * 2 + 1)))
    const laneH   = maxLane * LH

    // ── Lane bands ────────────────────────────────────────
    for (let lane = -maxLane; lane <= maxLane; lane++) {
      const yLane = lane * LH
      const laneNodes = nodes.filter(n => n.lane === lane)
      if (laneNodes.length === 0 && lane !== 0) continue

      const bandColor = lane === 0 ? '#D4A84A' : LANE_BAND_COLORS[(Math.abs(lane) - 1) % LANE_BAND_COLORS.length]
      const bandOp    = lane === 0 ? 0.05 : 0.03

      g.append('rect')
        .attr('class', 'lane-band')
        .attr('x', -200)
        .attr('y', yLane - LH / 2 + 6)
        .attr('width', spreadW + 400)
        .attr('height', LH - 12)
        .attr('fill', bandColor)
        .attr('opacity', bandOp)
        .attr('rx', 6)
    }

    // ── 止まっていた時間（3日以上あいた区間）────────────────
    const gapTop = -(maxLane + 1) * LH - 30
    const gapH   = (maxLane * 2 + 2) * LH + 60
    axis.gaps.forEach(gap => {
      g.append('rect')
        .attr('class', 'time-gap')
        .attr('x', gap.x1 + STEP_PX * 0.6)
        .attr('y', gapTop)
        .attr('width', Math.max(4, gap.x2 - gap.x1 - STEP_PX * 0.6))
        .attr('height', gapH)
        .attr('fill', '#0E0904')
        .attr('opacity', 0.55)
      g.append('text')
        .attr('class', 'gap-label')
        .attr('x', (gap.x1 + gap.x2) / 2 + STEP_PX * 0.3)
        .attr('y', gapTop + 12)
        .attr('text-anchor', 'middle')
        .attr('fill', '#6B5537')
        .attr('font-size', 8.5)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('opacity', 0)
        .text(`${gap.days}日`)
    })

    // ── 日付の目盛り ───────────────────────────────────────
    const tickTop = gapTop - 16
    const tickBottom = gapTop + gapH
    axis.ticksIn(axis.time(0), axis.time(axis.total)).forEach(tick => {
      g.append('line')
        .attr('class', 'time-grid')
        .attr('x1', tick.x).attr('y1', tickTop)
        .attr('x2', tick.x).attr('y2', tickBottom)
        .attr('stroke', '#D4A84A')
        .attr('stroke-width', tick.major ? 1 : 0.6)
        .attr('opacity', tick.major ? 0.13 : 0.06)
    })

    // ── Main spine ────────────────────────────────────────
    const mainNodes = nodes.filter(n => n.isMainBranch).sort((a, b) => a.timestamp - b.timestamp)
    if (mainNodes.length > 1) {
      g.append('line')
        .attr('x1', xPos(mainNodes[0].timestamp))
        .attr('y1', 0)
        .attr('x2', xPos(mainNodes[mainNodes.length - 1].timestamp))
        .attr('y2', 0)
        .attr('stroke', '#D4A84A')
        .attr('stroke-width', 2.5)
        .attr('stroke-dasharray', '10,5')
        .attr('opacity', 0.18)
    }

    // ── Zone bands (time-based development phases) ────────
    const zones: Zone[] = (graph as MazeGraph & { zones?: Zone[] }).zones ?? []
    zones.forEach((zone, i) => {
      const x1 = xPos(zone.startTimestamp)
      const x2 = xPos(zone.endTimestamp)
      const color = TYPE_COLOR[zone.theme] ?? '#D4A84A'
      const bandTop = -(maxLane + 1) * LH - 24
      const bandH   = (maxLane * 2 + 2) * LH + 48

      // 帯背景
      g.append('rect')
        .attr('class', 'zone-band')
        .attr('x', x1 - 6)
        .attr('y', bandTop)
        .attr('width', Math.max(20, x2 - x1 + 12))
        .attr('height', bandH)
        .attr('fill', color)
        .attr('opacity', i % 2 === 0 ? 0.055 : 0.03)
        .attr('rx', 8)

      // 上部ラベル
      g.append('text')
        .attr('class', 'zone-label')
        .attr('x', (x1 + x2) / 2)
        .attr('y', bandTop - 6)
        .attr('text-anchor', 'middle')
        .attr('fill', color)
        .attr('font-size', 8)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '600')
        .attr('letter-spacing', '0.5')
        .attr('opacity', 0.65)
        .text(zone.label)
    })

    // ── Milestone gates (isMilestone nodes) ───────────────
    // 大規模変更まで門にすると、ラベルが横一列に並んで潰れる。
    // 門と札はタグ・バージョンだけにして、大規模変更はノード上の ⚡ に任せる。
    const taggedNodes = nodes.filter(n => n.isMilestone && n.milestoneReason !== 'large_change')
    taggedNodes.forEach(n => {
      const x  = xPos(n.timestamp)
      const gh = laneH + LH

      // Gate line
      g.append('line')
        .attr('class', 'milestone-gate')
        .attr('x1', x).attr('y1', -gh)
        .attr('x2', x).attr('y2', gh)
        .attr('stroke', '#D4A84A')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '5,4')
        .attr('opacity', 0.35)
        .attr('filter', 'url(#milestone-glow)')

      // Labels above gate
      const labels: string[] = n.tagNames.length > 0
        ? n.tagNames.slice(0, 2)
        : n.milestoneReason === 'version'
          ? [n.message.match(/v\d+[\d.]+/)?.[0] ?? n.label]
          : [n.label]

      labels.forEach((tag, i) => {
        const yy = -gh - 10 - i * 18
        const labelColor = n.milestoneReason === 'large_change' ? '#C0624B' : '#D4A84A'
        g.append('rect')
          .attr('class', 'milestone-label')
          .attr('x', x - 4).attr('y', yy - 12)
          .attr('width', tag.length * 6.2 + 12).attr('height', 16)
          .attr('fill', '#3D2810').attr('rx', 4).attr('opacity', 0.85)
        g.append('text')
          .attr('class', 'milestone-label')
          .attr('x', x + 2).attr('y', yy)
          .attr('text-anchor', 'start')
          .attr('fill', labelColor)
          .attr('font-size', 9).attr('font-family', 'JetBrains Mono, monospace')
          .attr('font-weight', '600')
          .attr('opacity', 0.9)
          .text(tag)
      })
    })

    // ── Lane labels (from LaneInfo — purpose-aware) ───────
    const laneInfoMap = new Map((graph.lanes ?? []).map(l => [l.lane, l]))
    const laneLabelMap = new Map<number, string>()
    nodes.forEach(n => {
      if (!laneLabelMap.has(n.lane)) {
        const info = laneInfoMap.get(n.lane)
        const name = info?.label
          ?? n.branchNames.find(b => !/^(origin\/|HEAD)/.test(b) && b !== 'HEAD')
          ?? (n.lane === 0 ? 'main' : `lane ${n.lane}`)
        laneLabelMap.set(n.lane, name)
      }
    })
    laneLabelMap.forEach((name, lane) => {
      const info = laneInfoMap.get(lane)
      const themeColor = info ? (TYPE_COLOR[info.theme] ?? '#D4A84A') : '#D4A84A'
      const bandColor = lane === 0 ? '#D4A84A' : themeColor
      const display = name.length > 22 ? name.slice(0, 20) + '…' : name
      g.append('text')
        .attr('class', 'lane-label')
        .attr('x', -30)
        .attr('y', lane * LH + 4)
        .attr('text-anchor', 'end')
        .attr('fill', bandColor)
        .attr('font-size', 9)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '500')
        .attr('opacity', 0.6)
        .text(display)
    })

    // ── Edges ─────────────────────────────────────────────
    const linkGroup = g.append('g').attr('class', 'links')
    const linkElems = linkGroup.selectAll<SVGLineElement, D3Link>('line')
      .data(links).join('line')
      .attr('stroke', d => EDGE_COLOR[d.type])
      .attr('stroke-width', d => {
        if (d.type === 'merge_parent') return 2.5
        if (d.type === 'revert_of')   return 2
        return d.source.isMainBranch && d.target.isMainBranch ? 2.5 : 1.2
      })
      .attr('stroke-dasharray', d => EDGE_DASH[d.type])
      .attr('opacity', d => {
        if (d.type === 'merge_parent') return 0.85
        if (d.type === 'revert_of')   return 0.9
        return 0.45
      })
      .attr('marker-end', d => `url(#arr-${d.type})`)

    // ── Nodes ─────────────────────────────────────────────
    const nodeGroup = g.append('g').attr('class', 'nodes')
    const nodeElems = nodeGroup.selectAll<SVGGElement, D3Node>('g.node')
      .data(nodes, d => d.id).join('g')
      .attr('class', 'node').style('cursor', 'pointer')

    // Glow halo
    nodeElems.append('circle')
      .attr('class', 'glow')
      .attr('r', d => nodeRadius(d) + 6)
      .attr('fill', d => TYPE_COLOR[d.type])
      .attr('opacity', 0)

    // Shape by type
    nodeElems.each(function(d) {
      const sel = d3.select(this)
      const c   = TYPE_COLOR[d.type]
      const r   = nodeRadius(d)

      if (d.type === 'merge') {
        sel.append('path')
          .attr('class', 'main-circle')
          .attr('d', diamond(r))
          .attr('fill', `${c}33`)
          .attr('stroke', c)
          .attr('stroke-width', 2)
      } else if (d.type === 'release') {
        sel.append('path')
          .attr('class', 'main-circle')
          .attr('d', hexagon(r))
          .attr('fill', `${c}40`)
          .attr('stroke', c)
          .attr('stroke-width', 2.5)
          .attr('filter', 'url(#glow)')
      } else {
        sel.append('circle')
          .attr('class', 'main-circle')
          .attr('r', r)
          .attr('fill', d.isMainBranch ? `${c}55` : `${c}2A`)
          .attr('stroke', c)
          .attr('stroke-width', d.isMainBranch ? 2.5 : 1.5)
          .attr('filter', d.isMainBranch ? 'url(#glow)' : 'none')
      }
    })

    // 沼マーカー（何らかの沼に属するコミットを破線の輪で囲う）
    if (struggleIds && struggleIds.size > 0) {
      nodeElems.filter(d => struggleIds.has(d.id))
        .append('circle')
        .attr('class', 'struggle-ring')
        .attr('r', d => nodeRadius(d) + 4)
        .attr('fill', 'none')
        .attr('stroke', '#C0624B')
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '2,2.5')
        .attr('opacity', 0.55)
        .attr('pointer-events', 'none')
    }

    // Milestone star (★ for tag/version, ⚡ for large_change)
    nodeElems.filter(d => d.isMilestone)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => -nodeRadius(d) - 5)
      .attr('font-size', d => d.milestoneReason === 'large_change' ? 9 : 10)
      .attr('pointer-events', 'none')
      .attr('fill', d => d.milestoneReason === 'large_change' ? '#C0624B' : '#D4A84A')
      .attr('opacity', 0.9)
      .text(d => d.milestoneReason === 'large_change' ? '⚡' : '★')

    // Tag dot (small corner indicator when tags exist)
    nodeElems.filter(d => d.tagNames.length > 0)
      .append('circle')
      .attr('r', 3.5)
      .attr('cx', d => nodeRadius(d))
      .attr('cy', d => -nodeRadius(d))
      .attr('fill', '#D4A84A')
      .attr('stroke', '#1A1107')
      .attr('stroke-width', 1)

    // Short hash label (visible on zoom-in)
    nodeElems.append('text')
      .attr('class', 'label')
      .attr('dy', d => nodeRadius(d) + 11)
      .attr('text-anchor', 'middle')
      .attr('fill', d => d.isMainBranch ? '#D4A84A80' : '#8B703580')
      .attr('font-size', 8)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .text(d => d.label)

    // Commit message label for important commits (merge / release / tag)
    nodeElems
      .filter(d => d.type === 'merge' || d.type === 'release' || d.tagNames.length > 0)
      .append('text')
      .attr('class', 'commit-label')
      .attr('dy', d => -nodeRadius(d) - 8)
      .attr('text-anchor', 'middle')
      .attr('fill', d => TYPE_COLOR[d.type])
      .attr('font-size', 8.5)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-weight', '500')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .text(d => {
        const msg = d.message.split('\n')[0]
        return msg.length > 28 ? msg.slice(0, 26) + '…' : msg
      })

    // ── Events ────────────────────────────────────────────
    nodeElems
      .on('mouseenter', function(event, d) {
        d3.select(this).select('.glow').attr('opacity', 0.28)
        showTooltip(event, d)
      })
      .on('mousemove', (event) => moveTooltip(event))
      .on('mouseleave', function(_, d) {
        const sel = d.id === selectedNodeId
        d3.select(this).select('.glow').attr('opacity', sel ? 0.3 : 0)
        hideTooltip()
      })
      .on('click', (_, d) => handleNodeClick(d))

    // Drag
    const drag = d3.drag<SVGGElement, D3Node>()
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
      .on('drag',  (ev, d) => { d.fx = ev.x; d.fy = ev.y })
      .on('end',   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
    nodeElems.call(drag)

    // ── Force simulation ──────────────────────────────────
    const sim = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(links)
        .id(d => d.id)
        .distance(d => d.type === 'parent' ? 42 : 75)
        .strength(d => d.type === 'parent' ? 0.85 : 0.35)
      )
      .force('charge', d3.forceManyBody<D3Node>()
        .strength(-140).distanceMin(8).distanceMax(260)
      )
      // 日付の目盛りを引いた以上、x は時間として読めなければ嘘になる。
      // 以前より強く時間位置に留める（散らばりは y と衝突で逃がす）
      .force('x', d3.forceX<D3Node>(d => xPos(d.timestamp))
        .strength(d => d.isMainBranch ? 0.9 : 0.6)
      )
      .force('y', d3.forceY<D3Node>(d => d.lane * LH)
        .strength(d => d.isMainBranch ? 0.75 : 0.38)
      )
      .force('collision', d3.forceCollide<D3Node>(d => nodeRadius(d) + 5))
      .velocityDecay(0.45)
      .alphaDecay(0.02)

    sim.on('tick', () => {
      linkElems
        .attr('x1', d => d.source.x ?? 0).attr('y1', d => d.source.y ?? 0)
        .attr('x2', d => d.target.x ?? 0).attr('y2', d => d.target.y ?? 0)
      nodeElems.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    // ── 時間ルーラー（画面固定・最前面）──────────────────
    const RULER_H = 22
    const rulerG = svg.append('g').attr('class', 'time-ruler')
    rulerG.append('rect')
      .attr('x', 0).attr('y', 0).attr('width', W).attr('height', RULER_H)
      .attr('fill', '#140D05').attr('opacity', 0.92)
    rulerG.append('line')
      .attr('x1', 0).attr('y1', RULER_H).attr('x2', W).attr('y2', RULER_H)
      .attr('stroke', '#3A2A15').attr('stroke-width', 1)
    const rulerTicks = rulerG.append('g')

    // いま画面に映っている期間（目盛りが疎でも必ず出る）
    const rangeLabel = rulerG.append('text')
      .attr('x', 10).attr('y', RULER_H - 7)
      .attr('fill', '#D4A84A')
      .attr('font-size', 9.5)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('opacity', 0.85)

    const fmt = (ms: number) => {
      const d = new Date(ms)
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
    }

    renderRuler = (t: d3.ZoomTransform) => {
      rangeLabel.text(`${fmt(axis.time(t.invertX(0)))} → ${fmt(axis.time(t.invertX(W)))}`)

      // 画面内に入る目盛りだけを、重ならない間隔で描く
      const visible: TimeTick[] = []
      let lastX = 150   // 左端の期間ラベルと重ねない
      for (const tick of axis.ticksIn(axis.time(t.invertX(0)), axis.time(t.invertX(W)))) {
        const sx = t.applyX(tick.x)
        if (sx < 0 || sx > W - 10) continue
        if (sx - lastX < 58) continue
        lastX = sx
        visible.push({ x: sx, label: tick.label, major: tick.major })
      }

      const sel = rulerTicks.selectAll<SVGGElement, TimeTick>('g.tick')
        .data(visible, d => d.label)
      const enter = sel.enter().append('g').attr('class', 'tick')
      enter.append('line')
        .attr('y1', RULER_H - 6).attr('y2', RULER_H)
        .attr('stroke', '#8B7355').attr('stroke-width', 1).attr('opacity', 0.7)
      enter.append('text')
        .attr('y', RULER_H - 9)
        .attr('fill', '#B99A63')
        .attr('font-size', 9.5)
        .attr('font-family', 'JetBrains Mono, monospace')
      sel.exit().remove()

      const merged = enter.merge(sel)
      merged.attr('transform', d => `translate(${d.x},0)`)
      merged.select('text')
        .attr('fill', d => d.major ? '#D4A84A' : '#B99A63')
        .text(d => d.label)
    }

    // ズームが一度も起きなくてもルーラーを出す
    renderRuler(d3.zoomTransform(svg.node()!))

    // 初回のみ自動フィット（フィルター変更では再フィットしない）
    let hasFit = false
    sim.on('end', () => {
      if (!hasFit) { focusRecent(svg, zoom, nodes, W, H); hasFit = true }
    })

    if (selectedNodeId || highlightIds) applyHighlight(nodeElems, selectedNodeId, highlightIds)

    return () => { sim.stop() }
  }, [nodes, links, handleNodeClick, struggleIds])

  useEffect(() => {
    if (!svgRef.current) return
    const nodeElems = d3.select(svgRef.current).selectAll<SVGGElement, D3Node>('g.node')
    applyHighlight(nodeElems, selectedNodeId, highlightIds)
  }, [selectedNodeId, highlightIds])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#1A1107' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block', background: '#1A1107' }} />

      {/* Legend */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        display: 'flex', flexDirection: 'column', gap: 5,
        background: 'rgba(26,17,7,0.88)', backdropFilter: 'blur(8px)',
        border: '1px solid var(--border)', borderRadius: 8,
        padding: '8px 12px', fontSize: 10,
      }}>
        <div style={{ color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.8px', marginBottom: 2 }}>凡例</div>
        {([
          { label: 'Main',      color: TYPE_COLOR.normal,    shape: 'circle',  main: true,  dashed: false },
          { label: 'Feature',   color: TYPE_COLOR.feature,   shape: 'circle',  main: false, dashed: false },
          { label: 'Merge',     color: TYPE_COLOR.merge,     shape: 'diamond', main: false, dashed: false },
          { label: 'Release',   color: TYPE_COLOR.release,   shape: 'hex',     main: false, dashed: false },
          { label: 'Bugfix',    color: TYPE_COLOR.error_fix, shape: 'circle',  main: false, dashed: false },
          { label: 'Refactor',  color: TYPE_COLOR.refactor,  shape: 'circle',  main: false, dashed: false },
          { label: 'Test',      color: TYPE_COLOR.test,      shape: 'circle',  main: false, dashed: false },
          { label: 'Docs',      color: TYPE_COLOR.docs,      shape: 'circle',  main: false, dashed: false },
          { label: 'Chore',     color: TYPE_COLOR.chore,     shape: 'circle',  main: false, dashed: false },
          { label: 'Revert',    color: TYPE_COLOR.revert,    shape: 'circle',  main: false, dashed: true  },
          { label: '★ Milestone',color: '#D4A84A',           shape: 'gate',    main: false, dashed: false },
        ]).map(({ label, color, shape, dashed, main }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {shape === 'gate' ? (
              <div style={{ width: 2, height: 12, background: color, opacity: 0.7, borderRadius: 1 }} />
            ) : shape === 'diamond' ? (
              <svg width="12" height="12" viewBox="-6 -6 12 12">
                <path d={diamond(5)} fill={`${color}30`} stroke={color} strokeWidth="1.5"/>
              </svg>
            ) : shape === 'hex' ? (
              <svg width="12" height="12" viewBox="-6 -6 12 12">
                <path d={hexagon(5)} fill={`${color}30`} stroke={color} strokeWidth="1.5"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="-6 -6 12 12">
                <circle r={main ? 5 : 4} fill={`${color}33`} stroke={color}
                  strokeWidth={main ? 2 : 1.5}
                  strokeDasharray={dashed ? '3,2' : 'none'}/>
              </svg>
            )}
            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Display limit + Home button */}
      <div style={{
        position: 'absolute', bottom: 14, right: 14,
        display: 'flex', alignItems: 'center', gap: 5,
        background: 'rgba(26,17,7,0.88)', backdropFilter: 'blur(8px)',
        border: '1px solid var(--border)', borderRadius: 8,
        padding: '5px 10px', fontSize: 11, color: 'var(--text-secondary)',
      }}>
        <button
          onClick={handleFitView}
          title="全体表示 (🏠)"
          style={{
            background: 'transparent', border: '1px solid var(--border)',
            borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
            color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1,
            marginRight: 4,
          }}
        >
          🏠
        </button>
        <span style={{ color: 'var(--text-dim)' }}>表示</span>
        {DISPLAY_LIMITS.map(n => (
          <button key={n} onClick={() => setDisplayLimit(n)} style={{
            background: displayLimit === n ? 'var(--accent)' : 'transparent',
            border: `1px solid ${displayLimit === n ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 4, padding: '2px 7px',
            color: displayLimit === n ? '#1A1107' : 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 11,
            fontWeight: displayLimit === n ? '600' : '400',
          }}>
            {n >= 1000 ? '全件' : n}
          </button>
        ))}
        <span style={{ color: 'var(--text-dim)', marginLeft: 2 }}>/ {totalCount}</span>
      </div>

      <Tooltip />
    </div>
  )
}

// ── Utilities ──────────────────────────────────────────────
function fitView(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
  nodes: D3Node[], W: number, H: number
) {
  const valid = nodes.filter(n => n.x !== undefined)
  if (valid.length === 0) return
  const xs = valid.map(n => n.x!), ys = valid.map(n => n.y!)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const gW = maxX - minX || 1, gH = maxY - minY || 1

  // 全体を1画面に押し込めると、履歴が長いリポジトリでは点の帯になって読めない。
  // 縦は必ず収め、横は縮尺の下限（0.35）で止めて、収まらない分はスクロールに委ねる。
  const fitAll = Math.min((W - 80) / (gW + 80), (H - 120) / (gH + 120))
  const scale = Math.max(0.35, Math.min(1.1, fitAll))
  const fitsHorizontally = gW * scale <= W - 80

  // 横に収まらないときは最新（右端）を見せる。人が最初に知りたいのは直近だから。
  const tx = fitsHorizontally
    ? W / 2 - scale * (minX + maxX) / 2
    : W - 60 - scale * maxX
  const ty = H / 2 - scale * (minY + maxY) / 2
  svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale))
}

/**
 * 初期表示。全体を1画面に押し込むと点の帯になるので、読める倍率のまま
 * いちばん新しい側を映す。全体像が見たいときは Home（fitView）がある。
 */
function focusRecent(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
  nodes: D3Node[], W: number, H: number
) {
  const valid = nodes.filter(n => n.x !== undefined)
  if (valid.length === 0) return
  const xs = valid.map(n => n.x!), ys = valid.map(n => n.y!)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const gW = maxX - minX || 1, gH = maxY - minY || 1

  // 縦は必ず収める。横は「直近70コミットぶんくらいが一画面に入る」を目安にする。
  // 倍率を上げすぎると数十分ぶんしか映らず、どこを見ているのか分からなくなる。
  const verticalFit = Math.min(1.1, (H - 140) / (gH + 100))
  const targetW = Math.min(gW, 70 * STEP_PX)
  const scale = Math.max(0.45, Math.min(verticalFit, (W - 100) / targetW))
  const fits = gW * scale <= W - 100

  const tx = fits ? W / 2 - scale * (minX + maxX) / 2 : W - 70 - scale * maxX
  const ty = (H + 22) / 2 - scale * (minY + maxY) / 2
  svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale))
}

function applyHighlight(
  nodeElems: d3.Selection<SVGGElement, D3Node, SVGGElement, unknown>,
  selectedId?: string,
  highlightIds?: Set<string>
) {
  const dimming = !!highlightIds && highlightIds.size > 0
  nodeElems.attr('opacity', (d: D3Node) =>
    !dimming || highlightIds!.has(d.id) ? 1 : 0.15)
  nodeElems.select('.glow').attr('opacity', (d: D3Node) =>
    d.id === selectedId ? 0.35 : (dimming && highlightIds!.has(d.id) ? 0.2 : 0))
  nodeElems.select('.main-circle')
    .attr('stroke', (d: D3Node) => d.id === selectedId ? '#fff' : TYPE_COLOR[d.type])
    .attr('stroke-width', (d: D3Node) => {
      if (d.id === selectedId) return 3
      if (d.type === 'merge' || d.type === 'release') return 2.5
      return d.isMainBranch ? 2.5 : 1.5
    })
}

// ── Tooltip ────────────────────────────────────────────────
let tooltipEl: HTMLDivElement | null = null
function Tooltip() {
  return <div id="maze-tooltip" style={{
    position: 'fixed', pointerEvents: 'none', display: 'none',
    background: 'rgba(22,14,6,0.96)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '9px 13px', zIndex: 1000,
    fontSize: 12, color: 'var(--text-primary)',
    boxShadow: '0 6px 28px rgba(0,0,0,0.7)', maxWidth: 340,
    backdropFilter: 'blur(10px)',
  }} />
}

function getTooltipEl() {
  if (!tooltipEl) tooltipEl = document.getElementById('maze-tooltip') as HTMLDivElement
  return tooltipEl!
}

const TYPE_LABEL: Record<CommitType, string> = {
  normal: '通常', feature: '機能追加', error_fix: 'バグ修正',
  revert: 'リバート', merge: 'マージ', wip: 'WIP', release: 'リリース',
  chore: '環境整備', docs: 'ドキュメント', refactor: 'リファクタ', test: 'テスト',
}

function showTooltip(event: MouseEvent, d: D3Node) {
  const el = getTooltipEl()
  const date = new Date(d.timestamp).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })
  const color = TYPE_COLOR[d.type]

  const tags = d.tagNames.map(t =>
    `<span style="background:rgba(212,168,74,0.15);color:#D4A84A;padding:1px 6px;border-radius:3px;font-size:10px;border:1px solid rgba(212,168,74,0.3)">${t}</span>`
  ).join(' ')

  const branches = d.branchNames.slice(0, 2).map(b =>
    `<span style="background:rgba(100,100,100,0.2);color:var(--text-secondary);padding:1px 6px;border-radius:3px;font-size:10px">${b}</span>`
  ).join(' ')

  const milestoneLabel = d.isMilestone
    ? `<span style="background:rgba(212,168,74,0.18);color:#D4A84A;padding:1px 6px;border-radius:3px;font-size:10px">
        ${{ tag: '★ タグ', version: '★ バージョン', large_change: '⚡ 大規模変更' }[d.milestoneReason ?? 'tag'] ?? '★'}
      </span>`
    : ''

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">
      <span style="font-weight:700;font-family:monospace;color:${color};font-size:11px">${d.label}</span>
      <span style="background:${color}22;color:${color};padding:1px 6px;border-radius:3px;font-size:10px;border:1px solid ${color}44">${TYPE_LABEL[d.type]}</span>
      ${milestoneLabel}
      ${tags}
    </div>
    <div style="color:var(--text-primary);margin-bottom:7px;line-height:1.5;font-size:12px">${d.message.split('\n')[0].slice(0, 100)}${d.message.length > 100 ? '…' : ''}</div>
    ${branches ? `<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap">${branches}</div>` : ''}
    <div style="display:flex;gap:12px;font-size:10px;color:var(--text-dim)">
      <span>${d.authorName}</span>
      <span>${date}</span>
      ${d.filesChanged > 0 ? `<span>+${d.insertions} -${d.deletions}</span>` : ''}
    </div>
  `
  el.style.display = 'block'
  moveTooltip(event)
}

function moveTooltip(event: MouseEvent) {
  const el = getTooltipEl()
  const x = event.clientX + 16, w = el.offsetWidth, vw = window.innerWidth
  el.style.left = (x + w > vw ? event.clientX - w - 16 : x) + 'px'
  el.style.top  = (event.clientY - 10) + 'px'
}

function hideTooltip() {
  getTooltipEl().style.display = 'none'
}
