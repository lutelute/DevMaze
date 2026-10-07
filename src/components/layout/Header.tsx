import { useEffect, useRef, useState } from 'react'
import s from './layout.module.css'
import { Button, IconButton, Badge } from '@/components/ui'
import { MazeLogo, GitHubIcon, FolderIcon, RefreshIcon } from '@/components/ui/Icons'
import { useStore } from '@/store'
import { useResult, useFromCache } from '@/store/selectors'
import { api } from '@/api'
import type { RepoStatus } from '@shared/ipc'

export default function Header() {
  const result = useResult()
  const fromCache = useFromCache()
  const github = useStore(st => st.github)
  const remoteBehind = useStore(st => st.remoteBehind)
  const watchBanner = useStore(st => st.watchBanner)
  const { openLocal, refresh, exportReport, exportKnowledge, setSearchOpen, dismissBanner } = useStore.getState()
  const ready = !!result

  return (
    <header className={s.header}>
      <div className={s.brand}>
        <MazeLogo size={18} />
        <span className={s.brandName}>DevMaze</span>
      </div>
      <div className={s.sep} />

      <div className={s.repo}>
        {ready ? (
          <>
            <span className={`${s.repoName} truncate`}>{result.repoName}</span>
            {fromCache && <Badge color="var(--accent)" title="HEAD が変わっていないので、前回の解析結果を使っています">cached</Badge>}
            {github && <GithubStatus owner={github.owner} name={github.name} />}
          </>
        ) : (
          <span className={s.placeholder}>リポジトリを開く</span>
        )}
      </div>

      {ready && (remoteBehind || watchBanner) && (
        <div className={s.pill} role="status">
          <span>{remoteBehind ? 'GitHub に未取り込みのコミットがあります' : '手元に新しいコミットがあります'}</span>
          <button className={s.pillBtn} onClick={() => { dismissBanner(); refresh() }}>
            {remoteBehind ? '取り込む' : '再読み込み'}
          </button>
          <button className={s.pillClose} onClick={dismissBanner} title="閉じる">✕</button>
        </div>
      )}

      <div className={s.actions}>
        {ready && (
          <>
            <IconButton onClick={refresh} title="リモートから取り込んで再解析"><RefreshIcon size={14} /></IconButton>
            <IconButton onClick={() => setSearchOpen(true)} title="コミットを検索（⌘F）">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="7" cy="7" r="4.5" /><line x1="10.5" y1="10.5" x2="14" y2="14" />
              </svg>
            </IconButton>
            <Button onClick={exportReport} title="開発過程を Markdown 1本に書き出す">
              <DocIcon />レポート
            </Button>
            <Button onClick={exportKnowledge} title="Obsidian 向け vault と RAG 用 JSONL を書き出す">
              <GraphIcon />ナレッジ
            </Button>
            <div className={s.sep} />
          </>
        )}
        <GithubOpener />
        <div className={s.sep} />
        <Button variant="primary" onClick={() => openLocal()}>
          <FolderIcon size={12} color="var(--text-inverse)" />開く
        </Button>
      </div>
    </header>
  )
}

function DocIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1.5H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6z" /><path d="M9 1.5V6h4.5" /><path d="M5.5 9h5M5.5 11.5h3" />
    </svg>
  )
}
function GraphIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="3.5" cy="4" r="1.8" /><circle cx="12.5" cy="4" r="1.8" /><circle cx="8" cy="12" r="1.8" />
      <path d="M5 5l2 5.2M11 5l-2 5.2M5.3 4h5.4" />
    </svg>
  )
}

function GithubStatus({ owner, name }: { owner: string; name: string }) {
  const [st, setSt] = useState<RepoStatus | null>(null)
  useEffect(() => {
    let alive = true
    setSt(null)
    api.invoke('github:status', owner, name).then(r => { if (alive && r.ok) setSt(r.data) }).catch(() => {})
    return () => { alive = false }
  }, [owner, name])
  if (!st) return null
  const ci = { success: ['✓', 'var(--ok)'], failure: ['✗', 'var(--danger)'], pending: ['○', 'var(--warn)'], unknown: ['–', 'var(--text-dim)'] }[st.ciStatus]
  return (
    <>
      <Badge mono title={`open PR: ${st.prs}`}>PR {st.prs}</Badge>
      <Badge mono title={`open issues: ${st.issues}`}>#{st.issues}</Badge>
      <Badge mono color={ci[1]} title={st.ciName ? `CI: ${st.ciName} (${st.ciStatus})` : `CI: ${st.ciStatus}`}>CI {ci[0]}</Badge>
    </>
  )
}

type Validation = 'idle' | 'checking' | 'ok' | 'error'

function parseShorthand(input: string): { owner: string; name: string } | null {
  const t = input.trim().replace(/\.git$/, '')
  const m = t.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/)
    ?? t.match(/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\/.*)?$/)
  return m ? { owner: m[1], name: m[2] } : null
}

function GithubOpener() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [state, setState] = useState<Validation>('idle')
  const wrap = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const openGithub = useStore(st => st.openGithub)

  useEffect(() => {
    if (!open) { setInput(''); setState('idle'); return }
    const t = setTimeout(() => inputRef.current?.focus(), 40)
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown) }
  }, [open])

  // 存在確認は 500ms デバウンス。HEAD だけなので軽い
  useEffect(() => {
    const trimmed = input.trim()
    if (!trimmed) { setState('idle'); return }
    const parsed = parseShorthand(trimmed)
    if (!parsed) { setState('error'); return }
    setState('checking')
    const ac = new AbortController()
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.name}`, { method: 'HEAD', signal: ac.signal })
        setState(r.ok ? 'ok' : 'error')
      } catch { if (!ac.signal.aborted) setState('idle') }
    }, 500)
    return () => { clearTimeout(t); ac.abort() }
  }, [input])

  const submit = () => {
    if (state !== 'ok') return
    setOpen(false)
    openGithub(input.trim())
  }

  return (
    <div ref={wrap} className={s.popWrap}>
      <Button onClick={() => setOpen(v => !v)} active={open}><GitHubIcon size={13} />GitHub</Button>
      {open && (
        <div className={s.pop}>
          <div className={s.popTitle}>GitHub のリポジトリを開く</div>
          <div className={s.popForm}>
            <input ref={inputRef} className={s.popInput} data-state={state} value={input} placeholder="user/repo"
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false) }} />
            <Button variant="primary" disabled={state !== 'ok'} onClick={submit}>開く</Button>
          </div>
          <div className={s.popHint} data-state={state}>
            {state === 'idle' && 'user/repo の形か、GitHub の URL'}
            {state === 'checking' && '確認中...'}
            {state === 'ok' && '存在を確認しました。履歴を最大 1000 件取得します'}
            {state === 'error' && 'リポジトリが見つかりません'}
          </div>
        </div>
      )}
    </div>
  )
}
