import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import type { MazeGraph, MazeNode, CommitType } from '../../shared/types'

interface Props {
  graph: MazeGraph
  filterTypes: Set<string>
  onNodeClick: (node: MazeNode) => void
  selectedNodeId?: string
}

const CELL_W = 72
const CELL_H = 56
const NODE_R = 10
const PADDING = 40

const TYPE_COLOR: Record<CommitType, string> = {
  normal:    '#D4A84A',
  feature:   '#7B9E5A',
  error_fix: '#C0624B',
  revert:    '#C88B3A',
  merge:     '#8B7355',
  wip:       '#B8A06A',
  release:   '#9B8570',
}

export default function MazeModeView({ graph, filterTypes, onNodeClick, selectedNodeId }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [pan, setPan] = useState({ x: PADDING, y: 0 })
  const [scale, setScale] = useState(1)
  const dragging = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)

  // フィルタリング
  const visibleNodes = useMemo(() => {
    const nodes = filterTypes.size === 0
      ? graph.nodes
      : graph.nodes.filter(n => filterTypes.has(n.type))
    return [...nodes].sort((a, b) => a.timestamp - b.timestamp)
  }, [graph.nodes, filterTypes])

  const nodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes])

  // x: 時系列インデックス、y: レーン番号 → ピクセル座標へ
  const positions = useMemo(() => {
    const sorted = [...visibleNodes].sort((a, b) => a.timestamp - b.timestamp)
    const timeIndex = new Map(sorted.map((n, i) => [n.id, i]))
    const lanes = new Map<number, number>()
    let maxLane = 0
    for (const n of sorted) {
      lanes.set(n.lane, 1)
      if (Math.abs(n.lane) > maxLane) maxLane = Math.abs(n.lane)
    }
    const laneOffset = maxLane

    return new Map(sorted.map(n => {
      const xi = timeIndex.get(n.id) ?? 0
      const lane = n.lane + laneOffset
      return [n.id, {
        x: PADDING + xi * CELL_W,
        y: PADDING + lane * CELL_H,
      }]
    }))
  }, [visibleNodes])

  // SVGサイズ
  const { svgW, svgH } = useMemo(() => {
    const xs = [...positions.values()].map(p => p.x)
    const ys = [...positions.values()].map(p => p.y)
    return {
      svgW: (Math.max(...xs, 0) + PADDING + CELL_W),
      svgH: (Math.max(...ys, 0) + PADDING + CELL_H),
    }
  }, [positions])

  // センタリング
  useEffect(() => {
    if (!svgRef.current) return
    const { width, height } = svgRef.current.getBoundingClientRect()
    const targetScale = Math.min(1, (width - 60) / svgW, (height - 60) / svgH)
    setScale(targetScale)
    setPan({
      x: (width - svgW * targetScale) / 2,
      y: (height - svgH * targetScale) / 2,
    })
  }, [svgW, svgH])

  // パン操作
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragging.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
  }, [pan])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      setPan({
        x: dragging.current.panX + e.clientX - dragging.current.startX,
        y: dragging.current.panY + e.clientY - dragging.current.startY,
      })
    }
    const onUp = () => { dragging.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    setScale(s => Math.max(0.2, Math.min(3, s * factor)))
  }, [])

  // エッジを直角パスで描画
  const edges = useMemo(() => {
    return graph.edges
      .filter(e => {
        const src = typeof e.source === 'string' ? e.source : (e.source as MazeNode).id
        const tgt = typeof e.target === 'string' ? e.target : (e.target as MazeNode).id
        return nodeIds.has(src) && nodeIds.has(tgt)
      })
      .map(e => {
        const srcId = typeof e.source === 'string' ? e.source : (e.source as MazeNode).id
        const tgtId = typeof e.target === 'string' ? e.target : (e.target as MazeNode).id
        const src = positions.get(srcId)
        const tgt = positions.get(tgtId)
        if (!src || !tgt) return null
        // 直角パス: 水平→垂直→水平
        const mx = (src.x + tgt.x) / 2
        const path = `M${src.x},${src.y} L${mx},${src.y} L${mx},${tgt.y} L${tgt.x},${tgt.y}`
        return { id: e.id, path, type: e.type, srcId, tgtId }
      })
      .filter(Boolean)
  }, [graph.edges, nodeIds, positions])

  const edgeColor: Record<string, string> = {
    parent:       'rgba(212,168,74,0.25)',
    merge_parent: 'rgba(139,115,85,0.4)',
    revert_of:    'rgba(200,139,58,0.5)',
  }
  const edgeDash: Record<string, string> = {
    parent:       'none',
    merge_parent: '5,3',
    revert_of:    '3,3',
  }

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--bg-base)', cursor: 'grab', overflow: 'hidden' }}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
    >
      <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block' }}>
        <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>

          {/* Grid lines (subtle) */}
          <g opacity={0.04}>
            {[...positions.values()].map((p, i) => (
              <line key={`gx${i}`} x1={p.x} y1={0} x2={p.x} y2={svgH} stroke="#D4A84A" strokeWidth={1} />
            ))}
            {[...new Set([...positions.values()].map(p => p.y))].map((y, i) => (
              <line key={`gy${i}`} x1={0} y1={y} x2={svgW} y2={y} stroke="#D4A84A" strokeWidth={1} />
            ))}
          </g>

          {/* Edges */}
          {edges.map(e => e && (
            <path
              key={e.id}
              d={e.path}
              fill="none"
              stroke={edgeColor[e.type] ?? edgeColor.parent}
              strokeWidth={1.5}
              strokeDasharray={edgeDash[e.type] ?? 'none'}
              strokeLinecap="round"
            />
          ))}

          {/* Nodes */}
          {visibleNodes.map(node => {
            const pos = positions.get(node.id)
            if (!pos) return null
            const color = TYPE_COLOR[node.type] ?? '#D4A84A'
            const isSelected = node.id === selectedNodeId
            const isMain = node.isMainBranch
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x},${pos.y})`}
                onClick={() => onNodeClick(node)}
                style={{ cursor: 'pointer' }}
              >
                {/* Glow for main branch */}
                {isMain && (
                  <circle r={NODE_R + 5} fill={color} opacity={0.08} />
                )}
                {/* Selected ring */}
                {isSelected && (
                  <circle r={NODE_R + 4} fill="none" stroke={color} strokeWidth={2} opacity={0.8} />
                )}
                {/* Node body */}
                <circle
                  r={isMain ? NODE_R + 2 : NODE_R}
                  fill={isSelected ? color : `${color}33`}
                  stroke={color}
                  strokeWidth={isMain ? 2 : 1.5}
                />
                {/* Hash label */}
                <text
                  y={NODE_R + 12}
                  textAnchor="middle"
                  fill="var(--text-dim)"
                  fontSize={8}
                  fontFamily="monospace"
                >
                  {node.label}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* Lane labels (右端に固定表示) */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        pointerEvents: 'none', overflow: 'hidden',
      }}>
        {[...new Set(visibleNodes.map(n => n.lane))].map(lane => {
          const laneNodes = visibleNodes.filter(n => n.lane === lane)
          if (laneNodes.length === 0) return null
          const samplePos = positions.get(laneNodes[0].id)
          if (!samplePos) return null
          const y = samplePos.y * scale + pan.y
          const label = lane === 0 ? 'main' : laneNodes[0].branchNames.find(b => b) ?? `lane${lane}`
          return (
            <div key={lane} style={{
              position: 'absolute', left: 8, top: y - 8,
              fontSize: 9, color: 'var(--text-dim)',
              fontFamily: 'monospace', letterSpacing: '0.3px',
              background: 'var(--bg-base)', padding: '1px 4px',
              borderRadius: 3,
            }}>
              {label.length > 16 ? label.slice(0, 14) + '…' : label}
            </div>
          )
        })}
      </div>

      {/* ズームヒント */}
      <div style={{
        position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
        fontSize: 10, color: 'var(--text-dim)',
        pointerEvents: 'none',
      }}>
        ドラッグでパン · スクロールでズーム
      </div>
    </div>
  )
}
