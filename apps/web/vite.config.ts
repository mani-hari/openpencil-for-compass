import { defineConfig } from 'vitest/config'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { vitePluginSkills } from '../../packages/pen-ai-skills/vite-plugin-skills'

const isElectronBuild = process.env.BUILD_TARGET === 'electron'
// Vercel sets VERCEL=1 during builds; also detect explicit preset override.
const isVercel = !!process.env.VERCEL || process.env.NITRO_PRESET === 'vercel'

// Copy CanvasKit WASM files to public directory for runtime loading
function copyCanvasKitWasm() {
  const wasmDir = resolve('public/canvaskit')
  if (!existsSync(wasmDir)) mkdirSync(wasmDir, { recursive: true })
  const ckDir = resolve('../../node_modules/canvaskit-wasm/bin')
  const files = ['canvaskit.wasm']
  for (const file of files) {
    const src = resolve(ckDir, file)
    const dest = resolve(wasmDir, file)
    if (existsSync(src) && !existsSync(dest)) {
      copyFileSync(src, dest)
    }
  }
}
copyCanvasKitWasm()

const config = defineConfig({
  test: {
    teardownTimeout: 1000,
    include: [
      'src/**/*.test.ts',
      'server/**/*.test.ts',
      '../../packages/*/src/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  assetsInclude: ['**/*.wasm'],
  plugins: [
    vitePluginSkills(fileURLToPath(new URL('../../packages/pen-ai-skills', import.meta.url))),
    devtools(),
    nitro({
      rollupConfig: { external: [/^@sentry\//, 'canvas', 'jsdom', 'cssstyle', 'canvaskit-wasm'] },
      serverDir: './server',
      // On Vercel, let Nitro's `vercel` preset emit the Build Output API
      // structure to its default location (`apps/web/.vercel/output/`).
      // Elsewhere, keep custom output for Electron/Docker/CLI builds.
      ...(isVercel ? {} : { output: { dir: '../../out/web' } }),
      ...(isElectronBuild ? { preset: 'node-server' } : {}),
      ...(isVercel
        ? {
            preset: 'vercel',
            // Force Node runtime. Vercel's experimental bun1.x runtime (which
            // Nitro auto-selects when the build runs under Bun) cold-starts
            // unreliably for this app and returns 404: NOT_FOUND at the edge.
            vercel: {
              functions: { runtime: 'nodejs22.x', maxDuration: 30 },
            },
          }
        : {}),
    }),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
