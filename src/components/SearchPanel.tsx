import { useState, useEffect, useMemo, useRef } from 'react'
import type { MazeNode, CommitType } from '../../shared/types'
import { COMMIT_TYPE } from '../../shared/theme'

interface Props {
  nodes: MazeNode[]
  onSelect: (node: MazeNode) => void
  onSelectFile: (path: string) => void
  onClose: () => void
}

// 色は shared/theme.ts が唯一の出どころ
const TYPE_COLOR = Object.fromEntries(
  Object.entries(COMMIT_TYPE).map(([k, v]) => [k, v.hex]),
) as Record<CommitType, string>

const MAX_RESULTS = 40

interface Hit {
  node: MazeNode
  where: 'message' | 'hash' | 'author' | 'file'
  detail?: string
}

/**
 * コミット検索。メッセージ・ハッシュ・著者・変更ファイルを横断する。
 * どこに当たったかを出すのは、同じ語が別の場所に当たったときに
 * 「なぜこれが出たか」が分からないと選べないため。
 */
function search(nodes: MazeNode[], query: string): Hit[] {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return []

  const hits: Hit[] = []
  for (const node of nodes) {
    if (node.id.toLowerCase().startsWith(q)) {
      hits.push({ node, where: 'hash' })
      continue
    }
    if (node.message.toLowerCase().includes(q)) {
      hits.push({ node, where: 'message' })
      continue
    }
    const file = node.files.find(f => f.toLowerCase().includes(q))
    if (file) {
      hits.push({ node, where: 'file', detail: file })
      continue
    }
    if (node.authorName.toLowerCase().includes(q)) {
      hits.push({ node, where: 'author', detail: node.authorName })
    }
  }

  return hits.sort((a, b) => b.node.timestamp - a.node.timestamp).slice(0, MAX_RESULTS)
}

export default function SearchPanel({ nodes, onSelect, onSelectFile, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const hits = useMemo(() => search(nodes, query), [nodes, query])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setCursor(0) }, [query])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(hits.length - 1, c + 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
    if (e.key === 'Enter' && hits[cursor]) {
      const hit = hits[cursor]
      if (hit.where === 'file' && hit.detail && e.shiftKey) onSelectFile(hit.detail)
      else onSelect(hit.node)
      onClose()
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(10,6,2,0.5)', backdropFilter: 'blur(2px)',
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(680px, 86vw)', maxHeight: '68vh', display: 'flex', flexDirection: 'column',
          background: 'var(--bg-panel)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="コミットを検索（メッセージ / ハッシュ / 著者 / ファイル）"
          style={{
            background: 'var(--bg-base)', border: 'none', borderBottom: '1px solid var(--border)',
            padding: '14px 16px', fontSize: 14, color: 'var(--text-primary)', outline: 'none',
          }}
        />

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {query.trim() && hits.length === 0 && (
            <div style={{ padding: '18px 16px', fontSize: 12, color: 'var(--text-dim)' }}>
              該当なし。表示中のコミットだけが検索対象です（表示件数を増やすと範囲が広がります）。
            </div>
          )}
          {hits.map((hit, i) => {
            const active = i === cursor
            const color = TYPE_COLOR[hit.node.type]
            const d = new Date(hit.node.timestamp)
            return (
              <div
                key={hit.node.id}
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  if (hit.where === 'file' && hit.detail) onSelectFile(hit.detail)
                  else onSelect(hit.node)
                  onClose()
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
                  background: active ? 'rgba(212,168,74,0.10)' : 'transparent',
                  borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  cursor: 'pointer',
                }}
              >
                <span style={{ color, fontSize: 9, flexShrink: 0 }}>⬤</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontSize: 12.5, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {hit.node.message.split('\n')[0]}
                  </span>
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                    {hit.node.label} · {d.getFullYear()}/{d.getMonth() + 1}/{d.getDate()} · {hit.node.authorName}
                    {hit.where === 'file' && hit.detail && ` · ${hit.detail}`}
                  </span>
                </span>
                <span style={{
                  flexShrink: 0, fontSize: 9.5, color: 'var(--text-dim)',
                  border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px',
                }}>
                  {{ message: 'メッセージ', hash: 'ハッシュ', author: '著者', file: 'ファイル' }[hit.where]}
                </span>
              </div>
            )
          })}
        </div>

        <div style={{
          padding: '7px 16px', borderTop: '1px solid var(--border)',
          fontSize: 10, color: 'var(--text-dim)', display: 'flex', gap: 14,
        }}>
          <span>↑↓ 移動</span>
          <span>Enter 開く</span>
          <span>Shift+Enter ファイルを辿る</span>
          <span>Esc 閉じる</span>
          {hits.length > 0 && <span style={{ marginLeft: 'auto' }}>{hits.length} 件</span>}
        </div>
      </div>
    </div>
  )
}
