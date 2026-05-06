/**
 * MazeModeView — Snake (boustrophedon) layout
 *
 * Commits are sorted by timestamp and placed left→right, then right→left
 * (snake / boustrophedon) across a fixed number of columns.
 * Edges are drawn as orthogonal L-paths.
 */
import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import type { MazeGraph, MazeNode, CommitType } from '../../shared/types'

interface Props {
  graph: MazeGraph
  filterTypes: Set<string>
  onNodeClick: (node: MazeNode) => void
  selectedNodeId?: string
}

/* ── constants ─────────────────────────────────── */
const COLS    = 8    // commits per snake row
const CW      = 76   // cell width  (px)
const CH      = 76   // cell height (px)
const R       = 11   // node radius
const PAD     = 52   // canvas padding
const MAX_N   = 200  // max nodes shown in maze mode

const TYPE_COLOR: Record<CommitType, string> = {
  normal:    '#D4A84A',
  feature:   '#7B9E5A',
  error_fix: '#C0624B',
  revert:    '#C88B3A',
  merge:     '#8B7355',
  wip:       '#B8A06A',
  release:   '#9B8570',
}

/* ── component ─────────────────────────────────── */
export default function MazeModeView({ graph, filterTypes, onNodeClick, selectedNodeId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pan,   setPan]   = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)

  /* ── 1. filter + limit ───────────────────────── */
  const nodes = useMemo(() => {
    const all = filterTypes.size === 0
      ? graph.nodes
      : graph.nodes.filter(n => filterTypes.has(n.type))
    return [...all]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-MAX_N)          // show most-recent MAX_N commits
  }, [graph.nodes, filterTypes])

  const nodeIds = useMemo(() => new Set(nodes.map(n => n.id)), [nodes])

  /* ── 2. snake layout ─────────────────────────── */
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>()
    nodes.forEach((n, i) => {
      const row    = Math.floor(i / COLS)
      const colRaw = i % COLS
      const col    = row % 2 === 0 ? colRaw : (COLS - 1 - colRaw)
      pos.set(n.id, {
        x: PAD + col * CW,
        y: PAD + row * CH,
      })
    })
    return pos
  }, [nodes])

  /* ── 3. canvas size ─────────────────────────── */
  const { canvasW, canvasH } = useMemo(() => {
    const rows = Math.ceil(nodes.length / COLS)
    return {
      canvasW: PAD * 2 + COLS * CW,
      canvasH: PAD * 2 + rows * CH,
    }
  }, [nodes.length])

  /* ── 4. auto-fit ─────────────────────────────── */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    if (width === 0 || height === 0) return
    const s = Math.min(1.2, (width - 24) / canvasW, (height - 24) / canvasH)
    setScale(s)
    setPan({ x: (width - canvasW * s) / 2, y: (height - canvasH * s) / 2 })
  }, [canvasW, canvasH])

  /* ── 5. interaction ─────────────────────────── */
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    drag.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
  }, [pan])

  useEffect(() => {
    const mv = (e: MouseEvent) => {
      if (!drag.current) return
      setPan({ x: drag.current.px + e.clientX - drag.current.sx, y: drag.current.py + e.clientY - drag.current.sy })
    }
    const up = () => { drag.current = null }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setScale(s => Math.max(0.2, Math.min(3, s * (e.deltaY < 0 ? 1.1 : 0.9))))
  }, [])

  /* ── 6. edges as orthogonal L-paths ─────────── */
  const edges = useMemo(() => graph.edges
    .filter(e => {
      const s = typeof e.source === 'string' ? e.source : (e.source as MazeNode).id
      const t = typeof e.target === 'string' ? e.target : (e.target as MazeNode).id
      return nodeIds.has(s) && nodeIds.has(t)
    })
    .map(e => {
      const sId = typeof e.source === 'string' ? e.source : (e.source as MazeNode).id
      const tId = typeof e.target === 'string' ? e.target : (e.target as MazeNode).id
      const sp = positions.get(sId); const tp = positions.get(tId)
      if (!sp || !tp) return null

      /* midpoint elbow */
      const mx = (sp.x + tp.x) / 2
      const path = sp.x === tp.x || sp.y === tp.y
        ? `M${sp.x},${sp.y} L${tp.x},${tp.y}`
        : `M${sp.x},${sp.y} L${mx},${sp.y} L${mx},${tp.y} L${tp.x},${tp.y}`

      const color = e.type === 'merge_parent' ? 'rgba(139,115,85,0.55)'
        : e.type === 'revert_of'   ? 'rgba(200,139,58,0.6)'
        : 'rgba(212,168,74,0.28)'
      const dash = e.type === 'parent' ? 'none' : e.type === 'merge_parent' ? '5,3' : '3,3'
      return { id: e.id, path, color, dash }
    })
    .filter(Boolean), [graph.edges, nodeIds, positions])

  /* ── render ─────────────────────────────────── */
  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
        background: 'var(--bg-base)', cursor: drag.current ? 'grabbing' : 'grab' }}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
    >
      <svg style={{ width: '100%', height: '100%', display: 'block' }}>
        <defs>
          {/* subtle grid pattern to give dungeon-floor feel */}
          <pattern id="maze-grid" width={CW} height={CH} patternUnits="userSpaceOnUse">
            <rect width={CW} height={CH} fill="var(--bg-base)" />
            <rect x={3} y={3} width={CW - 6} height={CH - 6}
              fill="var(--bg-panel)" rx={4} opacity={0.6} />
          </pattern>
        </defs>
        <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>

          {/* floor tiles */}
          <rect x={0} y={0} width={canvasW} height={canvasH} fill="url(#maze-grid)" />

          {/* cell borders for each node */}
          {nodes.map(n => {
            const p = positions.get(n.id)
            if (!p) return null
            const c = TYPE_COLOR[n.type] ?? '#D4A84A'
            const isMain = n.isMainBranch
            return (
              <rect key={`cell-${n.id}`}
                x={p.x - CW / 2 + 2} y={p.y - CH / 2 + 2}
                width={CW - 4} height={CH - 4}
                fill="none" stroke={`${c}${isMain ? '30' : '18'}`}
                strokeWidth={isMain ? 2 : 1.5} rx={5} />
            )
          })}

          {/* edges */}
          {edges.map(e => e && (
            <path key={e.id} d={e.path} fill="none"
              stroke={e.color} strokeWidth={2}
              strokeDasharray={e.dash} strokeLinecap="round" strokeLinejoin="round" />
          ))}

          {/* nodes */}
          {nodes.map(n => {
            const p = positions.get(n.id)
            if (!p) return null
            const c    = TYPE_COLOR[n.type] ?? '#D4A84A'
            const sel  = n.id === selectedNodeId
            const main = n.isMainBranch
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`}
                onClick={() => onNodeClick(n)} style={{ cursor: 'pointer' }}>
                {main && <circle r={R + 7} fill={c} opacity={0.06} />}
                {sel  && <circle r={R + 4} fill="none" stroke={c} strokeWidth={2} opacity={0.85} />}
                <circle r={main ? R + 2 : R}
                  fill={sel ? c : `${c}2E`}
                  stroke={c}
                  strokeWidth={main ? 2.5 : 1.5} />
                <text y={R + 13} textAnchor="middle"
                  fill="var(--text-dim)" fontSize={7.5} fontFamily="monospace">
                  {n.label}
                </text>
              </g>
            )
          })}

          {/* snake-row direction arrows (subtle) */}
          {Array.from({ length: Math.ceil(nodes.length / COLS) }).map((_, row) => {
            const rightward = row % 2 === 0
            const y = PAD + row * CH
            return (
              <text key={`arr-${row}`}
                x={rightward ? PAD - 22 : PAD + COLS * CW + 8}
                y={y + 4}
                fontSize={9} fill="var(--text-dim)" opacity={0.4}
                fontFamily="monospace" textAnchor="middle">
                {rightward ? '→' : '←'}
              </text>
            )
          })}
        </g>
      </svg>

      {/* info bar */}
      <div style={{
        position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
        fontSize: 10, color: 'var(--text-dim)', pointerEvents: 'none', letterSpacing: '0.2px',
        display: 'flex', gap: 12,
      }}>
        <span>最新 {nodes.length} 件 / 全 {graph.nodes.length} 件</span>
        <span>ドラッグ: パン ·  スクロール: ズーム</span>
      </div>
    </div>
  )
}
