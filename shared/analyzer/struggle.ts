import type {
  CommitNode, CommitType, StruggleEpisode, StruggleKind, StruggleCommitRef,
} from '../types'
import { signalFiles, isFocused, fileLabel } from './paths'

// ===================================================================
// 沼（Struggle）抽出
//
// 試行錯誤スコアが「どれくらい荒れたか」の集計値なのに対し、こちらは
// 「どこで詰まったか」を個別のエピソードとして取り出す。
// 判定はすべてコミット履歴だけから決まる（推測を混ぜない）。根拠は
// evidence に数値で残し、読んだ側が再判断できるようにする。
// ===================================================================

const HOUR = 3600_000
const DAY = 24 * HOUR

// 沼を抜けた印として認めるコミット種別（修正・WIP・やり直しは「まだ抜けていない」）
const ESCAPE_TYPES: CommitType[] = ['feature', 'release', 'refactor', 'test', 'docs', 'normal']

// ===== helpers =====

function toRef(c: CommitNode): StruggleCommitRef {
  return {
    hash: c.hash,
    shortHash: c.shortHash,
    message: c.message.split('\n')[0].trim(),
    type: c.type,
    timestamp: c.timestamp.getTime(),
  }
}

function formatDuration(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60000))}分`
  if (ms < DAY) return `${Math.round(ms / HOUR)}時間`
  return `${Math.round(ms / DAY)}日`
}

function countFiles(commits: CommitNode[]): { path: string; touches: number }[] {
  const counts = new Map<string, number>()
  for (const c of commits) {
    for (const f of new Set(signalFiles(c))) {
      counts.set(f, (counts.get(f) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([path, touches]) => ({ path, touches }))
    .sort((a, b) => b.touches - a.touches || a.path.localeCompare(b.path))
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const clampSeverity = (n: number): number => Math.max(1, Math.min(100, Math.round(n)))

/**
 * 沼を抜けた（と思われる）コミットを探す。
 * エピソード終了後、同じファイルに触れた最初の「前進コミット」。
 */
function findEscape(
  sorted: CommitNode[],
  endTimestamp: number,
  focus: Set<string>,
): StruggleCommitRef | undefined {
  for (const c of sorted) {
    const t = c.timestamp.getTime()
    if (t <= endTimestamp) continue
    if (t - endTimestamp > 14 * DAY) break
    if (!ESCAPE_TYPES.includes(c.type)) continue
    if (focus.size > 0 && !signalFiles(c).some(f => focus.has(f))) continue
    return toRef(c)
  }
  return undefined
}

interface Draft {
  kind: StruggleKind
  members: CommitNode[]
  severity: number
  title: string
  evidence: string[]
}

function buildEpisode(draft: Draft, sorted: CommitNode[], index: number): StruggleEpisode {
  const members = [...draft.members].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const start = members[0].timestamp.getTime()
  const end = members[members.length - 1].timestamp.getTime()
  const files = countFiles(members)
  const focus = new Set(files.slice(0, 5).map(f => f.path))

  const night = members.filter(c => {
    const h = c.timestamp.getHours()
    return h >= 22 || h < 5
  }).length

  return {
    id: `struggle_${draft.kind}_${index}`,
    kind: draft.kind,
    title: draft.title,
    severity: clampSeverity(draft.severity),
    nightRatio: Math.round((night / members.length) * 100) / 100,
    startTimestamp: start,
    endTimestamp: end,
    durationHours: Math.round(((end - start) / HOUR) * 10) / 10,
    commits: members.map(toRef),
    files: files.slice(0, 10),
    escape: findEscape(sorted, end, focus),
    evidence: draft.evidence,
  }
}

// ===== 1. やり直しの輪（revert_loop） =====

function detectRevertLoops(sorted: CommitNode[]): Draft[] {
  const drafts: Draft[] = []
  const byHash = new Map(sorted.map(c => [c.hash, c]))

  for (const revert of sorted.filter(c => c.type === 'revert')) {
    const target = revert.revertedHash ? byHash.get(revert.revertedHash) : undefined
    const focus = new Set([...signalFiles(revert), ...(target ? signalFiles(target) : [])])
    if (focus.size === 0 && !target) continue

    const from = (target?.timestamp.getTime() ?? revert.timestamp.getTime()) - 7 * DAY
    const to = revert.timestamp.getTime() + 3 * DAY

    const members = sorted.filter(c => {
      const t = c.timestamp.getTime()
      if (t < from || t > to) return false
      if (c.hash === revert.hash || c.hash === target?.hash) return true
      return isFocused(c) && signalFiles(c).some(f => focus.has(f))
    })

    if (members.length < 3) continue

    const revertCount = members.filter(c => c.type === 'revert').length
    const topFile = countFiles(members)[0]

    drafts.push({
      kind: 'revert_loop',
      members,
      severity: 55 + members.length * 4 + (revertCount - 1) * 12,
      title: topFile
        ? `${fileLabel(topFile.path)} を巻き戻して作り直した`
        : `巻き戻しからの作り直し`,
      evidence: [
        `revert コミット ${revert.shortHash}${target ? `（${target.shortHash} を取り消し）` : ''}`,
        `同じファイルに触れた前後のコミット: ${members.length}件`,
        revertCount > 1 ? `期間内の revert: ${revertCount}件` : '',
        topFile ? `最多変更: ${topFile.path}（${topFile.touches}回）` : '',
      ].filter(Boolean),
    })
  }

  return drafts
}

// ===== 2. 修正の連鎖（fix_chain） =====

function detectFixChains(sorted: CommitNode[]): Draft[] {
  const fixes = sorted.filter(c => c.type === 'error_fix')
  const drafts: Draft[] = []

  let cluster: CommitNode[] = []
  const flush = () => {
    if (cluster.length >= 3) {
      const files = countFiles(cluster)
      const shared = files.filter(f => f.touches >= 2)
      const span = cluster[cluster.length - 1].timestamp.getTime() - cluster[0].timestamp.getTime()

      drafts.push({
        kind: 'fix_chain',
        members: [...cluster],
        severity: 35 + (cluster.length - 3) * 8 + (shared.length > 0 ? 15 : 0),
        title: shared[0]
          ? `${fileLabel(shared[0].path)} の修正が ${cluster.length} 回続いた`
          : `修正コミットが ${cluster.length} 回続いた`,
        evidence: [
          `fix 系コミット ${cluster.length}件が ${formatDuration(span)} に集中`,
          shared[0]
            ? `重複して直したファイル: ${shared.slice(0, 3).map(f => `${f.path}(${f.touches}回)`).join(', ')}`
            : `重複して直したファイルは無し（別々の箇所を修正）`,
          `先頭: ${cluster[0].shortHash} ${cluster[0].message.split('\n')[0]}`,
        ],
      })
    }
    cluster = []
  }

  for (const c of fixes) {
    if (cluster.length === 0) {
      cluster.push(c)
      continue
    }
    const prev = cluster[cluster.length - 1]
    if (c.timestamp.getTime() - prev.timestamp.getTime() <= DAY) cluster.push(c)
    else { flush(); cluster.push(c) }
  }
  flush()

  return drafts
}

// ===== 3. 同じファイルの往復（file_churn） =====

function detectFileChurn(sorted: CommitNode[]): Draft[] {
  const byFile = new Map<string, CommitNode[]>()
  for (const c of sorted) {
    // リリースコミットは版番号の更新でファイルに触るだけなので往復に数えない
    if (!isFocused(c) || c.type === 'release') continue
    for (const f of new Set(signalFiles(c))) {
      if (!byFile.has(f)) byFile.set(f, [])
      byFile.get(f)!.push(c)
    }
  }

  const drafts: Draft[] = []

  for (const [file, touches] of byFile) {
    if (touches.length < 4) continue

    // 7日窓を端から順に走査して、密集した区間を「すべて」拾う。
    // 最も密な一区間だけを採ると、同じファイルで時期を空けて繰り返した沼が
    // 1件に潰れ、再発（同じ場所で何度も詰まっている）が見えなくなる。
    let i = 0
    while (i < touches.length) {
      let j = i
      while (j + 1 < touches.length &&
             touches[j + 1].timestamp.getTime() - touches[i].timestamp.getTime() <= 7 * DAY) j++

      const window = touches.slice(i, j + 1)
      // 「作り込んだ」のか「詰まった」のかを分けるため、荒れの印を要求する。
      // 件数ではなく割合で見るのが要点 —— 毎コミット追記される台帳やログは
      // 変更回数だけは多く、1件でも fix が混じれば沼に化けてしまう。
      const rough = window.filter(c => c.type === 'error_fix' || c.type === 'revert' || c.type === 'wip')
      const enoughRough = rough.length >= Math.max(1, Math.ceil(window.length * 0.2))

      if (window.length < 4 || !enoughRough) { i++; continue }

      const span = window[window.length - 1].timestamp.getTime() - window[0].timestamp.getTime()

      drafts.push({
        kind: 'file_churn',
        members: window,
        severity: 30 + (window.length - 4) * 6 + rough.length * 6 +
                  (window.some(c => c.type === 'revert') ? 12 : 0),
        title: `${fileLabel(file)} を ${window.length} 回書き直した`,
        evidence: [
          `${file} を ${formatDuration(span)} のあいだに ${window.length} 回変更`,
          `うち fix/revert/WIP: ${rough.length}件`,
          `変更行の合計: +${window.reduce((a, c) => a + c.insertions, 0)} / -${window.reduce((a, c) => a + c.deletions, 0)}`,
        ],
      })

      i = j + 1
    }
  }

  return drafts
}

// ===== 4. WIP の漂流（wip_drift） =====

function detectWipDrift(sorted: CommitNode[]): Draft[] {
  const wips = sorted.filter(c => c.type === 'wip')
  const drafts: Draft[] = []

  let cluster: CommitNode[] = []
  const flush = () => {
    if (cluster.length >= 3) {
      const span = cluster[cluster.length - 1].timestamp.getTime() - cluster[0].timestamp.getTime()
      const topFile = countFiles(cluster)[0]
      drafts.push({
        kind: 'wip_drift',
        members: [...cluster],
        severity: 25 + (cluster.length - 3) * 7,
        title: topFile
          ? `${fileLabel(topFile.path)} 周辺で WIP が ${cluster.length} 件続いた`
          : `WIP が ${cluster.length} 件続いた`,
        evidence: [
          `WIP/TODO/draft 系コミット ${cluster.length}件が ${formatDuration(span)} に連続`,
          topFile ? `中心のファイル: ${topFile.path}（${topFile.touches}回）` : '',
        ].filter(Boolean),
      })
    }
    cluster = []
  }

  for (const c of wips) {
    if (cluster.length === 0) { cluster.push(c); continue }
    const prev = cluster[cluster.length - 1]
    if (c.timestamp.getTime() - prev.timestamp.getTime() <= 2 * DAY) cluster.push(c)
    else { flush(); cluster.push(c) }
  }
  flush()

  return drafts
}

// ===== 5. 停滞のあとの一気書き（stall_burst） =====

function detectStallBursts(sorted: CommitNode[]): Draft[] {
  if (sorted.length < 6) return []

  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime())
  }
  const medGap = median(gaps)
  const medChange = median(sorted.map(c => c.insertions + c.deletions).filter(n => n > 0))
  const threshold = Math.max(3 * DAY, medGap * 8)

  const drafts: Draft[] = []

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime()
    if (gap < threshold) continue

    const after = sorted[i]
    const change = after.insertions + after.deletions
    const isRough = after.type === 'error_fix' || after.type === 'revert' || after.type === 'wip'
    const isBurst = medChange > 0 && change >= medChange * 3
    if (!isRough && !isBurst) continue   // ただの休止は沼ではない

    const gapDays = gap / DAY

    drafts.push({
      kind: 'stall_burst',
      members: [sorted[i - 1], after],
      severity: 20 + Math.min(25, gapDays) + (isRough ? 12 : 0) + (isBurst ? 8 : 0),
      title: `${Math.round(gapDays)}日の空白のあと ${isRough ? '修正から' : '大きな変更で'}再開`,
      evidence: [
        `${sorted[i - 1].shortHash} → ${after.shortHash} の間隔: ${formatDuration(gap)}（中央値 ${formatDuration(medGap)}）`,
        `再開コミット: ${after.type} / +${after.insertions} -${after.deletions}（変更量の中央値 ${medChange}）`,
        `再開時のメッセージ: ${after.message.split('\n')[0]}`,
      ],
    })
  }

  return drafts
}

// ===== 重複統合 =====

function overlapRatio(a: CommitNode[], b: CommitNode[]): number {
  const setA = new Set(a.map(c => c.hash))
  const shared = b.filter(c => setA.has(c.hash)).length
  return shared / Math.min(a.length, b.length)
}

/** 同じ種別で大きく重なるエピソードを1本にまとめる（同じ沼を何度も数えない） */
function mergeDrafts(drafts: Draft[]): Draft[] {
  const merged: Draft[] = []

  for (const d of drafts) {
    const hit = merged.find(m => m.kind === d.kind && overlapRatio(m.members, d.members) >= 0.6)
    if (!hit) { merged.push({ ...d, members: [...d.members], evidence: [...d.evidence] }); continue }

    const seen = new Set(hit.members.map(c => c.hash))
    for (const c of d.members) if (!seen.has(c.hash)) hit.members.push(c)
    if (d.severity > hit.severity) {
      hit.severity = d.severity
      hit.title = d.title
      hit.evidence = d.evidence
    }
  }

  return merged
}

// ===== エントリポイント =====

export function detectStruggles(commits: CommitNode[]): StruggleEpisode[] {
  if (commits.length === 0) return []

  const sorted = [...commits]
    .filter(c => c.type !== 'merge')   // マージ自体は詰まりの証拠にならない
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  if (sorted.length === 0) return []

  const drafts = mergeDrafts([
    ...detectRevertLoops(sorted),
    ...detectFixChains(sorted),
    ...detectFileChurn(sorted),
    ...detectWipDrift(sorted),
    ...detectStallBursts(sorted),
  ])

  const episodes = drafts.map((d, i) => buildEpisode(d, sorted, i))
  markRecurrences(episodes)

  return episodes
    .sort((a, b) => b.severity - a.severity || b.endTimestamp - a.endTimestamp)
    .slice(0, 30)
}

/**
 * 同じ場所で、時期を空けて繰り返し詰まっているものに印をつける。
 *
 * 一度きりの沼と、半年に3回同じファイルで溺れている沼は、意味がまったく違う。
 * 後者は「そのとき苦労した」ではなく「その場所に問題がある」。
 * 時期が近いものは同じ一件の続きなので、14日以上あいた場合だけ別回と数える。
 */
const RECURRENCE_GAP = 14 * DAY

function markRecurrences(episodes: StruggleEpisode[]): void {
  const byFile = new Map<string, StruggleEpisode[]>()

  for (const e of episodes) {
    const top = e.files[0]?.path
    if (!top) continue
    if (!byFile.has(top)) byFile.set(top, [])
    byFile.get(top)!.push(e)
  }

  for (const [file, group] of byFile) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => a.startTimestamp - b.startTimestamp)

    // 時期の離れたものだけを別回として拾う
    const rounds: StruggleEpisode[] = [sorted[0]]
    for (const e of sorted.slice(1)) {
      if (e.startTimestamp - rounds[rounds.length - 1].endTimestamp >= RECURRENCE_GAP) rounds.push(e)
    }
    if (rounds.length < 2) continue

    rounds.forEach((e, i) => {
      e.recurrence = {
        file,
        times: rounds.length,
        index: i + 1,
        firstAt: rounds[0].startTimestamp,
      }
      // 繰り返しているという事実そのものが深刻度
      e.severity = clampSeverity(e.severity + (rounds.length - 1) * 8)
      e.evidence.push(
        `同じファイル（${file}）で ${rounds.length} 回目の沼（${i + 1}回目 / 初回 ${new Date(rounds[0].startTimestamp).toLocaleDateString('ja-JP')}）`
      )
    })
  }
}

// ===== Markdown 化（MCP / レポート用） =====

const KIND_LABEL: Record<StruggleKind, string> = {
  revert_loop: 'やり直しの輪',
  fix_chain:   '修正の連鎖',
  file_churn:  '同じファイルの往復',
  wip_drift:   'WIP の漂流',
  stall_burst: '停滞のあとの再開',
}

export function struggleKindLabel(kind: StruggleKind): string {
  return KIND_LABEL[kind]
}

function severityMark(severity: number): string {
  return severity >= 75 ? '🔴' : severity >= 50 ? '🟠' : severity >= 30 ? '🟡' : '⚪️'
}

export function formatStruggles(
  episodes: StruggleEpisode[],
  repoName: string,
  fileStatsCoverage = 1,
): string {
  // ファイル差分が取れていないと file_churn / revert_loop が原理的に動かない。
  // 「沼が無い」のか「見えていない」のかを取り違えないよう、必ず明示する。
  const degraded = fileStatsCoverage < 0.5
    ? `\n\n> ⚠️ ファイル単位の差分を取得できたコミットは ${Math.round(fileStatsCoverage * 100)}% です（shallow clone / オブジェクト欠損）。ファイルに依る検出（同じファイルの往復・やり直しの輪）はこの結果に現れていない可能性があります。`
    : ''

  if (episodes.length === 0) {
    return `## ${repoName} の沼\n\n検出なし（履歴からは詰まった箇所を特定できませんでした）。\n\n※ 「沼が無かった」ではなく「履歴に痕跡が残っていない」可能性があります。コミットが粗い（まとめてコミットしている）場合は検出できません。${degraded}`
  }

  const date = (ts: number) => new Date(ts).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })

  const lines: string[] = [
    `## ${repoName} の沼（${episodes.length}件）`,
    ``,
    `開発履歴から「詰まった箇所」を抽出したもの。判定根拠は各項目の evidence に数値で残してある。${degraded}`,
    ``,
  ]

  for (const e of episodes) {
    lines.push(
      `### ${severityMark(e.severity)} ${e.title}`,
      ``,
      `- **種別**: ${KIND_LABEL[e.kind]} / **深刻度**: ${e.severity}`
        + (e.recurrence ? ` / **再発**: ${e.recurrence.file} で ${e.recurrence.index}/${e.recurrence.times} 回目` : '')
        + (e.nightRatio >= 0.4 ? ` / **夜間作業**: ${Math.round(e.nightRatio * 100)}%` : ''),
      `- **期間**: ${date(e.startTimestamp)} 〜 ${date(e.endTimestamp)}（${formatDuration(e.endTimestamp - e.startTimestamp)}）`,
      `- **コミット**: ${e.commits.length}件 — ${e.commits.slice(0, 6).map(c => c.shortHash).join(', ')}${e.commits.length > 6 ? ' …' : ''}`,
    )
    if (e.files.length > 0) {
      lines.push(`- **関与ファイル**: ${e.files.slice(0, 5).map(f => `${f.path}(${f.touches})`).join(', ')}`)
    }
    lines.push(`- **根拠**:`)
    for (const ev of e.evidence) lines.push(`  - ${ev}`)
    if (e.escape) {
      lines.push(`- **抜けた印**: ${e.escape.shortHash} \`${e.escape.message}\`（${date(e.escape.timestamp)}）`)
    } else {
      lines.push(`- **抜けた印**: なし（同じ場所に前進コミットが続いていない）`)
    }
    lines.push(``)
  }

  return lines.join('\n')
}
