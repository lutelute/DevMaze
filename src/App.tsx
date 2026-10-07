import { useEffect } from 'react'
import s from './App.module.css'
import { useStore } from '@/store'
import { useFocusLabel } from '@/store/selectors'
import { useKeyboard } from '@/hooks/useKeyboard'
import { useRepoWatch } from '@/hooks/useRepoWatch'
import { Kbd } from '@/components/ui'
import Header from '@/components/layout/Header'
import Sidebar from '@/components/layout/Sidebar'
import Welcome from '@/components/screens/Welcome'
import Loading from '@/components/screens/Loading'
import ErrorScreen from '@/components/screens/ErrorScreen'
import MazeView from '@/components/maze/MazeView'
import CalendarView from '@/components/calendar/CalendarView'
import DetailPane from '@/components/detail/DetailPane'
import SearchPanel from '@/components/search/SearchPanel'

export default function App() {
  const phase = useStore(st => st.phase)
  const viewMode = useStore(st => st.viewMode)
  const searchOpen = useStore(st => st.searchOpen)
  const helpOpen = useStore(st => st.helpOpen)
  const toast = useStore(st => st.toast)
  const selectedHash = useStore(st => st.selectedHash)
  const init = useStore(st => st.init)
  const setViewMode = useStore(st => st.setViewMode)

  useEffect(() => init(), [init])
  useKeyboard()
  useRepoWatch()

  return (
    <div className={s.app}>
      <Header />
      <div className={s.main}>
        <Sidebar />
        <div className={s.canvas}>
          {phase.phase === 'idle' && <Welcome />}
          {phase.phase === 'loading' && <Loading progress={phase.progress} />}
          {phase.phase === 'error' && <ErrorScreen message={phase.message} target={phase.target} retry={phase.retry} />}
          {phase.phase === 'ready' && (
            <>
              <NavBar />
              <div className={s.viewToggle}>
                {(['maze', 'calendar'] as const).map(m => (
                  <button key={m} className={s.viewBtn} data-active={viewMode === m ? 'true' : undefined} onClick={() => setViewMode(m)}>
                    {m === 'maze' ? '迷路' : '暦'}
                  </button>
                ))}
              </div>
              {viewMode === 'maze' ? <MazeView /> : <CalendarView />}
            </>
          )}
          {toast && <div className={s.toast} role="status">{toast}</div>}
        </div>
        {phase.phase === 'ready' && selectedHash && <DetailPane />}
      </div>
      {searchOpen && phase.phase === 'ready' && <SearchPanel />}
      {helpOpen && <Help />}
    </div>
  )
}

/** 戻る + いまどこ */
function NavBar() {
  const past = useStore(st => st.past.length)
  const ahead = useStore(st => !!st.ahead)
  const label = useFocusLabel()
  const { goBack, goForward, clearFocus } = useStore.getState()
  if (past === 0 && !label && !ahead) return null
  return (
    <div className={s.navBar}>
      <button className={s.navBtn} onClick={goBack} disabled={past === 0} title={past ? `戻る（⌘[）· 残り ${past}` : '戻れる場所がありません'}>←</button>
      {label ? (
        <>
          <span className={`${s.focusChip} truncate`}>{label}</span>
          <button className={s.focusClear} onClick={clearFocus} title="注目を解除して全体へ">✕</button>
        </>
      ) : <span className={s.navAll}>全体</span>}
      {ahead && <button className={s.fwd} onClick={goForward} title="さっきの場所へ（⌘]）">さっきの場所へ →</button>}
    </div>
  )
}

const KEYS = [
  ['← →', '時系列を1つ前後へ（注目中はその中だけ）'],
  ['⌘[ / ⌘←', '戻る'],
  ['⌘] / ⌘→', 'さっきの場所へ'],
  ['⌘F', 'コミットを検索'],
  ['Esc', '手前から1つ閉じる（検索 → 詳細 → 注目）'],
  ['?', 'この一覧'],
] as const

function Help() {
  const setHelpOpen = useStore(st => st.setHelpOpen)
  return (
    <div className={s.helpBackdrop} onClick={() => setHelpOpen(false)}>
      <div className={s.help} onClick={e => e.stopPropagation()}>
        <div className={s.helpTitle}>キーボード操作</div>
        <div className={s.helpGrid}>
          {KEYS.map(([k, d]) => (<><Kbd key={k}>{k}</Kbd><span key={`${k}d`} className={s.helpDesc}>{d}</span></>))}
        </div>
        <div className={s.helpFoot}>クリックか Esc で閉じる</div>
      </div>
    </div>
  )
}
