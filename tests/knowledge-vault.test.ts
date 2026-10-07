import { describe, it, expect } from 'vitest'
import { buildVault, frontmatter, fileSlug } from '../shared/knowledge/vault'
import { buildKnowledgeGraph } from '../shared/knowledge/graph'
import { buildChunks } from '../shared/knowledge/chunks'
import { resultFrom, richHistory } from './knowledge-helpers'

/** frontmatter を素朴に読み戻す（引用符付き文字列・数値・真偽・配列） */
function parseFrontmatter(md: string): Record<string, unknown> {
  const m = md.match(/^---\n([\s\S]*?)\n---/)
  if (!m) throw new Error('frontmatter が無い')
  const out: Record<string, unknown> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(': ')
    if (i < 0) throw new Error(`行が壊れている: ${line}`)
    const key = line.slice(0, i)
    const raw = line.slice(i + 2)
    out[key] = parseValue(raw)
  }
  return out
}
function parseValue(raw: string): unknown {
  if (raw === 'null') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (raw.startsWith('[')) return JSON.parse(raw)
  if (raw.startsWith('"')) return JSON.parse(raw)
  throw new Error(`引用符の無い文字列: ${raw}`)
}

describe('frontmatter', () => {
  it('コロンや引用符を含む題名でも壊れない', () => {
    const fm = frontmatter({ title: 'fix: "A" が落ちる #12', n: 3, ok: true, none: null, arr: ['a:b', 'c'] })
    const parsed = parseFrontmatter(fm)
    expect(parsed.title).toBe('fix: "A" が落ちる #12')
    expect(parsed.n).toBe(3)
    expect(parsed.ok).toBe(true)
    expect(parsed.none).toBe(null)
    expect(parsed.arr).toEqual(['a:b', 'c'])
  })

  it('undefined の項目は出さない', () => {
    expect(frontmatter({ a: undefined, b: 1 })).toBe('---\nb: 1\n---')
  })
})

describe('fileSlug', () => {
  it('スラッシュを __ にする', () => {
    expect(fileSlug('src/components/Board.tsx')).toBe('src__components__Board.tsx')
  })
})

describe('buildVault', () => {
  const result = resultFrom(richHistory())
  const graph = buildKnowledgeGraph(result)
  const chunks = buildChunks(result)
  const vault = buildVault(result, graph, chunks)
  const paths = vault.map(f => f.path)

  it('パスに重複が無く、すべて repo フォルダの下にある', () => {
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.every(p => p.startsWith('fixture/'))).toBe(true)
  })

  it('README・phases・activity・jsonl 3本・沼・ホットスポットが揃う', () => {
    expect(paths).toContain('fixture/README.md')
    expect(paths).toContain('fixture/phases.md')
    expect(paths).toContain('fixture/activity.md')
    expect(paths).toContain('fixture/graph.nodes.jsonl')
    expect(paths).toContain('fixture/graph.edges.jsonl')
    expect(paths).toContain('fixture/chunks.jsonl')
    expect(paths.filter(p => p.startsWith('fixture/struggles/')).length).toBe(result.struggles.length)
    expect(paths.filter(p => p.startsWith('fixture/hotspots/')).length).toBe(result.hotspots.length)
  })

  it('Markdown は全部 frontmatter を持ち、YAML として読み戻せる', () => {
    for (const f of vault.filter(f => f.path.endsWith('.md'))) {
      const fm = parseFrontmatter(f.content)
      expect(fm.type, f.path).toMatch(/^devmaze-/)
      expect(fm.repo).toBe('fixture')
    }
  })

  it('README の沼リンクは実在するノートを指す', () => {
    const readme = vault.find(f => f.path === 'fixture/README.md')!.content
    const links = [...readme.matchAll(/\[\[([^\]|]+)\|/g)].map(m => m[1])
    expect(links.length).toBeGreaterThan(0)
    for (const l of links) {
      expect(paths, l).toContain(`${l}.md`)
    }
  })

  it('沼のノートは根拠・関連・教訓の欄を持つ', () => {
    const note = vault.find(f => f.path.startsWith('fixture/struggles/'))!.content
    expect(note).toContain('## 判定根拠')
    expect(note).toContain('## 関連')
    expect(note).toContain('## 教訓')
    expect(note).toContain('[[fixture/README|fixture]]')
  })

  it('jsonl は1行1 JSON', () => {
    for (const name of ['graph.nodes.jsonl', 'graph.edges.jsonl', 'chunks.jsonl']) {
      const f = vault.find(f => f.path === `fixture/${name}`)!
      const lines = f.content.trimEnd().split('\n')
      for (const l of lines) expect(() => JSON.parse(l), name).not.toThrow()
    }
    const nodes = vault.find(f => f.path === 'fixture/graph.nodes.jsonl')!.content.trimEnd().split('\n')
    expect(nodes.length).toBe(graph.nodes.length)
  })
})
