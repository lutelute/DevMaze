import s from './panels.module.css'
import l from '@/components/layout/layout.module.css'
import { Row, RowMain, RowTitle, RowSub, repoLabel, isGithubCache } from '@/components/ui'
import { GitHubIcon, FolderIcon } from '@/components/ui/Icons'
import { useStore } from '@/store'

export default function Repos() {
  const recent = useStore(st => st.recentRepos)
  const current = useStore(st => st.repoPath)
  const openLocal = useStore(st => st.openLocal)
  if (recent.length === 0) return <div className={l.empty}>まだ開いたリポジトリがありません。</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {recent.map(p => (
        <Row key={p} active={p === current} title={p} onClick={() => openLocal(p)}>
          <span className={s.repoIcon}>{isGithubCache(p) ? <GitHubIcon size={12} /> : <FolderIcon size={12} />}</span>
          <RowMain>
            <RowTitle className="truncate">{repoLabel(p)}</RowTitle>
            <RowSub className={`truncate ${s.dir}`}>{p}</RowSub>
          </RowMain>
        </Row>
      ))}
    </div>
  )
}
