import type { ReactNode, ButtonHTMLAttributes, CSSProperties } from 'react'
import s from './ui.module.css'
import { COMMIT_TYPE } from '@shared/theme'
import type { CommitType } from '@shared/types'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'primary' | 'outline'
  size?: 'sm' | 'md'
  active?: boolean
}

export function Button({ variant = 'ghost', size = 'md', active, className, ...rest }: BtnProps) {
  const cls = [s.btn, variant === 'primary' && s.primary, variant === 'outline' && s.outline, size === 'sm' && s.sm, className]
    .filter(Boolean).join(' ')
  return <button className={cls} data-active={active ? 'true' : undefined} {...rest} />
}

export function IconButton({ variant = 'ghost', size = 'md', active, className, ...rest }: BtnProps) {
  const cls = [s.btn, s.icon, variant === 'outline' && s.outline, size === 'sm' && s.sm, className].filter(Boolean).join(' ')
  return <button className={cls} data-active={active ? 'true' : undefined} {...rest} />
}

export function Badge({ color, mono, children, title }: { color?: string; mono?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={[s.badge, mono && s.mono].filter(Boolean).join(' ')} title={title}
      style={{ '--badge-color': color } as CSSProperties}>
      {children}
    </span>
  )
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.section}>
      <div className={s.sectionTitle}><span>{title}</span>{aside}</div>
      <div className={s.sectionBody}>{children}</div>
    </div>
  )
}

export function StatRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={s.statRow}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue} data-warn={warn ? 'true' : undefined}>{value}</span>
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>
}

/** 一覧の1行。active のときは row-color で染める */
export function Row({ active, color, title, onClick, children, aside }: {
  active?: boolean; color?: string; title?: string; onClick?: () => void; children: ReactNode; aside?: ReactNode
}) {
  return (
    <button className={s.row} data-active={active ? 'true' : undefined} title={title} onClick={onClick}
      style={{ '--row-color': color } as CSSProperties}>
      {children}
      {aside !== undefined && <span className={s.rowAside}>{aside}</span>}
    </button>
  )
}
export const RowMain = ({ children }: { children: ReactNode }) => <span className={s.rowMain}>{children}</span>
export const RowTitle = ({ children, className }: { children: ReactNode; className?: string }) =>
  <span className={[s.rowTitle, className].filter(Boolean).join(' ')}>{children}</span>
export const RowSub = ({ children, className }: { children: ReactNode; className?: string }) =>
  <span className={[s.rowSub, className].filter(Boolean).join(' ')}>{children}</span>

export function Meter({ value, color }: { value: number; color?: string }) {
  return (
    <span className={s.meter} style={{ '--meter-color': color } as CSSProperties}>
      <span className={s.meterFill} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  )
}

/** 節点と同じ形の印。凡例・フィルター・検索で共通に使う */
export function TypeMark({ type, size = 12 }: { type: CommitType; size?: number }) {
  const meta = COMMIT_TYPE[type] ?? COMMIT_TYPE.normal
  const c = meta.hex
  return (
    <svg width={size} height={size} viewBox="-7 -7 14 14" style={{ flexShrink: 0 }} aria-hidden>
      {meta.shape === 'diamond' ? (
        <path d="M0,-5.2 L4.2,0 L0,5.2 L-4.2,0 Z" fill={`${c}30`} stroke={c} strokeWidth="1.4" />
      ) : meta.shape === 'hex' ? (
        <path d="M4.5,-2.6 L4.5,2.6 L0,5.2 L-4.5,2.6 L-4.5,-2.6 L0,-5.2 Z" fill={`${c}30`} stroke={c} strokeWidth="1.4" />
      ) : meta.shape === 'dashed' ? (
        <circle r={4.6} fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="2.4,1.8" />
      ) : meta.shape === 'square' ? (
        <>
          <rect x={-4.8} y={-4.8} width={9.6} height={9.6} rx={2} fill={`${c}30`} stroke={c} strokeWidth="1.3" />
          {'glyph' in meta && meta.glyph && (
            <text textAnchor="middle" dy={3} fontSize={7.5} fontFamily="var(--font-mono)" fill={c}>{meta.glyph}</text>
          )}
        </>
      ) : (
        <circle r={4.6} fill={`${c}33`} stroke={c} strokeWidth="1.6" />
      )}
    </svg>
  )
}

export const fmtDate = (ts: number) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}` }
export const fmtDateTime = (ts: number) => {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}
export const repoLabel = (p: string) => (p.split('/').pop() ?? p).replace(/\.git$/, '')
export const isGithubCache = (p: string) => p.includes('github-repos')
