/**
 * 暦ビュー — 迷路が対数で歪めた「体感時間」に対する、正直な実時間。
 *
 * 迷路は密度を残すために時間を圧縮している（1か月と1年が1.27倍にしか見えない）。
 * それは「いつ集中したか」を読ませるための意図的な歪みだが、歪んだ絵しか無いと
 * 検算のしようがない。同じデータを実時間で並べた面を1枚置いて、
 * 「迷路で塊に見えたここは、暦では3日だった」と突き合わせられるようにする。
 *
 * 置き換えた MazeModeView は 8列固定・最新200件のみで、密度も空白も分岐も消えた
 * 升目だった（実測で横幅の17%しか使わず、897件中697件が出ていなかった）。
 *
 * ここでしか描かれていないデータ: activity.byWeekday / busiestDay
 * （どちらも計算済みなのに src/ から一度も参照されていなかった）
 */
import { useMemo, useState } from 'react'
import type { MazeGraph, MazeNode, ActivityProfile } from '../../shared/types'

interface Props {
  graph: MazeGraph
  activity: ActivityProfile
  filterTypes: Set<string>
  onNodeClick: (node: MazeNode) => void
  selectedNodeId?: string
  /** 沼に属するコミット。その日を沼の色で示す */
  struggleIds?: Set<string>
}

const DAY = 86400_000
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

interface DayCell {
  key: string
  date: Date
  nodes: MazeNode[]
  fixRatio: number
  struggleCount: number
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

/** 週の始まり（日曜）に丸める */
function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - x.getDay())
  return x
}

