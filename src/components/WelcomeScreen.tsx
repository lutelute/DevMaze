import { MazeLogo, FolderIcon, GitBranchIcon, ScoreIcon, AlertIcon, PlugIcon } from './Icons'

interface Props {
  onOpen: () => void
  recentRepos: string[]
  onOpenRecent: (path: string) => void
}

const features = [
  { Icon: GitBranchIcon, text: 'Git 履歴を迷路グラフで可視化' },
  { Icon: ScoreIcon,     text: '試行錯誤スコアを自動算出' },
  { Icon: AlertIcon,     text: 'エラー・リバートを自動検出' },
  { Icon: PlugIcon,      text: 'MCP サーバーとして Claude から呼び出し可能' },
]

function isGithubBare(path: string) { return path.includes('github-repos') }

export default function WelcomeScreen({ onOpen, recentRepos, onOpenRecent }: Props) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 36, padding: 40,
    }}>

      {/* Logo */}
      <div style={{ textAlign: 'center' }}>
        <MazeLogo size={64} style={{ marginBottom: 16 }} />
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.8px', color: 'var(--text-primary)' }}>
          DevMaze
        </div>
        <div style={{ color: 'var(--text-dim)', marginTop: 5, fontSize: 13, letterSpacing: '0.2px' }}>
          Development History Visualizer
        </div>
      </div>

      {/* Open button */}
      <button
        onClick={onOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--accent)', color: '#1A1107', border: 'none',
          padding: '11px 28px', borderRadius: 8, cursor: 'pointer',
          fontWeight: 600, fontSize: 14, letterSpacing: '0.1px',
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      >
        <FolderIcon size={15} color="#1A1107" />
        リポジトリを開く
      </button>

      {/* Feature badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 500 }}>
        {features.map(({ Icon, text }) => (
          <div key={text} style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: 'var(--bg-panel)', borderRadius: 6,
            padding: '6px 12px', fontSize: 12,
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
          }}>
            <Icon size={12} color="var(--accent)" />
            {text}
          </div>
        ))}
      </div>

      {/* Recent repos */}
      {recentRepos.length > 0 && (
        <div style={{ width: '100%', maxWidth: 460 }}>
          <div style={{
            color: 'var(--text-dim)', fontSize: 10, marginBottom: 8,
            textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600,
          }}>
            最近開いたリポジトリ
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recentRepos.slice(0, 5).map(repo => {
              const isGH = isGithubBare(repo)
              const name = repo.split('/').pop()?.replace(/\.git$/, '') ?? repo
              return (
                <button key={repo} onClick={() => onOpenRecent(repo)} style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)',
                  borderRadius: 6, padding: '8px 12px', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: 12, textAlign: 'left',
                  transition: 'border-color 0.12s, color 0.12s',
                }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'rgba(212,168,74,0.4)'
                    e.currentTarget.style.color = 'var(--text-primary)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)'
                    e.currentTarget.style.color = 'var(--text-secondary)'
                  }}
                >
                  {isGH ? (
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                  ) : (
                    <FolderIcon size={11} color="currentColor" style={{ opacity: 0.5, flexShrink: 0 }} />
                  )}
                  <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{name}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, opacity: 0.35,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                    {repo}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
