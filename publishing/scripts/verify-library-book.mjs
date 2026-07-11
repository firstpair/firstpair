#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(process.argv[2] ?? 'docs/book/dist')
const markerPath = join(distDir, 'VERSION.md')
const failures = []

function parseMarker(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)
    if (match) values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return values
}

function command(name, args, options = {}) {
  const result = spawnSync(name, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  })
  if (result.error || result.status !== 0) {
    const detail = `${result.stderr ?? ''}`.trim()
    throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`)
  }
  return result.stdout
}

function present(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

function requireField(marker, key) {
  if (!marker[key]) failures.push(`VERSION.md is missing ${key}`)
}

function verifyVersionedPair(marker, fileKey, linkKey) {
  const stable = marker[fileKey]
  const versioned = marker[linkKey]
  if (!stable && !versioned) return
  if (!stable || !versioned) {
    failures.push(`VERSION.md has an incomplete ${fileKey}/${linkKey} pair`)
    return
  }

  const stablePath = join(distDir, stable)
  const linkPath = join(distDir, versioned)
  if (!present(stablePath)) failures.push(`missing stable artifact: ${stable}`)
  if (!present(linkPath)) {
    failures.push(`missing versioned artifact: ${versioned}`)
    return
  }

  if (lstatSync(linkPath).isSymbolicLink()) {
    if (basename(readlinkSync(linkPath)) !== basename(stable)) {
      failures.push(`bad symlink target for ${versioned}: ${readlinkSync(linkPath)}`)
    }
  } else if (present(stablePath)) {
    const stableBytes = readFileSync(stablePath)
    const versionedBytes = readFileSync(linkPath)
    if (!stableBytes.equals(versionedBytes)) {
      failures.push(`versioned artifact differs from stable artifact: ${versioned}`)
    }
  }
}

function stripMarkup(text) {
  return text
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[A-Za-z0-9#]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function localResourceTarget(value) {
  if (!value || value.startsWith('#') || value.startsWith('/') || value.startsWith('//')) return null
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return null
  const withoutSuffix = value.split(/[?#]/, 1)[0]
  if (!withoutSuffix) return null
  try {
    return decodeURIComponent(withoutSuffix)
  } catch {
    return withoutSuffix
  }
}

function resourceReferences(text) {
  return [...text.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)].map((match) => match[1])
}

function verifyHtmlResources(text, path, label) {
  for (const reference of resourceReferences(text)) {
    const target = localResourceTarget(reference)
    if (!target) continue
    if (/\.md$/i.test(target)) failures.push(`${label} links to source Markdown: ${reference}`)
    else if (!present(resolve(dirname(path), target))) failures.push(`${label} has a missing local resource: ${reference}`)
  }
}

function verifyHtml(path, label, minimumWords = 30) {
  if (!present(path)) {
    failures.push(`missing ${label}: ${basename(path)}`)
    return
  }
  const text = readFileSync(path, 'utf8')
  if (!/<html\b/i.test(text)) failures.push(`${label} has no html element: ${basename(path)}`)
  if (!/<title\b[^>]*>[^<]+/i.test(text)) failures.push(`${label} has no document title: ${basename(path)}`)
  if (stripMarkup(text).split(/\s+/).length < minimumWords) failures.push(`${label} contains too little readable text`)
  if (/\b(?:src|href)=["'](?:file:\/\/\/|\/Users\/[^/]+\/)/i.test(text)) {
    failures.push(`${label} leaks a local absolute resource link`)
  }
  verifyHtmlResources(text, path, label)
}

let marker
try {
  marker = parseMarker(readFileSync(markerPath, 'utf8'))
} catch (error) {
  console.error(`missing or unreadable VERSION.md: ${markerPath}`)
  process.exit(1)
}

for (const key of [
  'title',
  'title_stem',
  'edition',
  'version',
  'version_stamp',
  'source_commit',
  'built_at',
  'pdf_file',
  'epub_file',
  'html_file',
  'html_chapters_dir',
]) requireField(marker, key)

if (marker.edition && !['preview', 'full'].includes(marker.edition)) {
  failures.push(`edition must be preview or full, got ${marker.edition}`)
}

verifyVersionedPair(marker, 'pdf_file', 'pdf_link')
verifyVersionedPair(marker, 'epub_file', 'epub_link')
if (marker.kindle_link) verifyVersionedPair(marker, 'epub_file', 'kindle_link')
verifyVersionedPair(marker, 'html_file', 'html_link')

for (const key of Object.keys(marker).filter((key) => key.startsWith('pdf_file_'))) {
  verifyVersionedPair(marker, key, key.replace('pdf_file_', 'pdf_link_'))
}
for (const key of Object.keys(marker).filter((key) => key.startsWith('epub_file_'))) {
  verifyVersionedPair(marker, key, key.replace('epub_file_', 'epub_link_'))
}

const pdfFiles = [...new Set(Object.entries(marker)
  .filter(([key]) => key === 'pdf_file' || key.startsWith('pdf_file_'))
  .map(([, value]) => value)
  .filter(Boolean))]
for (const pdfFile of pdfFiles) {
  if (!present(join(distDir, pdfFile))) continue
  const result = spawnSync(join(scriptDir, 'check-pdf-layout.mjs'), [join(distDir, pdfFile)], {
    stdio: 'inherit',
  })
  if (result.status !== 0) failures.push(`PDF layout check failed: ${pdfFile}`)
}

if (marker.epub_file && present(join(distDir, marker.epub_file))) {
  const epubPath = join(distDir, marker.epub_file)
  try {
    command('unzip', ['-tqq', epubPath])
    const entries = command('unzip', ['-Z1', epubPath]).split(/\r?\n/).filter(Boolean)
    const container = command('unzip', ['-p', epubPath, 'META-INF/container.xml'])
    const opfName = /full-path=["']([^"']+)["']/.exec(container)?.[1]
    if (!opfName) {
      failures.push('EPUB container does not identify an OPF package')
    } else {
      const opf = command('unzip', ['-p', epubPath, opfName])
      for (const [label, pattern] of [
        ['title', /<dc:title\b[^>]*>\s*[^<\s]/i],
        ['creator', /<dc:creator\b[^>]*>\s*[^<\s]/i],
        ['language', /<dc:language\b[^>]*>\s*[^<\s]/i],
        ['spine', /<spine\b/i],
      ]) {
        if (!pattern.test(opf)) failures.push(`EPUB metadata/package is missing ${label}`)
      }
    }
    const entrySet = new Set(entries)
    const contentEntries = entries.filter((entry) => /\.(xhtml|html)$/i.test(entry))
    if (contentEntries.length === 0) failures.push('EPUB contains no XHTML content')
    let wordCount = 0
    for (const entry of contentEntries) {
      const content = command('unzip', ['-p', epubPath, entry])
      wordCount += stripMarkup(content).split(/\s+/).filter(Boolean).length
      for (const reference of resourceReferences(content)) {
        const target = localResourceTarget(reference)
        if (!target) continue
        if (/\.md$/i.test(target)) {
          failures.push(`EPUB content links to source Markdown: ${reference}`)
          continue
        }
        const archivePath = posix.normalize(posix.join(posix.dirname(entry), target))
        if (!entrySet.has(archivePath)) failures.push(`EPUB content has a missing resource: ${reference}`)
      }
    }
    if (wordCount < 30) failures.push('EPUB contains too little readable text')
  } catch (error) {
    failures.push(`EPUB verification failed: ${error.message}`)
  }
}

if (marker.html_file) verifyHtml(join(distDir, marker.html_file), 'single-file HTML')

if (marker.html_chapters_dir) {
  const chaptersDir = join(distDir, marker.html_chapters_dir)
  if (!present(chaptersDir) || !statSync(chaptersDir).isDirectory()) {
    failures.push(`missing chapter HTML directory: ${marker.html_chapters_dir}`)
  } else {
    const htmlFiles = readdirSync(chaptersDir).filter((entry) => entry.endsWith('.html'))
    if (!htmlFiles.includes('index.html')) failures.push('chapter HTML directory has no index.html')
    if (htmlFiles.length < 2) failures.push('chapter HTML directory contains fewer than two HTML files')
    for (const entry of htmlFiles) verifyHtml(join(chaptersDir, entry), `chapter HTML ${entry}`, 5)
  }
}

if (marker.html_chapters_link) {
  const linkPath = join(distDir, marker.html_chapters_link)
  if (!present(linkPath)) failures.push(`missing versioned chapter package: ${marker.html_chapters_link}`)
  else if (lstatSync(linkPath).isSymbolicLink() && basename(readlinkSync(linkPath)) !== marker.html_chapters_dir) {
    failures.push(`bad chapter symlink target: ${readlinkSync(linkPath)}`)
  }
}

if (marker.tutorial_file && !present(join(distDir, marker.tutorial_file))) {
  failures.push(`missing tutorial artifact: ${marker.tutorial_file}`)
}

if (failures.length > 0) {
  console.error(`Library book verification failed: ${distDir}`)
  for (const failure of [...new Set(failures)]) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`Library book contract passed: ${markerPath}`)
