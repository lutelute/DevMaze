import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// レンダラー専用。main / preload / MCP は scripts/build.mjs（esbuild）が束ねる。
// base を './' にするのは、配布物では file:// で dist/index.html を開くため。
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'shared'),
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome140',
  },
  server: { port: 5173, strictPort: false },
})
