import s from './screens.module.css'
import { Button, repoLabel, isGithubCache } from '@/components/ui'
import { MazeLogo, FolderIcon, GitHubIcon, GitBranchIcon, ScoreIcon, AlertIcon, PlugIcon } from '@/components/ui/Icons'
import { useStore } from '@/store'

const FEATURES = [
  { Icon: GitBranchIcon, text: '履歴を迷路として読む。塊・空白・枝' },
  { Icon: AlertIcon, text: '沼（詰まった箇所）とホットスポットの抽出' },
  { Icon: ScoreIcon, text: '試行錯誤スコアと働き方' },
  { Icon: PlugIcon, text: 'MCP サーバーとナレッジ出力（RAG / GraphRAG）' },
]

export default function Welcome() {
  const recent = useStore(st => st.recentRepos)
  const openLocal = useStore(st => st.openLocal)
  return (
    <div className={s.welcome}>
      <svg className={s.grid} aria-hidden>
        <defs>
          <pattern id="wgrid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0 L0 0 0 48" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.4" />
          </pattern>
          <radialGradient id="wfade" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="var(--bg-base)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--bg-base)" stopOpacity="1" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#wgrid)" />
        <rect width="100%" height="100%" fill="url(#wfade)" />
      </svg>

      <div className={s.hero}>
        <MazeLogo size={52} color="var(--accent)" />
        <h1 className={s.title}>DevMaze</h1>
        <p className={s.tagline}>Git history visualizer</p>
        <div className={s.rule} />
        <ul className={s.features}>
          {FEATURES.map(({ Icon, text }) => (
            <li key={text} className={s.feature}><Icon size={13} color="var(--accent)" style={{ opacity: 0.8 }} />{text}</li>
          ))}
        </ul>
        <div className={s.cta}>
          <Button variant="primary" onClick={() => openLocal()} style={{ height: 36, padding: '0 20px', fontSize: 13 }}>
            <FolderIcon size={13} color="var(--text-inverse)" />ローカルを開く
          </Button>
          <Button variant="outline" disabled style={{ height: 36, padding: '0 16px', fontSize: 13, opacity: 0.7 }}>
            <GitHubIcon size={13} />GitHub はヘッダーから
          </Button>
        </div>
      </div>

      <div className={s.recent}>
        {recent.length > 0 ? (
          <>
            <div className={s.recentTitle}>最近使用</div>
            <div className={s.recentList}>
              {recent.slice(0, 7).map(p => (
                <button key={p} className={s.recentItem} onClick={() => openLocal(p)}>
                  {isGithubCache(p) ? <GitHubIcon size={13} color="var(--text-dim)" /> : <FolderIcon size={13} color="var(--text-dim)" />}
                  <div style={{ overflow: 'hidden', flex: 1 }}>
                    <div className={`${s.recentName} truncate`}>{repoLabel(p)}</div>
                    <div className={`${s.recentPath} truncate`}>{p}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className={s.recentEmpty}>まだ開いたリポジトリがありません<br />左の「ローカルを開く」か、ヘッダーの GitHub から</div>
        )}
      </div>
    </div>
  )
}
