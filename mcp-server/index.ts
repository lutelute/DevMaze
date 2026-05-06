import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import path from 'path'
import { analyzeRepo } from '../shared/analyzer/index'

const server = new Server(
  { name: 'devmaze', version: '0.1.0' },
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
