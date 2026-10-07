import { memo } from 'react'
import s from './maze.module.css'
import { diamond, hexagon } from './shapes'
import { COMMIT_TYPE, severityColor, STRUGGLE_META, typeColor } from '@shared/theme'
import type { MazeLayout, MazeItem, MazeLink } from '@shared/maze'
import { nodeRadius } from '@shared/maze'
import type { StruggleEpisode, Zone, MazeEdge } from '@shared/types'

const EDGE_COLOR: Record<MazeEdge['type'], string> = { parent: '#5A3D1E', merge_parent: '#C8A060', revert_of: '#C88B3A' }
const EDGE_DASH: Record<MazeEdge['type'], string | undefined> = { parent: undefined, merge_parent: '6,3', revert_of: '3,4' }

export interface SceneProps {
  layout: MazeLayout
  items: MazeItem[]
  links: MazeLink[]
  zones: Zone[]
  struggles: StruggleEpisode[]
  activeStruggleId?: string
  /** 浮かび上がらせる印。undefined なら全部通常 */
  highlight?: Set<string>
  /** 沼の印（帯が無いときだけ輪で示す） */
  struggleMarks: Map<string, number>
  selectedId?: string
  onClick: (item: MazeItem) => void
  onHover: (item: MazeItem | null, e?: React.MouseEvent) => void
}

/**
 * 迷路の中身。座標はすべてレイアウトエンジンが決めていて、ここは描くだけ。
 * memo にしてあるので、ズームやホバーでは再描画されない。
 */
