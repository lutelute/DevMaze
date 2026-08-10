import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import * as d3 from 'd3'
import type { MazeGraph, MazeNode, MazeEdge, CommitType, Zone } from '../../shared/types'

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
  parent:       '#5A3D1E',
  merge_parent: '#C8A060',
  revert_of:    '#C88B3A',
}

const EDGE_DASH: Record<MazeEdge['type'], string> = {
  parent:       'none',
  merge_parent: '6,3',
  revert_of:    '3,4',
}

const DISPLAY_LIMITS = [80, 150, 300, 1000] as const

const HOUR = 3600_000
const DAY = 24 * HOUR

// ── 時間軸 ─────────────────────────────────────────────────
//
// コミットを実時間で並べると、開発が集中した数日に全部が固まり、
// 残りが空白になる。そこでコミット間隔を対数で圧縮した「体感時間」の軸を作る。
// 密度が均されて読めるようになり、長い空白は縮んでも消えずに残る。
interface TimeTick { x: number; label: string; major: boolean }

interface TimeAxis {
  pos: (t: number) => number
  time: (x: number) => number
  total: number
  ticksIn: (t0: number, t1: number) => TimeTick[]
  gaps: { at: number; days: number }[]
}

// 1件ごとの前進はごく小さくして、時間が近いコミットは重なるようにする。
// 均等に並べると読めるが、のっぺりして「いつ集中していたか」が消える。
// 重ねておけば、衝突判定が塊（クラスタ）に押し広げてくれる。
const STEP_PX = 3         // コミット1件ぶんの基本間隔（ほぼ0にして重なりを許す）
const GAP_K = 24          // 空白時間の効き
const GAP_MAX = 200       // 1つの空白が占められる最大幅

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
    if (gap >= 3 * DAY) gaps.push({ at: (xs[i - 1] + x) / 2, days: Math.round(gap / DAY) })
  }

  const total = xs[xs.length - 1] || 1

  const interp = (v: number, from: number[], to: number[]): number => {
    if (v <= from[0]) return to[0]
    if (v >= from[from.length - 1]) return to[to.length - 1]
    let lo = 0, hi = from.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (from[mid] <= v) lo = mid
      else hi = mid
    }
    const span = from[hi] - from[lo] || 1
    return to[lo] + ((v - from[lo]) / span) * (to[hi] - to[lo])
  }

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

  return {
    pos: t => interp(t, ts, xs),
    time: x => interp(x, xs, ts),
    total,
    ticksIn,
    gaps,
  }
}

function weekOf(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1)
  return Math.floor((d.getTime() - start.getTime()) / (7 * DAY))
}

// ── 蛇行レイアウト ─────────────────────────────────────────
//
// 一直線の履歴を一直線に描くと、画面の縦がまるごと余り、
// 横に細長い帯にしかならない。時間軸を一定幅で折り返して蛇行させると、
// 画面を使い切れて、道として読めるようになる（= 迷路）。
interface Layout {
  rowW: number
  rowH: number
  laneGap: number
  rows: number
  pos: (t: number, lane: number) => { x: number; y: number }
  rowOf: (t: number) => number
  rowStart: (row: number) => { x: number; y: number; time: number } | null
  width: number
  height: number
}

function buildLayout(axis: TimeAxis, maxLane: number, viewportW: number): Layout {
  // 1行の長さは画面幅にそろえる（1行 ≒ 1画面ぶん）
  const rowW = Math.max(760, Math.min(1700, viewportW - 190))
  const laneGap = 46
  // 塊が縦に膨らむぶんの余白を持たせる
  const rowH = (maxLane * 2 + 1) * laneGap + 130
  const rows = Math.max(1, Math.ceil(axis.total / rowW))

  const place = (ax: number) => {
    const row = Math.min(rows - 1, Math.floor(ax / rowW))
    const off = ax - row * rowW
    // 偶数行は左→右、奇数行は右→左（牛耕式）。行の変わり目が短い縦移動で済む
    return { row, x: row % 2 === 0 ? off : rowW - off }
  }

  return {
    rowW, rowH, laneGap, rows,
    width: rowW,
    height: rows * rowH,
    pos: (t, lane) => {
      const { row, x } = place(axis.pos(t))
      return { x, y: row * rowH + rowH / 2 + lane * laneGap }
    },
    rowOf: t => place(axis.pos(t)).row,
    rowStart: row => {
      if (row < 0 || row >= rows) return null
      const ax = row * rowW
      return {
        x: row % 2 === 0 ? 0 : rowW,
        y: row * rowH + rowH / 2,
        time: axis.time(ax),
      }
    },
  }
}

