#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { isStructuredDependencyPage } from './pdf-structured-lines.mjs'

const args = process.argv.slice(2)
const pdf = args.find((arg) => !arg.startsWith('--'))
const pagesArg = args.find((arg) => arg.startsWith('--render-pages='))

if (!pdf) {
  console.error('usage: check-pdf-layout.mjs <book.pdf> [--render-pages=1,2,middle,last]')
  process.exit(2)
}

if (!existsSync(pdf)) {
  console.error(`missing PDF: ${pdf}`)
  process.exit(1)
}

function command(commandName, commandArgs, options = {}) {
  const result = spawnSync(commandName, commandArgs, {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  })

  if (result.error || result.status !== 0) {
    const detail = `${result.stderr ?? ''}`.trim()
    throw new Error(`${commandName} failed${detail ? `: ${detail}` : ''}`)
  }

  return result.stdout
}

function attributes(tag) {
  const values = {}
  for (const match of tag.matchAll(/([A-Za-z][A-Za-z0-9]*)="([^"]+)"/g)) {
    values[match[1]] = Number(match[2])
  }
  return values
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function parsePgm(path) {
  const bytes = readFileSync(path)
  let offset = 0

  function token() {
    while (offset < bytes.length) {
      if (bytes[offset] === 35) {
        while (offset < bytes.length && bytes[offset] !== 10) offset += 1
      } else if (bytes[offset] <= 32) {
        offset += 1
      } else {
        break
      }
    }

    const start = offset
    while (offset < bytes.length && bytes[offset] > 32 && bytes[offset] !== 35) offset += 1
    return bytes.subarray(start, offset).toString('ascii')
  }

  if (token() !== 'P5') throw new Error(`unexpected raster format: ${path}`)
  const width = Number(token())
  const height = Number(token())
  const maximum = Number(token())
  while (offset < bytes.length && bytes[offset] <= 32) offset += 1

  if (!width || !height || maximum > 255) throw new Error(`unsupported PGM header: ${path}`)
  const pixels = bytes.subarray(offset, offset + width * height)
  let ink = 0
  for (const value of pixels) {
    if (value < 248) ink += 1
  }

  return { width, height, inkRatio: ink / pixels.length }
}

const info = command('pdfinfo', [pdf])
const pageCount = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1])
if (!pageCount) throw new Error(`pdfinfo reported no pages for ${pdf}`)

const bbox = command('pdftotext', ['-bbox-layout', pdf, '-'])
const pageMatches = [...bbox.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)]
const failures = []

if (pageMatches.length !== pageCount) {
  failures.push(`geometry parser found ${pageMatches.length} pages; pdfinfo found ${pageCount}`)
}

for (let index = 0; index < pageMatches.length; index += 1) {
  const pageNumber = index + 1
  const pageBox = attributes(pageMatches[index][1])
  const pageBody = pageMatches[index][2]
  const words = [...pageBody.matchAll(/<word\b([^>]*)>/g)]
  const lines = [...pageBody.matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/g)]

  for (const word of words) {
    const box = attributes(word[1])
    if (
      box.xMin < -1 ||
      box.yMin < -1 ||
      box.xMax > pageBox.width + 1 ||
      box.yMax > pageBox.height + 1
    ) {
      failures.push(`page ${pageNumber} contains text outside the page bounds`)
      break
    }
  }

  if (words.length < 50 || lines.length < 20) continue

  const lineStats = lines.map((line) => {
    const box = attributes(line[1])
    const wordCount = [...line[2].matchAll(/<word\b/g)].length
    return { wordCount, width: box.xMax - box.xMin }
  })
  const shortRatio = lineStats.filter((line) => line.wordCount <= 2).length / lineStats.length
  const medianWidthRatio = median(lineStats.map((line) => line.width)) / pageBox.width
  const lineBoxes = lines.map((line) => attributes(line[1]))
  const occupiedWidthRatio = (
    Math.max(...lineBoxes.map((line) => line.xMax)) -
    Math.min(...lineBoxes.map((line) => line.xMin))
  ) / pageBox.width

  if (shortRatio >= 0.65 && medianWidthRatio <= 0.28 && occupiedWidthRatio <= 0.45 &&
      !isStructuredDependencyPage(lines.map((line) => ({
        ...attributes(line[1]), xml: line[2],
      })), pageBox.height)) {
    failures.push(
      `page ${pageNumber} resembles a one-word column ` +
        `(short-line ratio ${shortRatio.toFixed(2)}, median width ${medianWidthRatio.toFixed(2)}, ` +
        `occupied width ${occupiedWidthRatio.toFixed(2)})`,
    )
  }
}

const requestedPages = (pagesArg?.split('=', 2)[1] ?? '1,2,middle,last').split(',')
const renderPages = [...new Set(requestedPages.map((value) => {
  if (value === 'middle') return Math.ceil(pageCount / 2)
  if (value === 'last') return pageCount
  return Math.max(1, Math.min(pageCount, Number(value)))
}).filter(Number.isInteger))].sort((left, right) => left - right)

const renderDir = mkdtempSync(join(tmpdir(), 'firstpair-pdf-check-'))
try {
  for (const pageNumber of renderPages) {
    const prefix = join(renderDir, `page-${pageNumber}`)
    command('pdftoppm', [
      '-f', String(pageNumber),
      '-l', String(pageNumber),
      '-singlefile',
      '-gray',
      '-r', '36',
      pdf,
      prefix,
    ])
    const raster = parsePgm(`${prefix}.pgm`)
    if (raster.inkRatio < 0.0008) {
      failures.push(`rendered page ${pageNumber} is visually blank (${raster.inkRatio.toFixed(5)} ink)`)
    }
  }
} finally {
  rmSync(renderDir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`PDF layout verification failed: ${pdf}`)
  for (const failure of [...new Set(failures)]) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(
  `PDF layout passed: ${basename(pdf)} (${pageCount} pages; rendered ${renderPages.join(', ')})`,
)
