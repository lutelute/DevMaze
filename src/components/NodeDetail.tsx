import type { MazeNode, CommitType } from '../../shared/types'

interface Props {
  node: MazeNode
  onClose: () => void
}

const TYPE_LABELS: Record<CommitType, { label: string; color: string }> = {
  normal:    { label: '通常コミット', color: '#3B82F6' },
  feature:   { label: '機能追加',     color: '#10B981' },
  error_fix: { label: 'バグ修正',     color: '#EF4444' },
  revert:    { label: 'リバート',     color: '#F97316' },
  merge:     { label: 'マージ',       color: '#A855F7' },
  wip:       { label: 'WIP',          color: '#F59E0B' },
  release:   { label: 'リリース',     color: '#6B7280' },
}

export default function NodeDetail({ node, onClose }: Props) {
  const meta = TYPE_LABELS[node.type]
  const date = new Date(node.timestamp)

  return (
    <aside style={{
      width: 280, flexShrink: 0,
      background: 'var(--bg-panel)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 600, color: meta.color,
            background: meta.color + '20', padding: '2px 6px', borderRadius: 4,
          }}>
            {meta.label}
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>
            {node.label}
          </span>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'var(--text-dim)',
          cursor: 'pointer', fontSize: 16, padding: 4, lineHeight: 1,
        }}>
          ×
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Message */}
        <div>
          <Label>コミットメッセージ</Label>
          <div style={{
            color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.5,
            background: 'var(--bg-base)', padding: '10px 12px', borderRadius: 6,
            borderLeft: `3px solid ${meta.color}`,
          }}>
            {node.message}
          </div>
        </div>

        {/* Author + Date */}
        <div>
          <Label>著者</Label>
          <Value>{node.authorName}</Value>
        </div>

        <div>
          <Label>日時</Label>
          <Value>{date.toLocaleString('ja-JP')}</Value>
        </div>

        {/* Hash */}
        <div>
          <Label>ハッシュ</Label>
          <Value mono>{node.id}</Value>
        </div>

        {/* Stats */}
        {(node.filesChanged > 0 || node.insertions > 0) && (
          <div>
            <Label>変更統計</Label>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatBadge value={node.filesChanged} label="files" color="#94A3B8" />
              <StatBadge value={node.insertions}   label="+lines" color="#10B981" />
              <StatBadge value={node.deletions}    label="-lines" color="#EF4444" />
            </div>
          </div>
        )}

        {/* Branches */}
        {node.branchNames.length > 0 && (
          <div>
            <Label>ブランチ</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {node.branchNames.map(b => (
                <Tag key={b} color="#3B82F6">{b}</Tag>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {node.tagNames.length > 0 && (
          <div>
            <Label>タグ</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {node.tagNames.map(t => (
                <Tag key={t} color="#F59E0B">🏷 {t}</Tag>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>
      {children}
    </div>
  )
}

function Value({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{
      color: 'var(--text-secondary)', fontSize: 12,
      fontFamily: mono ? 'monospace' : undefined,
      wordBreak: 'break-all',
    }}>
      {children}
    </div>
  )
}

function StatBadge({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      background: 'var(--bg-base)', padding: '6px 10px', borderRadius: 6, gap: 2,
    }}>
      <span style={{ color, fontWeight: 700, fontFamily: 'monospace', fontSize: 14 }}>{value}</span>
      <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{label}</span>
    </div>
  )
}

function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      fontSize: 11, color, background: color + '20',
      padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace',
    }}>
      {children}
    </span>
  )
}
