import { describe, it, expect } from 'vitest'
import { buildChunks } from '../shared/knowledge/chunks'
import { resultFrom, richHistory } from './knowledge-helpers'

describe('buildChunks', () => {
  const result = resultFrom(richHistory())
  const chunks = buildChunks(result)

  it('repo / struggle / hotspot / phase / activity が揃う', () => {
    const byKind = (k: string) => chunks.filter(c => c.kind === k)
    expect(byKind('repo').length).toBe(1)
    expect(byKind('activity').length).toBe(1)
    expect(byKind('struggle').length).toBe(result.struggles.length)
    expect(byKind('hotspot').length).toBe(result.hotspots.length)
    expect(byKind('phase').length).toBe(result.graph.zones.length)
  })

  it('ID に重複が無い', () => {
    expect(new Set(chunks.map(c => c.id)).size).toBe(chunks.length)
  })

  it('各 chunk は題名・本文・出所を持ち、自己完結している', () => {
    for (const c of chunks) {
      expect(c.title.length, c.id).toBeGreaterThan(0)
      expect(c.text.startsWith('# '), c.id).toBe(true)
      expect(c.text).toContain(result.repoName)
      expect(c.provenance.repoPath).toBe(result.repoPath)
      expect(Array.isArray(c.provenance.hashes)).toBe(true)
      expect(c.metadata.repo).toBe(result.repoName)
      expect(c.metadata.kind).toBe(c.kind)
    }
  })

  it('沼の chunk は根拠・関与ファイル・コミット列・抜けた印を含む', () => {
    const s = chunks.find(c => c.kind === 'struggle')!
    expect(s.text).toContain('## 判定根拠')
    expect(s.text).toContain('## 関与ファイル')
    expect(s.text).toContain('## コミット列')
    expect(s.text).toMatch(/抜けた印/)
    expect(s.provenance.hashes.length).toBeGreaterThan(0)
    expect(s.metadata.severity).toBeGreaterThan(0)
    expect(s.metadata.start).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(typeof s.metadata.escaped).toBe('boolean')
  })

  it('ホットスポットの chunk はそのファイルを触ったコミットを出所に持つ', () => {
    const h = chunks.find(c => c.kind === 'hotspot')!
    const path = h.metadata.files[0]
    const touching = result.graph.nodes.filter(n => n.files.includes(path)).map(n => n.id)
    expect(h.provenance.hashes).toEqual(touching)
  })

  it('空の履歴でも repo と activity は出る', () => {
    const c = buildChunks(resultFrom([]))
    expect(c.map(x => x.kind)).toEqual(['repo', 'activity'])
  })
})
