/**
 * コミットの実際のパッチを取り出す。
 *
 * 解析層はこれまで `--numstat`（ファイル名と増減行数）と件名・本文しか読んでおらず、
 * 「どのファイルを何行いじったか」は持っていても「何を書いたか」は捨てていた。
 * 沼（詰まった箇所）を外部のエージェントに渡して「技術的に何を試して何が効いたか」を
 * 蒸留させるには、パッチ本文が要る。
 *
 * 前提と制約（呼ぶ側が知っておくべきこと）:
 * - GitHub キャッシュは `--filter=blob:limit=100k` なので、**100KB以上のファイルは
 *   中身が手元に無い**。取れなかったものは黙って省かず `skipped` に理由つきで返す。
 *   「差分が無い」と「差分が取れない」を取り違えさせないため。
 * - 部分クローンは手元に無いオブジェクトに触れると勝手にネットワークへ出る。
 *   `GIT_NO_LAZY_FETCH=1` を必ず渡す（解析側と同じ理由。実測で78秒→2秒の差）。
 * - 沼1件が数十コミットになることがあり、全文を返すと簡単に数十万トークンになる。
 *   既定で行数・ファイル数に上限をかけ、**削ったことを必ず返り値に書く**。
 */
import simpleGit, { type SimpleGit } from 'simple-git'
import { isSignalFile } from './paths'

export interface CommitPatch {
  hash: string
  /** 取れたパッチ（unified diff）。ファイルごとに区切られている */
  files: { path: string; patch: string; truncated: boolean }[]
  /** 取れなかったファイルと、その理由 */
  skipped: { path: string; reason: string }[]
}

export interface PatchOptions {
  /** 1ファイルあたりの最大行数。超えたら切って truncated を立てる */
  maxLinesPerFile?: number
  /** 1コミットあたりの最大ファイル数 */
  maxFilesPerCommit?: number
  /** 差分の文脈行数。既定1（3行だと量が3倍近くなる） */
  context?: number
  /** これに含まれるパスだけを返す（沼の中心ファイルに絞るとき用） */
  onlyPaths?: string[]
}

const DEFAULTS = {
  maxLinesPerFile: 400,
  maxFilesPerCommit: 12,
  context: 1,
}

/** 解析層と同じ設定の git。遅延取得を止めるのが要点 */
function gitAt(repoPath: string): SimpleGit {
  // env はキー単位で渡す。オブジェクトごと渡すと環境を置き換える扱いになり、
  // PAGER を含むと simple-git に拒否されて全部落ちる
  return simpleGit(repoPath).env('GIT_NO_LAZY_FETCH', '1')
}

/**
 * 1コミットのパッチを、ファイル単位に分けて返す。
 * マージコミットは `-m --first-parent` で1つ目の親との差分を見る
 * （既定だと差分が空になり「変更なし」に化ける）。
 */
export async function getCommitPatch(
  repoPath: string, hash: string, opts: PatchOptions = {},
): Promise<CommitPatch> {
  const o = { ...DEFAULTS, ...opts }
  const git = gitAt(repoPath)
  const out: CommitPatch = { hash, files: [], skipped: [] }

  let raw: string
  try {
    raw = await git.raw([
      'show', hash,
      '--first-parent', '-m',
      `--unified=${o.context}`,
      '--format=',              // ヘッダは要らない。メタは既に解析層が持っている
      '--no-color',
      '--no-ext-diff',
    ])
  } catch (e) {
    // blob が手元に無い（blob:limit で落とした大きいファイル）か、
    // depth の外にいて親が無いか。どちらも「取れなかった」として明示する
    out.skipped.push({ path: '*', reason: shortError(e) })
    return out
  }

  const chunks = splitByFile(raw)
  for (const c of chunks) {
    if (!isSignalFile(c.path)) continue                       // lock ファイル・dist 等
    if (opts.onlyPaths && !opts.onlyPaths.includes(c.path)) continue
    if (out.files.length >= o.maxFilesPerCommit) {
      out.skipped.push({ path: c.path, reason: `ファイル数の上限 ${o.maxFilesPerCommit} を超えた` })
      continue
    }
    const lines = c.patch.split('\n')
    const truncated = lines.length > o.maxLinesPerFile
    out.files.push({
      path: c.path,
      patch: truncated
        ? lines.slice(0, o.maxLinesPerFile).join('\n') + `\n… 以下 ${lines.length - o.maxLinesPerFile} 行を省略`
        : c.patch,
      truncated,
    })
  }
  return out
}

/** 複数コミットぶん。沼1件をまるごと渡すとき用 */
export async function getPatches(
  repoPath: string, hashes: string[], opts: PatchOptions = {},
): Promise<CommitPatch[]> {
  const out: CommitPatch[] = []
  for (const h of hashes) {
    out.push(await getCommitPatch(repoPath, h, opts))
  }
  return out
}

/**
 * `git show` の出力を `diff --git a/x b/x` ごとに切る。
 * パスは `+++ b/<path>` から取る（`diff --git` の行はスペースを含むパスで壊れる）。
 */
export function splitByFile(raw: string): { path: string; patch: string }[] {
  const out: { path: string; patch: string }[] = []
  const lines = raw.split('\n')
  let cur: string[] = []
  let path = ''

  const flush = () => {
    if (path && cur.length > 0) out.push({ path, patch: cur.join('\n').trimEnd() })
    cur = []; path = ''
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) { flush(); cur = [line]; continue }
    if (cur.length === 0) continue
    cur.push(line)
    if (!path && line.startsWith('+++ b/')) path = line.slice(6)
    // 削除されたファイルは `+++ /dev/null` なので、`--- a/` 側から拾う
    if (!path && line.startsWith('--- a/')) path = line.slice(6)
  }
  flush()
  return out
}

function shortError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  const first = m.split('\n').find(l => l.trim().length > 0) ?? m
  return first.length > 200 ? first.slice(0, 200) + '…' : first
}
