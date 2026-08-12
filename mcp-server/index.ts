import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import path from 'path'
import { analyzeRepo } from '../shared/analyzer/index'
import { formatStruggles } from '../shared/analyzer/struggle'
import { formatHotspots } from '../shared/analyzer/hotspot'
import { buildReport } from '../shared/analyzer/report'
import { getPatches } from '../shared/analyzer/diff'
import type { StruggleKind } from '../shared/types'

const server = new Server(
  { name: 'devmaze', version: '0.4.0' },
  { capabilities: { tools: {} } }
)

// ===== Tool Definitions =====
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'scan_repo',
      description: 'Gitリポジトリを解析し、開発迷路グラフとスコアを返す',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description: '解析対象のGitリポジトリのパス（絶対パス）',
          },
        },
        required: ['repo_path'],
      },
    },
    {
      name: 'get_summary',
      description: '開発サマリーをMarkdown形式で返す',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description: 'Gitリポジトリのパス',
          },
        },
        required: ['repo_path'],
      },
    },
    {
      name: 'get_score',
      description: '試行錯誤スコアと詳細を返す',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description: 'Gitリポジトリのパス',
          },
        },
        required: ['repo_path'],
      },
    },
    {
      name: 'get_struggle_diff',
      description:
        '沼（詰まった箇所）で実際に書かれたコードの差分を返す。' +
        'get_struggles が返すのは「どこで何回詰まったか」までで、' +
        '「技術的に何を試して何が効いたか」は差分を読まないと分からない。' +
        'ノイズ（lock ファイル・dist 等）は除外し、量が多い場合は削ったうえで' +
        '削ったことを明示する。取得できなかったファイルも理由つきで返す' +
        '（GitHub キャッシュは 100KB 以上のファイルの中身を持っていない）。',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Gitリポジトリのパス' },
          struggle_id: {
            type: 'string',
            description: '対象の沼のID（get_struggles の id）。省略時は最も深刻なもの',
          },
          only_struggle_files: {
            type: 'boolean',
            description:
              'その沼の関与ファイルだけに絞る（デフォルト: true）。' +
              'false にすると同じコミットの他の変更も入り、量が数倍になる',
            default: true,
          },
          max_commits: {
            type: 'number',
            description: '読むコミット数の上限（デフォルト: 12）。沼は100件を超えることがある',
            default: 12,
          },
          max_lines_per_file: {
            type: 'number',
            description: '1ファイルあたりの最大行数（デフォルト: 200）',
            default: 200,
          },
          context: {
            type: 'number',
            description: '差分の文脈行数（デフォルト: 1）。3にすると量が3倍近くなる',
            default: 1,
          },
        },
        required: ['repo_path'],
      },
    },
    {
      name: 'get_struggles',
      description:
        '開発履歴から「詰まった箇所（沼）」を個別のエピソードとして抽出する。' +
        'やり直しの輪 / 修正の連鎖 / 同じファイルの往復 / WIPの漂流 / 停滞のあとの再開 を、' +
        '該当コミット・関与ファイル・判定根拠・抜けた印つきで返す。',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description: 'Gitリポジトリのパス',
          },
          format: {
            type: 'string',
            enum: ['markdown', 'json'],
            description: '出力形式（デフォルト: markdown）',
            default: 'markdown',
          },
          min_severity: {
            type: 'number',
            description: 'この深刻度未満のエピソードを除外（0-100、デフォルト: 0）',
            default: 0,
          },
          limit: {
            type: 'number',
            description: '最大件数（デフォルト: 10）',
            default: 10,
          },
          kind: {
            type: 'string',
            enum: ['revert_loop', 'fix_chain', 'file_churn', 'wip_drift', 'stall_burst'],
            description: '種別で絞り込む（省略時は全種別）',
          },
        },
        required: ['repo_path'],
      },
    },
    {
      name: 'get_hotspots',
      description:
        '荒れているファイル（よく変わる × 直してばかり × 触る人が多い）を risk 順に返す。' +
        '沼が時間軸の詰まりなのに対し、こちらは場所の軸。',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Gitリポジトリのパス' },
          format: {
            type: 'string',
            enum: ['markdown', 'json'],
            description: '出力形式（デフォルト: markdown）',
            default: 'markdown',
          },
          limit: { type: 'number', description: '最大件数（デフォルト: 15）', default: 15 },
        },
        required: ['repo_path'],
      },
    },
    {
      name: 'export_report',
      description:
        '開発サマリー・試行錯誤スコア・沼・ホットスポットを1本の Markdown にまとめて返す。' +
        '開発過程を資産として外部（ノート・記憶・レポート）に取り込むための出力口。',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: 'Gitリポジトリのパス' },
          struggle_limit: { type: 'number', description: '沼の最大件数（デフォルト: 10）', default: 10 },
          hotspot_limit: { type: 'number', description: 'ホットスポットの最大件数（デフォルト: 15）', default: 15 },
        },
        required: ['repo_path'],
      },
    },
    {
      name: 'get_maze_graph',
      description: 'コミットグラフをJSON形式で返す（ノードとエッジ）',
      inputSchema: {
        type: 'object',
        properties: {
          repo_path: {
            type: 'string',
            description: 'Gitリポジトリのパス',
          },
          limit: {
            type: 'number',
            description: '最大ノード数（デフォルト: 200）',
            default: 200,
          },
        },
        required: ['repo_path'],
      },
    },
  ],
}))

