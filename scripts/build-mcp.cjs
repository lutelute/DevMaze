#!/usr/bin/env node
const { build } = require('esbuild')
const path = require('path')
const fs = require('fs')

const outDir = path.join(__dirname, '..', 'dist-mcp')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

build({
  entryPoints: [path.join(__dirname, '..', 'mcp-server', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: path.join(outDir, 'server.js'),
  format: 'cjs',
  sourcemap: false,
  // simple-git and @modelcontextprotocol/sdk are pure JS, bundle them
  external: ['electron'],
  banner: {
    js: '#!/usr/bin/env node',
  },
}).then(() => {
  fs.chmodSync(path.join(outDir, 'server.js'), '755')
  console.log('MCP server built: dist-mcp/server.js')
}).catch(err => {
  console.error('Build failed:', err)
  process.exit(1)
})
