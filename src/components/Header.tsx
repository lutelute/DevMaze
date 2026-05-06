import { useState, useRef, useEffect } from 'react'

interface Props {
  repoName?: string
  onOpenRepo: () => void
  onOpenGithub: (input: string) => void
  onRecentRepo: (path: string) => void
  onRefresh?: () => void
  recentRepos: string[]
  fromCache?: boolean
}

type ValidationState = 'idle' | 'checking' | 'ok' | 'error'

function parseGithubShorthand(input: string): { owner: string; name: string } | null {
  const s = input.trim().replace(/\.git$/, '')
  const short = s.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/)
  if (short) return { owner: short[1], name: short[2] }
  const url = s.match(/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\/.*)?$/)
  if (url) return { owner: url[1], name: url[2] }
  return null
}

const validationColor: Record<ValidationState, string> = {
  idle: 'var(--border)',
  checking: '#A07840',
  ok: '#6AAF6A',
  error: '#EF4444',
}

const validationHint: Record<ValidationState, string> = {
  idle: 'user/repo 形式または GitHub URL',
  checking: '確認中...',
  ok: '✓ リポジトリを確認しました（commitのみ取得、ファイルなし、最大1000件）',
  error: '✗ リポジトリが見つかりません',
}

export default function Header({
  repoName, onOpenRepo, onOpenGithub, onRecentRepo, onRefresh, recentRepos, fromCache,
}: Props) {
  const [showRecent, setShowRecent] = useState(false)
  const [showGithub, setShowGithub] = useState(false)
  const [githubInput, setGithubInput] = useState('')
  const [validation, setValidation] = useState<ValidationState>('idle')
  const dropRef = useRef<HTMLDivElement>(null)
  const githubRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowRecent(false)
      if (githubRef.current && !githubRef.current.contains(e.target as Node)) setShowGithub(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (showGithub) setTimeout(() => inputRef.current?.focus(), 50)
    else {
      setGithubInput('')
      setValidation('idle')
    }
  }, [showGithub])

  // リアルタイム検証：入力 500ms 後に GitHub API で存在確認
  useEffect(() => {
    abortRef.current?.abort()
    const trimmed = githubInput.trim()

    if (!trimmed) { setValidation('idle'); return }

    const parsed = parseGithubShorthand(trimmed)
    if (!parsed) { setValidation('error'); return }

    setValidation('checking')
    const ac = new AbortController()
    abortRef.current = ac

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${parsed.owner}/${parsed.name}`,
          { method: 'HEAD', signal: ac.signal }
        )
        setValidation(res.ok ? 'ok' : 'error')
      } catch {
        // ネットエラー or abort → 判定しない
        if (!ac.signal.aborted) setValidation('idle')
      }
    }, 500)

    return () => { clearTimeout(timer); ac.abort() }
  }, [githubInput])

  const submitGithub = () => {
    if (!githubInput.trim() || validation === 'error' || validation === 'checking') return
    setShowGithub(false)
    onOpenGithub(githubInput.trim())
  }

  return (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 16px', height: 48,
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

      <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

      {/* Repo name + cache badge */}
      {repoName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', flex: 1 }}>
          <div style={{
            fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {repoName}
          </div>
          {fromCache && (
            <span style={{
              fontSize: 10, color: 'var(--accent)', background: 'rgba(212,168,74,0.15)',
              padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              キャッシュ
            </span>
          )}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Refresh */}
      {repoName && onRefresh && (
        <button onClick={onRefresh} title="強制再スキャン"
          style={{ ...btnStyle, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          ↺ 更新
        </button>
      )}

      {/* GitHub shorthand */}
      <div ref={githubRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button onClick={() => setShowGithub(v => !v)} style={btnStyle}>
          🐙 GitHub
        </button>

        {showGithub && (
          <div style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 6,
            background: 'var(--bg-panel)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '14px 14px 12px', zIndex: 100, minWidth: 300,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>
              GitHub リポジトリを開く
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input
                ref={inputRef}
                value={githubInput}
                onChange={e => setGithubInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitGithub()
                  if (e.key === 'Escape') setShowGithub(false)
                }}
                placeholder="user/repo"
                style={{
                  flex: 1,
                  background: 'var(--bg-base)',
                  border: `1.5px solid ${validationColor[validation]}`,
                  borderRadius: 5, padding: '5px 8px',
                  color: 'var(--text-primary)',
                  fontSize: 12, fontFamily: 'monospace', outline: 'none',
                  transition: 'border-color 0.2s',
                }}
              />
              <button
                onClick={submitGithub}
                disabled={validation !== 'ok'}
                style={{
                  ...btnStyle,
                  background: validation === 'ok' ? 'var(--accent)' : 'var(--bg-hover)',
                  color: validation === 'ok' ? '#1A1107' : 'var(--text-secondary)',
                  padding: '5px 10px',
                  cursor: validation === 'ok' ? 'pointer' : 'not-allowed',
                  opacity: validation === 'checking' ? 0.6 : 1,
                }}
              >
                開く
              </button>
            </div>

            {/* 検証メッセージ */}
            <div style={{
              fontSize: 10,
              color: validation === 'ok' ? '#6AAF6A'
                : validation === 'error' ? '#EF4444'
                : 'var(--text-secondary, #7a6f5a)',
              lineHeight: 1.5,
              minHeight: 14,
            }}>
              {validationHint[validation]}
            </div>
          </div>
        )}
      </div>

      {/* Recent */}
      {recentRepos.length > 0 && (
        <div ref={dropRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button onClick={() => setShowRecent(v => !v)} style={btnStyle}>
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

      {/* Open local */}
      <button onClick={onOpenRepo}
        style={{ ...btnStyle, background: 'var(--accent)', color: '#1A1107', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
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
