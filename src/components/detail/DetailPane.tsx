import type { CSSProperties } from 'react'
import s from './detail.module.css'
import { Badge, Button } from '@/components/ui'
import { useStore } from '@/store'
import { useResult, useSelectedNode, useNodeStruggles } from '@/store/selectors'
import { api } from '@/api'
import { COMMIT_TYPE, STRUGGLE_META } from '@shared/theme'

/** git のリモート URL（SSH / HTTPS）から GitHub の owner/repo を取り出す */
function githubSlug(remoteUrl?: string): string | null {
  if (!remoteUrl) return null
  const m = remoteUrl.match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/)
  return m ? `${m[1]}/${m[2]}` : null
}

export default function DetailPane() {
  const result = useResult()
  const node = useSelectedNode()
  const struggles = useNodeStruggles()
  const { selectHash, selectStruggle, selectFile } = useStore.getState()
  if (!node || !result) return null

  const meta = COMMIT_TYPE[node.type] ?? COMMIT_TYPE.normal
  const slug = githubSlug(result.remoteUrl)
  const risk = new Map(result.hotspots.map(h => [h.path, h.risk]))
  const open = (url: string) => api.invoke('shell:openExternal', url)
  const milestone = node.isMilestone
    ? { tag: ['★ タグ', 'var(--accent)'], version: ['★ バージョン', 'var(--accent)'], large_change: ['⚡ 大規模変更', 'var(--danger)'] }[node.milestoneReason ?? 'tag']
    : null

  return (
    <aside className={s.pane} style={{ '--msg-color': meta.hex } as CSSProperties}>
      <div className={s.head}>
        <div className={s.headTags}>
          <Badge color={meta.hex}>{meta.label}</Badge>
          {milestone && <Badge color={milestone[1]}>{milestone[0]}</Badge>}
          <span className={s.hash}>{node.label}</span>
        </div>
        <button className={s.close} onClick={() => selectHash(null)} title="閉じる（Esc）">×</button>
      </div>

      <div className={s.body}>
        <div>
          <div className={s.label}>コミットメッセージ</div>
          <div className={s.message}>{node.message}</div>
        </div>

        <div>
          <div className={s.label}>著者・日時</div>
          <div className={s.value}>{node.authorName}</div>
          <div className={s.value}>{new Date(node.timestamp).toLocaleString('ja-JP')}</div>
        </div>

        <div>
          <div className={s.label}>ハッシュ</div>
          <div className={`${s.value} ${s.mono}`}>{node.id}</div>
          {slug && <Button size="sm" variant="outline" className={s.link} onClick={() => open(`https://github.com/${slug}/commit/${node.id}`)}>GitHub で開く ↗</Button>}
        </div>

        {node.refs.length > 0 && (
          <div>
            <div className={s.label}>PR / Issue</div>
            <div className={s.tagRow}>
              {node.refs.map(n => (
                <button key={n} onClick={() => slug && open(`https://github.com/${slug}/pull/${n}`)} title={slug ? `${slug} の #${n} を開く` : `#${n}`}>
                  <Badge mono color="#7A9BB8">#{n}</Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {(node.filesChanged > 0 || node.insertions > 0) && (
          <div>
            <div className={s.label}>変更量</div>
            <div className={s.stats}>
              <div className={s.stat}><span className={s.statNum} style={{ color: 'var(--text-secondary)' }}>{node.filesChanged}</span><span className={s.statLbl}>files</span></div>
              <div className={s.stat}><span className={s.statNum} style={{ color: 'var(--ok)' }}>+{node.insertions}</span><span className={s.statLbl}>lines</span></div>
              <div className={s.stat}><span className={s.statNum} style={{ color: 'var(--danger)' }}>−{node.deletions}</span><span className={s.statLbl}>lines</span></div>
            </div>
          </div>
        )}

        {struggles.length > 0 && (
          <div>
            <div className={s.label}>このコミットが属する沼</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {struggles.map(e => (
                <button key={e.id} className={s.struggle} onClick={() => selectStruggle(e)}>
                  <div className={s.struggleTitle}>{e.title}</div>
                  <div className={s.struggleSub}>{STRUGGLE_META[e.kind].label} · 深刻度 {e.severity} · {e.commits.length}コミット</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {node.files.length > 0 && (
          <div>
            <div className={s.label}>変更ファイル（{node.files.length}）</div>
            <div className={s.files}>
              {node.files.slice(0, 60).map(f => {
                const r = risk.get(f)
                return (
                  <button key={f} className={s.file} title={`${f}\nクリックでこのファイルの履歴を辿る`} onClick={() => selectFile(f)}>
                    <span className={`${s.filePath} truncate`}>{f}</span>
                    {r !== undefined && <Badge mono color={r >= 50 ? 'var(--danger)' : 'var(--warn)'} title={`ホットスポット risk ${r}`}>risk {r}</Badge>}
                  </button>
                )
              })}
              {node.files.length > 60 && <div className={s.more}>… 他 {node.files.length - 60} 件</div>}
            </div>
          </div>
        )}

        {node.branchNames.length > 0 && (
          <div>
            <div className={s.label}>ブランチ</div>
            <div className={s.tagRow}>{node.branchNames.map(b => <Badge key={b} mono color="#6A93C8">{b}</Badge>)}</div>
          </div>
        )}
        {node.tagNames.length > 0 && (
          <div>
            <div className={s.label}>タグ</div>
            <div className={s.tagRow}>{node.tagNames.map(t => <Badge key={t} mono color="var(--accent)">{t}</Badge>)}</div>
          </div>
        )}
      </div>
    </aside>
  )
}
