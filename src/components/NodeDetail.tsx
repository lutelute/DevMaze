import type { MazeNode, CommitType, StruggleEpisode, FileHotspot } from '../../shared/types'

interface Props {
  node: MazeNode
  onClose: () => void
  /** このコミットが属する沼エピソード */
  struggles?: StruggleEpisode[]
  /** リポジトリ全体のホットスポット（変更ファイルに risk を添えるのに使う） */
  hotspots?: FileHotspot[]
  onSelectStruggle?: (episode: StruggleEpisode) => void
}

const STRUGGLE_LABEL: Record<StruggleEpisode['kind'], string> = {
  revert_loop: 'やり直しの輪',
  fix_chain:   '修正の連鎖',
  file_churn:  '同じファイルの往復',
  wip_drift:   'WIP の漂流',
  stall_burst: '停滞のあとの再開',
}

const TYPE_LABELS: Record<CommitType, { label: string; color: string }> = {
  normal:    { label: '通常コミット',     color: '#D4A84A' },
  feature:   { label: '機能追加',         color: '#7B9E5A' },
  error_fix: { label: 'バグ修正',         color: '#C0624B' },
  revert:    { label: 'リバート',         color: '#C88B3A' },
  merge:     { label: 'マージ',           color: '#8B7355' },
  wip:       { label: 'WIP',              color: '#B8A06A' },
  release:   { label: 'リリース',         color: '#E8C060' },
  chore:     { label: '環境整備',         color: '#8B9BAA' },
  docs:      { label: 'ドキュメント',     color: '#7A9BB8' },
  refactor:  { label: 'リファクタリング', color: '#9B8EC4' },
  test:      { label: 'テスト',           color: '#6AAF9E' },
}

export default function NodeDetail({ node, onClose, struggles = [], hotspots = [], onSelectStruggle }: Props) {
  const meta = TYPE_LABELS[node.type]
  const date = new Date(node.timestamp)
  const riskByPath = new Map(hotspots.map(h => [h.path, h.risk]))

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontWeight: 600, color: meta.color,
            background: meta.color + '20', padding: '2px 6px', borderRadius: 4,
          }}>
            {meta.label}
          </span>
          {node.isMilestone && (
            <span style={{
              fontSize: 10, color: node.milestoneReason === 'large_change' ? '#C0624B' : '#D4A84A',
              background: 'rgba(212,168,74,0.12)', padding: '2px 6px', borderRadius: 4,
            }}>
              {{ tag: '★ タグ', version: '★ バージョン', large_change: '⚡ 大規模変更' }[node.milestoneReason ?? 'tag']}
            </span>
          )}
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

        {/* 沼バッジ */}
        {struggles.length > 0 && (
          <div>
            <Label>このコミットが属する沼</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {struggles.map(e => (
                <button
                  key={e.id}
                  onClick={() => onSelectStruggle?.(e)}
                  style={{
                    textAlign: 'left', background: 'rgba(192,98,75,0.12)',
                    border: '1px solid rgba(192,98,75,0.35)', borderRadius: 6,
                    padding: '6px 8px', cursor: onSelectStruggle ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ fontSize: 11.5, color: '#E0A090', lineHeight: 1.35 }}>{e.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                    {STRUGGLE_LABEL[e.kind]} · 深刻度 {e.severity} · {e.commits.length}コミット
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 変更ファイル */}
        {node.files.length > 0 && (
          <div>
            <Label>変更ファイル（{node.files.length}）</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflowY: 'auto' }}>
              {node.files.slice(0, 60).map(f => {
                const risk = riskByPath.get(f)
                return (
                  <div key={f} title={f} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)',
                    padding: '2px 0',
                  }}>
                    <span style={{
                      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left',
                    }}>
                      {f}
                    </span>
                    {risk !== undefined && (
                      <span title={`ホットスポット risk ${risk}`} style={{
                        flexShrink: 0, fontSize: 9.5, color: risk >= 50 ? '#C0624B' : '#C88B3A',
                        background: risk >= 50 ? 'rgba(192,98,75,0.15)' : 'rgba(200,139,58,0.12)',
                        padding: '1px 5px', borderRadius: 4,
                      }}>
                        risk {risk}
                      </span>
                    )}
                  </div>
                )
              })}
              {node.files.length > 60 && (
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>… 他 {node.files.length - 60} 件</div>
              )}
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
