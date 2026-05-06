/* Shared SVG icon components — no emoji */

interface IconProps {
  size?: number
  color?: string
  style?: React.CSSProperties
}

/* ── Maze logo mark ────────────────────────────────────────── */
export function MazeLogo({ size = 24, color = 'var(--accent)', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style}>
      {/* Outer border */}
      <rect x="1" y="1" width="22" height="22" rx="3.5"
        stroke={color} strokeWidth="1.6" fill="none"/>
      {/* Internal walls (forming a maze) */}
      {/* top-left cell wall: right side */}
      <line x1="9" y1="1"  x2="9"  y2="9"  stroke={color} strokeWidth="1.6" strokeLinecap="square"/>
      {/* top-right cell wall: bottom */}
      <line x1="9"  y1="9"  x2="23" y2="9"  stroke={color} strokeWidth="1.6" strokeLinecap="square"/>
      {/* middle horizontal */}
      <line x1="1"  y1="15" x2="15" y2="15" stroke={color} strokeWidth="1.6" strokeLinecap="square"/>
      {/* mid-right vertical */}
      <line x1="15" y1="9"  x2="15" y2="15" stroke={color} strokeWidth="1.6" strokeLinecap="square"/>
      {/* bottom-right cell wall: top partial */}
      <line x1="15" y1="15" x2="15" y2="23" stroke={color} strokeWidth="1.6" strokeLinecap="square"/>
    </svg>
  )
}

/* ── Folder ────────────────────────────────────────────────── */
export function FolderIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style}>
      <path d="M1 4.5A1.5 1.5 0 0 1 2.5 3h3l2 2h6A1.5 1.5 0 0 1 15 6.5v6A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-8z"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
}

/* ── GitHub mark ───────────────────────────────────────────── */
export function GitHubIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill={color}
      xmlns="http://www.w3.org/2000/svg" style={style}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  )
}

/* ── Git branch ─────────────────────────────────────────────── */
export function GitBranchIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style}>
      <circle cx="4" cy="3"  r="1.5" stroke={color} strokeWidth="1.4"/>
      <circle cx="4" cy="13" r="1.5" stroke={color} strokeWidth="1.4"/>
      <circle cx="12" cy="5" r="1.5" stroke={color} strokeWidth="1.4"/>
      <line x1="4" y1="4.5" x2="4" y2="11.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M4 4.5 C4 8 12 8 12 6.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" fill="none"/>
    </svg>
  )
}

/* ── Score / target ─────────────────────────────────────────── */
export function ScoreIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style}>
      <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.4"/>
      <circle cx="8" cy="8" r="3"   stroke={color} strokeWidth="1.4"/>
      <circle cx="8" cy="8" r="1"   fill={color}/>
    </svg>
  )
}

/* ── Alert / revert ─────────────────────────────────────────── */
export function AlertIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style}>
      <path d="M8 2 L14.5 13.5 H1.5 Z" stroke={color} strokeWidth="1.4" strokeLinejoin="round"/>
      <line x1="8" y1="6.5" x2="8" y2="10"   stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="8" cy="11.5" r="0.7" fill={color}/>
    </svg>
  )
}

/* ── Plug / MCP ─────────────────────────────────────────────── */
export function PlugIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style}>
      <path d="M5 2 V7 M11 2 V7" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
      <rect x="3" y="7" width="10" height="5" rx="2" stroke={color} strokeWidth="1.4"/>
      <line x1="8" y1="12" x2="8" y2="14.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

/* ── Refresh / sync ─────────────────────────────────────────── */
export function RefreshIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" style={style}>
      <path d="M13.5 8A5.5 5.5 0 1 1 10 3.08" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M10 1v3h3" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
