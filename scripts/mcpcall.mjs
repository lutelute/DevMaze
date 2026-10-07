#!/usr/bin/env node
// MCP サーバーを stdio で直接叩く簡易クライアント。
//   node scripts/mcpcall.mjs                       → tools/list
//   node scripts/mcpcall.mjs scan_repo '{"repo_path":"/path"}'
// 環境変数 MCP_SERVER で別の server.js を指定できる。
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const serverPath = process.env.MCP_SERVER ?? join(root, 'dist-mcp', 'server.js')
const [tool, rawArgs] = process.argv.slice(2)
const args = rawArgs ? JSON.parse(rawArgs) : {}

const child = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] })
let buf = ''
const pending = new Map()
let nextId = 1

child.stdout.on('data', chunk => {
  buf += chunk.toString()
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})

function send(method, params) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((resolve, reject) => {
    // タイマーは応答が来たら消す。消さないとイベントループが 180 秒生き続け、
    // 呼び出し1回ごとに 3 分待たされる
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)) }
    }, 180_000)
    pending.set(id, msg => {
      clearTimeout(timer)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    })
  })
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

try {
  const init = await send('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'mcpcall', version: '0.1' },
  })
  notify('notifications/initialized', {})
  console.error(`[mcpcall] server: ${init.serverInfo?.name} ${init.serverInfo?.version}`)

  if (!tool) {
    const list = await send('tools/list', {})
    console.log(`${list.tools.length} tools`)
    for (const t of list.tools) {
      const keys = Object.keys(t.inputSchema?.properties ?? {})
      console.log(`- ${t.name}(${keys.join(', ')})`)
    }
  } else {
    const t0 = Date.now()
    const res = await send('tools/call', { name: tool, arguments: args })
    const ms = Date.now() - t0
    for (const c of res.content ?? []) {
      if (c.type === 'text') console.log(c.text)
      else console.log(JSON.stringify(c))
    }
    console.error(`[mcpcall] ${tool}: ${ms}ms${res.isError ? ' (isError)' : ''}`)
    if (res.isError) process.exitCode = 2
  }
} catch (e) {
  console.error(`[mcpcall] ${e.message}`)
  process.exitCode = 1
} finally {
  child.kill()
  setTimeout(() => process.exit(), 50).unref()
}
