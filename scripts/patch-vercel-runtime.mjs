#!/usr/bin/env node
// Rewrites any Vercel function .vc-config.json that uses the experimental
// `bun1.x` runtime to `nodejs22.x`. Nitro's vercel preset auto-selects bun1.x
// when the build runs under Bun, but that runtime cold-starts unreliably and
// returns 404: NOT_FOUND at the edge for this app.
//
// Runs as a post-build step on Vercel.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const FUNCTIONS_DIR = 'apps/web/.vercel/output/functions'
const TARGET_RUNTIME = 'nodejs22.x'

function walk(dir) {
  let count = 0
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      count += walk(full)
    } else if (entry === '.vc-config.json') {
      const cfg = JSON.parse(readFileSync(full, 'utf8'))
      if (cfg.runtime && cfg.runtime.startsWith('bun')) {
        cfg.runtime = TARGET_RUNTIME
        writeFileSync(full, JSON.stringify(cfg, null, 2))
        console.log(`[patch-vercel-runtime] ${full} -> ${TARGET_RUNTIME}`)
        count++
      }
    }
  }
  return count
}

try {
  const patched = walk(FUNCTIONS_DIR)
  console.log(`[patch-vercel-runtime] patched ${patched} function(s)`)
} catch (err) {
  console.warn(`[patch-vercel-runtime] skipped: ${err.message}`)
}
