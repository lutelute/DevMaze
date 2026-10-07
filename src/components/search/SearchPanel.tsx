import { useEffect, useMemo, useRef, useState } from 'react'
import s from './search.module.css'
import { TypeMark, fmtDate } from '@/components/ui'
import { useStore } from '@/store'
import { useResult } from '@/store/selectors'
import type { MazeNode } from '@shared/types'

const MAX = 40
interface Hit { node: MazeNode; where: 'message' | 'hash' | 'author' | 'file'; detail?: string }
const WHERE = { message: 'メッセージ', hash: 'ハッシュ', author: '著者', file: 'ファイル' } as const

/** メッセージ・ハッシュ・著者・変更ファイルを横断。どこに当たったかを出すのは、同じ語が別の場所に当たったとき選べるように */
function search(nodes: MazeNode[], query: string): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Hit[] = []
  for (const node of nodes) {
    if (node.id.toLowerCase().startsWith(q)) { hits.push({ node, where: 'hash' }); continue }
    if (node.message.toLowerCase().includes(q)) { hits.push({ node, where: 'message' }); continue }
    const file = node.files.find(f => f.toLowerCase().includes(q))
    if (file) { hits.push({ node, where: 'file', detail: file }); continue }
    if (node.authorName.toLowerCase().includes(q)) hits.push({ node, where: 'author', detail: node.authorName })
  }
  return hits.sort((a, b) => b.node.timestamp - a.node.timestamp).slice(0, MAX)
}

export default function SearchPanel() {
  const result = useResult()
  const { setSearchOpen, selectHash, selectFile } = useStore.getState()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const nodes = result?.graph.nodes ?? []
  const hits = useMemo(() => search(nodes, query), [nodes, query])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setCursor(0) }, [query])

  const close = () => setSearchOpen(false)
  const pick = (hit: Hit, asFile: boolean) => {
    if (asFile && hit.where === 'file' && hit.detail) selectFile(hit.detail)
    else { useStore.setState({ focus: null }); selectHash(hit.node.id) }
    close()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(hits.length - 1, c + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
    if (e.key === 'Enter' && hits[cursor]) pick(hits[cursor], e.shiftKey)
  }

  return (
    <div className={s.backdrop} onClick={close}>
      <div className={s.panel} onClick={e => e.stopPropagation()}>
        <input ref={inputRef} className={s.input} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey}
          placeholder="コミットを検索（メッセージ / ハッシュ / 著者 / ファイル）" />
        <div className={s.list}>
          {query.trim() && hits.length === 0 && <div className={s.none}>該当なし。</div>}
          {hits.map((hit, i) => (
            <div key={hit.node.id} className={s.hit} data-active={i === cursor ? 'true' : undefined}
              onMouseEnter={() => setCursor(i)} onClick={() => pick(hit, false)}>
              <TypeMark type={hit.node.type} size={11} />
              <span className={s.hitMain}>
                <span className={`${s.hitTitle} truncate`}>{hit.node.message.split('\n')[0]}</span>
                <span className={`${s.hitSub} truncate`}>
                  {hit.node.label} · {new Date(hit.node.timestamp).getFullYear()}/{fmtDate(hit.node.timestamp)} · {hit.node.authorName}
                  {hit.where === 'file' && hit.detail ? ` · ${hit.detail}` : ''}
                </span>
              </span>
              <span className={s.where}>{WHERE[hit.where]}</span>
            </div>
          ))}
        </div>
        <div className={s.foot}>
          <span>↑↓ 移動</span><span>Enter 開く</span><span>Shift+Enter ファイルを辿る</span><span>Esc 閉じる</span>
          {hits.length > 0 && <span style={{ marginLeft: 'auto' }}>{hits.length} 件</span>}
        </div>
      </div>
    </div>
  )
}
