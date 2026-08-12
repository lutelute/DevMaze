import { useState, useCallback, useEffect, useRef } from 'react'
import type {
  AnalysisResult, CommitType, StruggleEpisode, StruggleKind, FileHotspot, Zone,
} from '../../shared/types'
import ScoreCard from './ScoreCard'
import { COMMIT_TYPE, severityColor } from '../../shared/theme'

interface Props {
  result: AnalysisResult | null
  filterTypes: Set<string>
  onFilterChange: (types: Set<string>) => void
  recentRepos: string[]
  currentRepoPath: string | null
  onOpenRecent: (path: string) => void
  selectedStruggleId?: string
  onSelectStruggle: (episode: StruggleEpisode | null) => void
  selectedFilePath?: string
  onSelectFile: (path: string | null) => void
  selectedZoneId?: string
  onSelectZone: (zone: Zone | null) => void
}

type Tab = 'overview' | 'struggles' | 'hotspots' | 'repos'

// 色と短い名前は shared/theme.ts が唯一の出どころ
const TYPE_META = Object.fromEntries(
  Object.entries(COMMIT_TYPE).map(([k, v]) => [k, { label: v.short, color: v.hex }]),
) as Record<CommitType, { label: string; color: string }>

const ZONE_ICON: Partial<Record<CommitType, string>> = {
  feature: '🌱', error_fix: '🔧', refactor: '♻️', release: '🚀', wip: '🌀',
  test: '🧪', docs: '📝', chore: '⚙️', merge: '🔀', normal: '📌', revert: '↩️',
}

const STRUGGLE_META: Record<StruggleKind, { label: string; icon: string }> = {
  revert_loop: { label: 'やり直しの輪',       icon: '↩︎' },
  fix_chain:   { label: '修正の連鎖',         icon: '🔧' },
  file_churn:  { label: '同じファイルの往復', icon: '🌀' },
  wip_drift:   { label: 'WIP の漂流',         icon: '⋯'  },
  stall_burst: { label: '停滞のあとの再開',   icon: '⏸'  },
}

const MIN_W = 200
const MAX_W = 460
const DEFAULT_W = 252
// 畳んだときの幅。キャンバスが 252px ぶん広がるので、全体表示の縮尺が大きく上がる
const RAIL_W = 40

// 畳んだレールに出す1文字。タブのラベルの頭を使う
const TAB_GLYPH: Record<Tab, string> = {
  overview: '概', struggles: '沼', hotspots: '場', repos: '歴',
}


/** フィルター行の印。迷路の節点と同じ形にそろえる */
function TypeMark({ type, color }: { type: CommitType; color: string }) {
  const shape = COMMIT_TYPE[type].shape
  const glyph = COMMIT_TYPE[type].glyph
  return (
    <svg width="12" height="12" viewBox="-7 -7 14 14" style={{ flexShrink: 0 }}>
      {shape === 'diamond' ? (
        <path d="M0,-5 L4,0 L0,5 L-4,0 Z" fill={`${color}30`} stroke={color} strokeWidth="1.4"/>
      ) : shape === 'hex' ? (
        <path d="M4.3,-2.5 L4.3,2.5 L0,5 L-4.3,2.5 L-4.3,-2.5 L0,-5 Z"
          fill={`${color}30`} stroke={color} strokeWidth="1.4"/>
      ) : shape === 'dashed' ? (
        <circle r={4.4} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2.4,1.8"/>
      ) : shape === 'square' ? (
        <>
          <rect x={-4.6} y={-4.6} width={9.2} height={9.2} rx={2}
            fill={`${color}30`} stroke={color} strokeWidth="1.3"/>
          {glyph && (
            <text textAnchor="middle" dy={3} fontSize={7}
              fontFamily="JetBrains Mono, monospace" fill={color}>{glyph}</text>
          )}
        </>
      ) : (
        <circle r={4.4} fill={`${color}33`} stroke={color} strokeWidth="1.6"/>
      )}
    </svg>
  )
}

