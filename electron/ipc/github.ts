import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// DevMaze が解析する最大コミット数に合わせた上限
const FETCH_DEPTH = 1000

function githubReposDir(): string {
  return path.join(app.getPath('userData'), 'github-repos')
}

export interface ParsedGithubRepo {
  url: string
  owner: string
  name: string
  localPath: string
}

export function parseGithubInput(input: string): ParsedGithubRepo | null {
  const s = input.trim().replace(/\.git$/, '')

  // user/repo 形式
  const short = s.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/)
  if (short) {
    const [, owner, name] = short
    return {
      url: `https://github.com/${owner}/${name}.git`,
      owner,
      name,
      localPath: path.join(githubReposDir(), owner, `${name}.git`),
    }
  }

  // https://github.com/user/repo
  const url = s.match(/https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\/.*)?$/)
  if (url) {
    const [, owner, name] = url
    return {
      url: `https://github.com/${owner}/${name}.git`,
      owner,
      name,
      localPath: path.join(githubReposDir(), owner, `${name}.git`),
    }
  }

  return null
}

export async function ensureGithubRepo(
  input: string,
  onProgress: (msg: string) => void
): Promise<string> {
  const parsed = parseGithubInput(input)
  if (!parsed) throw new Error(
    `形式が不正です: "${input}"\n例: lutelute/AtelierX または https://github.com/lutelute/AtelierX`
  )

  const { url, owner, name, localPath } = parsed

  if (fs.existsSync(path.join(localPath, 'HEAD'))) {
    // 既に取得済み → 差分のみ fetch
    onProgress(`${owner}/${name} の新着コミットを確認中...`)
    await execFileAsync('git', [
      '--git-dir', localPath,
      'fetch',
      '--filter=blob:none',    // ファイル内容は取らない
      `--depth=${FETCH_DEPTH}`, // 最大1000件に収める
      '--quiet',
    ], { timeout: 60_000 })
    onProgress('最新化完了')
  } else {
    // 初回 —— commit/tree メタデータのみ、最大1000件
    fs.mkdirSync(path.dirname(localPath), { recursive: true })
    onProgress(`${owner}/${name} のコミット履歴を取得中（ファイル内容なし、最大${FETCH_DEPTH}件）...`)
    await execFileAsync('git', [
      'clone', '--bare',
      '--filter=blob:none',    // ファイル内容は取らない
      `--depth=${FETCH_DEPTH}`, // コミット数を1000に制限
      '--quiet',
      url, localPath,
    ], { timeout: 120_000 })
    onProgress('取得完了')
  }

  return localPath
}
