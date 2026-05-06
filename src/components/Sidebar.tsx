import type { AnalysisResult } from '../../shared/types'
import type { CommitType } from '../../shared/types'
import ScoreCard from './ScoreCard'

interface Props {
  result: AnalysisResult | null
  filterTypes: Set<string>
  onFilterChange: (types: Set<string>) => void
  recentRepos: string[]
  currentRepoPath: string | null
  onOpenRecent: (path: string) => void
}

const TYPE_META: Record<CommitType, { label: string; color: string }> = {
  normal:    { label: '通常',     color: '#D4A84A' },
  feature:   { label: '機能追加', color: '#7B9E5A' },
  error_fix: { label: 'バグ修正', color: '#C0624B' },
  revert:    { label: 'リバート', color: '#C88B3A' },
  merge:     { label: 'マージ',   color: '#8B7355' },
  wip:       { label: 'WIP',      color: '#B8A06A' },
  release:   { label: 'リリース', color: '#9B8570' },
}

function repoLabel(repoPath: string): string {
  const name = repoPath.split('/').pop() ?? repoPath
  return name.endsWith('.git') ? name.slice(0, -4) : name
}

function isGithubBare(repoPath: string): boolean {
  return repoPath.includes('github-repos')
}

export default function Sidebar({
  result, filterTypes, onFilterChange,
  recentRepos, currentRepoPath, onOpenRecent,
}: Props) {
  const toggleFilter = (type: string) => {
    const next = new Set(filterTypes)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    onFilterChange(next)
  }

  return (
    <aside style={{
      width: 200,
      background: 'var(--bg-panel)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* 迷路履歴 */}
        {recentRepos.length > 0 && (
          <Section title="迷路">
            {recentRepos.slice(0, 10).map(repo => {
              const isCurrent = repo === currentRepoPath
              const isGH = isGithubBare(repo)
              return (
                <button
                  key={repo}
                  onClick={() => onOpenRecent(repo)}
                  title={repo}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: '100%', textAlign: 'left',
                    background: isCurrent ? 'rgba(212,168,74,0.15)' : 'none',
                    border: `1px solid ${isCurrent ? 'rgba(212,168,74,0.4)' : 'transparent'}`,
                    borderRadius: 6, padding: '5px 7px', cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => {
                    if (!isCurrent) e.currentTarget.style.background = 'var(--bg-hover)'
                  }}
                  onMouseLeave={e => {
                    if (!isCurrent) e.currentTarget.style.background = 'none'
                  }}
                >
                  <span style={{ fontSize: 11, flexShrink: 0 }}>{isGH ? '🐙' : '📁'}</span>
                  <span style={{
                    fontSize: 12,
                    color: isCurrent ? 'var(--accent)' : 'var(--text-secondary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: isCurrent ? 600 : 400,
                  }}>
                    {repoLabel(repo)}
                  </span>
                </button>
              )
            })}
          </Section>
        )}

        {/* Stats */}
        {result && (
          <Section title="統計">
            <StatRow label="コミット数" value={String(result.stats.totalCommits)} />
            <StatRow label="ブランチ数" value={String(result.stats.branchCount)} />
            <StatRow label="マージ"     value={String(result.stats.mergeCount)} />
            <StatRow label="リバート"   value={String(result.stats.revertCount)} />
            <StatRow label="バグ修正"   value={String(result.stats.errorFixCount)} />
            <StatRow label="WIP"        value={String(result.stats.wipCount)} />
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
                クリア
              </button>
            )}
          </Section>
        )}
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px',
        color: 'var(--text-dim)', marginBottom: 6,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontWeight: 500, fontSize: 12 }}>{value}</span>
    </div>
  )
}
