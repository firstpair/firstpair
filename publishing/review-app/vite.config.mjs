import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { firstpairShared, reviewData, reviewDecisions } from './vite/plugins.js'

// The shared FirstPair reader modules (CommonJS, also bundled into the
// Obsidian plugins) are imported as they are from the firstpair-reader
// repository ($FIRSTPAIR_READER_ROOT, default ~/src/firstpair-reader); see
// vite/plugins.js.
const readerRoot = process.env.FIRSTPAIR_READER_ROOT || path.join(os.homedir(), 'src', 'firstpair-reader')
const plugins = path.join(readerRoot, 'plugins')
if (!fs.existsSync(path.join(plugins, 'shared'))) {
  throw new Error(`firstpair-reader is not checked out at ${readerRoot}; clone github.com/firstpair/firstpair-reader there or set FIRSTPAIR_READER_ROOT`)
}

export default defineConfig({
  plugins: [
    vue(),
    firstpairShared(plugins),
    // REVIEW_DATA: the book's exported data folder (firstpair.review.v1).
    reviewData(process.env.REVIEW_DATA, { includeInBuild: process.env.REVIEW_INCLUDE_DATA === '1' }),
    // REVIEW_DECISIONS: where the dev server saves the decisions ledger.
    reviewDecisions(process.env.REVIEW_DECISIONS),
  ],
  resolve: { alias: { '@firstpair': plugins } },
  server: { host: '127.0.0.1', port: 5190, fs: { allow: [plugins, '.'] } },
  worker: { format: 'es' },
})
