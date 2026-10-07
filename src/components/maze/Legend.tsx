import s from './maze.module.css'
import { TypeMark } from '@/components/ui'
import { useStore } from '@/store'
import type { CommitType } from '@shared/types'

const ROWS: { type: CommitType; label: string }[] = [
  { type: 'feature', label: '機能追加' }, { type: 'normal', label: '通常' }, { type: 'revert', label: 'リバート' },
  { type: 'error_fix', label: 'バグ修正' }, { type: 'merge', label: 'マージ' }, { type: 'release', label: 'リリース' },
  { type: 'wip', label: 'WIP' }, { type: 'chore', label: '周辺作業（C D R T）' },
]

export default function Legend() {
  const open = useStore(st => st.legendOpen)
  const setOpen = useStore(st => st.setLegendOpen)
  if (!open) return <button className={`${s.float} ${s.legendMini}`} onClick={() => setOpen(true)} title="凡例を開く">凡例</button>
  return (
    <div className={`${s.float} ${s.legend}`}>
      <div className={s.legendHead}><span>凡例</span><button className={s.legendToggle} onClick={() => setOpen(false)} title="凡例を畳む">✕</button></div>
      {ROWS.map(r => (<div key={r.type} className={s.legendRow}><TypeMark type={r.type} size={13} /><span>{r.label}</span></div>))}
      <div className={s.legendRow}>
        <svg width="13" height="13" viewBox="-7 -7 14 14"><rect x={-6} y={-3} width={12} height={6} rx={2} fill="#C4604A" opacity={0.14} /><line x1={-6} y1={3} x2={6} y2={3} stroke="#C4604A" strokeWidth={1.6} /></svg>
        <span>沼（選ぶと帯が立つ）</span>
      </div>
    </div>
  )
}