export default function CalendarView({
  graph, activity, filterTypes, onNodeClick, selectedNodeId, struggleIds,
}: Props) {
  const [hover, setHover] = useState<DayCell | null>(null)

  const nodes = useMemo(
    () => filterTypes.size === 0
      ? graph.nodes
      : graph.nodes.filter(n => filterTypes.has(n.type)),
    [graph.nodes, filterTypes],
  )

  // 日ごとに束ねる。「触らなかった日」と「存在しなかった日」を混ぜないよう、
  // 期間は最初と最後のコミットで区切る
  const { weeks, maxCount, monthMarks } = useMemo(() => {
    const byDay = new Map<string, DayCell>()
    for (const n of nodes) {
      const d = new Date(n.timestamp)
      const k = dayKey(d)
      let cell = byDay.get(k)
      if (!cell) {
        cell = { key: k, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
                 nodes: [], fixRatio: 0, struggleCount: 0 }
        byDay.set(k, cell)
      }
      cell.nodes.push(n)
      if (struggleIds?.has(n.id)) cell.struggleCount++
    }
    for (const c of byDay.values()) {
      const bad = c.nodes.filter(n => n.type === 'error_fix' || n.type === 'revert').length
      c.fixRatio = c.nodes.length > 0 ? bad / c.nodes.length : 0
    }

    if (nodes.length === 0) return { weeks: [], maxCount: 1, monthMarks: [] }

    const ts = nodes.map(n => n.timestamp)
    const first = weekStart(new Date(Math.min(...ts)))
    const last = new Date(Math.max(...ts))

    const cols: (DayCell | null)[][] = []
    const marks: { col: number; label: string }[] = []
    let cursor = new Date(first)
    let prevMonth = -1
    while (cursor <= last) {
      const col: (DayCell | null)[] = []
      for (let w = 0; w < 7; w++) {
        const d = new Date(cursor.getTime() + w * DAY)
        col.push(d > last ? null : (byDay.get(dayKey(d)) ?? {
          key: dayKey(d), date: d, nodes: [], fixRatio: 0, struggleCount: 0,
        }))
      }
      const m = cursor.getMonth()
      if (m !== prevMonth) { marks.push({ col: cols.length, label: `${m + 1}月` }); prevMonth = m }
      cols.push(col)
      cursor = new Date(cursor.getTime() + 7 * DAY)
    }

    return {
      weeks: cols,
      maxCount: Math.max(1, ...[...byDay.values()].map(c => c.nodes.length)),
      monthMarks: marks,
    }
  }, [nodes, struggleIds])

  // Maze ビューは横幅の17%しか使っていなかった。同じ轍を踏まないよう大きく取る
  const CELL = 22
  const GAP = 4

  // 濃さ＝その日の件数、赤み＝その日の fix/revert 比率。
  // 「育っている週」と「直している週」が同じ濃さでも区別できるようにする
  const cellFill = (c: DayCell): string => {
    if (c.nodes.length === 0) return 'rgba(212,168,74,0.05)'
    const t = Math.min(1, Math.log1p(c.nodes.length) / Math.log1p(maxCount))
    const a = 0.18 + t * 0.72
    return c.fixRatio >= 0.5
      ? `rgba(192,98,75,${a})`
      : c.fixRatio >= 0.25
        ? `rgba(200,139,58,${a})`
        : `rgba(212,168,74,${a})`
  }

  const maxHour = Math.max(1, ...activity.byHour)
  const maxWd = Math.max(1, ...activity.byWeekday)

  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'auto',
      background: 'var(--bg-base)', padding: '58px 28px 28px',
    }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 30 }}>

        <Section
          title="実時間の暦"
          note="濃さ＝その日のコミット数 ／ 赤み＝その日の修正・巻き戻しの割合。迷路は時間を圧縮しているので、こちらが本当の間隔"
        >
          <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
            <svg
              width={Math.max(320, weeks.length * (CELL + GAP) + 40)}
              height={7 * (CELL + GAP) + 22}
              style={{ display: 'block' }}
            >
              {monthMarks.map(m => (
                <text key={m.col} x={36 + m.col * (CELL + GAP)} y={9}
                  fontSize={10.5} fill="var(--text-dim)" fontFamily="JetBrains Mono, monospace">
                  {m.label}
                </text>
              ))}
              {WEEKDAY.map((w, i) => (
                i % 2 === 1 && (
                  <text key={w} x={0} y={20 + i * (CELL + GAP) + CELL - 3}
                    fontSize={10} fill="var(--text-dim)" fontFamily="JetBrains Mono, monospace">
                    {w}
                  </text>
                )
              ))}
              {weeks.map((col, ci) => col.map((c, ri) => c && (
                <rect
                  key={c.key}
                  x={36 + ci * (CELL + GAP)} y={16 + ri * (CELL + GAP)}
                  width={CELL} height={CELL} rx={3}
                  fill={cellFill(c)}
                  stroke={c.struggleCount > 0 ? '#C0624B' : 'none'}
                  strokeWidth={c.struggleCount > 0 ? 1 : 0}
                  strokeDasharray={c.struggleCount > 0 ? '2,1.5' : undefined}
                  style={{ cursor: c.nodes.length ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHover(c)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => { if (c.nodes.length) onNodeClick(c.nodes[c.nodes.length - 1]) }}
                />
              )))}
            </svg>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', minHeight: 20, marginTop: 4 }}>
            {hover
              ? `${hover.date.getFullYear()}/${hover.date.getMonth() + 1}/${hover.date.getDate()}（${WEEKDAY[hover.date.getDay()]}）· ` +
                (hover.nodes.length === 0
                  ? '触っていない'
                  : `${hover.nodes.length} コミット` +
                    (hover.fixRatio > 0 ? ` · 修正・巻き戻し ${Math.round(hover.fixRatio * 100)}%` : '') +
                    (hover.struggleCount > 0 ? ` · 沼のコミット ${hover.struggleCount} 件` : ''))
              : activity.busiestDay
                ? `いちばん打った日: ${activity.busiestDay.date}（${activity.busiestDay.count} コミット）`
                : ''}
          </div>
        </Section>

        <div style={{ display: 'grid', gap: 30, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <Section title="時間帯" note="夜（22-5時）は色を変えている">
            <Bars
              values={activity.byHour} max={maxHour}
              isNight={h => h >= 22 || h < 5}
              labels={['0時', '6時', '12時', '18時', '23時']}
              caption={`夜間 ${Math.round(activity.nightRatio * 100)}%`}
            />
          </Section>

          <Section title="曜日" note="週末は色を変えている">
            <Bars
              values={activity.byWeekday} max={maxWd}
              isNight={d => d === 0 || d === 6}
              labels={WEEKDAY}
              caption={`週末 ${Math.round(activity.weekendRatio * 100)}%`}
            />
          </Section>
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.9 }}>
          {activity.activeDays} 日 / {activity.spanDays} 日に手を入れた
          （稼働日あたり {activity.commitsPerActiveDay} コミット）·
          最長の連続 {activity.longestStreakDays} 日 · 最長の空白 {activity.longestBreakDays} 日
          {selectedNodeId ? '' : ' · マスをクリックするとその日の最後のコミットを開く'}
        </div>
      </div>
    </div>
  )
}

function Section({ title, note, children }: {
  title: string; note?: string; children: React.ReactNode
}) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
        {title}
      </div>
      {note && (
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.7 }}>
          {note}
        </div>
      )}
      {children}
    </div>
  )
}

/** 時間帯・曜日の共通の棒。既存の HourHistogram と同じ見せ方にそろえる */
function Bars({ values, max, isNight, labels, caption }: {
  values: number[]; max: number; isNight: (i: number) => boolean
  labels: string[]; caption: string
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 66 }}>
        {values.map((n, i) => (
          <div
            key={i}
            title={`${labels.length === 7 ? labels[i] : `${i}時台`}: ${n}件`}
            style={{
              flex: 1,
              height: `${Math.max(2, (n / max) * 100)}%`,
              background: isNight(i) ? '#C0624B' : 'var(--accent)',
              opacity: n === 0 ? 0.18 : isNight(i) ? 0.85 : 0.6,
              borderRadius: 2,
            }}
          />
        ))}
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 9.5, color: 'var(--text-dim)', fontFamily: 'monospace', marginTop: 4,
      }}>
        {labels.map(l => <span key={l}>{l}</span>)}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 7 }}>{caption}</div>
    </div>
  )
}
