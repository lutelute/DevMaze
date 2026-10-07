import { memo } from 'react'
import s from './maze.module.css'
import { severityColor, typeColor } from '@shared/theme'
import type { MazeItem, MazeLayout } from '@shared/maze'

const MM_W = 148, MM_H = 106, PAD = 7

interface Props {
  layout: MazeLayout
  items: MazeItem[]
  marks: Map<string, number>
  view: { k: number; x: number; y: number }
  viewportW: number
  viewportH: number
  hidden: boolean
  onJump: (gx: number, gy: number) => void
}

/** 全体のどこを見ているか。全体が収まっているあいだは何も足さないので出さない */
const Minimap = memo(function Minimap({ layout, items, marks, view, viewportW, viewportH, hidden, onJump }: Props) {
  const scale = Math.min((MM_W - PAD * 2) / Math.max(1, layout.width), (MM_H - PAD * 2) / Math.max(1, layout.height))
  const inv = (sx: number, sy: number) => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k })
  const a = inv(0, 0), b = inv(viewportW, viewportH)
  const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const x0 = cl(PAD + a.x * scale, PAD, MM_W - PAD), y0 = cl(PAD + a.y * scale, PAD, MM_H - PAD)
  const x1 = cl(PAD + b.x * scale, PAD, MM_W - PAD), y1 = cl(PAD + b.y * scale, PAD, MM_H - PAD)

  return (
    <svg className={`${s.float} ${s.minimap}`} width={MM_W} height={MM_H} data-hidden={hidden ? 'true' : undefined}
      onClick={e => {
        const r = e.currentTarget.getBoundingClientRect()
        onJump((e.clientX - r.left - PAD) / scale, (e.clientY - r.top - PAD) / scale)
      }}>
      <g transform={`translate(${PAD},${PAD}) scale(${scale})`}>
        {items.map(it => {
          const p = layout.byId.get(it.id)
          if (!p) return null
          const m = marks.get(it.id)
          return <circle key={it.id} cx={p.x} cy={p.y} r={Math.max(2.5, 3 / scale)} fill={m !== undefined ? severityColor(m) : typeColor(it.type)} opacity={0.75} />
        })}
      </g>
      <rect x={x0} y={y0} width={Math.max(3, x1 - x0)} height={Math.max(3, y1 - y0)} rx={2} fill="rgba(217,168,75,0.12)" stroke="var(--accent)" strokeWidth={1} pointerEvents="none" />
    </svg>
  )
})

export default Minimap
