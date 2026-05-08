import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import * as d3 from 'd3'
import type { MazeGraph, MazeNode, MazeEdge, CommitType } from '../../shared/types'
import type { Zone } from '../../shared/types'

interface Props {
  graph: MazeGraph
  filterTypes: Set<string>
  onNodeClick: (node: MazeNode) => void
  selectedNodeId?: string
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
const LANE_HEIGHT = 65

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
export default function MazeGraph({ graph, filterTypes, onNodeClick, selectedNodeId }: Props) {
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

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.02, 12])
      .on('zoom', event => {
        g.attr('transform', event.transform)
        const k = event.transform.k
        // Labels visible at k > 0.35
        const lOp = k > 0.35 ? Math.min(1, (k - 0.35) * 3) : 0
        g.selectAll<SVGTextElement, unknown>('text.commit-label').attr('opacity', lOp)
        g.selectAll<SVGTextElement, unknown>('text.lane-label').attr('opacity', Math.min(1, k * 0.8))
        g.selectAll<SVGTextElement, unknown>('.milestone-label').attr('opacity', Math.min(1, k * 1.5))
        g.selectAll<SVGLineElement, unknown>('.milestone-gate').attr('opacity', Math.min(0.6, k * 0.8))
      })
    svg.call(zoom)
    zoomRef.current = zoom
    nodesRef.current = nodes

    // ── Time & layout ─────────────────────────────────────
    const timestamps = nodes.map(n => n.timestamp)
    const tMin = Math.min(...timestamps)
    const tMax = Math.max(...timestamps)
    const tRange = tMax - tMin || 1
    const spreadW = Math.min(W * 5, Math.max(W * 1.5, nodes.length * 18))
    const xPos = (t: number) => ((t - tMin) / tRange) * spreadW

    const maxLane = Math.max(1, ...nodes.map(n => Math.abs(n.lane)))
    const laneH   = maxLane * LANE_HEIGHT

    // ── Lane bands ────────────────────────────────────────
    for (let lane = -maxLane; lane <= maxLane; lane++) {
      const yLane = lane * LANE_HEIGHT
      const laneNodes = nodes.filter(n => n.lane === lane)
      if (laneNodes.length === 0 && lane !== 0) continue

      const bandColor = lane === 0 ? '#D4A84A' : LANE_BAND_COLORS[(Math.abs(lane) - 1) % LANE_BAND_COLORS.length]
      const bandOp    = lane === 0 ? 0.05 : 0.03

      g.append('rect')
        .attr('class', 'lane-band')
        .attr('x', -200)
        .attr('y', yLane - LANE_HEIGHT / 2 + 6)
        .attr('width', spreadW + 400)
        .attr('height', LANE_HEIGHT - 12)
        .attr('fill', bandColor)
        .attr('opacity', bandOp)
        .attr('rx', 6)
    }

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
      const bandTop = -(maxLane + 1) * LANE_HEIGHT - 24
      const bandH   = (maxLane * 2 + 2) * LANE_HEIGHT + 48

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
    const taggedNodes = nodes.filter(n => n.isMilestone)
    taggedNodes.forEach(n => {
      const x  = xPos(n.timestamp)
      const gh = laneH + LANE_HEIGHT

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
          : n.milestoneReason === 'large_change'
            ? [`⚡ ${n.label}`]
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
        .attr('y', lane * LANE_HEIGHT + 4)
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
        .strength(-250).distanceMin(8).distanceMax(380)
      )
      .force('x', d3.forceX<D3Node>(d => xPos(d.timestamp))
        .strength(d => d.isMainBranch ? 0.5 : 0.22)
      )
      .force('y', d3.forceY<D3Node>(d => d.lane * LANE_HEIGHT)
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

    // 初回のみ自動フィット（フィルター変更では再フィットしない）
    let hasFit = false
    sim.on('end', () => {
      if (!hasFit) { fitView(svg, g, zoom, nodes, W, H); hasFit = true }
    })

    if (selectedNodeId) applyHighlight(nodeElems, selectedNodeId)

    return () => { sim.stop() }
  }, [nodes, links, handleNodeClick])

  useEffect(() => {
    if (!svgRef.current) return
    const nodeElems = d3.select(svgRef.current).selectAll<SVGGElement, D3Node>('g.node')
    applyHighlight(nodeElems, selectedNodeId)
  }, [selectedNodeId])

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
  const scale = Math.min(0.85, (W - 80) / (gW + 80), (H - 80) / (gH + 80))
  const tx = W / 2 - scale * (minX + maxX) / 2
  const ty = H / 2 - scale * (minY + maxY) / 2
  svg.transition().duration(900).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale))
}

function applyHighlight(
  nodeElems: d3.Selection<SVGGElement, D3Node, SVGGElement, unknown>,
  selectedId?: string
) {
  nodeElems.select('.glow').attr('opacity', (d: D3Node) => d.id === selectedId ? 0.35 : 0)
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
