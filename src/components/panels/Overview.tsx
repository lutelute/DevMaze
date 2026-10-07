import { CSSProperties } from 'react'
import s from './panels.module.css'
import l from '@/components/layout/layout.module.css'
import { Section, StatRow, Badge, Row, RowMain, RowTitle, TypeMark, fmtDate } from '@/components/ui'
import { useStore } from '@/store'
import { useResult } from '@/store/selectors'
import { COMMIT_TYPE } from '@shared/theme'
import type { CommitType, TrialScore } from '@shared/types'

const LEVEL = {
  clean:   { label: 'クリーン', color: 'var(--ok)' },
  normal:  { label: '通常',     color: 'var(--accent)' },
  messy:   { label: '混沌',     color: 'var(--warn)' },
  chaotic: { label: '超混沌',   color: 'var(--danger)' },
} as const

export default function Overview() {
  const result = useResult()
  const filterTypes = useStore(st => st.filterTypes)
  const focus = useStore(st => st.focus)
  const { toggleFilter, clearFilters, selectZone } = useStore.getState()
  if (!result) return <div className={l.empty}>リポジトリを開くと、ここに統計が出ます。</div>

  const a = result.activity
  const st = result.stats
  const zones = result.graph.zones
  const activeZone = focus?.kind === 'zone' ? focus.zone.id : undefined
  const counts = new Map<string, number>()
  for (const n of result.graph.nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1)

  return (
    <>
      <Section title="統計">
        <StatRow label="コミット" value={String(st.totalCommits)} />
        <StatRow label="ブランチ" value={String(st.branchCount)} />
        <StatRow label="マージ" value={String(st.mergeCount)} />
        <StatRow label="リバート" value={String(st.revertCount)} />
        <StatRow label="バグ修正" value={String(st.errorFixCount)} />
        <StatRow label="WIP" value={String(st.wipCount)} />
        {st.fileStatsCoverage < 1 && (
          <StatRow label="差分の取得率" value={`${Math.round(st.fileStatsCoverage * 100)}%`} warn={st.fileStatsCoverage < 0.5} />
        )}
      </Section>

      <Section title="試行錯誤スコア"><ScoreCard score={result.score} /></Section>

      <Section title="働き方">
        <HourHistogram byHour={a.byHour} />
        <StatRow label="稼働日数" value={`${a.activeDays}日 / ${a.spanDays}日`} />
        <StatRow label="稼働日あたり" value={`${a.commitsPerActiveDay} コミット`} />
        <StatRow label="夜間（22〜5時）" value={`${Math.round(a.nightRatio * 100)}%`} warn={a.nightRatio >= 0.35} />
        <StatRow label="週末" value={`${Math.round(a.weekendRatio * 100)}%`} />
        <StatRow label="最長の連続稼働" value={`${a.longestStreakDays}日`} />
        <StatRow label="最長の空白" value={`${a.longestBreakDays}日`} />
        {a.authors.length > 1 && <StatRow label="著者" value={`${a.authors.length}人`} />}
      </Section>

      {zones.length > 0 && (
        <Section title="開発フェーズ">
          {zones.map(z => {
            const meta = COMMIT_TYPE[z.theme] ?? COMMIT_TYPE.normal
            const active = z.id === activeZone
            return (
              <Row key={z.id} active={active} color={meta.hex} onClick={() => selectZone(active ? null : z)}
                title={`${z.label}（${z.nodeCount}コミット / ${fmtDate(z.startTimestamp)}〜${fmtDate(z.endTimestamp)}）`}
                aside={<>{fmtDate(z.startTimestamp)}〜 · {z.nodeCount}</>}>
                <TypeMark type={z.theme} />
                <RowMain><RowTitle className="truncate">{z.label}</RowTitle></RowMain>
              </Row>
            )
          })}
        </Section>
      )}

      <Section title="種別で絞る" aside={filterTypes.size > 0 && <button className={l.clearBtn} style={{ width: 'auto', padding: '0 4px' }} onClick={clearFilters}>クリア</button>}>
        {(Object.keys(COMMIT_TYPE) as CommitType[]).map(type => {
          const n = counts.get(type) ?? 0
          if (n === 0) return null
          const meta = COMMIT_TYPE[type]
          return (
            <Row key={type} active={filterTypes.has(type)} color={meta.hex} onClick={() => toggleFilter(type)} aside={n}>
              <TypeMark type={type} />
              <span className={s.filterLabel}>{meta.short}</span>
            </Row>
          )
        })}
      </Section>
    </>
  )
}

function ScoreCard({ score }: { score: TrialScore }) {
  const lv = LEVEL[score.level]
  return (
    <div style={{ '--score-color': lv.color } as CSSProperties}>
      <div className={s.score}>
        <span className={s.scoreNum}>{score.total}</span>
        <Badge color={lv.color}>{lv.label}</Badge>
      </div>
      <div className={s.scoreDetails}>
        {score.details.filter(d => d.count > 0).map(d => (
          <div key={d.label} className={s.scoreLine}>
            <span className={s.scoreLabel}>{d.label}</span>
            <span className={s.scoreCalc}>{d.count}×{d.weight}</span>
            <span className={s.scoreSub}>{d.subtotal}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 24時間の分布。夜（22〜5時）だけ色を変えて、生活のはみ出しが一目で分かるように */
export function HourHistogram({ byHour }: { byHour: number[] }) {
  const max = Math.max(1, ...byHour)
  return (
    <div style={{ marginBottom: 6 }}>
      <div className={s.hist}>
        {byHour.map((n, h) => (
          <div key={h} className={s.histBar} title={`${h}時台: ${n}件`}
            data-night={h >= 22 || h < 5 ? 'true' : undefined} data-zero={n === 0 ? 'true' : undefined}
            style={{ height: `${Math.max(2, (n / max) * 100)}%` }} />
        ))}
      </div>
      <div className={s.histAxis}><span>0時</span><span>6時</span><span>12時</span><span>18時</span><span>23時</span></div>
    </div>
  )
}
