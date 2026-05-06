import type { TrialScore } from '../../shared/types'

interface Props { score: TrialScore }

const LEVEL_CONFIG = {
  clean:   { label: 'クリーン',   color: '#7B9E5A', bar: '#7B9E5A' },
  normal:  { label: '通常',       color: '#D4A84A', bar: '#D4A84A' },
  messy:   { label: '混沌',       color: '#C88B3A', bar: '#C88B3A' },
  chaotic: { label: '超混沌',     color: '#C0624B', bar: '#C0624B' },
}

export default function ScoreCard({ score }: Props) {
  const cfg = LEVEL_CONFIG[score.level]
  const maxScore = 100
  const pct = Math.min(100, (score.total / maxScore) * 100)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Score number + level */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, fontFamily: 'monospace', color: cfg.color }}>
          {score.total}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, color: cfg.color, background: cfg.color + '20',
          padding: '2px 6px', borderRadius: 4, letterSpacing: '0.5px',
        }}>
          {cfg.label}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: 'var(--bg-hover)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: cfg.bar, borderRadius: 2,
          transition: 'width 0.8s ease',
        }} />
      </div>

      {/* Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
        {score.details.filter(d => d.count > 0).map(d => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <span style={{ color: 'var(--text-dim)', flex: 1 }}>{d.label}</span>
            <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
              {d.count}×{d.weight}
            </span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontWeight: 600, minWidth: 24, textAlign: 'right' }}>
              {d.subtotal}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
