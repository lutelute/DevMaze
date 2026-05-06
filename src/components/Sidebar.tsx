import type { AnalysisResult } from '../../shared/types'
import type { CommitType } from '../../shared/types'
import ScoreCard from './ScoreCard'

interface Props {
  result: AnalysisResult | null
  filterTypes: Set<string>
  onFilterChange: (types: Set<string>) => void
}

const TYPE_META: Record<CommitType, { label: string; color: string; emoji: string }> = {
  normal:    { label: '通常',     color: '#3B82F6', emoji: '●' },
  feature:   { label: '機能追加', color: '#10B981', emoji: '●' },
  error_fix: { label: 'バグ修正', color: '#EF4444', emoji: '●' },
  revert:    { label: 'リバート', color: '#F97316', emoji: '●' },
  merge:     { label: 'マージ',   color: '#A855F7', emoji: '●' },
  wip:       { label: 'WIP',      color: '#F59E0B', emoji: '●' },
  release:   { label: 'リリース', color: '#6B7280', emoji: '●' },
}

export default function Sidebar({ result, filterTypes, onFilterChange }: Props) {
  const toggleFilter = (type: string) => {
    const next = new Set(filterTypes)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    onFilterChange(next)
  }

  return (
    <aside style={{
      width: 240,
      background: 'var(--bg-panel)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Stats */}
        {result && (
          <Section title="統計">
            <StatRow label="コミット総数" value={String(result.stats.totalCommits)} />
            <StatRow label="ブランチ数"   value={String(result.stats.branchCount)} />
            <StatRow label="マージ数"     value={String(result.stats.mergeCount)} />
            <StatRow label="リバート数"   value={String(result.stats.revertCount)} />
            <StatRow label="バグ修正"     value={String(result.stats.errorFixCount)} />
            <StatRow label="WIP"          value={String(result.stats.wipCount)} />
          </Section>
        )}

        {/* Score */}
        {result && (
          <Section title="試行錯誤スコア">
            <ScoreCard score={result.score} />
          </Section>
        )}

        {/* Filters */}
        {result && (
          <Section title="フィルター">
            {(Object.entries(TYPE_META) as [CommitType, typeof TYPE_META[CommitType]][]).map(([type, meta]) => {
              const count = result.graph.nodes.filter(n => n.type === type).length
              if (count === 0) return null
              const active = filterTypes.has(type)
              return (
                <button
                  key={type}
                  onClick={() => toggleFilter(type)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', background: active ? meta.color + '20' : 'none',
                    border: `1px solid ${active ? meta.color + '60' : 'transparent'}`,
                    borderRadius: 6, padding: '5px 8px', cursor: 'pointer',
                    textAlign: 'left', transition: 'all 0.15s',
                  }}
                >
                  <span style={{ color: meta.color, fontSize: 10 }}>⬤</span>
                  <span style={{ flex: 1, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: 12 }}>
                    {meta.label}
                  </span>
                  <span style={{ color: 'var(--text-dim)', fontSize: 11, fontFamily: 'monospace' }}>{count}</span>
                </button>
              )
            })}
            {filterTypes.size > 0 && (
              <button onClick={() => onFilterChange(new Set())} style={{
                width: '100%', background: 'none', border: 'none',
                color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer',
                padding: '4px', marginTop: 4, textAlign: 'center',
              }}>
                フィルタークリア
              </button>
            )}
          </Section>
        )}

        {/* Legend */}
        <Section title="凡例">
          {(Object.entries(TYPE_META) as [CommitType, typeof TYPE_META[CommitType]][]).map(([type, meta]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <span style={{ color: meta.color, fontSize: 10 }}>⬤</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{meta.label}</span>
            </div>
          ))}
        </Section>
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px',
        color: 'var(--text-dim)', marginBottom: 8,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {children}
      </div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontWeight: 500, fontSize: 12 }}>{value}</span>
    </div>
  )
}
