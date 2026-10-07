import { app, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { analyzeWithCache } from '../../shared/cache'
import { buildReport } from '../../shared/analyzer/report'
import { buildKnowledgeExport } from '../../shared/knowledge/index'
import { handle, guarded } from './typed'

export function registerExportIpc(): void {
  // 開発過程を Markdown 1本に。ノート・記憶・レポートへ持ち出すための口
  handle('export:report', (_e, repoPath) => guarded(async () => {
    const { data } = await analyzeWithCache(repoPath)
    const stamp = new Date().toISOString().slice(0, 10)
    const save = await dialog.showSaveDialog({
      title: 'レポートを保存',
      defaultPath: path.join(app.getPath('downloads'), `${data.repoName}-devmaze-${stamp}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (save.canceled || !save.filePath) return { ok: false as const, error: 'canceled' }
    fs.writeFileSync(save.filePath, buildReport(data), 'utf-8')
    return { ok: true as const, path: save.filePath }
  }))

  // ナレッジ出力: Obsidian 向け vault（Markdown + wikilink）と、RAG / GraphRAG 向け JSONL を同じ場所に
  handle('export:knowledge', (_e, repoPath) => guarded(async () => {
    const { data } = await analyzeWithCache(repoPath)
    const pick = await dialog.showOpenDialog({
      title: 'ナレッジの書き出し先（vault のルート）を選択',
      properties: ['openDirectory', 'createDirectory'],
      message: `${data.repoName}/ 以下にファイルを書き出します`,
    })
    if (pick.canceled || pick.filePaths.length === 0) return { ok: false as const, error: 'canceled' }
    const root = pick.filePaths[0]
    const { vault } = buildKnowledgeExport(data)
    for (const f of vault) {
      const target = path.join(root, f.path)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, f.content, 'utf-8')
    }
    return { ok: true as const, dir: path.join(root, data.repoName), files: vault.length }
  }))
}
