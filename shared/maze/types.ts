/**
 * 迷路レイアウトエンジンの型。描画（React）と計算（純粋関数）を分けるための境界。
 * 画面側はここで決まった座標を描くだけで、位置の計算には口を出さない。
 */
import type { CommitType, MazeEdge } from '../types'
import type { TimeAxis } from './axis'

/** 迷路に置く1つの印。コミット1件か、作業のまとまり1つ */
export interface MazeItem {
  id: string
  type: CommitType
  timestamp: number
  lane: number
  isMainBranch: boolean
  filesChanged: number
  /** まとまりのとき: 含まれるコミット数（1件のときは undefined） */
  count?: number
  /** まとまりのとき: 含まれるコミットのハッシュ */
  memberHashes?: string[]
  label: string
  message: string
  tagNames: string[]
  isMilestone: boolean
  milestoneReason?: 'tag' | 'version' | 'large_change'
  authorName: string
  insertions: number
  deletions: number
}

export interface MazeLink {
  id: string
  source: string
  target: string
  type: MazeEdge['type']
}

export interface Placed {
  id: string
  x: number
  y: number
  r: number
  row: number
}

export interface RowGeometry {
  index: number
  top: number
  height: number
  /** レーン0の線の y（絶対座標。行の中心ではない。枝が片側だけなら中心からずれる） */
  mid: number
  /** 偶数行は左→右、奇数行は右→左 */
  leftToRight: boolean
  startTime: number
  endTime: number
}

export interface GapMark {
  x: number
  row: number
  days: number
}

export interface BandSegment {
  struggleId: string
  row: number
  x0: number
  x1: number
  /** このエピソードの先頭を含む区間か */
  isHead: boolean
  /** このエピソードの末尾を含む区間か */
  isTail: boolean
}

export interface MazeLayout {
  unit: 'commit' | 'session'
  width: number
  height: number
  rowW: number
  laneGap: number
  rows: RowGeometry[]
  placed: Placed[]
  byId: Map<string, Placed>
  gaps: GapMark[]
  bands: BandSegment[]
  /** 時刻 → 蛇行上の位置。帯やゲートを描くときに使う。lane は元のレーン番号（内部で畳む） */
  pos: (t: number, lane?: number) => { x: number; y: number; row: number }
  /** 画面に収める倍率（上下限はかけていない。描画側で FIT_MIN_K / FIT_MAX_K に収める） */
  fitScale: (viewportW: number, viewportH: number) => number
  /** 体感時間の軸。目盛りや帯の計算に使う */
  axis: TimeAxis
  /** 元のレーン番号 → 畳んだレーン番号 */
  laneOf: (lane: number) => number
}

export interface LayoutOptions {
  viewportW: number
  viewportH: number
  /** 画面に収めたいとき、行の折り返しをこの範囲で探す */
  maxRows?: number
}
