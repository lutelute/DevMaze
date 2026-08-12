import type { MazeNode, CommitType, StruggleEpisode, FileHotspot } from '../../shared/types'
import { COMMIT_TYPE } from '../../shared/theme'

interface Props {
  node: MazeNode
  onClose: () => void
  /** このコミットが属する沼エピソード */
  struggles?: StruggleEpisode[]
  /** リポジトリ全体のホットスポット（変更ファイルに risk を添えるのに使う） */
  hotspots?: FileHotspot[]
  onSelectStruggle?: (episode: StruggleEpisode) => void
  /** 変更ファイルをクリックしたとき、そのファイルの履歴を辿る */
  onSelectFile?: (path: string) => void
  /** origin の URL（GitHub 上のコミット・PR へのリンクを作る） */
  remoteUrl?: string
}

/** git のリモートURL（SSH / HTTPS どちらの書式でも）から GitHub の owner/repo を取り出す */
function githubSlug(remoteUrl?: string): string | null {
  if (!remoteUrl) return null
  const m = remoteUrl.match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/)
  return m ? `${m[1]}/${m[2]}` : null
}

const STRUGGLE_LABEL: Record<StruggleEpisode['kind'], string> = {
  revert_loop: 'やり直しの輪',
  fix_chain:   '修正の連鎖',
  file_churn:  '同じファイルの往復',
  wip_drift:   'WIP の漂流',
  stall_burst: '停滞のあとの再開',
}

// 色とラベルは shared/theme.ts が唯一の出どころ。
// 元はここにも写しがあって、merge の色と normal のラベルが他とずれていた
const TYPE_LABELS = Object.fromEntries(
  Object.entries(COMMIT_TYPE).map(([k, v]) => [k, { label: v.label, color: v.hex }]),
) as Record<CommitType, { label: string; color: string }>

export default function NodeDetail({
  node, onClose, struggles = [], hotspots = [], onSelectStruggle, onSelectFile, remoteUrl,
}: Props) {
  const meta = TYPE_LABELS[node.type]
  const date = new Date(node.timestamp)
  const riskByPath = new Map(hotspots.map(h => [h.path, h.risk]))
  const slug = githubSlug(remoteUrl)
  const open = (url: string) => window.electronAPI.openExternal?.(url)

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
          {slug && (
            <button
              onClick={() => open(`https://github.com/${slug}/commit/${node.id}`)}
              style={{
                marginTop: 6, background: 'none', border: '1px solid var(--border)',
                borderRadius: 5, padding: '3px 8px', fontSize: 11,
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              GitHub で開く ↗
            </button>
          )}
        </div>

        {/* PR / Issue */}
        {node.refs.length > 0 && (
          <div>
            <Label>PR / Issue</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {node.refs.map(n => (
                <button
                  key={n}
                  onClick={() => slug && open(`https://github.com/${slug}/pull/${n}`)}
                  title={slug ? `github.com/${slug} の #${n} を開く` : `#${n}`}
                  style={{
                    fontSize: 11, color: '#7A9BB8', background: 'rgba(122,155,184,0.14)',
                    border: 'none', padding: '2px 7px', borderRadius: 4,
                    fontFamily: 'monospace', cursor: slug ? 'pointer' : 'default',
                  }}
                >
                  #{n}
                </button>
              ))}
            </div>
          </div>
        )}

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
                  <div
                    key={f}
                    title={onSelectFile ? `${f}\nクリックでこのファイルの履歴を辿る` : f}
                    onClick={() => onSelectFile?.(f)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)',
                      padding: '2px 0', cursor: onSelectFile ? 'pointer' : 'default',
                    }}
                    onMouseEnter={e => { if (onSelectFile) e.currentTarget.style.color = 'var(--accent)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                  >
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

// 見出しは「コミットメッセージ」等の和文。uppercase は効かないうえ、
// 0.8px の字間は和文だと「統 計」のように間延びする
function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.02em', marginBottom: 6 }}>
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