function nodeRadius(n: D3Node): number {
  if (n.type === 'merge')   return 9
  if (n.type === 'release') return 10
  const base = n.isMainBranch ? 8 : 5.5
  return base + Math.min(4, Math.sqrt(n.filesChanged ?? 0))
}

function diamond(r: number): string {
  return `M0,${-r} L${r * 0.8},0 L0,${r} L${-r * 0.8},0 Z`
}

function hexagon(r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3 - Math.PI / 6
    return `${i === 0 ? 'M' : 'L'}${Math.cos(a) * r},${Math.sin(a) * r}`
  }).join(' ') + 'Z'
}

const ZONE_LABEL_COLOR = (theme: CommitType) => TYPE_COLOR[theme] ?? '#D4A84A'

// ── Component ──────────────────────────────────────────────
export default function MazeGraph({
  graph, filterTypes, onNodeClick, selectedNodeId, highlightIds, struggleIds,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const nodesRef = useRef<D3Node[]>([])
  const layoutRef = useRef<Layout | null>(null)
  const [displayLimit, setDisplayLimit] = useState<number>(150)
  const [zoomPct, setZoomPct] = useState(100)

  const { nodes, links, totalCount } = useMemo(() => {
    const filtered = filterTypes.size === 0
      ? graph.nodes
      : graph.nodes.filter(n => filterTypes.has(n.type))

    const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp)
    const limited = sorted.slice(0, displayLimit)
    const activeNodes: D3Node[] = limited.map(n => ({ ...n })) as D3Node[]
    const byId = new Map(activeNodes.map(n => [n.id, n]))

    const activeLinks = graph.edges
      .map(e => {
        const sId = typeof e.source === 'string' ? e.source : (e.source as MazeNode).id
        const tId = typeof e.target === 'string' ? e.target : (e.target as MazeNode).id
        const source = byId.get(sId)
        const target = byId.get(tId)
        if (!source || !target) return null
        return { id: e.id, source, target, type: e.type }
      })
      .filter((l): l is D3Link => l !== null)

    return { nodes: activeNodes, links: activeLinks, totalCount: filtered.length }
  }, [graph, filterTypes, displayLimit])

  const handleNodeClick = useCallback((node: D3Node) => {
    onNodeClick(node as MazeNode)
  }, [onNodeClick])

  const zoomBy = useCallback((factor: number) => {
    if (!svgRef.current || !zoomRef.current) return
    d3.select(svgRef.current).transition().duration(220)
      .call(zoomRef.current.scaleBy, factor)
  }, [])

  const handleFitView = useCallback(() => {
    if (!svgRef.current || !zoomRef.current || !layoutRef.current) return
    fitLayout(d3.select(svgRef.current), zoomRef.current, layoutRef.current,
      svgRef.current.clientWidth, svgRef.current.clientHeight)
  }, [])

  useEffect(() => {
    const svg = d3.select(svgRef.current!)
    svg.selectAll('*').remove()

    const container = svgRef.current!
    const W = container.clientWidth || 900
    const H = container.clientHeight || 600
    if (nodes.length === 0) return

    const axis = buildTimeAxis(nodes.map(n => n.timestamp))
    const maxLane = Math.max(1, ...nodes.map(n => Math.abs(n.lane)))
    const layout = buildLayout(axis, maxLane, W)
    layoutRef.current = layout
    nodesRef.current = nodes

    // ── defs ──────────────────────────────────────────────
    const defs = svg.append('defs')
    const glow = defs.append('filter').attr('id', 'glow')
      .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%')
    glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'coloredBlur')
    const fm = glow.append('feMerge')
    fm.append('feMergeNode').attr('in', 'coloredBlur')
    fm.append('feMergeNode').attr('in', 'SourceGraphic')

    ;(['parent', 'merge_parent', 'revert_of'] as MazeEdge['type'][]).forEach(type => {
      defs.append('marker')
        .attr('id', `arr-${type}`)
        .attr('viewBox', '0 -4 8 8').attr('refX', 18).attr('refY', 0)
        .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
        .append('path').attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', EDGE_COLOR[type])
        .attr('opacity', type === 'parent' ? 0.6 : 0.9)
    })

    svg.style('background', '#1A1107')
    const g = svg.append('g').attr('class', 'zoom-layer')

    let onZoom: (t: d3.ZoomTransform) => void = () => {}

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.12, 6])
      .on('zoom', event => {
        const t = event.transform as d3.ZoomTransform
        g.attr('transform', t.toString())
        const k = t.k
        const lOp = k > 0.42 ? Math.min(1, (k - 0.42) * 3) : 0
        g.selectAll<SVGTextElement, unknown>('text.commit-label').attr('opacity', lOp)
        g.selectAll<SVGTextElement, unknown>('.hash-label').attr('opacity', k > 0.9 ? Math.min(0.75, (k - 0.9) * 2) : 0)
        g.selectAll<SVGTextElement, unknown>('.milestone-label').attr('opacity', Math.min(1, k * 1.6))
        g.selectAll<SVGTextElement, unknown>('.lane-label').attr('opacity', Math.min(0.8, k))
        onZoom(t)
      })
    svg.call(zoom)
    zoomRef.current = zoom

    // ── 行（廊下）────────────────────────────────────────
    const corridors = g.append('g').attr('class', 'corridors')
    const zones: Zone[] = graph.zones ?? []

    for (let row = 0; row < layout.rows; row++) {
      const start = layout.rowStart(row)!
      const endTime = layout.rowStart(row + 1)?.time ?? axis.time(axis.total)
      // その行の期間を支配する開発フェーズの色で廊下を染める
      const zone = zones.find(z => z.startTimestamp <= endTime && z.endTimestamp >= start.time)
      const tint = zone ? ZONE_LABEL_COLOR(zone.theme) : '#D4A84A'

      corridors.append('rect')
        .attr('x', -26)
        .attr('y', row * layout.rowH + 14)
        .attr('width', layout.rowW + 52)
        .attr('height', layout.rowH - 28)
        .attr('rx', 14)
        .attr('fill', tint)
        .attr('opacity', row % 2 === 0 ? 0.045 : 0.03)

      corridors.append('rect')
        .attr('x', -26)
        .attr('y', row * layout.rowH + 14)
        .attr('width', layout.rowW + 52)
        .attr('height', layout.rowH - 28)
        .attr('rx', 14)
        .attr('fill', 'none')
        .attr('stroke', tint)
        .attr('stroke-width', 1)
        .attr('opacity', 0.10)

      // 行の始まりに日付。折り返した先が「いつ」なのかが分からないと道を追えない
      const d = new Date(start.time)
      const leftToRight = row % 2 === 0
      corridors.append('text')
        .attr('x', leftToRight ? -30 : layout.rowW + 30)
        .attr('y', row * layout.rowH + layout.rowH / 2 - 4)
        .attr('text-anchor', leftToRight ? 'end' : 'start')
        .attr('fill', tint)
        .attr('font-size', 11)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '600')
        .attr('opacity', 0.75)
        .text(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`)

      corridors.append('text')
        .attr('x', leftToRight ? -30 : layout.rowW + 30)
        .attr('y', row * layout.rowH + layout.rowH / 2 + 10)
        .attr('text-anchor', leftToRight ? 'end' : 'start')
        .attr('fill', 'var(--text-dim)')
        .attr('font-size', 9)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('opacity', 0.5)
        .text(zone ? zone.label : leftToRight ? '→' : '←')
    }

    // ── 止まっていた時間 ───────────────────────────────────
    const gapsG = g.append('g').attr('class', 'gaps')
    for (const gap of axis.gaps) {
      const row = Math.min(layout.rows - 1, Math.floor(gap.at / layout.rowW))
      const off = gap.at - row * layout.rowW
      const x = row % 2 === 0 ? off : layout.rowW - off
      const y = row * layout.rowH + layout.rowH / 2

      gapsG.append('line')
        .attr('x1', x).attr('y1', y - layout.rowH / 2 + 18)
        .attr('x2', x).attr('y2', y + layout.rowH / 2 - 18)
        .attr('stroke', '#6B5537')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,4')
        .attr('opacity', 0.5)
      gapsG.append('text')
        .attr('class', 'lane-label')
        .attr('x', x).attr('y', y - layout.rowH / 2 + 14)
        .attr('text-anchor', 'middle')
        .attr('fill', '#8B7355')
        .attr('font-size', 9)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('opacity', 0)
        .text(`⏸ ${gap.days}日`)
    }

    // ── Edges ─────────────────────────────────────────────
    const linkGroup = g.append('g').attr('class', 'links')
    const linkElems = linkGroup.selectAll<SVGLineElement, D3Link>('line')
      .data(links).join('line')
      .attr('stroke', d => EDGE_COLOR[d.type])
      .attr('stroke-width', d => {
        if (d.type === 'merge_parent') return 2.2
        if (d.type === 'revert_of')   return 1.8
        return d.source.isMainBranch && d.target.isMainBranch ? 2.4 : 1.3
      })
      .attr('stroke-dasharray', d => EDGE_DASH[d.type])
      .attr('opacity', d => d.type === 'parent' ? 0.55 : 0.85)
      .attr('marker-end', d => `url(#arr-${d.type})`)

    // ── Nodes ─────────────────────────────────────────────
    const nodeGroup = g.append('g').attr('class', 'nodes')
    const nodeElems = nodeGroup.selectAll<SVGGElement, D3Node>('g.node')
      .data(nodes, d => d.id).join('g')
      .attr('class', 'node').style('cursor', 'pointer')

    nodeElems.append('circle')
      .attr('class', 'glow')
      .attr('r', d => nodeRadius(d) + 6)
      .attr('fill', d => TYPE_COLOR[d.type])
      .attr('opacity', 0)

    nodeElems.each(function(d) {
      const sel = d3.select(this)
      const c   = TYPE_COLOR[d.type]
      const r   = nodeRadius(d)

      if (d.type === 'merge') {
        sel.append('path').attr('class', 'main-circle').attr('d', diamond(r))
          .attr('fill', `${c}33`).attr('stroke', c).attr('stroke-width', 2)
      } else if (d.type === 'release') {
        sel.append('path').attr('class', 'main-circle').attr('d', hexagon(r))
          .attr('fill', `${c}40`).attr('stroke', c).attr('stroke-width', 2.5)
          .attr('filter', 'url(#glow)')
      } else {
        sel.append('circle').attr('class', 'main-circle').attr('r', r)
          .attr('fill', d.isMainBranch ? `${c}55` : `${c}2A`)
          .attr('stroke', c)
          .attr('stroke-width', d.isMainBranch ? 2.4 : 1.5)
          .attr('filter', d.isMainBranch ? 'url(#glow)' : 'none')
      }
    })

    // 沼マーカー
    if (struggleIds && struggleIds.size > 0) {
      nodeElems.filter(d => struggleIds.has(d.id))
        .append('circle')
        .attr('class', 'struggle-ring')
        .attr('r', d => nodeRadius(d) + 4)
        .attr('fill', 'none')
        .attr('stroke', '#C0624B')
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '2,2.5')
        .attr('opacity', 0.6)
        .attr('pointer-events', 'none')
    }

    // マイルストーン（タグ・バージョンのみ。大規模変更まで出すとラベルが潰れる）
    nodeElems.filter(d => d.isMilestone && d.milestoneReason !== 'large_change')
      .each(function(d) {
        const label = d.tagNames[0] ?? d.message.match(/v\d+[\d.]+/)?.[0] ?? d.label
        const sel = d3.select(this)
        sel.append('rect')
          .attr('class', 'milestone-label')
          .attr('x', -label.length * 3.2 - 5).attr('y', -nodeRadius(d) - 26)
          .attr('width', label.length * 6.4 + 10).attr('height', 15)
          .attr('rx', 4).attr('fill', '#3D2810').attr('opacity', 0.9)
        sel.append('text')
          .attr('class', 'milestone-label')
          .attr('y', -nodeRadius(d) - 15)
          .attr('text-anchor', 'middle')
          .attr('fill', '#E8C060')
          .attr('font-size', 9.5)
          .attr('font-family', 'JetBrains Mono, monospace')
          .attr('font-weight', '600')
          .text(label)
      })

    nodeElems.filter(d => d.milestoneReason === 'large_change')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => -nodeRadius(d) - 5)
      .attr('font-size', 9)
      .attr('pointer-events', 'none')
      .attr('fill', '#C0624B')
      .attr('opacity', 0.9)
      .text('⚡')

    nodeElems.append('text')
      .attr('class', 'hash-label')
      .attr('dy', d => nodeRadius(d) + 11)
      .attr('text-anchor', 'middle')
      .attr('fill', '#8B7355')
      .attr('font-size', 8)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .text(d => d.label)

    nodeElems
      .filter(d => d.type === 'merge' || d.type === 'release' || d.tagNames.length > 0)
      .append('text')
      .attr('class', 'commit-label')
      .attr('dy', d => nodeRadius(d) + 22)
      .attr('text-anchor', 'middle')
      .attr('fill', d => TYPE_COLOR[d.type])
      .attr('font-size', 8.5)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .text(d => {
        const msg = d.message.split('\n')[0]
        return msg.length > 26 ? msg.slice(0, 24) + '…' : msg
      })

    // ── Events ────────────────────────────────────────────
    nodeElems
      .on('mouseenter', function(event, d) {
        d3.select(this).select('.glow').attr('opacity', 0.28)
        showTooltip(event, d)
      })
      .on('mousemove', event => moveTooltip(event))
      .on('mouseleave', function(_, d) {
        d3.select(this).select('.glow').attr('opacity', d.id === selectedNodeId ? 0.3 : 0)
        hideTooltip()
      })
      .on('click', (_, d) => handleNodeClick(d))

    // ── 位置決め ──────────────────────────────────────────
    // 蛇行の座標を目標に、重なりだけを力学で逃がす。
    // 力任せの配置にすると、時間も行も読めない塊になる。
    const sim = d3.forceSimulation<D3Node>(nodes)
      // x は「その時刻の位置」に引く。時間が近いコミットは同じ場所に引かれ、
      // 反発と衝突がそれを塊に押し広げる —— 集中して書いた時期が塊として見える
      .force('x', d3.forceX<D3Node>(d => layout.pos(d.timestamp, d.lane).x).strength(0.6))
      // y のしばりは弱くする。強く縛ると1本の線に戻り、
      // 集中して書いた時期が「線の上の密な部分」にしか見えなくなる
      .force('y', d3.forceY<D3Node>(d => layout.pos(d.timestamp, d.lane).y)
        .strength(d => d.isMainBranch ? 0.3 : 0.2))
      .force('charge', d3.forceManyBody<D3Node>().strength(-120).distanceMax(220))
      .force('link', d3.forceLink<D3Node, D3Link>(links).id(d => d.id)
        .distance(26).strength(0.25))
      .force('collision', d3.forceCollide<D3Node>(d => nodeRadius(d) + 3.5).strength(0.95))
      .velocityDecay(0.45)
      .alphaDecay(0.035)

    const applyPositions = () => {
      linkElems
        .attr('x1', d => d.source.x ?? 0).attr('y1', d => d.source.y ?? 0)
        .attr('x2', d => d.target.x ?? 0).attr('y2', d => d.target.y ?? 0)
      nodeElems.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    }
    sim.on('tick', applyPositions)

    const drag = d3.drag<SVGGElement, D3Node>()
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.2).restart(); d.fx = d.x; d.fy = d.y })
      .on('drag',  (ev, d) => { d.fx = ev.x; d.fy = ev.y })
      .on('end',   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
    nodeElems.call(drag)

    // ── ミニマップ ────────────────────────────────────────
    const MM_W = 148, MM_H = 106, MM_PAD = 7
    const mmScale = Math.min(
      (MM_W - MM_PAD * 2) / Math.max(1, layout.width),
      (MM_H - MM_PAD * 2) / Math.max(1, layout.height),
    )
    const mm = svg.append('g')
      .attr('class', 'minimap')
      .attr('transform', `translate(${W - MM_W - 16},${H - MM_H - 52})`)
      .style('cursor', 'pointer')

    mm.append('rect')
      .attr('width', MM_W).attr('height', MM_H).attr('rx', 8)
      .attr('fill', 'rgba(12,8,3,0.9)')
      .attr('stroke', '#3A2A15').attr('stroke-width', 1)

    // 枠からはみ出さないように切り抜く
    defs.append('clipPath').attr('id', 'minimap-clip')
      .append('rect')
      .attr('x', 1).attr('y', 1).attr('width', MM_W - 2).attr('height', MM_H - 2).attr('rx', 7)
    mm.attr('clip-path', 'url(#minimap-clip)')

    const mmInner = mm.append('g').attr('transform', `translate(${MM_PAD},${MM_PAD}) scale(${mmScale})`)
    mmInner.selectAll('circle')
      .data(nodes).join('circle')
      .attr('cx', d => layout.pos(d.timestamp, d.lane).x)
      .attr('cy', d => layout.pos(d.timestamp, d.lane).y)
      .attr('r', Math.max(2.5, 3 / mmScale))
      .attr('fill', d => struggleIds?.has(d.id) ? '#C0624B' : TYPE_COLOR[d.type])
      .attr('opacity', 0.75)

    const mmView = mm.append('rect')
      .attr('fill', 'rgba(212,168,74,0.12)')
      .attr('stroke', '#D4A84A').attr('stroke-width', 1).attr('rx', 2)
      .attr('pointer-events', 'none')

    // ミニマップのクリックでその位置へ飛ぶ
    mm.on('click', event => {
      const [mx, my] = d3.pointer(event, mm.node())
      const gx = (mx - MM_PAD) / mmScale
      const gy = (my - MM_PAD) / mmScale
      const k = d3.zoomTransform(svg.node()!).k
      svg.transition().duration(320).call(
        zoom.transform,
        d3.zoomIdentity.translate(W / 2 - k * gx, H / 2 - k * gy).scale(k),
      )
    })

    onZoom = (t: d3.ZoomTransform) => {
      setZoomPct(Math.round(t.k * 100))
      // 画面がレイアウトより広いときは矩形が枠を食い破るので、枠内に収める
      const x0 = MM_PAD + t.invertX(0) * mmScale
      const y0 = MM_PAD + t.invertY(0) * mmScale
      const x1 = MM_PAD + t.invertX(W) * mmScale
      const y1 = MM_PAD + t.invertY(H) * mmScale
      const cx0 = Math.max(MM_PAD, Math.min(MM_W - MM_PAD, x0))
      const cy0 = Math.max(MM_PAD, Math.min(MM_H - MM_PAD, y0))
      const cx1 = Math.max(MM_PAD, Math.min(MM_W - MM_PAD, x1))
      const cy1 = Math.max(MM_PAD, Math.min(MM_H - MM_PAD, y1))
      mmView
        .attr('x', cx0).attr('y', cy0)
        .attr('width', Math.max(3, cx1 - cx0))
        .attr('height', Math.max(3, cy1 - cy0))
    }

    // ── 初期表示 ──────────────────────────────────────────
    sim.tick(110)         // だいたい落ち着くまで先に進めてから映す（初回の暴れを見せない）
    applyPositions()
    fitLayout(svg, zoom, layout, W, H)

    if (selectedNodeId || highlightIds) applyHighlight(nodeElems, selectedNodeId, highlightIds)

    return () => { sim.stop() }
  }, [nodes, links, handleNodeClick, struggleIds])

  useEffect(() => {
    if (!svgRef.current) return
    const nodeElems = d3.select(svgRef.current).selectAll<SVGGElement, D3Node>('g.node')
    applyHighlight(nodeElems, selectedNodeId, highlightIds)
  }, [selectedNodeId, highlightIds])

  // 選択されたコミットが画面外なら、そこまで運ぶ（沼や検索から飛んだとき用）
  useEffect(() => {
    if (!selectedNodeId || !svgRef.current || !zoomRef.current) return
    const node = nodesRef.current.find(n => n.id === selectedNodeId)
    if (!node || node.x === undefined || node.y === undefined) return

    const svg = d3.select(svgRef.current)
    const W = svgRef.current.clientWidth
    const H = svgRef.current.clientHeight
    const t = d3.zoomTransform(svgRef.current)
    const sx = t.applyX(node.x), sy = t.applyY(node.y)
    const margin = 80
    if (sx > margin && sx < W - margin && sy > margin && sy < H - margin) return

    const k = Math.max(t.k, 0.6)
    svg.transition().duration(420).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(W / 2 - k * node.x, H / 2 - k * node.y).scale(k),
    )
  }, [selectedNodeId])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#1A1107' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block', background: '#1A1107' }} />

      {/* 凡例 */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        display: 'flex', flexDirection: 'column', gap: 4,
        background: 'rgba(26,17,7,0.88)', backdropFilter: 'blur(8px)',
        border: '1px solid var(--border)', borderRadius: 8,
        padding: '8px 12px', fontSize: 10,
      }}>
        <div style={{ color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.8px', marginBottom: 2 }}>凡例</div>
        {([
          { label: 'Main',      color: TYPE_COLOR.normal,    shape: 'circle',  main: true },
          { label: 'Feature',   color: TYPE_COLOR.feature,   shape: 'circle',  main: false },
          { label: 'Bugfix',    color: TYPE_COLOR.error_fix, shape: 'circle',  main: false },
          { label: 'Merge',     color: TYPE_COLOR.merge,     shape: 'diamond', main: false },
          { label: 'Release',   color: TYPE_COLOR.release,   shape: 'hex',     main: false },
          { label: '沼',        color: '#C0624B',            shape: 'ring',    main: false },
        ]).map(({ label, color, shape, main }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="-7 -7 14 14">
              {shape === 'diamond' ? (
                <path d={diamond(5)} fill={`${color}30`} stroke={color} strokeWidth="1.5"/>
              ) : shape === 'hex' ? (
                <path d={hexagon(5)} fill={`${color}30`} stroke={color} strokeWidth="1.5"/>
              ) : shape === 'ring' ? (
                <circle r={5} fill="none" stroke={color} strokeWidth="1.3" strokeDasharray="2,2"/>
              ) : (
                <circle r={main ? 5 : 4} fill={`${color}33`} stroke={color} strokeWidth={main ? 2 : 1.5}/>
              )}
            </svg>
            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* ズーム操作 */}
      <div style={{
        position: 'absolute', left: 14, bottom: 14,
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'rgba(26,17,7,0.88)', backdropFilter: 'blur(8px)',
        border: '1px solid var(--border)', borderRadius: 8, padding: '4px 6px',
      }}>
        <ZoomBtn onClick={() => zoomBy(1 / 1.4)} title="縮小">−</ZoomBtn>
        <span style={{
          minWidth: 42, textAlign: 'center', fontSize: 10.5,
          color: 'var(--text-secondary)', fontFamily: 'monospace',
        }}>
          {zoomPct}%
        </span>
        <ZoomBtn onClick={() => zoomBy(1.4)} title="拡大">＋</ZoomBtn>
        <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 3px' }} />
        <ZoomBtn onClick={handleFitView} title="全体を表示">⤢</ZoomBtn>
      </div>

      {/* 表示件数 */}
      <div style={{
        position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 5,
        background: 'rgba(26,17,7,0.88)', backdropFilter: 'blur(8px)',
        border: '1px solid var(--border)', borderRadius: 8,
        padding: '5px 10px', fontSize: 11, color: 'var(--text-secondary)',
      }}>
        <span style={{ color: 'var(--text-dim)' }}>表示</span>
        {DISPLAY_LIMITS.map(n => (
          <button key={n} onClick={() => setDisplayLimit(n)} style={{
            background: displayLimit === n ? 'var(--accent)' : 'transparent',
            border: `1px solid ${displayLimit === n ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 4, padding: '2px 7px',
            color: displayLimit === n ? '#1A1107' : 'var(--text-secondary)',
            cursor: 'pointer', fontSize: 11,
            fontWeight: displayLimit === n ? 600 : 400,
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

function ZoomBtn({ onClick, title, children }: {
  onClick: () => void; title: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'transparent', border: '1px solid var(--border)', borderRadius: 5,
        width: 22, height: 22, cursor: 'pointer', color: 'var(--text-secondary)',
        fontSize: 12, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  )
}

// ── Utilities ──────────────────────────────────────────────
/** 蛇行レイアウト全体を画面に収める */
function fitLayout(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
  layout: Layout, W: number, H: number,
) {
  const scale = Math.max(0.12, Math.min(1.2,
    Math.min((W - 120) / (layout.width + 120), (H - 60) / (layout.height + 40))))
  const tx = W / 2 - scale * (layout.width / 2)
  const ty = H / 2 - scale * (layout.height / 2)
  svg.transition().duration(600).call(
    zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale))
}

function applyHighlight(
  nodeElems: d3.Selection<SVGGElement, D3Node, SVGGElement, unknown>,
  selectedId?: string,
  highlightIds?: Set<string>
) {
  const dimming = !!highlightIds && highlightIds.size > 0
  nodeElems.attr('opacity', (d: D3Node) =>
    !dimming || highlightIds!.has(d.id) ? 1 : 0.14)
  nodeElems.select('.glow').attr('opacity', (d: D3Node) =>
    d.id === selectedId ? 0.35 : (dimming && highlightIds!.has(d.id) ? 0.2 : 0))
  nodeElems.select('.main-circle')
    .attr('stroke', (d: D3Node) => d.id === selectedId ? '#fff' : TYPE_COLOR[d.type])
    .attr('stroke-width', (d: D3Node) => {
      if (d.id === selectedId) return 3
      if (d.type === 'merge' || d.type === 'release') return 2.5
      return d.isMainBranch ? 2.4 : 1.5
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

function showTooltip(event: MouseEvent, d: D3Node) {
  const el = getTooltipEl()
  if (!el) return
  const date = new Date(d.timestamp)
  el.innerHTML = `
    <div style="font-weight:600;margin-bottom:4px;line-height:1.4">${escapeHtml(d.message.split('\n')[0])}</div>
    <div style="color:#8B7355;font-family:monospace;font-size:11px">
      ${d.label} · ${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}
    </div>
    <div style="color:#8B7355;font-size:11px;margin-top:3px">
      ${escapeHtml(d.authorName)} · ${d.filesChanged} files · <span style="color:#7B9E5A">+${d.insertions}</span> <span style="color:#C0624B">-${d.deletions}</span>
    </div>
  `
  el.style.display = 'block'
  moveTooltip(event)
}

function moveTooltip(event: MouseEvent) {
  const el = getTooltipEl()
  if (!el) return
  const pad = 14
  const w = el.offsetWidth, h = el.offsetHeight
  let x = event.clientX + pad
  let y = event.clientY + pad
  if (x + w > window.innerWidth - 10) x = event.clientX - w - pad
  if (y + h > window.innerHeight - 10) y = event.clientY - h - pad
  el.style.left = `${x}px`
  el.style.top = `${y}px`
}

function hideTooltip() {
  const el = getTooltipEl()
  if (el) el.style.display = 'none'
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
