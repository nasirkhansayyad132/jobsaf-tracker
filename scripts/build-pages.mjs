#!/usr/bin/env node

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detailFileName, indexRecord } from './split-feed.mjs'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const frontendDirectory = path.join(repositoryRoot, 'frontend')
const outputDirectory = path.join(frontendDirectory, 'dist')
const canonicalDataDirectory = path.join(repositoryRoot, 'docs', 'data')
const stalePublicData = path.join(frontendDirectory, 'public', 'data', 'jobs.json')
const dataFiles = ['jobs.json', 'summary.json']

// Validate the data as of the Kabul day it was generated. The site hides jobs
// whose deadline passed since then, so a rebuild days after the last refresh
// (for example a frontend-only change) must not fail on calendar drift.
async function dataGeneratedOn() {
  const summary = JSON.parse(await readFile(path.join(canonicalDataDirectory, 'summary.json'), 'utf8'))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(summary?.today || '')) {
    throw new Error('docs/data/summary.json is missing its generation date (today)')
  }
  return summary.today
}

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

const generatedOn = await dataGeneratedOn()
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
  '--today',
  generatedOn,
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

// Fast feed: the list index loads first; each job's full text loads on open.
const publishedJobs = JSON.parse(await readFile(path.join(artifactDataDirectory, 'jobs.json'), 'utf8'))
const detailDirectory = path.join(artifactDataDirectory, 'jobs')
await mkdir(detailDirectory, { recursive: true })
await writeFile(path.join(artifactDataDirectory, 'jobs-index.json'), JSON.stringify(publishedJobs.map(indexRecord)))
await Promise.all(publishedJobs.map(job => writeFile(path.join(detailDirectory, detailFileName(job)), JSON.stringify(job))))
console.log(`Fast feed ready: jobs-index.json plus ${publishedJobs.length} detail files`)

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
  '--today',
  generatedOn,
  '--require-relevance',
])
console.log(`Pages artifact ready at ${outputDirectory}`)
