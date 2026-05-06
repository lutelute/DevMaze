import { useState, useRef, useEffect } from 'react'

interface Props {
  repoName?: string
  onOpenRepo: () => void
  onRecentRepo: (path: string) => void
  recentRepos: string[]
}

export default function Header({ repoName, onOpenRepo, onRecentRepo, recentRepos }: Props) {
  const [showRecent, setShowRecent] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setShowRecent(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 16px',
      height: 48,
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      WebkitAppRegion: 'drag',
    } as React.CSSProperties}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <span style={{ fontSize: 18 }}>🌀</span>
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.3px' }}>DevMaze</span>
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

      {/* Repo name */}
      {repoName && (
        <div style={{
          fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>
          {repoName}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Recent dropdown */}
      {recentRepos.length > 0 && (
        <div ref={dropRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => setShowRecent(v => !v)}
            style={btnStyle}
          >
            最近使用 ▾
          </button>
          {showRecent && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', marginTop: 4,
              background: 'var(--bg-panel)', border: '1px solid var(--border)',
              borderRadius: 8, overflow: 'hidden', zIndex: 100, minWidth: 300,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {recentRepos.slice(0, 8).map(repo => (
                <button key={repo} onClick={() => { onRecentRepo(repo); setShowRecent(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '8px 12px', background: 'none', border: 'none',
                    color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
                    fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    transition: 'background 0.1s, color 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)' }}
                >
                  📁 {repo}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Open button */}
      <button onClick={onOpenRepo} style={{ ...btnStyle, background: 'var(--accent)', color: '#fff', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        📂 開く
      </button>
    </header>
  )
}

const btnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  background: 'var(--bg-hover)', border: 'none', color: 'var(--text-secondary)',
  padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
  fontWeight: 500, transition: 'background 0.15s, color 0.15s',
}
