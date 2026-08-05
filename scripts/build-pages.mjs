#!/usr/bin/env node

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const frontendDirectory = path.join(repositoryRoot, 'frontend')
const outputDirectory = path.join(frontendDirectory, 'dist')
const canonicalDataDirectory = path.join(repositoryRoot, 'docs', 'data')
const stalePublicData = path.join(frontendDirectory, 'public', 'data', 'jobs.json')
const dataFiles = ['jobs.json', 'summary.json']

function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
}

async function assertMissing(filePath, message) {
  try {
    await stat(filePath)
    throw new Error(message)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

await assertMissing(
  stalePublicData,
  'frontend/public/data/jobs.json must not exist; docs/data/jobs.json is the canonical data source.',
)

run(process.execPath, [
  path.join(repositoryRoot, 'scripts', 'validate-data.mjs'),
  path.join(canonicalDataDirectory, 'jobs.json'),
  path.join(canonicalDataDirectory, 'summary.json'),
  '--min-jobs',
  '10',
  '--min-sources',
  '3',
  '--max-expired',
  '0',
  '--require-relevance',
])
run('npm', ['run', 'build'], frontendDirectory)

const artifactDataDirectory = path.join(outputDirectory, 'data')
await mkdir(artifactDataDirectory, { recursive: true })
for (const fileName of dataFiles) {
  const source = path.join(canonicalDataDirectory, fileName)
  const destination = path.join(artifactDataDirectory, fileName)
  await copyFile(source, destination)

  const [sourceContents, artifactContents] = await Promise.all([readFile(source), readFile(destination)])
  if (!sourceContents.equals(artifactContents)) throw new Error(`Artifact copy verification failed for ${fileName}`)
}
await writeFile(path.join(outputDirectory, '.nojekyll'), '')

run(process.execPath, [
  path.join(repositoryRoot, 'scripts', 'validate-data.mjs'),
  path.join(artifactDataDirectory, 'jobs.json'),
  path.join(artifactDataDirectory, 'summary.json'),
  '--min-jobs',
  '10',
  '--min-sources',
  '3',
  '--max-expired',
  '0',
  '--require-relevance',
])
console.log(`Pages artifact ready at ${outputDirectory}`)
