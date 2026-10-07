/**
 * 沼を「教訓」に蒸留するための素材を1本の Markdown にする。
 *
 * 沼は事実の記録で、そのままでは再利用できない。「状況 / 症状 / 試したこと / 効いたこと /
 * 一般化した規則 / 根拠へのリンク」の形に蒸留して初めて、次に同じ場所を触るときに効く。
 * 蒸留は LLM にやらせる。ここは判断を混ぜず、必要な事実（根拠・関与ファイル・コミット列・差分）を
 * 揃えて、最後に埋めるべき雛形を付けるところまで。
 *
 * 量の歯止めと「削ったことの明示」は get_struggle_diff から引き継ぐ。
 * 取れなかった差分は黙って省かず理由つきで返す（「差分が無い」と「差分が取れない」を取り違えさせない）。
 */
import type { AnalysisResult, StruggleEpisode } from '../types'
import type { CommitPatch } from '../analyzer/diff'
import { struggleKindLabel } from '../analyzer/struggle'

export interface LessonMaterialOptions {
  /** 関与ファイルの表とコミット列を入れる（既定 true）。get_struggle_diff は false で従来の形を保つ */
  includeTimeline?: boolean
  /** 末尾に蒸留テンプレートを付ける（既定 true） */
  includeTemplate?: boolean
  /** 差分を返した上限（max_commits）。「削ったもの」の説明に使う */
  maxCommits?: number
}

const when = (ts: number) => new Date(ts).toLocaleString('ja-JP')
const day = (ts: number) => new Date(ts).toLocaleDateString('ja-JP')

export function buildLessonMaterial(
  result: AnalysisResult,
  episode: StruggleEpisode,
  patches: CommitPatch[],
  opts: LessonMaterialOptions = {},
): string {
  const includeTimeline = opts.includeTimeline ?? true
  const includeTemplate = opts.includeTemplate ?? true
  const hashes = episode.commits.map(c => c.hash)
  const used = patches.length
  const maxCommits = opts.maxCommits ?? used
  const byHash = new Map(episode.commits.map(c => [c.hash, c]))
  const riskByPath = new Map(result.hotspots.map(h => [h.path, h.risk]))

  const lines: string[] = [
    `# ${episode.title}`,
    '',
    `- 種別: ${episode.kind} / 深刻度: ${episode.severity}`,
    `- 期間: ${when(episode.startTimestamp)} 〜 ${when(episode.endTimestamp)}（${episode.durationHours} 時間）`,
    `- コミット: ${hashes.length} 件` + (used < hashes.length ? `（うち先頭 ${used} 件の差分を返す）` : ''),
    `- 夜間(22-5時)の割合: ${Math.round(episode.nightRatio * 100)}%`,
    ...(episode.recurrence
      ? [`- 再発: ${episode.recurrence.file} で ${episode.recurrence.times} 回目のうち ` +
         `${episode.recurrence.index} 回目（初回 ${day(episode.recurrence.firstAt)}）`]
      : []),
    ...(episode.escape
      ? [`- 抜けた印: ${episode.escape.message}`]
      : ['- **抜けた印なし** — まだ抜けていない可能性がある']),
    '',
    '## 判定根拠',
    ...episode.evidence.map(e => `- ${e}`),
  ]

  if (includeTimeline) {
    lines.push(
      '',
      '## 関与ファイル',
      '',
      '| ファイル | 触った回数 | ホットスポット risk |',
      '|---|---:|---:|',
      ...(episode.files.length
        ? episode.files.map(f => `| \`${f.path}\` | ${f.touches} | ${riskByPath.get(f.path) ?? '−'} |`)
        : ['| （ファイル単位の差分が取れていない） | | |']),
      '',
      '## コミット列（時系列）',
      '',
      ...[...episode.commits]
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(c => `- ${when(c.timestamp)} \`${c.shortHash}\` [${c.type}] ${c.message}` +
          (episode.escape?.hash === c.hash ? ' ← 抜けた印' : '')),
      ...(episode.escape && !byHash.has(episode.escape.hash)
        ? [`- ${when(episode.escape.timestamp)} \`${episode.escape.shortHash}\` [${episode.escape.type}] ${episode.escape.message} ← 抜けた印（沼の後）`]
        : []),
    )
  }

  lines.push('', '## 差分')

  let skippedTotal = 0
  for (const p of patches) {
    const c = byHash.get(p.hash)
    lines.push('', `### ${p.hash.slice(0, 7)} ${c?.message ?? ''}`)
    if (p.files.length === 0 && p.skipped.length === 0) {
      lines.push('（対象ファイルへの変更なし）')
    }
    for (const f of p.files) {
      lines.push('', `**${f.path}**${f.truncated ? '（行数の上限で切り詰め）' : ''}`, '```diff', f.patch, '```')
    }
    for (const s of p.skipped) {
      skippedTotal++
      lines.push('', `> 取得できず: ${s.path} — ${s.reason}`)
    }
  }

  if (used < hashes.length || skippedTotal > 0) {
    lines.push('', '## この出力で削ったもの')
    if (used < hashes.length) {
      lines.push(`- ${hashes.length - used} コミットぶんの差分（max_commits=${maxCommits} の上限）`)
    }
    if (skippedTotal > 0) lines.push(`- ${skippedTotal} ファイルが取得できなかった（上の理由を参照）`)
  }

  if (includeTemplate) {
    lines.push(
      '',
      '---',
      '',
      '## 蒸留テンプレート',
      '',
      `上の事実から、再利用できる形に蒸留する。対象: ${result.repoName} / ${struggleKindLabel(episode.kind)} / ${episode.id}`,
      '',
      '### 状況',
      '',
      '（何を作っていて、どのファイル・どの機能を触っていたか）',
      '',
      '### 症状',
      '',
      '（何が起きたか。エラー・挙動・検出された型）',
      '',
      '### 試したこと',
      '',
      '（コミット列の順に、何を変えたか。効かなかったものも残す）',
      '',
      '### 効いたこと',
      '',
      '（抜けた印の差分で何が変わったか。無ければ「未解決」と書く）',
      '',
      '### 一般化した規則',
      '',
      '（次に同じ場所・同じ型で詰まらないための1〜3行。「〜のときは〜する」の形）',
      '',
      '### 根拠へのリンク',
      '',
      `- 沼: ${episode.id}`,
      `- コミット: ${hashes.slice(0, 6).map(h => h.slice(0, 7)).join(', ')}${hashes.length > 6 ? ' …' : ''}`,
      ...(episode.escape ? [`- 抜けた印: ${episode.escape.shortHash}`] : []),
      ...episode.files.slice(0, 5).map(f => `- ファイル: ${f.path}`),
      '',
      '### 埋めるときの注意',
      '',
      '- 差分に無いことを推測で書かない。書くなら「推測」と明記する',
      '- 「効いたこと」は抜けた印の差分に根拠を置く。無ければ未解決として残す',
      '- 規則はこのリポジトリ固有の事情と、他でも効く一般論を分けて書く',
    )
  }

  return lines.join('\n')
}
