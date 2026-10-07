import { useEffect } from 'react'
import { api } from '@/api'
import { useStore } from '@/store'

/**
 * 開いているリポジトリの変化を2経路で見る。
 * - 手元: chokidar が HEAD/refs の変化を知らせる → 「再読み込み」バナー
 * - リモート: 5分ごとに ls-remote → 「取り込む」バナー
 * 手元のファイル監視だけでは、GitHub 側に積まれたコミットには永久に気づけない。
 */
export function useRepoWatch(): void {
  const repoPath = useStore(s => s.repoPath)
  const phase = useStore(s => s.phase.phase)

  useEffect(() => {
    if (!repoPath || phase !== 'ready') { api.send('watch:stop'); return }
    api.send('watch:start', repoPath)
    const off = api.on('watch:changed', () => useStore.getState().setWatchBanner(true))
    return () => { off(); api.send('watch:stop') }
  }, [repoPath, phase])

  useEffect(() => {
    if (!repoPath || phase !== 'ready') return
    let alive = true
    const check = async () => {
      try {
        const r = await api.invoke('repo:checkRemote', repoPath)
        if (alive && !r.error) useStore.getState().setRemoteBehind(r.behind)
      } catch { /* 通信できなくても画面は動く */ }
    }
    check()
    const timer = setInterval(check, 5 * 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [repoPath, phase])

  // トーストは「…中」で終わるもの以外、5秒で消える
  const toast = useStore(s => s.toast)
  useEffect(() => {
    if (!toast || toast.endsWith('中...')) return
    const t = setTimeout(() => useStore.getState().setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])
}
