import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import * as d3 from 'd3'
import type { MazeGraph, MazeNode, MazeEdge, CommitType } from '../../shared/types'

interface Props {
  graph: MazeGraph
  filterTypes: Set<string>
  onNodeClick: (node: MazeNode) => void
  selectedNodeId?: string
}

type D3Node = MazeNode & d3.SimulationNodeDatum
type D3Link = { id: string; source: D3Node; target: D3Node; type: MazeEdge['type'] }

const TYPE_COLOR: Record<CommitType, string> = {
  normal:    '#D4A84A',
  feature:   '#7B9E5A',
  error_fix: '#C0624B',
  revert:    '#C88B3A',
  merge:     '#8B7355',
  wip:       '#B8A06A',
  release:   '#9B8570',
}

const EDGE_COLOR: Record<MazeEdge['type'], string> = {
  parent:       '#4A3018',
  merge_parent: '#7A6040',
  revert_of:    '#C88B3A',
}

const EDGE_DASH: Record<MazeEdge['type'], string> = {
  parent:       'none',
  merge_parent: '6,3',
  revert_of:    '3,4',
}

const DISPLAY_LIMITS = [80, 150, 300, 1000] as const
const LANE_HEIGHT = 65

function nodeRadius(n: D3Node): number {
  const base = n.isMainBranch ? 8 : (n.type === 'merge' ? 6 : 5)
  return base + Math.min(5, Math.sqrt(n.filesChanged ?? 0))
}