function repoLabel(repoPath: string): string {
  const name = repoPath.split('/').pop() ?? repoPath
  return name.endsWith('.git') ? name.slice(0, -4) : name
}

function isGithubBare(repoPath: string): boolean {
  return repoPath.includes('github-repos')
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function Sidebar({
  result, filterTypes, onFilterChange,
  recentRepos, currentRepoPath, onOpenRecent,
  selectedStruggleId, onSelectStruggle,
  selectedFilePath, onSelectFile,
  selectedZoneId, onSelectZone,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [width, setWidth] = useState(DEFAULT_W)
  const [collapsed, setCollapsed] = useState(false)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const toggleFilter = (type: string) => {
    const next = new Set(filterTypes)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    onFilterChange(next)
  }

  const startResize = useCallback((e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startW: width }
    e.preventDefault()
  }, [width])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current) return
      const next = dragRef.current.startW + (e.clientX - dragRef.current.startX)
      setWidth(Math.max(MIN_W, Math.min(MAX_W, next)))
    }
    const up = () => { dragRef.current = null }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])

  const zones = result?.graph.zones ?? []
  const struggles = result?.struggles ?? []
  const hotspots = result?.hotspots ?? []

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview',  label: '概要' },
    { id: 'struggles', label: '沼',   count: struggles.length },
    { id: 'hotspots',  label: '場所', count: hotspots.length },
    { id: 'repos',     label: '履歴', count: recentRepos.length },
  ]

  // 畳んだ状態: 40px のレール。1文字＋件数だけ出し、押すとその内容で開く
  if (collapsed) {
    return (
      <aside style={{
        width: RAIL_W, flexShrink: 0,
        background: 'var(--bg-panel)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '8px 0', gap: 4, overflow: 'hidden',
      }}>
        <button
          onClick={() => setCollapsed(false)}
          title="サイドバーを開く"
          style={{
            width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-secondary)', fontSize: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >»</button>
        <div style={{ width: 20, height: 1, background: 'var(--border)', margin: '4px 0' }} />
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setCollapsed(false) }}
              title={`${t.label}${t.count ? `（${t.count}）` : ''}`}
              style={{
                width: 28, padding: '5px 0', borderRadius: 6,
                border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
                background: active ? 'rgba(212,168,74,0.12)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 12, lineHeight: 1.2 }}>{TAB_GLYPH[t.id]}</span>
              {t.count !== undefined && t.count > 0 && (
                <span style={{ fontSize: 8.5, fontFamily: 'monospace', opacity: 0.75 }}>{t.count}</span>
              )}
            </button>
          )
        })}
      </aside>
    )
  }

  return (
    <aside style={{
      width, flexShrink: 0, position: 'relative',
      background: 'var(--bg-panel)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* タブ */}
      <div style={{
        display: 'flex', gap: 2, padding: '8px 6px 0',
        borderBottom: '1px solid var(--border)', alignItems: 'flex-start',
      }}>
        <button
          onClick={() => setCollapsed(true)}
          title="サイドバーを畳む（迷路が大きく映る）"
          style={{
            width: 20, height: 22, borderRadius: 5, border: 'none', background: 'transparent',
            color: 'var(--text-dim)', fontSize: 12, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >«</button>
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: '5px 4px 7px', background: 'none', border: 'none',
                borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                color: active ? 'var(--accent)' : 'var(--text-dim)',
                fontSize: 11, fontWeight: active ? 600 : 400, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                transition: 'color 0.12s',
              }}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span style={{ fontSize: 9.5, fontFamily: 'monospace', opacity: 0.7 }}>{t.count}</span>
              )}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {tab === 'overview' && result && (
          <>
            <Section title="統計">
              <StatRow label="コミット数" value={String(result.stats.totalCommits)} />
              <StatRow label="ブランチ数" value={String(result.stats.branchCount)} />
              <StatRow label="マージ"     value={String(result.stats.mergeCount)} />
              <StatRow label="リバート"   value={String(result.stats.revertCount)} />
              <StatRow label="バグ修正"   value={String(result.stats.errorFixCount)} />
              <StatRow label="WIP"        value={String(result.stats.wipCount)} />
              {result.stats.fileStatsCoverage < 1 && (
                <StatRow
                  label="差分の取得率"
                  value={`${Math.round(result.stats.fileStatsCoverage * 100)}%`}
                  warn={result.stats.fileStatsCoverage < 0.5}
                />
              )}
            </Section>

            <Section title="試行錯誤スコア">
              <ScoreCard score={result.score} />
            </Section>

            <Section title="働き方">
              <HourHistogram byHour={result.activity.byHour} />
              <StatRow label="稼働日数" value={`${result.activity.activeDays}日 / ${result.activity.spanDays}日`} />
              <StatRow label="稼働日あたり" value={`${result.activity.commitsPerActiveDay} コミット`} />
              <StatRow label="夜間(22-5時)" value={`${Math.round(result.activity.nightRatio * 100)}%`} warn={result.activity.nightRatio >= 0.35} />
              <StatRow label="週末" value={`${Math.round(result.activity.weekendRatio * 100)}%`} />
              <StatRow label="最長の連続稼働" value={`${result.activity.longestStreakDays}日`} />
              <StatRow label="最長の空白" value={`${result.activity.longestBreakDays}日`} />
              {result.activity.authors.length > 1 && (
                <StatRow label="著者数" value={String(result.activity.authors.length)} />
              )}
            </Section>

            {zones.length > 0 && (
              <Section title="開発フェーズ">
                {zones.map(zone => {
                  const meta = TYPE_META[zone.theme]
                  const icon = ZONE_ICON[zone.theme] ?? '📌'
                  // 元は filterTypes.has(zone.theme) だったので、同じ種別の
                  // フェーズが2区間あると両方が同時に点灯していた
                  const active = zone.id === selectedZoneId
                  return (
                    <button
                      key={zone.id}
                      onClick={() => onSelectZone(active ? null : zone)}
                      title={`${zone.label}（${zone.nodeCount}コミット / ${formatDate(zone.startTimestamp)}〜${formatDate(zone.endTimestamp)}）`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                        background: active ? `${meta.color}20` : 'none',
                        border: `1px solid ${active ? `${meta.color}60` : 'transparent'}`,
                        borderRadius: 6, padding: '4px 7px', cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontSize: 12, flexShrink: 0 }}>{icon}</span>
                      <span style={{ flex: 1, fontSize: 11, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {zone.label}
                      </span>
                      <span style={{ fontSize: 9.5, color: 'var(--text-dim)', fontFamily: 'monospace', flexShrink: 0 }}>
                        {formatDate(zone.startTimestamp)}〜
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace', flexShrink: 0 }}>
                        {zone.nodeCount}
                      </span>
                    </button>
                  )
                })}
              </Section>
            )}

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
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                      background: active ? meta.color + '20' : 'none',
                      border: `1px solid ${active ? meta.color + '60' : 'transparent'}`,
                      borderRadius: 6, padding: '5px 8px', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {/* 形も出す。⬤ のままだと形のチャネルが凡例にしか無く、
                        周辺作業4種が「同じ色の点」として並んでしまう */}
                    <TypeMark type={type} color={meta.color} />
                    <span style={{ flex: 1, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: 12 }}>
                      {meta.label}
                    </span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 11, fontFamily: 'monospace' }}>{count}</span>
                  </button>
                )
              })}
              {filterTypes.size > 0 && (
                <button onClick={() => onFilterChange(new Set())} style={{
                  width: '100%', background: 'none', border: 'none', color: 'var(--text-dim)',
                  fontSize: 11, cursor: 'pointer', padding: '4px', marginTop: 4, textAlign: 'center',
                }}>
                  クリア
                </button>
              )}
            </Section>
          </>
        )}

        {tab === 'struggles' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {struggles.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                詰まった箇所は検出されませんでした。
                {result && result.stats.fileStatsCoverage < 0.5 && (
                  <span style={{ color: '#C88B3A' }}>
                    {' '}ただしファイル差分が {Math.round(result.stats.fileStatsCoverage * 100)}% しか取れていないため、
                    ファイルに依る検出は効いていません（shallow clone）。
                  </span>
                )}
              </div>
            )}
            {struggles.map(e => {
              const active = e.id === selectedStruggleId
              const color = severityColor(e.severity)
              const meta = STRUGGLE_META[e.kind]
              return (
                <button
                  key={e.id}
                  onClick={() => onSelectStruggle(active ? null : e)}
                  title={e.evidence.join('\n')}
                  style={{
                    display: 'flex', gap: 7, width: '100%', textAlign: 'left',
                    background: active ? `${color}1E` : 'none',
                    border: `1px solid ${active ? `${color}70` : 'transparent'}`,
                    borderRadius: 7, padding: '7px 8px', cursor: 'pointer',
                  }}
                  onMouseEnter={ev => { if (!active) ev.currentTarget.style.background = `${color}12` }}
                  onMouseLeave={ev => { if (!active) ev.currentTarget.style.background = 'none' }}
                >
                  <span style={{ fontSize: 11, color, flexShrink: 0, marginTop: 1 }}>{meta.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'block', fontSize: 11.5, lineHeight: 1.4,
                      color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    }}>
                      {e.title}
                    </span>
                    <span style={{ display: 'block', fontSize: 9.5, color: 'var(--text-dim)', fontFamily: 'monospace', marginTop: 2 }}>
                      {meta.label} · {formatDate(e.startTimestamp)}〜{formatDate(e.endTimestamp)} · {e.commits.length}件
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                      <span style={{ flex: 1, height: 3, background: 'var(--bg-base)', borderRadius: 2, overflow: 'hidden' }}>
                        <span style={{ display: 'block', width: `${e.severity}%`, height: '100%', background: color }} />
                      </span>
                      <span style={{ fontSize: 9, color, fontFamily: 'monospace' }}>{e.severity}</span>
                    </span>
                    {e.escape && (
                      <span style={{ display: 'block', fontSize: 9.5, color: '#7B9E5A', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ↳ 抜けた: {e.escape.message}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
            {selectedStruggleId && (
              <button onClick={() => onSelectStruggle(null)} style={{
                width: '100%', background: 'none', border: 'none', color: 'var(--text-dim)',
                fontSize: 11, cursor: 'pointer', padding: '6px', textAlign: 'center',
              }}>
                強調を解除
              </button>
            )}
          </div>
        )}

        {tab === 'hotspots' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {hotspots.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                荒れているファイルは検出されませんでした。
              </div>
            )}
            {hotspots.map(h => (
              <HotspotRow
                key={h.path}
                hotspot={h}
                active={h.path === selectedFilePath}
                onClick={() => onSelectFile(h.path === selectedFilePath ? null : h.path)}
              />
            ))}
            {selectedFilePath && (
              <button onClick={() => onSelectFile(null)} style={{
                width: '100%', background: 'none', border: 'none', color: 'var(--text-dim)',
                fontSize: 11, cursor: 'pointer', padding: '6px', textAlign: 'center',
              }}>
                強調を解除
              </button>
            )}
          </div>
        )}

        {tab === 'repos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {recentRepos.slice(0, 10).map(repo => {
              const isCurrent = repo === currentRepoPath
              const isGH = isGithubBare(repo)
              return (
                <button
                  key={repo}
                  onClick={() => onOpenRecent(repo)}
                  title={repo}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                    background: isCurrent ? 'rgba(212,168,74,0.15)' : 'none',
                    border: `1px solid ${isCurrent ? 'rgba(212,168,74,0.4)' : 'transparent'}`,
                    borderRadius: 6, padding: '6px 7px', cursor: 'pointer',
                  }}
                >
                  {isGH ? (
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.7, flexShrink: 0, color: 'var(--text-secondary)' }}>
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0, color: 'var(--text-secondary)' }}>
                      <path d="M1 4.5A1.5 1.5 0 0 1 2.5 3h3l2 2h6A1.5 1.5 0 0 1 15 6.5v6A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-8z"/>
                    </svg>
                  )}
                  <span style={{
                    fontSize: 12, color: isCurrent ? 'var(--accent)' : 'var(--text-secondary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontWeight: isCurrent ? 600 : 400,
                  }}>
                    {repoLabel(repo)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 幅を変えるつまみ */}
      <div
        onMouseDown={startResize}
        title="ドラッグで幅を変える"
        style={{
          position: 'absolute', top: 0, right: -2, width: 5, height: '100%',
          cursor: 'col-resize', zIndex: 20,
        }}
      />
    </aside>
  )
}

