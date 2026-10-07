#!/usr/bin/env node
// esbuild で main / preload / MCP サーバーをそれぞれ1ファイルに束ねる。
//   node scripts/build.mjs electron   → dist-electron/main.cjs, preload.cjs
//   node scripts/build.mjs mcp        → dist-mcp/server.js
//   node scripts/build.mjs all
// 依存はすべて束ねる（electron だけ外に出す）ので、配布物に node_modules は要らない。
import * as esbuild from 'esbuild'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const which = process.argv[2] ?? 'all'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
}

export const targets = {
  main: {
    ...common,
    entryPoints: [join(root, 'electron/main.ts')],
    outfile: join(root, 'dist-electron/main.cjs'),
    external: ['electron'],
  },
  preload: {
    ...common,
    entryPoints: [join(root, 'electron/preload.ts')],
    outfile: join(root, 'dist-electron/preload.cjs'),
    external: ['electron'],
  },
  mcp: {
    ...common,
    entryPoints: [join(root, 'mcp-server/index.ts')],
    outfile: join(root, 'dist-mcp/server.js'),
    banner: { js: '#!/usr/bin/env node' },
  },
}

export async function buildTargets(names) {
  for (const name of names) {
    const t = targets[name]
    mkdirSync(dirname(t.outfile), { recursive: true })
    await esbuild.build(t)
    if (name === 'mcp') chmodSync(t.outfile, 0o755)
  }
}

// dev.mjs から import されたときは何もしない（直接実行されたときだけ走る）
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (invokedDirectly) {
  await buildTargets(
    which === 'electron' ? ['main', 'preload'] :
    which === 'mcp' ? ['mcp'] :
    ['main', 'preload', 'mcp'],
  )
}
