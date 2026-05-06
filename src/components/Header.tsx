import { useState, useRef, useEffect } from 'react'
import { MazeLogo, GitHubIcon, FolderIcon, RefreshIcon } from './Icons'

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

export default function Header({
  repoName, onOpenRepo, onOpenGithub, onRecentRepo, onRefresh, recentRepos, fromCache,
}: Props) {
  const [showGithub, setShowGithub] = useState(false)
  const [githubInput, setGithubInput] = useState('')
  const [validation, setValidation] = useState<ValidationState>('idle')
  const githubRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // ポップアップの外クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (githubRef.current && !githubRef.current.contains(e.target as Node)) {
        setShowGithub(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (showGithub) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setGithubInput('')
      setValidation('idle')
    }
  }, [showGithub])

  // GitHub API でリアルタイム検証（500ms デバウンス）
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
        const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.name}`, {
          method: 'HEAD', signal: ac.signal,
        })
        setValidation(res.ok ? 'ok' : 'error')
      } catch {
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

  const borderColor =
    validation === 'ok' ? '#6AAF6A' :
    validation === 'error' ? '#EF4444' :
    validation === 'checking' ? '#A07840' :
    'var(--border)'

  return (
    <header style={{
      display: 'flex', alignItems: 'center',
      // macOS hiddenInset: 左78pxをウィンドウコントロール用に確保
      paddingLeft: 80, paddingRight: 12,
      height: 44,
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      WebkitAppRegion: 'drag',
      gap: 0,
    } as React.CSSProperties}>

      {/* ロゴ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        WebkitAppRegion: 'no-drag', flexShrink: 0,
      } as React.CSSProperties}>
        <MazeLogo size={18} />
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '-0.2px', color: 'var(--text-primary)' }}>
          DevMaze
        </span>
      </div>

      {/* セパレーター */}
      <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 12px', flexShrink: 0 }} />

      {/* リポジトリ名 + キャッシュバッジ */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', minWidth: 0 }}>
        {repoName ? (
          <>
            <span style={{
              fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {repoName}
            </span>
            {fromCache && (
              <span style={{
                fontSize: 10, color: 'var(--accent)',
                background: 'rgba(212,168,74,0.12)',
                border: '1px solid rgba(212,168,74,0.25)',
                padding: '0 5px', borderRadius: 3,
                whiteSpace: 'nowrap', flexShrink: 0, lineHeight: '16px',
              }}>
                cached
              </span>
            )}
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-dim, #5a5040)' }}>
            リポジトリを開く...
          </span>
        )}
      </div>

      {/* 右側アクション群 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}>

        {/* ↺ 強制再スキャン（リポジトリ表示中のみ） */}
        {repoName && onRefresh && (
          <IconBtn onClick={onRefresh} title="再スキャン">
            <RefreshIcon size={14} color="currentColor" />
          </IconBtn>
        )}

        {/* 区切り */}
        {repoName && onRefresh && (
          <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 4px' }} />
        )}

        {/* 🐙 GitHub */}
        <div ref={githubRef} style={{ position: 'relative' }}>
          <TextBtn onClick={() => setShowGithub(v => !v)} active={showGithub}>
            <GitHubIcon size={13} color="currentColor" />
            GitHub
          </TextBtn>

          {showGithub && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 6px)',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: 14, zIndex: 200, width: 290,
              boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10, letterSpacing: '0.3px' }}>
                GitHub リポジトリを開く
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  ref={inputRef}
                  value={githubInput}
                  onChange={e => setGithubInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitGithub(); if (e.key === 'Escape') setShowGithub(false) }}
                  placeholder="user/repo"
                  style={{
                    flex: 1, background: 'var(--bg-base)',
                    border: `1.5px solid ${borderColor}`,
                    borderRadius: 6, padding: '6px 9px',
                    color: 'var(--text-primary)', fontSize: 12,
                    fontFamily: 'monospace', outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                />
                <button
                  onClick={submitGithub}
                  disabled={validation !== 'ok'}
                  style={{
                    padding: '6px 12px', borderRadius: 6, border: 'none',
                    fontSize: 12, fontWeight: 500, cursor: validation === 'ok' ? 'pointer' : 'default',
                    background: validation === 'ok' ? 'var(--accent)' : 'var(--bg-hover)',
                    color: validation === 'ok' ? '#1A1107' : 'var(--text-dim, #6a5f4a)',
                    transition: 'all 0.15s', opacity: validation === 'checking' ? 0.5 : 1,
                  }}
                >
                  開く
                </button>
              </div>
              <div style={{
                marginTop: 8, fontSize: 10, lineHeight: 1.5,
                color: validation === 'ok' ? '#6AAF6A' : validation === 'error' ? '#EF4444' : 'var(--text-dim, #6a5f4a)',
              }}>
                {validation === 'idle' && 'user/repo 形式 または GitHub URL'}
                {validation === 'checking' && '確認中...'}
                {validation === 'ok' && '✓ 存在確認済み — commit メタのみ取得（最大 1000 件）'}
                {validation === 'error' && '✗ リポジトリが見つかりません'}
              </div>
            </div>
          )}
        </div>

        {/* セパレーター */}
        <div style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 4px' }} />

        {/* 開く（ローカル） */}
        <button
          onClick={onOpenRepo}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--accent)', color: '#1A1107',
            border: 'none', borderRadius: 6,
            padding: '5px 12px', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', letterSpacing: '-0.1px',
          }}
        >
          <FolderIcon size={12} color="#1A1107" />
          開く
        </button>
      </div>
    </header>
  )
}

// アイコンのみのボタン
function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: 6, border: 'none',
        background: hover ? 'var(--bg-hover)' : 'transparent',
        color: hover ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer', transition: 'all 0.12s', flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

// テキスト付きボタン
function TextBtn({ onClick, active, children }: { onClick: () => void; active?: boolean; children: React.ReactNode }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '5px 10px', borderRadius: 6, border: 'none',
        background: active || hover ? 'var(--bg-hover)' : 'transparent',
        color: active ? 'var(--text-primary)' : hover ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer', fontSize: 12, fontWeight: 500,
        transition: 'all 0.12s', flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}
