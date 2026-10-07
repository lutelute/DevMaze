import s from './screens.module.css'
import { Button } from '@/components/ui'
import { useStore } from '@/store'

// 失敗した対象と再試行を持つ。「何をしようとして失敗したか」と「同じ条件でやり直す手段」を失わない
export default function ErrorScreen({ message, target, retry }: { message: string; target?: string; retry?: () => void }) {
  const { openLocal, backToIdle } = useStore.getState()
  return (
    <div className={s.center}>
      <svg width="30" height="30" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M8 2 L14.5 13.5 H1.5 Z" stroke="var(--danger)" strokeWidth="1.4" strokeLinejoin="round" />
        <line x1="8" y1="6.5" x2="8" y2="10" stroke="var(--danger)" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.7" fill="var(--danger)" />
      </svg>
      <div className={s.errTitle}>解析できませんでした</div>
      {target && <div className={`${s.errTarget} truncate`}>{target}</div>}
      <div className={s.errBox}>{message}</div>
      <div className={s.errActions}>
        {retry && <Button variant="primary" onClick={retry}>同じ対象でもう一度</Button>}
        <Button variant="outline" onClick={() => openLocal()}>別の場所を選ぶ</Button>
        <Button onClick={backToIdle}>最近使用へ</Button>
      </div>
      {target && (
        <Button size="sm" onClick={() => navigator.clipboard?.writeText(`${target}\n${message}`)}>対象とエラーをコピー</Button>
      )}
    </div>
  )
}
