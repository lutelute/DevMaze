import { MazeLogo, FolderIcon, GitHubIcon, GitBranchIcon, ScoreIcon, AlertIcon, PlugIcon } from './Icons'

interface Props {
  onOpen: () => void
  recentRepos: string[]
  onOpenRecent: (path: string) => void
}

const features = [
  { Icon: GitBranchIcon, text: 'Git 履歴グラフ + 迷路ビュー' },
  { Icon: ScoreIcon,     text: '試行錯誤スコア自動算出' },
  { Icon: AlertIcon,     text: 'エラー・リバート検出' },
  { Icon: PlugIcon,      text: 'Claude MCP サーバー対応' },
]

function repoName(path: string) {
  return path.split('/').pop()?.replace(/\.git$/, '') ?? path
}
function isGH(path: string) { return path.includes('github-repos') }

export default function WelcomeScreen({ onOpen, recentRepos, onOpenRecent }: Props) {
  return (
    <div style={{
      position: 'relative',
      display: 'flex', height: '100%', overflow: 'hidden',
    }}>

      {/* ── subtle background grid ─────────────────────── */}
      <svg style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none',
      }}>
        <defs>
          <pattern id="wgrid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0 L0 0 0 48" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.4"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#wgrid)"/>
        {/* radial fade mask */}
        <radialGradient id="fade" cx="50%" cy="50%" r="60%">
          <stop offset="0%"   stopColor="var(--bg-base)" stopOpacity="0"/>
          <stop offset="100%" stopColor="var(--bg-base)" stopOpacity="1"/>
        </radialGradient>
        <rect width="100%" height="100%" fill="url(#fade)"/>
      </svg>

      {/* ── main content ───────────────────────────────── */}
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', width: '100%', height: '100%',
        alignItems: 'stretch',
      }}>

        {/* Left column: hero */}
        <div style={{
          flex: '0 0 52%',
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center', alignItems: 'flex-start',
          padding: '0 48px 0 64px',
          borderRight: '1px solid var(--border)',
        }}>

          {/* Logo mark */}
          <div style={{ marginBottom: 24 }}>
            <MazeLogo size={52} color="var(--accent)" />
          </div>

          {/* App name */}
          <h1 style={{
            fontSize: 42, fontWeight: 800, letterSpacing: '-1.5px',
            color: 'var(--text-primary)', margin: 0, lineHeight: 1,
          }}>
            DevMaze
          </h1>

          {/* Tag line */}
          <p style={{
            margin: '10px 0 0', fontSize: 12,
            color: 'var(--text-dim)', letterSpacing: '1.8px',
            textTransform: 'uppercase', fontWeight: 500,
          }}>
            Git History Visualizer
          </p>

          {/* Accent rule */}
          <div style={{
            width: 40, height: 2, background: 'var(--accent)',
            borderRadius: 2, margin: '28px 0',
            opacity: 0.8,
          }} />

          {/* Feature list */}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 11 }}>
            {features.map(({ Icon, text }) => (
              <li key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Icon size={13} color="var(--accent)" style={{ opacity: 0.75, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.3 }}>
                  {text}
                </span>
              </li>
            ))}
          </ul>

          {/* CTA */}
          <div style={{ display: 'flex', gap: 8, marginTop: 40 }}>
            <button
              onClick={onOpen}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                background: 'var(--accent)', color: '#1A1107',
                border: 'none', borderRadius: 7,
                padding: '10px 20px', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', letterSpacing: '-0.1px',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              <FolderIcon size={13} color="#1A1107" />
              ローカルを開く
            </button>

            <button
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                background: 'transparent', color: 'var(--text-secondary)',
                border: '1px solid var(--border)', borderRadius: 7,
                padding: '10px 16px', fontSize: 13, fontWeight: 500,
                cursor: 'default', letterSpacing: '-0.1px',
                opacity: 0.6,
              }}
            >
              <GitHubIcon size={13} color="currentColor" />
              GitHub → ヘッダーから
            </button>
          </div>
        </div>

        {/* Right column: recent */}
        <div style={{
          flex: 1,
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 40px',
        }}>
          {recentRepos.length > 0 ? (
            <>
              <div style={{
                fontSize: 10, fontWeight: 600,
                color: 'var(--text-dim)', letterSpacing: '1.4px',
                textTransform: 'uppercase', marginBottom: 16,
              }}>
                最近使用
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {recentRepos.slice(0, 7).map(repo => (
                  <button
                    key={repo}
                    onClick={() => onOpenRecent(repo)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      background: 'transparent',
                      border: '1px solid transparent',
                      borderRadius: 7, padding: '9px 12px',
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'background 0.12s, border-color 0.12s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'var(--bg-panel)'
                      e.currentTarget.style.borderColor = 'var(--border)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.borderColor = 'transparent'
                    }}
                  >
                    {/* Icon */}
                    {isGH(repo) ? (
                      <GitHubIcon size={13} color="var(--text-dim)" style={{ flexShrink: 0 }} />
                    ) : (
                      <FolderIcon size={13} color="var(--text-dim)" style={{ flexShrink: 0 }} />
                    )}

                    {/* Name + path */}
                    <div style={{ overflow: 'hidden', flex: 1 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 500,
                        color: 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {repoName(repo)}
                      </div>
                      <div style={{
                        fontSize: 10, color: 'var(--text-dim)', marginTop: 1,
                        fontFamily: 'monospace',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {repo}
                      </div>
                    </div>

                    {/* Arrow */}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                      style={{ opacity: 0.25, flexShrink: 0 }}>
                      <path d="M4 2 L8 6 L4 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div style={{
              color: 'var(--text-dim)', fontSize: 12,
              textAlign: 'center', lineHeight: 1.8,
            }}>
              まだ開いたリポジトリがありません
              <br />
              左の「ローカルを開く」または
              <br />
              ヘッダーの GitHub から始めてください
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