const MazeScene = memo(function MazeScene({
  layout, items, links, zones, struggles, activeStruggleId, highlight, struggleMarks, selectedId, onClick, onHover,
}: SceneProps) {
  const sevById = new Map(struggles.map(e => [e.id, e]))
  const bandH = layout.laneGap * 0.9
  const aggregated = layout.unit === 'session'
  const dimming = !!highlight && highlight.size > 0

  return (
    <>
      <defs>
        <filter id="mz-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {(['parent', 'merge_parent', 'revert_of'] as const).map(t => (
          <marker key={t} id={`mz-arr-${t}`} viewBox="0 -4 8 8" refX={18} refY={0} markerWidth={5} markerHeight={5} orient="auto">
            <path d="M0,-4L8,0L0,4" fill={EDGE_COLOR[t]} opacity={t === 'parent' ? 0.6 : 0.9} />
          </marker>
        ))}
      </defs>

      {/* 廊下（行）。その行の期間を支配する開発フェーズの色で薄く染める */}
      <g>
        {layout.rows.map(row => {
          const zone = zones.find(z => z.startTimestamp <= row.endTime && z.endTimestamp >= row.startTime)
          const tint = zone ? typeColor(zone.theme) : 'var(--accent)'
          const d = new Date(row.startTime)
          const lx = row.leftToRight ? -30 : layout.rowW + 30
          return (
            <g key={row.index}>
              <rect x={-26} y={row.top + 14} width={layout.rowW + 52} height={row.height - 28} rx={14} fill={tint} opacity={row.index % 2 === 0 ? 0.045 : 0.03} />
              <rect x={-26} y={row.top + 14} width={layout.rowW + 52} height={row.height - 28} rx={14} fill="none" stroke={tint} strokeWidth={1} opacity={0.1} />
              <text x={lx} y={row.mid - 4} textAnchor={row.leftToRight ? 'end' : 'start'} fill={tint} fontSize={11} fontFamily="var(--font-mono)" fontWeight={600} opacity={0.8}>
                {d.getFullYear()}/{d.getMonth() + 1}/{d.getDate()}
              </text>
              <text x={lx} y={row.mid + 10} textAnchor={row.leftToRight ? 'end' : 'start'} fill="var(--text-dim)" fontSize={9.5} fontFamily="var(--font-mono)">
                {zone ? zone.label : row.leftToRight ? '→' : '←'}
              </text>
            </g>
          )
        })}
      </g>

      {/* 沼。廊下に敷いた帯。既定はごく薄く、選ばれた1件だけ強く出す。
          薄い帯はグループにまとめて不透明度を1回だけかける。1枚ずつ重ねると
          30件が同じ時期に重なった場所で足し合わさり、赤い壁になる */}
      <g opacity={0.07} pointerEvents="none">
        {layout.bands.map((b, i) => {
          const e = sevById.get(b.struggleId)
          if (!e || e.id === activeStruggleId) return null
          const row = layout.rows[b.row]
          return <rect key={`${b.struggleId}-${i}`} x={b.x0} y={row.mid - bandH / 2} width={Math.max(6, b.x1 - b.x0)} height={bandH} rx={6} fill={severityColor(e.severity)} />
        })}
      </g>
      <g pointerEvents="none">
        {layout.bands.map((b, i) => {
          const e = sevById.get(b.struggleId)
          if (!e || e.id !== activeStruggleId) return null
          const row = layout.rows[b.row]
          const color = severityColor(e.severity)
          const y = row.mid - bandH / 2
          const w = Math.max(6, b.x1 - b.x0)
          const headX = row.leftToRight ? b.x0 : b.x1
          const tailX = row.leftToRight ? b.x1 : b.x0
          const meta = STRUGGLE_META[e.kind]
          return (
            <g key={`${b.struggleId}-${i}`}>
              <rect x={b.x0} y={y} width={w} height={bandH} rx={6} fill={color} opacity={0.18} />
              {/* 下端の線の太さが深刻度 */}
              <line x1={b.x0} y1={y + bandH} x2={b.x0 + w} y2={y + bandH} stroke={color} strokeWidth={1 + e.severity / 70} strokeLinecap="round" opacity={0.75} />
              {/* 終端が閉じていれば抜けた。開いていればまだ抜けていない */}
              {b.isTail && e.escape && <line x1={tailX} y1={y + 3} x2={tailX} y2={y + bandH - 3} stroke={color} strokeWidth={2.5} opacity={0.8} />}
              {b.isHead && (
                <text className={s.lblBand} x={headX} y={y - 3} textAnchor={row.leftToRight ? 'start' : 'end'} fill={color} fontSize={10} fontFamily="var(--font-mono)">
                  {e.recurrence ? `${meta.icon} ${e.recurrence.index}/${e.recurrence.times}` : meta.icon}
                </text>
              )}
            </g>
          )
        })}
      </g>

      {/* 止まっていた時間 */}
      <g>
        {layout.gaps.map((g, i) => {
          const row = layout.rows[g.row]
          return (
            <g key={i}>
              <line x1={g.x} y1={row.top + 18} x2={g.x} y2={row.top + row.height - 18} stroke="#6B5537" strokeWidth={1} strokeDasharray="3,4" opacity={0.5} />
              <text className={s.lblGap} x={g.x} y={row.top + 14} textAnchor="middle" fill="#8B7355" fontSize={9.5} fontFamily="var(--font-mono)">⏸ {g.days}日</text>
            </g>
          )
        })}
      </g>

      {/* 道 */}
      <g>
        {links.map(l => {
          const a = layout.byId.get(l.source), b = layout.byId.get(l.target)
          if (!a || !b) return null
          const main = l.type === 'parent' && items.length > 0
          const w = l.type === 'merge_parent' ? 2.2 : l.type === 'revert_of' ? 1.8 : main ? 1.8 : 1.3
          return (
            <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={EDGE_COLOR[l.type]} strokeWidth={w}
              strokeDasharray={EDGE_DASH[l.type]} opacity={l.type === 'parent' ? 0.55 : 0.85} markerEnd={`url(#mz-arr-${l.type})`} />
          )
        })}
      </g>

      {/* 節点 */}
      <g>
        {items.map(it => {
          const p = layout.byId.get(it.id)
          if (!p) return null
          const r = nodeRadius(it)
          const meta = COMMIT_TYPE[it.type] ?? COMMIT_TYPE.normal
          const c = meta.hex
          const selected = it.id === selectedId
          const lit = dimming && highlight!.has(it.id)
          const dim = dimming && !highlight!.has(it.id)
          const stroke = selected ? '#fff' : c
          const sw = selected ? 3 : meta.shape === 'diamond' || meta.shape === 'hex' ? 2.5 : it.isMainBranch ? 2.4 : 1.5
          const mark = struggleMarks.get(it.id)
          // 衝突で目標の y からずらされた印は塊の中にいる。そこに札を出すと重なって読めない
          const crowded = Math.abs(p.y - layout.pos(it.timestamp, it.lane).y) > 0.5
          const milestone = it.isMilestone && it.milestoneReason !== 'large_change' && !crowded
          const mlabel = milestone ? (it.tagNames[0] ?? it.message.match(/v\d+[\d.]+/)?.[0] ?? it.label) : null
          const commitLabel = !aggregated && !crowded && (it.type === 'merge' || it.type === 'release' || it.tagNames.length > 0)
            ? (() => { const m = it.message.split('\n')[0]; return m.length > 26 ? m.slice(0, 24) + '…' : m })()
            : null
          return (
            <g key={it.id} className={s.node} transform={`translate(${p.x},${p.y})`}
              data-selected={selected ? 'true' : undefined} data-lit={lit ? 'true' : undefined} data-dim={dim ? 'true' : undefined}
              onClick={() => onClick(it)} onMouseEnter={e => onHover(it, e)} onMouseMove={e => onHover(it, e)} onMouseLeave={() => onHover(null)}>
              <circle className={s.glow} r={r + 6} fill={c} />
              {meta.shape === 'diamond' ? (
                <path d={diamond(r)} fill={`${c}33`} stroke={stroke} strokeWidth={sw} />
              ) : meta.shape === 'hex' ? (
                <path d={hexagon(r)} fill={`${c}40`} stroke={stroke} strokeWidth={sw} filter="url(#mz-glow)" />
              ) : meta.shape === 'dashed' ? (
                <circle r={r} fill="none" stroke={stroke} strokeWidth={selected ? 3 : 1.8} strokeDasharray="3,2.4" />
              ) : meta.shape === 'square' ? (
                <>
                  <rect x={-r * 0.85} y={-r * 0.85} width={r * 1.7} height={r * 1.7} rx={3} fill={`${c}2A`} stroke={stroke} strokeWidth={sw} />
                  {'glyph' in meta && meta.glyph && r >= 6 && (
                    <text textAnchor="middle" dy={r * 0.42} fontSize={Math.min(11, r * 1.7 * 0.68)} fontFamily="var(--font-mono)" fill={c} pointerEvents="none">{meta.glyph}</text>
                  )}
                </>
              ) : (
                <circle r={r} fill={it.isMainBranch ? `${c}55` : `${c}2A`} stroke={stroke} strokeWidth={sw} filter={it.isMainBranch ? 'url(#mz-glow)' : undefined} />
              )}
              {it.count && it.count > 1 && (
                <text textAnchor="middle" dy={3.5} fill="var(--text-inverse)" fontSize={Math.min(13, 8 + Math.sqrt(it.count))} fontWeight={700} fontFamily="var(--font-mono)" pointerEvents="none">{it.count}</text>
              )}
              {mark !== undefined && (
                <circle r={r + 4} fill="none" stroke={severityColor(mark)} strokeWidth={1} strokeDasharray={mark >= 75 ? '4,2.5' : '2,2.5'} opacity={0.4} pointerEvents="none" />
              )}
              {mlabel && (
                <g className={s.lblMilestone} pointerEvents="none">
                  <rect x={-mlabel.length * 3.2 - 5} y={-r - 26} width={mlabel.length * 6.4 + 10} height={15} rx={4} fill="#3D2810" opacity={0.9} />
                  <text y={-r - 15} textAnchor="middle" fill="#E8C060" fontSize={9.5} fontWeight={600} fontFamily="var(--font-mono)">{mlabel}</text>
                </g>
              )}
              {it.milestoneReason === 'large_change' && (
                <text textAnchor="middle" dy={-r - 5} fontSize={9} fill="var(--danger)" opacity={0.9} pointerEvents="none">⚡</text>
              )}
              {aggregated && it.tagNames.length === 0 && (
                <text className={s.lblCommit} dy={r + 13} textAnchor="middle" fill="var(--text-dim)" fontSize={8.5} fontFamily="var(--font-mono)">
                  {new Date(it.timestamp).getMonth() + 1}/{new Date(it.timestamp).getDate()}
                </text>
              )}
              {!aggregated && !crowded && (
                <text className={s.lblHash} dy={r + 11} textAnchor="middle" fill="#8B7355" fontSize={8} fontFamily="var(--font-mono)">{it.label}</text>
              )}
              {commitLabel && (
                <text className={s.lblCommit} dy={r + 22} textAnchor="middle" fill={c} fontSize={8.5} fontFamily="var(--font-mono)">{commitLabel}</text>
              )}
            </g>
          )
        })}
      </g>
    </>
  )
})

export default MazeScene
