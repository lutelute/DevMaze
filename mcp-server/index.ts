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