// ===== Tool Handlers =====
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const repoPath = path.resolve((args as Record<string, string>).repo_path)

  try {
    const result = await analyzeRepo(repoPath)

    if (name === 'scan_repo') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            repoName: result.repoName,
            stats: result.stats,
            score: result.score,
            nodeCount: result.graph.nodes.length,
            edgeCount: result.graph.edges.length,
            struggleCount: result.struggles.length,
          }, null, 2),
        }],
      }
    }

    if (name === 'get_summary') {
      return {
        content: [{ type: 'text', text: result.summary }],
      }
    }

    if (name === 'get_score') {
      const s = result.score
      const levelEmoji = { clean: '✅', normal: '🟡', messy: '🟠', chaotic: '🔴' }[s.level]
      const text = [
        `# 試行錯誤スコア: ${s.total} ${levelEmoji}`,
        `レベル: ${s.level}`,
        ``,
        `## 内訳`,
        ...s.details.map(d =>
          `- ${d.label}: ${d.count}件 × ${d.weight}点 = **${d.subtotal}点**`
        ),
      ].join('\n')
      return { content: [{ type: 'text', text }] }
    }

    if (name === 'get_struggle_diff') {
      const a = (args ?? {}) as Record<string, unknown>
      const episode = a.struggle_id
        ? result.struggles.find(e => e.id === a.struggle_id)
        : [...result.struggles].sort((x, y) => y.severity - x.severity)[0]

      if (!episode) {
        return {
          content: [{
            type: 'text',
            text: a.struggle_id
              ? `沼 ${String(a.struggle_id)} が見つかりません。get_struggles で id を確認してください。`
              : '沼は検出されていません。' +
                (result.stats.fileStatsCoverage < 0.5
                  ? `ただしファイル差分の取得率が ${Math.round(result.stats.fileStatsCoverage * 100)}% しかないため、` +
                    '「無い」のか「見えていない」のか判断できません（shallow clone の可能性）。'
                  : ''),
          }],
        }
      }

      const maxCommits = Number(a.max_commits ?? 12)
      // 深刻度の根拠になっているのは中心のファイル。既定ではそこだけ読む
      const onlyPaths = (a.only_struggle_files ?? true)
        ? episode.files.map(f => f.path)
        : undefined
      const hashes = episode.commits.map(c => c.hash)
      const used = hashes.slice(0, maxCommits)

      const patches = await getPatches(repoPath, used, {
        onlyPaths,
        maxLinesPerFile: Number(a.max_lines_per_file ?? 200),
        context: Number(a.context ?? 1),
      })

      const byHash = new Map(episode.commits.map(c => [c.hash, c]))
      const lines: string[] = [
        `# ${episode.title}`,
        '',
        `- 種別: ${episode.kind} / 深刻度: ${episode.severity}`,
        `- 期間: ${new Date(episode.startTimestamp).toLocaleString('ja-JP')} 〜 ` +
          `${new Date(episode.endTimestamp).toLocaleString('ja-JP')}（${episode.durationHours} 時間）`,
        `- コミット: ${hashes.length} 件` +
          (used.length < hashes.length ? `（うち先頭 ${used.length} 件の差分を返す）` : ''),
        `- 夜間(22-5時)の割合: ${Math.round(episode.nightRatio * 100)}%`,
        ...(episode.recurrence
          ? [`- 再発: ${episode.recurrence.file} で ${episode.recurrence.times} 回目のうち ` +
             `${episode.recurrence.index} 回目（初回 ${new Date(episode.recurrence.firstAt).toLocaleDateString('ja-JP')}）`]
          : []),
        ...(episode.escape
          ? [`- 抜けた印: ${episode.escape.message}`]
          : ['- **抜けた印なし** — まだ抜けていない可能性がある']),
        '',
        '## 判定根拠',
        ...episode.evidence.map(e => `- ${e}`),
        '',
        '## 差分',
      ]

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

      if (used.length < hashes.length || skippedTotal > 0) {
        lines.push('', '## この出力で削ったもの')
        if (used.length < hashes.length) {
          lines.push(`- ${hashes.length - used.length} コミットぶんの差分（max_commits=${maxCommits} の上限）`)
        }
        if (skippedTotal > 0) lines.push(`- ${skippedTotal} ファイルが取得できなかった（上の理由を参照）`)
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }

    if (name === 'get_struggles') {
      const a = (args ?? {}) as Record<string, unknown>
      const minSeverity = Number(a.min_severity ?? 0)
      const limit = Number(a.limit ?? 10)
      const kind = a.kind as StruggleKind | undefined

      const episodes = result.struggles
        .filter(e => e.severity >= minSeverity)
        .filter(e => !kind || e.kind === kind)
        .slice(0, limit)

      if (a.format === 'json') {
        return {
          content: [{ type: 'text', text: JSON.stringify(episodes, null, 2) }],
        }
      }
      return {
        content: [{
          type: 'text',
          text: formatStruggles(episodes, result.repoName, result.stats.fileStatsCoverage),
        }],
      }
    }

    if (name === 'get_hotspots') {
      const a = (args ?? {}) as Record<string, unknown>
      const limit = Number(a.limit ?? 15)
      const hotspots = result.hotspots.slice(0, limit)

      if (a.format === 'json') {
        return { content: [{ type: 'text', text: JSON.stringify(hotspots, null, 2) }] }
      }
      return { content: [{ type: 'text', text: formatHotspots(hotspots, result.repoName) }] }
    }

    if (name === 'export_report') {
      const a = (args ?? {}) as Record<string, unknown>
      const text = buildReport(result, {
        struggleLimit: Number(a.struggle_limit ?? 10),
        hotspotLimit:  Number(a.hotspot_limit ?? 15),
      })
      return { content: [{ type: 'text', text }] }
    }

    if (name === 'get_maze_graph') {
      const limit = Number((args as Record<string, unknown>).limit ?? 200)
      const nodes = result.graph.nodes.slice(0, limit)
      const nodeIds = new Set(nodes.map(n => n.id))
      const edges = result.graph.edges.filter(e => {
        const src = typeof e.source === 'string' ? e.source : e.source.id
        const tgt = typeof e.target === 'string' ? e.target : e.target.id
        return nodeIds.has(src) && nodeIds.has(tgt)
      })
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ nodes, edges }, null, 2),
        }],
      }
    }

    throw new Error(`Unknown tool: ${name}`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    }
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('DevMaze MCP server running (stdio)\n')
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err}\n`)
  process.exit(1)
})
