/**
 * 時間軸。
 *
 * コミットを実時間で並べると、開発が集中した数日に全部が固まり、残りが空白になる。
 * そこでコミット間隔を対数で圧縮した「体感時間」の軸を作る。
 * 密度が均されて読めるようになり、長い空白は縮んでも消えずに残る。
 *
 * ここは純粋関数。DOM・d3・React に依存しない。
 */
export const HOUR = 3600_000
export const DAY = 24 * HOUR

/** これ以上の空白を「止まっていた時間」として印にする */
export const GAP_MARK_DAYS = 3

export interface TimeTick { x: number; label: string; major: boolean }
export interface TimeGap { at: number; days: number }

export interface TimeAxis {
  /** 時刻 → 軸上の位置（px） */
  pos: (t: number) => number
  /** 軸上の位置 → 時刻 */
  time: (x: number) => number
  /** 軸の全長（px） */
  total: number
  ticksIn: (t0: number, t1: number) => TimeTick[]
  /** 3日以上の空白。位置は空白の中央 */
  gaps: TimeGap[]
  /** 軸に乗っている時刻（昇順・重複なし） */
  times: number[]
}

export interface AxisOptions {
  /** 1件ぶんの基本間隔。ほぼ0にして重なりを許す（衝突回避が塊に押し広げる） */
  step: number
  /** 空白時間の効き */
  gapK: number
  /** 1つの空白が占められる最大幅 */
  gapMax: number
}

/** コミット表示: 1件ごとの前進はごく小さく、時間が近いものは重ねる */
export const COMMIT_AXIS: AxisOptions = { step: 3, gapK: 24, gapMax: 200 }

/**
 * まとまり表示: 1つ1つが大きい塊なので重ねる意味がない。
 * 等間隔で並べ、空白の効きも抑える（そうしないと縦に伸びて全体が読めない）
 */
export const SESSION_AXIS: AxisOptions = { step: 62, gapK: 8, gapMax: 60 }

/** その年の何週目か（1/1 を週0とする） */
export function weekOf(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1)
  return Math.floor((d.getTime() - start.getTime()) / (7 * DAY))
}

/** 区分線形の補間。from は昇順であること */
function interpolate(v: number, from: number[], to: number[]): number {
  if (from.length === 0) return 0
  if (v <= from[0]) return to[0]
  if (v >= from[from.length - 1]) return to[to.length - 1]
  let lo = 0
  let hi = from.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (from[mid] <= v) lo = mid
    else hi = mid
  }
  const span = from[hi] - from[lo] || 1
  return to[lo] + ((v - from[lo]) / span) * (to[hi] - to[lo])
}

export function buildTimeAxis(timestamps: number[], opts: AxisOptions = COMMIT_AXIS): TimeAxis {
  const ts = [...new Set(timestamps)].sort((a, b) => a - b)
  if (ts.length === 0) {
    return { pos: () => 0, time: () => 0, total: 1, ticksIn: () => [], gaps: [], times: [] }
  }

  const xs: number[] = [0]
  const gaps: TimeGap[] = []

  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1]
    const extra = Math.min(opts.gapMax, opts.gapK * Math.log1p(gap / HOUR))
    const x = xs[i - 1] + opts.step + extra
    xs.push(x)
    if (gap >= GAP_MARK_DAYS * DAY) gaps.push({ at: (xs[i - 1] + x) / 2, days: Math.round(gap / DAY) })
  }

  const total = xs[xs.length - 1] || 1

  const ticksIn: TimeAxis['ticksIn'] = (t0, t1) => {
    const spanDays = Math.max(0, t1 - t0) / DAY
    const unit: 'hour' | 'day' | 'week' | 'month' | 'year' =
      spanDays > 1100 ? 'year' :
      spanDays > 200  ? 'month' :
      spanDays > 30   ? 'week' :
      spanDays > 2    ? 'day' : 'hour'

    const out: TimeTick[] = []
    let prevKey = ''
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] < t0 || ts[i] > t1) continue
      const d = new Date(ts[i])
      const key =
        unit === 'year'  ? `${d.getFullYear()}` :
        unit === 'month' ? `${d.getFullYear()}-${d.getMonth()}` :
        unit === 'week'  ? `${d.getFullYear()}-${weekOf(d)}` :
        unit === 'day'   ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` :
                           `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`
      if (key === prevKey) continue
      prevKey = key
      out.push({
        x: xs[i],
        label:
          unit === 'year'  ? `${d.getFullYear()}` :
          unit === 'month' ? `${d.getFullYear()}/${d.getMonth() + 1}` :
          unit === 'hour'  ? `${d.getHours()}:00` :
                             `${d.getMonth() + 1}/${d.getDate()}`,
        major: unit === 'hour' ? d.getHours() === 0 : d.getDate() === 1,
      })
    }
    return out
  }

  return {
    pos: t => interpolate(t, ts, xs),
    time: x => interpolate(x, xs, ts),
    total,
    ticksIn,
    gaps,
    times: ts,
  }
}
