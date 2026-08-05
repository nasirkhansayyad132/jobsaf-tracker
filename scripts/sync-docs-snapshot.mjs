#!/usr/bin/env node

import { copyFile, lstat, mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const frontendDirectory = path.join(repositoryRoot, 'frontend')
const artifactDirectory = path.join(frontendDirectory, 'dist')
const docsDirectory = path.join(repositoryRoot, 'docs')
const docsDataDirectory = path.join(docsDirectory, 'data')
const generatedTopLevel = /^(?:\.nojekyll|index\.html|manifest\.webmanifest|pwa-(?:192x192|512x512)\.png|registerSW\.js|sw\.js|vite\.svg|workbox-[A-Za-z0-9_-]+\.js)$/
const generatedAsset = /^[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.(?:css|js|map)$/

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
}

async function assertRealDirectory(directory) {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Refusing to sync because ${directory} is not a real directory`)
  }
}

async function listValidatedFiles(directory, pattern, label) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !pattern.test(entry.name)) {
      throw new Error(`Refusing to modify unexpected ${label} entry: ${path.join(directory, entry.name)}`)
    }
    files.push(path.join(directory, entry.name))
  }
  return files
}

await assertRealDirectory(docsDirectory)
await assertRealDirectory(docsDataDirectory)
const canonicalDataBefore = new Map(
  await Promise.all(
    ['jobs.json', 'summary.json'].map(async fileName => [
      fileName,
      await readFile(path.join(docsDataDirectory, fileName)),
    ]),
  ),
)

run(process.execPath, [path.join(repositoryRoot, 'scripts', 'build-pages.mjs')])

const artifactEntries = await readdir(artifactDirectory, { withFileTypes: true })
for (const entry of artifactEntries) {
  if (entry.name === 'assets' || entry.name === 'data') continue
  if (!entry.isFile() || entry.isSymbolicLink() || !generatedTopLevel.test(entry.name)) {
    throw new Error(`Unexpected Pages artifact entry: ${path.join(artifactDirectory, entry.name)}`)
  }
}

const existingTopLevel = await readdir(docsDirectory, { withFileTypes: true })
for (const entry of existingTopLevel) {
  if (generatedTopLevel.test(entry.name) && (!entry.isFile() || entry.isSymbolicLink())) {
    throw new Error(`Refusing to replace non-file docs entry: ${path.join(docsDirectory, entry.name)}`)
  }
}
const removableTopLevel = existingTopLevel
  .filter(entry => entry.isFile() && !entry.isSymbolicLink() && generatedTopLevel.test(entry.name))
  .map(entry => path.join(docsDirectory, entry.name))

const docsAssets = path.join(docsDirectory, 'assets')
await mkdir(docsAssets, { recursive: true })
await assertRealDirectory(docsAssets)
const removableAssets = await listValidatedFiles(docsAssets, generatedAsset, 'docs asset')

// Every deletion target has now been enumerated, type-checked, and constrained.
for (const file of [...removableTopLevel, ...removableAssets]) await unlink(file)

for (const entry of artifactEntries) {
  if (!entry.isFile()) continue
  await copyFile(path.join(artifactDirectory, entry.name), path.join(docsDirectory, entry.name))
}

const artifactAssets = path.join(artifactDirectory, 'assets')
const generatedAssets = await listValidatedFiles(artifactAssets, generatedAsset, 'artifact asset')
for (const file of generatedAssets) await copyFile(file, path.join(docsAssets, path.basename(file)))

for (const [fileName, before] of canonicalDataBefore) {
  const after = await readFile(path.join(docsDataDirectory, fileName))
  if (!before.equals(after)) throw new Error(`Safety invariant failed: docs/data/${fileName} changed`)
}

run(process.execPath, [
  path.join(repositoryRoot, 'scripts', 'validate-data.mjs'),
  path.join(docsDataDirectory, 'jobs.json'),
  path.join(docsDataDirectory, 'summary.json'),
  '--min-jobs',
  '10',
  '--min-sources',
  '3',
  '--max-expired',
  '0',
  '--require-relevance',
])
console.log(`Data-preserving docs snapshot updated at ${docsDirectory}`)
