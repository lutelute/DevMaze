import type { CommitNode } from '../types'

// 自動生成物・ロックファイル・ベンダ配下は、変更が「作業の跡」を意味しないので除外する
const NOISY_FILE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock)$|(^|\/)(dist|dist-electron|dist-mcp|build|out|node_modules|coverage|vendor|\.next|__pycache__)\//

export const isSignalFile = (path: string): boolean =>
  path.length > 0 && !NOISY_FILE.test(path)

export const signalFiles = (c: CommitNode): string[] => c.files.filter(isSignalFile)

// 一度に大量のファイルを触る「なぎ払い」コミット（初回インポート・一括整形・リリース）は、
// どのファイルにも等しく現れるため「この場所で作業した」の証拠として弱い。
export const FOCUSED_MAX_FILES = 25

export const isFocused = (c: CommitNode): boolean =>
  c.filesChanged > 0 && c.filesChanged <= FOCUSED_MAX_FILES

export const fileLabel = (path: string): string => path.split('/').pop() ?? path