function HotspotRow({ hotspot, active, onClick }: {
  hotspot: FileHotspot; active: boolean; onClick: () => void
}) {
  const color = severityColor(hotspot.risk)
  const name = hotspot.path.split('/').pop() ?? hotspot.path
  const dir = hotspot.path.slice(0, hotspot.path.length - name.length)

  return (
    <button
      onClick={onClick}
      title={`${hotspot.path}\n${hotspot.reasons.join('\n')}`}
      style={{
        display: 'flex', gap: 7, width: '100%', textAlign: 'left',
        background: active ? `${color}1E` : 'none',
        border: `1px solid ${active ? `${color}70` : 'transparent'}`,
        borderRadius: 7, padding: '6px 8px', cursor: 'pointer',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = `${color}12` }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none' }}
    >
      <span style={{
        flexShrink: 0, width: 26, textAlign: 'right',
        fontSize: 11, fontFamily: 'monospace', color, fontWeight: 600, marginTop: 1,
      }}>
        {hotspot.risk}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'block', fontSize: 11.5, color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </span>
        {dir && (
          <span style={{
            display: 'block', fontSize: 9, color: 'var(--text-dim)', fontFamily: 'monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left',
          }}>
            {dir}
          </span>
        )}
        <span style={{ display: 'block', fontSize: 9.5, color: 'var(--text-dim)', fontFamily: 'monospace', marginTop: 2 }}>
          変更{hotspot.commits} · 修正{hotspot.fixCommits}（{Math.round(hotspot.fixRatio * 100)}%）
          {hotspot.authors > 1 ? ` · ${hotspot.authors}人` : ''}
        </span>
      </span>
    </button>
  )
}

/** 24時間の分布。夜（22-5時）だけ色を変えて、生活のはみ出しが一目で分かるようにする */
function HourHistogram({ byHour }: { byHour: number[] }) {
  const max = Math.max(1, ...byHour)
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 34 }}>
        {byHour.map((n, h) => {
          const night = h >= 22 || h < 5
          return (
            <div
              key={h}
              title={`${h}時台: ${n}件`}
              style={{
                flex: 1,
                height: `${Math.max(2, (n / max) * 100)}%`,
                background: night ? '#C0624B' : 'var(--accent)',
                opacity: n === 0 ? 0.18 : night ? 0.85 : 0.6,
                borderRadius: 1,
              }}
            />
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8.5, color: 'var(--text-dim)', fontFamily: 'monospace', marginTop: 2 }}>
        <span>0時</span><span>6時</span><span>12時</span><span>18時</span><span>23時</span>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '0.02em',
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

function StatRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{label}</span>
      <span style={{
        color: warn ? '#C88B3A' : 'var(--text-primary)',
        fontFamily: 'monospace', fontWeight: 500, fontSize: 12,
      }}>
        {value}
      </span>
    </div>
  )
}