export default function MazeGraph({ graph, filterTypes, onNodeClick, selectedNodeId }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [displayLimit, setDisplayLimit] = useState<number>(150)

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
        const src = typeof e.source === 'string' ? e.source : (e.source as MazeNode).id
        const tgt = typeof e.target === 'string' ? e.target : (e.target as MazeNode).id
        return nodeIds.has(src) && nodeIds.has(tgt)
      })
      .map(e => {
        const srcId = typeof e.source === 'string' ? e.source : (e.source as MazeNode).id
        const tgtId = typeof e.target === 'string' ? e.target : (e.target as MazeNode).id
        return {
          id: e.id,
          source: activeNodes.find(n => n.id === srcId)!,
          target: activeNodes.find(n => n.id === tgtId)!,
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

    // Markers
    const defs = svg.append('defs')

    // Glow filter for main branch
    const glow = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    glow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur')
    const feMerge = glow.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'coloredBlur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    ;(['parent', 'merge_parent', 'revert_of'] as MazeEdge['type'][]).forEach(type => {
      defs.append('marker')
        .attr('id', `arr-${type}`)
        .attr('viewBox', '0 -4 8 8').attr('refX', 18).attr('refY', 0)
        .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
        .append('path').attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', EDGE_COLOR[type])
        .attr('opacity', type === 'parent' ? 0.5 : 0.85)
    })

    svg.style('background', '#1A1107')
    const g = svg.append('g').attr('class', 'zoom-layer')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.02, 10])
      .on('zoom', event => {
        g.attr('transform', event.transform)
        const scale = event.transform.k
        const labelOpacity = scale > 0.4 ? Math.min(1, (scale - 0.4) * 2.5) : 0
        g.selectAll('text.label').attr('opacity', labelOpacity)
        // Hide spine line decorations at very low zoom
        g.selectAll('.spine-label').attr('opacity', scale > 0.25 ? 1 : 0)
      })
    svg.call(zoom)

    // Time scale — compact horizontal spread
    const timestamps = nodes.map(n => n.timestamp)
    const tMin = Math.min(...timestamps)
    const tMax = Math.max(...timestamps)
    const tRange = tMax - tMin || 1
    // Keep spread to roughly 15-18px per node, bounded reasonably
    const spreadW = Math.min(W * 4, Math.max(W * 1.5, nodes.length * 16))
    const xPos = (t: number) => ((t - tMin) / tRange) * spreadW

    const maxLane = Math.max(1, ...nodes.map(n => Math.abs(n.lane)))

    // ===== Main branch spine line =====
    const mainNodes = nodes.filter(n => n.isMainBranch).sort((a, b) => a.timestamp - b.timestamp)
    if (mainNodes.length > 1) {
      g.append('line')
        .attr('class', 'main-spine')
        .attr('x1', xPos(mainNodes[0].timestamp))
        .attr('y1', 0)
        .attr('x2', xPos(mainNodes[mainNodes.length - 1].timestamp))
        .attr('y2', 0)
        .attr('stroke', '#3D2810')
        .attr('stroke-width', 3)
        .attr('stroke-dasharray', '8,4')
        .attr('opacity', 0.7)

      // "MAIN" label
      g.append('text')
        .attr('class', 'spine-label')
        .attr('x', xPos(mainNodes[0].timestamp) - 20)
        .attr('y', -14)
        .attr('fill', '#D4A84A40')
        .attr('font-size', 10)
        .attr('font-family', 'JetBrains Mono, monospace')
        .attr('font-weight', '600')
        .attr('letter-spacing', '2px')
        .text('MAIN')
    }

    // Lane guide lines (subtle)
    for (let lane = -maxLane; lane <= maxLane; lane++) {
      if (lane === 0) continue
      const yLane = lane * LANE_HEIGHT
      const laneNodes = nodes.filter(n => n.lane === lane).sort((a, b) => a.timestamp - b.timestamp)
      if (laneNodes.length === 0) continue
      g.append('line')
        .attr('x1', xPos(laneNodes[0].timestamp) - 20)
        .attr('y1', yLane)
        .attr('x2', xPos(laneNodes[laneNodes.length - 1].timestamp) + 20)
        .attr('y2', yLane)
        .attr('stroke', '#1E293B')
        .attr('stroke-width', 1)
        .attr('opacity', 0.4)
    }

    // Links
    const linkGroup = g.append('g').attr('class', 'links')
    const linkElems = linkGroup.selectAll<SVGLineElement, D3Link>('line')
      .data(links).join('line')
      .attr('stroke', d => EDGE_COLOR[d.type])
      .attr('stroke-width', d => {
        if (d.type === 'revert_of') return 2
        return (d.source as D3Node).isMainBranch && (d.target as D3Node).isMainBranch ? 2 : 1
      })
      .attr('stroke-dasharray', d => EDGE_DASH[d.type])
      .attr('opacity', d => {
        if (d.type === 'revert_of') return 0.9
        if (d.type === 'merge_parent') return 0.7
        return 0.4
      })
      .attr('marker-end', d => `url(#arr-${d.type})`)

    // Nodes
    const nodeGroup = g.append('g').attr('class', 'nodes')
    const nodeElems = nodeGroup.selectAll<SVGGElement, D3Node>('g.node')
      .data(nodes, d => d.id).join('g')
      .attr('class', 'node').style('cursor', 'pointer')

    // Glow ring
    nodeElems.append('circle')
      .attr('class', 'glow')
      .attr('r', d => nodeRadius(d) + 5)
      .attr('fill', d => TYPE_COLOR[d.type])
      .attr('opacity', 0)

    // Main circle
    nodeElems.append('circle')
      .attr('class', 'main-circle')
      .attr('r', d => nodeRadius(d))
      .attr('fill', d => TYPE_COLOR[d.type])
      .attr('stroke', d => d.isMainBranch ? '#EDD090' : '#1A1107')
      .attr('stroke-width', d => d.isMainBranch ? 2 : 1.5)
      .attr('filter', d => d.isMainBranch ? 'url(#glow)' : 'none')

    // Tag indicator
    nodeElems.filter(d => d.tagNames.length > 0)
      .append('circle')
      .attr('r', 3)
      .attr('cx', d => nodeRadius(d) + 1)
      .attr('cy', d => -nodeRadius(d) - 1)
      .attr('fill', '#F59E0B')
      .attr('stroke', '#0F172A')
      .attr('stroke-width', 1)

    // Label
    nodeElems.append('text')
      .attr('class', 'label')
      .attr('dy', d => nodeRadius(d) + 11)
      .attr('text-anchor', 'middle')
      .attr('fill', d => d.isMainBranch ? '#EDD09080' : '#6B503580')
      .attr('font-size', 8)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .text(d => d.label)

    // Events
    nodeElems
      .on('mouseenter', function(event, d) {
        d3.select(this).select('.glow').attr('opacity', 0.25)
        d3.select(this).select('.main-circle').attr('stroke', '#fff').attr('stroke-width', 2.5)
        showTooltip(event, d)
      })
      .on('mousemove', (event) => moveTooltip(event))
      .on('mouseleave', function(_, d) {
        const sel = d.id === selectedNodeId
        d3.select(this).select('.glow').attr('opacity', sel ? 0.3 : 0)
        d3.select(this).select('.main-circle')
          .attr('stroke', sel ? '#fff' : (d.isMainBranch ? '#93C5FD' : '#0F172A'))
          .attr('stroke-width', sel ? 2.5 : (d.isMainBranch ? 2 : 1.5))
        hideTooltip()
      })
      .on('click', (_, d) => handleNodeClick(d))

    // Drag
    const drag = d3.drag<SVGGElement, D3Node>()
      .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
      .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
    nodeElems.call(drag)

    // ===== Force simulation with swimlanes =====
    const sim = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(links)
        .id(d => d.id)
        .distance(d => d.type === 'parent' ? 40 : 70)
        .strength(d => d.type === 'parent' ? 0.85 : 0.4)
      )
      .force('charge', d3.forceManyBody<D3Node>()
        .strength(-220).distanceMin(8).distanceMax(350)
      )
      // Strong x positioning by time
      .force('x', d3.forceX<D3Node>(d => xPos(d.timestamp))
        .strength(d => d.isMainBranch ? 0.5 : 0.25)
      )
      // Y: main branch → y=0, features → y = lane * LANE_HEIGHT
      .force('y', d3.forceY<D3Node>(d => d.lane * LANE_HEIGHT)
        .strength(d => d.isMainBranch ? 0.7 : 0.4)
      )
      .force('collision', d3.forceCollide<D3Node>(d => nodeRadius(d) + 4))
      .velocityDecay(0.45)
      .alphaDecay(0.02)

    sim.on('tick', () => {
      linkElems
        .attr('x1', d => d.source.x ?? 0).attr('y1', d => d.source.y ?? 0)
        .attr('x2', d => d.target.x ?? 0).attr('y2', d => d.target.y ?? 0)
      nodeElems.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    sim.on('end', () => fitView(svg, g, zoom, nodes, W, H))
    // Fallback: ensure fitView fires even if sim.on('end') doesn't trigger
    const fitTimer = setTimeout(() => fitView(svg, g, zoom, nodes, W, H), 4000)

    if (selectedNodeId) applyHighlight(nodeElems, selectedNodeId)

    return () => { sim.stop(); clearTimeout(fitTimer) }
  }, [nodes, links, handleNodeClick])

  useEffect(() => {
    if (!svgRef.current) return
    const nodeElems = d3.select(svgRef.current).selectAll<SVGGElement, D3Node>('g.node')
    applyHighlight(nodeElems, selectedNodeId)
  }, [selectedNodeId])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#1A1107' }}>
      <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block', background: '#1A1107' }} />

      {/* Legend overlay */}
      <div style={{
        position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8,
        background: '#0F172ACC', backdropFilter: 'blur(6px)',
        border: '1px solid #1E293B', borderRadius: 8, padding: '6px 10px', fontSize: 10,
      }}>
        <LegendItem color="#3B82F6" label="MAIN" dotStyle={{ boxShadow: '0 0 6px #3B82F6' }} />
        <LegendItem color="#8B5CF6" label="Merge" dashed />
        <LegendItem color="#F97316" label="Revert" dashed />
      </div>

      {/* Display limit controls */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16,
        display: 'flex', alignItems: 'center', gap: 6,
        background: '#1E293BCC', backdropFilter: 'blur(8px)',
        border: '1px solid #334155', borderRadius: 8, padding: '5px 10px', fontSize: 11, color: '#94A3B8',
      }}>
        <span>表示: </span>
        {DISPLAY_LIMITS.map(n => (
          <button key={n} onClick={() => setDisplayLimit(n)} style={{
            background: displayLimit === n ? '#3B82F6' : 'transparent',
            border: `1px solid ${displayLimit === n ? '#3B82F6' : '#475569'}`,
            borderRadius: 4, padding: '2px 7px',
            color: displayLimit === n ? '#fff' : '#94A3B8',
            cursor: 'pointer', fontSize: 11, transition: 'all 0.15s',
          }}>
            {n >= 1000 ? '全件' : n}
          </button>
        ))}
        <span style={{ color: '#475569', marginLeft: 4 }}>/ {totalCount}</span>
      </div>

      <Tooltip />
    </div>
  )
}

