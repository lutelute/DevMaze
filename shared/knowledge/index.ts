import type { AnalysisResult, KnowledgeExport } from '../types'
import { buildKnowledgeGraph } from './graph'
import { buildChunks } from './chunks'
import { buildVault } from './vault'

/** graph / chunks / vault を一度に組み立てる */
export function buildKnowledgeExport(result: AnalysisResult): KnowledgeExport {
  const graph = buildKnowledgeGraph(result)
  const chunks = buildChunks(result)
  const vault = buildVault(result, graph, chunks)
  return { graph, chunks, vault }
}

export { buildKnowledgeGraph, nodeId } from './graph'
export { buildChunks } from './chunks'
export { buildVault, frontmatter, fileSlug } from './vault'
export { queryGraph, indexOf, GraphIndex } from './query'
export type { GraphQuery, GraphQueryResult } from './query'
export { buildLessonMaterial } from './lesson'
export type { LessonMaterialOptions } from './lesson'
