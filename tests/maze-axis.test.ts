import { describe, it, expect } from 'vitest'
import { buildTimeAxis, COMMIT_AXIS, SESSION_AXIS, weekOf, DAY, HOUR } from '../shared/maze/axis'

const base = new Date('2026-01-05T09:00:00').getTime()

describe('buildTimeAxis', () => {
  it('空なら長さ1の空の軸', () => {
    const a = buildTimeAxis([])
    expect(a.total).toBe(1)
    expect(a.pos(123)).toBe(0)
    expect(a.gaps).toEqual([])
    expect(a.ticksIn(0, 1)).toEqual([])
  })

  it('位置は時刻に対して単調増加で、重複した時刻は同じ位置', () => {
    const ts = [base + 3 * HOUR, base, base + HOUR, base + HOUR, base + 10 * DAY]
    const a = buildTimeAxis(ts)
    const sorted = [...new Set(ts)].sort((x, y) => x - y)
    const xs = sorted.map(a.pos)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
    expect(a.pos(base + HOUR)).toBe(a.pos(base + HOUR))
    expect(a.pos(sorted[0])).toBe(0)
    expect(a.pos(sorted[sorted.length - 1])).toBe(a.total)
    expect(a.times).toEqual(sorted)
  })

  it('空白は対数で圧縮される（100倍の間隔が100倍の幅にはならない）', () => {
    const a = buildTimeAxis([base, base + HOUR, base + HOUR + 100 * HOUR])
    const short = a.pos(base + HOUR) - a.pos(base)
    const long = a.pos(base + 101 * HOUR) - a.pos(base + HOUR)
    expect(long).toBeGreaterThan(short)
    expect(long / short).toBeLessThan(10)
  })

  it('1つの空白が占める幅は gapMax を超えない', () => {
    const a = buildTimeAxis([base, base + 365 * DAY])
    expect(a.total).toBeLessThanOrEqual(COMMIT_AXIS.step + COMMIT_AXIS.gapMax)
  })

  it('3日以上の空白だけが gaps になる', () => {
    const a = buildTimeAxis([base, base + 2 * DAY, base + 2 * DAY + 5 * DAY, base + 7 * DAY + HOUR])
    expect(a.gaps).toHaveLength(1)
    expect(a.gaps[0].days).toBe(5)
    // 空白の中央に置かれる
    const x0 = a.pos(base + 2 * DAY)
    const x1 = a.pos(base + 7 * DAY)
    expect(a.gaps[0].at).toBeCloseTo((x0 + x1) / 2, 6)
  })

  it('time は pos の逆写像', () => {
    const ts = [base, base + 5 * HOUR, base + 3 * DAY, base + 20 * DAY]
    const a = buildTimeAxis(ts)
    for (const t of ts) expect(a.time(a.pos(t))).toBeCloseTo(t, 3)
    // 中間点も往復できる
    const mid = a.pos(base + 5 * HOUR) + (a.pos(base + 3 * DAY) - a.pos(base + 5 * HOUR)) / 2
    expect(a.pos(a.time(mid))).toBeCloseTo(mid, 6)
  })

  it('まとまり用の軸は等間隔に近く、空白の効きが小さい', () => {
    const ts = [base, base + 10 * MINUTES, base + 30 * DAY]
    const c = buildTimeAxis(ts, COMMIT_AXIS)
    const s = buildTimeAxis(ts, SESSION_AXIS)
    expect(s.pos(ts[1]) - s.pos(ts[0])).toBeGreaterThan(c.pos(ts[1]) - c.pos(ts[0]))
    const sGap = s.pos(ts[2]) - s.pos(ts[1])
    expect(sGap).toBeLessThanOrEqual(SESSION_AXIS.step + SESSION_AXIS.gapMax)
  })

  describe('ticksIn の単位', () => {
    it('2日以内なら時間、数日なら日付', () => {
      const a = buildTimeAxis([base, base + HOUR, base + 2 * HOUR, base + 5 * DAY])
      const hour = a.ticksIn(base, base + 2 * HOUR)
      expect(hour.map(t => t.label)).toEqual(['9:00', '10:00', '11:00'])
      const day = a.ticksIn(base, base + 5 * DAY)
      expect(day.map(t => t.label)).toEqual(['1/5', '1/10'])
    })

    it('1か月超なら週で間引き、200日超なら月、1100日超なら年', () => {
      const ts: number[] = []
      for (let d = 0; d < 1200; d += 5) ts.push(base + d * DAY)
      const a = buildTimeAxis(ts)
      const week = a.ticksIn(base, base + 60 * DAY)
      expect(week.length).toBeGreaterThan(5)
      expect(week.length).toBeLessThan(13)
      const month = a.ticksIn(base, base + 300 * DAY)
      expect(month[0].label).toBe('2026/1')
      expect(month.every(t => /^\d{4}\/\d{1,2}$/.test(t.label))).toBe(true)
      const year = a.ticksIn(base, base + 1199 * DAY)
      expect(year.map(t => t.label)).toEqual(['2026', '2027', '2028', '2029'])
    })

    it('範囲外の時刻は含めない', () => {
      const a = buildTimeAxis([base, base + DAY, base + 10 * DAY])
      const ticks = a.ticksIn(base + DAY, base + 3 * DAY)
      expect(ticks).toHaveLength(1)
      expect(ticks[0].x).toBe(a.pos(base + DAY))
    })
  })
})

const MINUTES = 60_000

describe('weekOf', () => {
  it('1月1日は第0週、1月8日は第1週', () => {
    expect(weekOf(new Date(2026, 0, 1))).toBe(0)
    expect(weekOf(new Date(2026, 0, 8))).toBe(1)
  })
})
