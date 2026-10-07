#!/usr/bin/env node
// 開発モード: Vite の開発サーバー + esbuild の watch + Electron。
// main / preload が組み直されたら Electron を立ち上げ直す。
import { createServer } from 'vite'
import * as esbuild from 'esbuild'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { targets } from './build.mjs'

const require = createRequire(import.meta.url)
const electronBin = require('electron')

const vite = await createServer({ configFile: 'vite.config.mts' })
await vite.listen()
const url = vite.resolvedUrls?.local[0]
if (!url) throw new Error('vite の URL が取れなかった')
console.log(`[dev] renderer: ${url}`)

let child = null
let restarting = false

function startElectron() {
  child = spawn(electronBin, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url, NODE_ENV: 'development' },
  })
  child.on('exit', code => {
    if (restarting) { restarting = false; return }
    console.log(`[dev] electron exited (${code ?? 'signal'})`)
    shutdown()
  })
}

function restartElectron() {
  if (!child) { startElectron(); return }
  restarting = true
  child.once('exit', () => startElectron())
  child.kill()
}

async function shutdown() {
  await vite.close()
  process.exit(0)
}

let ready = 0
const dev = { ...targets.main, define: { 'process.env.NODE_ENV': '"development"' } }
const devPreload = { ...targets.preload, define: { 'process.env.NODE_ENV': '"development"' } }
for (const t of [dev, devPreload]) {
  const ctx = await esbuild.context({
    ...t,
    logLevel: 'warning',
    plugins: [{
      name: 'restart-electron',
      setup(b) {
        b.onEnd(result => {
          if (result.errors.length > 0) return
          ready++
          if (ready === 2) startElectron()           // 2つ揃ってから初回起動
          else if (ready > 2) restartElectron()
        })
      },
    }],
  })
  await ctx.watch()
}

process.on('SIGINT', () => { child?.kill(); shutdown() })
process.on('SIGTERM', () => { child?.kill(); shutdown() })
