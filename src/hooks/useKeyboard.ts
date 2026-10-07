import { useEffect } from 'react'
import { useStore } from '@/store'

const inField = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/**
 * ⌘F 検索 / ⌘[ ⌘← 戻る / ⌘] ⌘→ さっきの場所へ / ← → 時系列 / Esc 手前から閉じる / ? ヘルプ
 * Esc を履歴の戻るに割り当てないのは、検索と GitHub 入力が既に使っているため。
 */
export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inField(e)) return
      const s = useStore.getState()
      const k = e.key.toLowerCase()

      if (e.metaKey || e.ctrlKey) {
        if (k === 'f') { e.preventDefault(); s.setSearchOpen(!s.searchOpen) }
        else if (k === '[' || k === 'arrowleft') { e.preventDefault(); s.goBack() }
        else if (k === ']' || k === 'arrowright') { e.preventDefault(); s.goForward() }
        return
      }
      if (e.altKey) return

      if (e.key === 'Escape') { s.escape(); return }
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); s.setHelpOpen(!s.helpOpen); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); s.stepSelection(-1); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); s.stepSelection(1); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
