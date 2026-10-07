import s from './maze.module.css'
import { fmtDateTime } from '@/components/ui'
import type { MazeItem } from '@shared/maze'

export default function NodeTooltip({ item, x, y }: { item: MazeItem; x: number; y: number }) {
  const pad = 14, w = 340, h = 90
  const left = x + pad + w > window.innerWidth - 10 ? x - w - pad : x + pad
  const top = y + pad + h > window.innerHeight - 10 ? y - h - pad : y + pad
  const agg = item.count && item.count > 1
  return (
    <div className={s.tooltip} style={{ left, top, width: agg ? undefined : undefined }}>
      <div className={s.ttTitle}>{item.message.split('\n')[0]}</div>
      <div className={s.ttSub}>{agg ? `${item.count} コミット · ` : `${item.label} · `}{fmtDateTime(item.timestamp)}</div>
      <div className={s.ttLine}>
        {item.authorName ? `${item.authorName} · ` : ''}{item.filesChanged} files ·{' '}
        <span style={{ color: 'var(--ok)' }}>+{item.insertions}</span> <span style={{ color: 'var(--danger)' }}>−{item.deletions}</span>
        {agg ? ' · クリックで中へ' : ''}
      </div>
    </div>
  )
}
