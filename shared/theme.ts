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
  shape: TypeShape
  /** square のときだけ中に置く1文字。同じ色を4種で共有するので識別はこれが担う */
  glyph?: string
}

/** 節点の描き分け。色だけに頼らないためのチャネル */
export type TypeShape = 'circle' | 'diamond' | 'hex' | 'dashed' | 'square'

/**
 * 11種を色だけで持つのをやめる。
 *
 * 元の11色を色覚多様性（P型・D型）でシミュレートすると、相互コントラストが 1.20 を
 * 下回る＝隣り合うと同色に見えるペアが **P型で26組・D型で30組**あった。
 * 正常色覚でも `revert #C88B3A` と `docs #7A9BB8` は明度が完全に一致していて、
 * ミニマップ（半径2.5px）では色相差しか手がかりが無く区別できない。
 * 配色の善し悪しではなく **11 という数が色の容量を超えている**ことによる問題なので、
 * 明るいテーマに替えても解決しない。
 *
 * 色を持つのは「試行錯誤の物語に効く4種」だけにして輝度のはしごを作る。
 * この4色は CVD 後の相互コントラストが P型で最小1.39・D型で1.26 あり、
 * 1.20 を下回るペアはゼロ（元は10組中4組が該当）。残りは形で持つ。
 */
export const COMMIT_TYPE = {
  // 4色の輝度ラダー（括弧内は背景 #1A1107 に対するコントラスト比）
  feature:   { hex: '#A6CE6E', label: '機能追加',         short: '機能追加',   shape: 'circle' },  // 10.36
  normal:    { hex: '#D9A63F', label: '通常コミット',     short: '通常',       shape: 'circle' },  //  8.41
  revert:    { hex: '#BE7A28', label: 'リバート',         short: 'リバート',   shape: 'circle' },  //  5.33
  error_fix: { hex: '#B85742', label: 'バグ修正',         short: 'バグ修正',   shape: 'circle' },  //  3.97

  // 形で持つもの
  merge:     { hex: '#A88B5A', label: 'マージ',           short: 'マージ',     shape: 'diamond' },
  release:   { hex: '#F2D27A', label: 'リリース',         short: 'リリース',   shape: 'hex' },
  // 破線の円＝閉じていない輪。「まだ途中」がそのまま形になる
  wip:       { hex: '#9A8656', label: 'WIP',              short: 'WIP',        shape: 'dashed' },

  // 周辺作業。試行錯誤の物語には効かないので、色相を4つ食う価値がない。1色＋1文字に畳む
  chore:     { hex: '#7E8C99', label: '環境整備',         short: '環境整備',     shape: 'square', glyph: 'C' },
  docs:      { hex: '#7E8C99', label: 'ドキュメント',     short: 'ドキュメント', shape: 'square', glyph: 'D' },
  refactor:  { hex: '#7E8C99', label: 'リファクタリング', short: 'リファクタ',   shape: 'square', glyph: 'R' },
  test:      { hex: '#7E8C99', label: 'テスト',           short: 'テスト',       shape: 'square', glyph: 'T' },
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