function LegendItem({ color, label, dashed, dotStyle }: { color: string; label: string; dashed?: boolean; dotStyle?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{
        width: dashed ? 16 : 8, height: dashed ? 0 : 8, borderRadius: dashed ? 0 : '50%',
        background: dashed ? 'none' : color,
        borderTop: dashed ? `2px dashed ${color}` : 'none',
        ...dotStyle,
      }} />
      <span style={{ color: '#64748B', fontSize: 10 }}>{label}</span>
    </div>
  )
}

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
    .attr('stroke', (d: D3Node) => {
      if (d.id === selectedId) return '#fff'
      return d.isMainBranch ? '#93C5FD' : '#0F172A'
    })
    .attr('stroke-width', (d: D3Node) => {
      if (d.id === selectedId) return 3
      return d.isMainBranch ? 2 : 1.5
    })
}

// ===== Tooltip =====
let tooltipEl: HTMLDivElement | null = null
function Tooltip() {
  return <div id="maze-tooltip" style={{
    position: 'fixed', pointerEvents: 'none', display: 'none',
    background: 'rgba(15,23,42,0.96)', border: '1px solid #334155',
    borderRadius: 8, padding: '8px 12px', zIndex: 1000, fontSize: 12, color: '#F1F5F9',
    boxShadow: '0 4px 24px rgba(0,0,0,0.7)', maxWidth: 320, backdropFilter: 'blur(8px)',
  }} />
}

