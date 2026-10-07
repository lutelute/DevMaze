import s from './screens.module.css'
import type { ProgressMessage } from '@shared/ipc'

// 実在する工程だけを並べる。偽のパーセンテージは出さない
const STAGES = [
  { id: 'git', label: 'Git 履歴を取得' },
  { id: 'graph', label: 'コミットを分類し、グラフを組む' },
  { id: 'detect', label: '沼・場所・働き方を解析' },
  { id: 'layout', label: '迷路を準備' },
]

export default function Loading({ progress }: { progress: ProgressMessage }) {
  const idx = progress.kind === 'stage' ? STAGES.findIndex(x => x.id === progress.stage) : -1
  return (
    <div className={s.center}>
      <svg width="34" height="34" viewBox="0 0 40 40" fill="none" className={s.spinner} aria-hidden>
        <circle cx="20" cy="20" r="16" stroke="var(--accent)" strokeWidth="3" opacity="0.12" />
        <path d="M20 4 A16 16 0 0 1 36 20" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {idx < 0 ? (
        <div className={s.loadingText}>{progress.kind === 'text' ? progress.text : '解析中...'}</div>
      ) : (
        <div className={s.stages}>
          {STAGES.map((st, i) => {
            const state = i < idx ? 'done' : i === idx ? 'now' : 'todo'
            return (
              <div key={st.id} className={s.stage} data-state={state}>
                <span className={s.stageMark}>{state === 'done' ? '✓' : state === 'now' ? '●' : '○'}</span>
                <span className={s.stageLabel}>{st.label}</span>
                {state === 'now' && progress.kind === 'stage' && progress.detail && <span className={s.stageDetail}>{progress.detail}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
