interface Props {
  onOpen: () => void
  recentRepos: string[]
  onOpenRecent: (path: string) => void
}

const features = [
  { icon: '🔀', text: 'Git 履歴を迷路グラフで可視化' },
  { icon: '🎯', text: '試行錯誤スコアを自動算出' },
  { icon: '🔴', text: 'エラー・リバートを自動検出' },
  { icon: '🔌', text: 'MCP サーバーとして Claude から呼び出し可能' },
]

export default function WelcomeScreen({ onOpen, recentRepos, onOpenRecent }: Props) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 32, padding: 40,
    }}>
      {/* Logo */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 8 }}>🌀</div>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
          DevMaze
        </div>
        <div style={{ color: 'var(--text-secondary)', marginTop: 6, fontSize: 14 }}>
          Development History Visualizer
        </div>
      </div>

      {/* Open button */}
      <button onClick={onOpen} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--accent)', color: '#fff', border: 'none',
        padding: '12px 28px', borderRadius: 8, cursor: 'pointer',
        fontWeight: 600, fontSize: 15, letterSpacing: '0.2px',
        transition: 'opacity 0.15s',
      }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      >
        <span>📂</span> リポジトリを開く
      </button>

      {/* Features */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', maxWidth: 480,
      }}>
        {features.map(f => (
          <div key={f.text} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--bg-panel)', borderRadius: 6,
            padding: '6px 12px', color: 'var(--text-secondary)', fontSize: 12,
            border: '1px solid var(--border-dim)',
          }}>
            <span>{f.icon}</span> {f.text}
          </div>
        ))}
      </div>

      {/* Recent repos */}
      {recentRepos.length > 0 && (
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            最近開いたリポジトリ
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recentRepos.slice(0, 5).map(repo => (
              <button key={repo} onClick={() => onOpenRecent(repo)} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--bg-panel)', border: '1px solid var(--border-dim)',
                borderRadius: 6, padding: '8px 12px', cursor: 'pointer',
                color: 'var(--text-secondary)', fontSize: 12, textAlign: 'left',
                transition: 'border-color 0.15s, color 0.15s',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--accent)'
                  e.currentTarget.style.color = 'var(--text-primary)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border-dim)'
                  e.currentTarget.style.color = 'var(--text-secondary)'
                }}
              >
                <span style={{ opacity: 0.5 }}>📁</span>
                <span style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {repo}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