function getTooltipEl() {
  if (!tooltipEl) tooltipEl = document.getElementById('maze-tooltip') as HTMLDivElement
  return tooltipEl!
}

function showTooltip(event: MouseEvent, d: D3Node) {
  const el = getTooltipEl()
  const date = new Date(d.timestamp).toLocaleDateString('ja-JP')
  const mainBadge = d.isMainBranch ? `<span style="background:#1D4ED8;color:#93C5FD;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:6px">MAIN</span>` : ''
  el.innerHTML = `
    <div style="display:flex;align-items:center;margin-bottom:5px">
      <span style="font-weight:600;font-family:monospace;color:${TYPE_COLOR[d.type]}">${d.label}</span>
      ${mainBadge}
      ${d.tagNames.length ? `<span style="background:#78350F;color:#F59E0B;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:4px">🏷 ${d.tagNames[0]}</span>` : ''}
    </div>
    <div style="color:#CBD5E1;margin-bottom:6px;line-height:1.45">${d.message.slice(0, 90)}${d.message.length > 90 ? '…' : ''}</div>
    <div style="display:flex;gap:10px;font-size:11px;color:#64748B">
      <span>👤 ${d.authorName}</span>
      <span>📅 ${date}</span>
      ${d.filesChanged > 0 ? `<span>📝 ${d.filesChanged}f</span>` : ''}
    </div>
  `
  el.style.display = 'block'
  moveTooltip(event)
}

function moveTooltip(event: MouseEvent) {
  const el = getTooltipEl()
  const x = event.clientX + 14, w = el.offsetWidth, vw = window.innerWidth
  el.style.left = (x + w > vw ? event.clientX - w - 14 : x) + 'px'
  el.style.top = (event.clientY - 8) + 'px'
}

function hideTooltip() {
  getTooltipEl().style.display = 'none'
}
