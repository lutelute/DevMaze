import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// 既定は node 環境（解析層・レイアウト・ナレッジは純粋関数）。
// 画面側のテストはファイル先頭の `// @vitest-environment jsdom` で切り替える。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'shared'),
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
})
