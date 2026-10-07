import s from './panels.module.css'
import l from '@/components/layout/layout.module.css'
import { Row, RowMain, RowTitle, RowSub, Meter, fmtDate } from '@/components/ui'
import { useStore } from '@/store'
import { useResult } from '@/store/selectors'
import { STRUGGLE_META, severityColor } from '@shared/theme'

export default function Struggles() {
  const result = useResult()
  const focus = useStore(st => st.focus)
  const selectStruggle = useStore(st => st.selectStruggle)
  if (!result) return <div className={l.empty}>リポジトリを開くと、詰まった箇所がここに並びます。</div>

  const active = focus?.kind === 'struggle' ? focus.episode.id : undefined
  const cov = result.stats.fileStatsCoverage

  if (result.struggles.length === 0) {
    return (
      <div className={l.empty}>
        詰まった箇所は検出されませんでした。
        {cov < 0.5 && (
          <span className={l.emptyWarn}> ただしファイル差分が {Math.round(cov * 100)}% しか取れていないため、ファイルに依る検出は効いていません。</span>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {result.struggles.map(e => {
        const color = severityColor(e.severity)
        const meta = STRUGGLE_META[e.kind]
        const on = e.id === active
        return (
          <Row key={e.id} active={on} color={color} title={e.evidence.join('\n')} onClick={() => selectStruggle(on ? null : e)}>
            <span style={{ color, fontSize: 12, flexShrink: 0, marginTop: 1 }}>{meta.icon}</span>
            <RowMain>
              <RowTitle>{e.title}</RowTitle>
              <RowSub>
                {meta.label} · {fmtDate(e.startTimestamp)}〜{fmtDate(e.endTimestamp)} · {e.commits.length}件
                {e.recurrence ? ` · ${e.recurrence.index}/${e.recurrence.times}回目` : ''}
              </RowSub>
              <span className={s.meterRow}><Meter value={e.severity} color={color} /><span className={s.meterNum}>{e.severity}</span></span>
              {e.escape && <span className={`${s.escape} truncate`}>↳ 抜けた: {e.escape.message}</span>}
            </RowMain>
          </Row>
        )
      })}
      {active && <button className={l.clearBtn} onClick={() => selectStruggle(null)}>強調を解除</button>}
    </div>
  )
}
