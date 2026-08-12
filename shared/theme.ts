/**
 * コミット種別の見た目を1箇所に集める。
 *
 * 元は MazeGraph / MazeModeView / Sidebar / NodeDetail / SearchPanel の5箇所に
 * 同じ表が写されていて、merge だけ MazeGraph が #A88B5A、他4箇所が #8B7355 と
 * 食い違っていた（Graph のマージ節点とサイドバーの凡例が別の色のまま同じ画面に出る）。
 * index.css にも --color-* トークンがあったが7種しかなく、種別が11に増えたときに
 * 置き去りにされてどこからも読まれていなかった。
 *
 * satisfies Record<CommitType, …> にしてあるので、shared/types.ts の CommitType に
 * 種別が増えたらコンパイルで落ちる。同じすり抜けをもう一度やらないための歯止め。
 *
 * shared/ は Electron と MCP の両方から読まれる純粋層なので、DOM に触らないこと。
 */
import type { CommitType, StruggleKind } from './types'

/** 沼の種別の記号と名前。サイドバーの一覧と迷路の帯で同じものを使う */
export const STRUGGLE_META: Record<StruggleKind, { label: string; icon: string }> = {
  revert_loop: { label: 'やり直しの輪',       icon: '↩︎' },
  fix_chain:   { label: '修正の連鎖',         icon: '🔧' },
  file_churn:  { label: '同じファイルの往復', icon: '🌀' },
  wip_drift:   { label: 'WIP の漂流',         icon: '⋯'  },
  stall_burst: { label: '停滞のあとの再開',   icon: '⏸'  },
}

export interface TypeStyle {
  /** 迷路の節点・凡例・フィルターで共通に使う色 */
  hex: string
  label: string
  /** 一覧で使う短い名前（サイドバーのように幅が狭いところ用） */
  short: string
}

export const COMMIT_TYPE = {
  normal:    { hex: '#D4A84A', label: '通常コミット',     short: '通常' },
  feature:   { hex: '#7B9E5A', label: '機能追加',         short: '機能追加' },
  error_fix: { hex: '#C0624B', label: 'バグ修正',         short: 'バグ修正' },
  revert:    { hex: '#C88B3A', label: 'リバート',         short: 'リバート' },
  merge:     { hex: '#A88B5A', label: 'マージ',           short: 'マージ' },
  wip:       { hex: '#B8A06A', label: 'WIP',              short: 'WIP' },
  release:   { hex: '#E8C060', label: 'リリース',         short: 'リリース' },
  chore:     { hex: '#8B9BAA', label: '環境整備',         short: '環境整備' },
  docs:      { hex: '#7A9BB8', label: 'ドキュメント',     short: 'ドキュメント' },
  refactor:  { hex: '#9B8EC4', label: 'リファクタリング', short: 'リファクタ' },
  test:      { hex: '#6AAF9E', label: 'テスト',           short: 'テスト' },
} as const satisfies Record<CommitType, TypeStyle>

/** 節点の色。未知の種別が来ても落ちないよう既定色を返す */
export function typeColor(type: CommitType): string {
  return COMMIT_TYPE[type]?.hex ?? COMMIT_TYPE.normal.hex
}

/**
 * 深刻度の階調。色相を1本に固定して明度と彩度だけを動かす。
 * 元は 100→#C0624B(=バグ修正) / 50→#C88B3A(=リバート) / 30→#D4A84A(=アクセント) と
 * 種別の色をそのまま使っていたので、「深刻度52」と「リバート」が同じ色になっていた。
 * 閾値は変えていないので、サイドバーの一覧と迷路の印で同じ意味が同じ色になる。
 */
export function severityColor(severity: number): string {
  if (severity >= 75) return '#E0533A'
  if (severity >= 50) return '#C0624B'
  if (severity >= 30) return '#9E6247'
  return '#7A5A45'
}
