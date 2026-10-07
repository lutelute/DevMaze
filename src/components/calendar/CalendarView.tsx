/**
 * 暦ビュー。迷路が対数で歪めた「体感時間」に対する、正直な実時間。
 * 「迷路で塊に見えたここは、暦では3日だった」と突き合わせるための面。
 */
import { useMemo, useState } from 'react'
import s from './calendar.module.css'
import { useStore } from '@/store'
import { useResult, useStruggleIds } from '@/store/selectors'
import type { MazeNode } from '@shared/types'

const DAY = 86400_000
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']
const CELL = 22, GAP = 4

interface DayCell { key: string; date: Date; nodes: MazeNode[]; fixRatio: number; struggleCount: number }
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
function weekStart(d: Date): Date { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x }

export default function CalendarView() {
  const result = useResult()
  const filterTypes = useStore(st => st.filterTypes)
  const selectHash = useStore(st => st.selectHash)
  const struggleIds = useStruggleIds()
  const [hover, setHover] = useState<DayCell | null>(null)

  const nodes = useMemo(() => {
    const all = result?.graph.nodes ?? []
    return filterTypes.size === 0 ? all : all.filter(n => filterTypes.has(n.type))
  }, [result, filterTypes])

  const { weeks, maxCount, monthMarks } = useMemo(() => {
    const byDay = new Map<string, DayCell>()
    for (const n of nodes) {
      const d = new Date(n.timestamp), k = dayKey(d)
      let c = byDay.get(k)
      if (!c) { c = { key: k, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), nodes: [], fixRatio: 0, struggleCount: 0 }; byDay.set(k, c) }
      c.nodes.push(n)
      if (struggleIds.has(n.id)) c.struggleCount++
    }
    for (const c of byDay.values()) {
      const bad = c.nodes.filter(n => n.type === 'error_fix' || n.type === 'revert').length
      c.fixRatio = c.nodes.length ? bad / c.nodes.length : 0
    }
    if (nodes.length === 0) return { weeks: [] as (DayCell | null)[][], maxCount: 1, monthMarks: [] as { col: number; label: string }[] }
    const ts = nodes.map(n => n.timestamp)
    const first = weekStart(new Date(Math.min(...ts))), last = new Date(Math.max(...ts))
    const cols: (DayCell | null)[][] = [], marks: { col: number; label: string }[] = []
    let cursor = new Date(first), prevMonth = -1
    while (cursor <= last) {
      const col: (DayCell | null)[] = []
      for (let w = 0; w < 7; w++) {
        const d = new Date(cursor.getTime() + w * DAY)
        col.push(d > last ? null : byDay.get(dayKey(d)) ?? { key: dayKey(d), date: d, nodes: [], fixRatio: 0, struggleCount: 0 })
      }
      const m = cursor.getMonth()
      if (m !== prevMonth) { marks.push({ col: cols.length, label: `${m + 1}月` }); prevMonth = m }
      cols.push(col)
      cursor = new Date(cursor.getTime() + 7 * DAY)
    }
    return { weeks: cols, maxCount: Math.max(1, ...[...byDay.values()].map(c => c.nodes.length)), monthMarks: marks }
  }, [nodes, struggleIds])

  if (!result) return null
  const a = result.activity

  // 濃さ＝その日の件数、赤み＝その日の fix/revert 比率
  const fill = (c: DayCell) => {
    if (c.nodes.length === 0) return 'rgba(217,168,75,0.05)'
    const t = Math.min(1, Math.log1p(c.nodes.length) / Math.log1p(maxCount))
    const al = 0.18 + t * 0.72
    return c.fixRatio >= 0.5 ? `rgba(196,96,74,${al})` : c.fixRatio >= 0.25 ? `rgba(201,142,60,${al})` : `rgba(217,168,75,${al})`
  }

  return (
    <div className={s.wrap}>
      <div className={s.inner}>
        <section>
          <div className={s.title}>実時間の暦</div>
          <div className={s.note}>濃さはその日のコミット数、赤みは修正・巻き戻しの割合。迷路は時間を圧縮しているので、こちらが本当の間隔。</div>
          <div className={s.scroll}>
            <svg width={Math.max(320, weeks.length * (CELL + GAP) + 40)} height={7 * (CELL + GAP) + 22} style={{ display: 'block' }}>
              {monthMarks.map(m => (
                <text key={m.col} x={36 + m.col * (CELL + GAP)} y={9} fontSize={10.5} fill="var(--text-dim)" fontFamily="var(--font-mono)">{m.label}</text>
              ))}
              {WEEKDAY.map((w, i) => i % 2 === 1 && (
                <text key={w} x={0} y={20 + i * (CELL + GAP) + CELL - 3} fontSize={10} fill="var(--text-dim)" fontFamily="var(--font-mono)">{w}</text>
              ))}
              {weeks.map((col, ci) => col.map((c, ri) => c && (
                <rect key={c.key} className={s.cell} data-empty={c.nodes.length ? undefined : 'true'}
                  x={36 + ci * (CELL + GAP)} y={16 + ri * (CELL + GAP)} width={CELL} height={CELL} rx={3}
                  fill={fill(c)} stroke={c.struggleCount > 0 ? 'var(--danger)' : 'none'} strokeWidth={1} strokeDasharray={c.struggleCount > 0 ? '2,1.5' : undefined}
                  onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)}
                  onClick={() => { if (c.nodes.length) selectHash(c.nodes[c.nodes.length - 1].id) }} />
              )))}
            </svg>
          </div>
          <div className={s.status}>
            {hover
              ? `${hover.date.getFullYear()}/${hover.date.getMonth() + 1}/${hover.date.getDate()}（${WEEKDAY[hover.date.getDay()]}）· ` +
                (hover.nodes.length === 0 ? '触っていない'
                  : `${hover.nodes.length} コミット` + (hover.fixRatio > 0 ? ` · 修正・巻き戻し ${Math.round(hover.fixRatio * 100)}%` : '') + (hover.struggleCount > 0 ? ` · 沼のコミット ${hover.struggleCount} 件` : ''))
              : a.busiestDay ? `いちばん打った日: ${a.busiestDay.date}（${a.busiestDay.count} コミット）` : ''}
          </div>
        </section>

        <div className={s.grid2}>
          <section>
            <div className={s.title}>時間帯</div>
            <div className={s.note}>夜（22〜5時）は色を変えている</div>
            <Bars values={a.byHour} off={h => h >= 22 || h < 5} labels={['0時', '6時', '12時', '18時', '23時']} caption={`夜間 ${Math.round(a.nightRatio * 100)}%`} />
          </section>
          <section>
            <div className={s.title}>曜日</div>
            <div className={s.note}>週末は色を変えている</div>
            <Bars values={a.byWeekday} off={d => d === 0 || d === 6} labels={WEEKDAY} caption={`週末 ${Math.round(a.weekendRatio * 100)}%`} />
          </section>
        </div>

        <div className={s.foot}>
          {a.activeDays} 日 / {a.spanDays} 日に手を入れた（稼働日あたり {a.commitsPerActiveDay} コミット）· 最長の連続 {a.longestStreakDays} 日 · 最長の空白 {a.longestBreakDays} 日 · マスをクリックするとその日の最後のコミットを開く
        </div>
      </div>
    </div>
  )
}

function Bars({ values, off, labels, caption }: { values: number[]; off: (i: number) => boolean; labels: string[]; caption: string }) {
  const max = Math.max(1, ...values)
  return (
    <div>
      <div className={s.bars}>
        {values.map((n, i) => (
          <div key={i} className={s.bar} data-off={off(i) ? 'true' : undefined} data-zero={n === 0 ? 'true' : undefined}
            title={`${labels.length === 7 ? labels[i] : `${i}時台`}: ${n}件`} style={{ height: `${Math.max(2, (n / max) * 100)}%` }} />
        ))}
      </div>
      <div className={s.axis}>{labels.map(l => <span key={l}>{l}</span>)}</div>
      <div className={s.caption}>{caption}</div>
    </div>
  )
}
