import s from './panels.module.css'
import l from '@/components/layout/layout.module.css'
import { Row, RowMain, RowTitle, RowSub } from '@/components/ui'
import { useStore } from '@/store'
import { useResult } from '@/store/selectors'
import { severityColor } from '@shared/theme'

export default function Hotspots() {
  const result = useResult()
  const focus = useStore(st => st.focus)
  const selectFile = useStore(st => st.selectFile)
  if (!result) return <div className={l.empty}>リポジトリを開くと、荒れているファイルがここに並びます。</div>
  if (result.hotspots.length === 0) return <div className={l.empty}>荒れているファイルは検出されませんでした。</div>

  const active = focus?.kind === 'file' ? focus.path : undefined
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {result.hotspots.map(h => {
        const color = severityColor(h.risk)
        const name = h.path.split('/').pop() ?? h.path
        const dir = h.path.slice(0, h.path.length - name.length)
        const on = h.path === active
        return (
          <Row key={h.path} active={on} color={color} title={`${h.path}\n${h.reasons.join('\n')}`} onClick={() => selectFile(on ? null : h.path)}>
            <span className={s.risk}>{h.risk}</span>
            <RowMain>
              <RowTitle className="truncate">{name}</RowTitle>
              {dir && <RowSub className={`truncate ${s.dir}`}>{dir}</RowSub>}
              <RowSub>変更{h.commits} · 修正{h.fixCommits}（{Math.round(h.fixRatio * 100)}%）{h.authors > 1 ? ` · ${h.authors}人` : ''}</RowSub>
            </RowMain>
          </Row>
        )
      })}
      {active && <button className={l.clearBtn} onClick={() => selectFile(null)}>強調を解除</button>}
    </div>
  )
}
