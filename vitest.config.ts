import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// アプリ用 vite.config.ts は electron プラグインを積んでいて、テスト実行時に
// electron のビルドまで走ってしまう。テストは解析ロジック（純粋関数）だけを
// 対象にするので、専用の設定を分けている。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
    },
  },
})
