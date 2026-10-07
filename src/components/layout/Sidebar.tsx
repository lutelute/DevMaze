import { useCallback, useEffect, useRef } from 'react'
import s from './layout.module.css'
import { useStore } from '@/store'
import { useResult } from '@/store/selectors'
import type { SidebarTab } from '@/store/types'
import Overview from '@/components/panels/Overview'
import Struggles from '@/components/panels/Struggles'
import Hotspots from '@/components/panels/Hotspots'
import Repos from '@/components/panels/Repos'

// 畳んだレールに出す1文字。タブのラベルの頭
const GLYPH: Record<SidebarTab, string> = { overview: '概', struggles: '沼', hotspots: '場', repos: '歴' }

export default function Sidebar() {
  const result = useResult()
  const tab = useStore(st => st.sidebarTab)
  const collapsed = useStore(st => st.sidebarCollapsed)
  const width = useStore(st => st.sidebarWidth)
  const recentCount = useStore(st => st.recentRepos.length)
  const { setSidebarTab, setSidebarCollapsed, setSidebarWidth } = useStore.getState()
  const drag = useRef<{ x: number; w: number } | null>(null)

  const tabs: { id: SidebarTab; label: string; count?: number }[] = [
    { id: 'overview', label: '概要' },
    { id: 'struggles', label: '沼', count: result?.struggles.length },
    { id: 'hotspots', label: '場所', count: result?.hotspots.length },
    { id: 'repos', label: '履歴', count: recentCount },
  ]

  const startResize = useCallback((e: React.MouseEvent) => {
    drag.current = { x: e.clientX, w: width }
    e.preventDefault()
  }, [width])

  useEffect(() => {
    const move = (e: MouseEvent) => { if (drag.current) setSidebarWidth(drag.current.w + e.clientX - drag.current.x) }
    const up = () => { drag.current = null }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [setSidebarWidth])

  // 畳んだ状態: 44px のレール。押すとその内容で開く（迷路が 220px ぶん広く映る）
  if (collapsed) {
    return (
      <aside className={s.rail}>
        <button className={s.railBtn} onClick={() => setSidebarCollapsed(false)} title="サイドバーを開く">
          <span className={s.railGlyph}>»</span>
        </button>
        <div className={s.railSep} />
        {tabs.map(t => (
          <button key={t.id} className={s.railBtn} data-active={tab === t.id ? 'true' : undefined}
            onClick={() => setSidebarTab(t.id)} title={`${t.label}${t.count ? `（${t.count}）` : ''}`}>
            <span className={s.railGlyph}>{GLYPH[t.id]}</span>
            {t.count ? <span className={s.railCount}>{t.count}</span> : null}
          </button>
        ))}
      </aside>
    )
  }

  return (
    <aside className={s.sidebar} style={{ width }}>
      <div className={s.tabs}>
        <button className={s.collapseBtn} onClick={() => setSidebarCollapsed(true)} title="サイドバーを畳む（迷路が大きく映る）">«</button>
        {tabs.map(t => (
          <button key={t.id} className={s.tab} data-active={tab === t.id ? 'true' : undefined} onClick={() => setSidebarTab(t.id)}>
            {t.label}
            {t.count ? <span className={s.tabCount}>{t.count}</span> : null}
          </button>
        ))}
      </div>
      <div className={s.body}>
        {tab === 'overview' && <Overview />}
        {tab === 'struggles' && <Struggles />}
        {tab === 'hotspots' && <Hotspots />}
        {tab === 'repos' && <Repos />}
      </div>
      <div className={s.resizer} onMouseDown={startResize} title="ドラッグで幅を変える" />
    </aside>
  )
}
