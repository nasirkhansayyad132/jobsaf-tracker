#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const HTTP_PROTOCOLS = new Set(['http:', 'https:'])
const APPLICATION_METHODS = new Set(['email', 'web', 'phone', 'unknown'])
const SUBJECT_TYPES = new Set(['exact', 'reference', 'title_template'])
const SUMMARY_ID_LISTS = [
  ['new_job_ids', 'new_count'],
  ['expiring_today_ids', 'expiring_today_count'],
  ['expiring_soon_ids', 'expiring_soon_count'],
  ['tech_banking_job_ids', 'tech_banking_count'],
]

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidDateOnly(value) {
  if (!DATE_ONLY.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function isValidTimestamp(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

function isValidUrl(value, protocols = HTTP_PROTOCOLS) {
  if (!isNonEmptyString(value)) return false
  try {
    return protocols.has(new URL(value).protocol)
  } catch {
    return false
  }
}

function push(errors, location, message) {
  errors.push(`${location}: ${message}`)
}

function validateStringArray(errors, value, location) {
  if (!Array.isArray(value)) {
    push(errors, location, 'must be an array')
    return
  }

  value.forEach((entry, index) => {
    if (!isNonEmptyString(entry)) push(errors, `${location}[${index}]`, 'must be a non-empty string')
  })
}

function validateRelevance(errors, relevance, location) {
  if (!isObject(relevance)) {
    push(errors, location, 'must be an object')
    return
  }

  if (relevance.version !== 2) push(errors, `${location}.version`, 'must be 2')

  for (const field of ['score', 'threshold']) {
    if (!Number.isFinite(relevance[field]) || relevance[field] < 0) {
      push(errors, `${location}.${field}`, 'must be a non-negative number')
    }
  }

  if (relevance.decision !== 'include') {
    push(errors, `${location}.decision`, 'published jobs must have decision "include"')
  }

  if (
    Number.isFinite(relevance.score) &&
    Number.isFinite(relevance.threshold) &&
    relevance.score < relevance.threshold
  ) {
    push(errors, location, 'published job score is below its inclusion threshold')
  }

  validateStringArray(errors, relevance.reasons, `${location}.reasons`)
  if (Array.isArray(relevance.reasons) && relevance.reasons.length === 0) {
    push(errors, `${location}.reasons`, 'must explain why the job was included')
  }
}

export function kabulDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kabul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function validateJobs(jobs, options = {}) {
  const errors = []
  const warnings = []
  const today = options.today ?? kabulDate()
  const minJobs = options.minJobs ?? 1
  const minSources = options.minSources ?? 1
  const requireRelevance = options.requireRelevance ?? false
  const maxExpired = options.maxExpired
  const ids = new Map()
  const urls = new Map()
  const sources = new Map()
  let expiredCount = 0
  let relevanceCount = 0

  if (!Array.isArray(jobs)) {
    return {
      errors: ['jobs: top-level value must be an array'],
      warnings,
      metrics: { total: 0, sources: {}, expired: 0, relevanceCoverage: 0 },
    }
  }

  if (jobs.length < minJobs) push(errors, 'jobs', `contains ${jobs.length}; expected at least ${minJobs}`)

  jobs.forEach((job, index) => {
    const location = `jobs[${index}]`
    if (!isObject(job)) {
      push(errors, location, 'must be an object')
      return
    }

    for (const field of ['id', 'source', 'url', 'title', 'company']) {
      if (!isNonEmptyString(job[field])) push(errors, `${location}.${field}`, 'must be a non-empty string')
    }

    if (isNonEmptyString(job.id)) {
      if (ids.has(job.id)) push(errors, `${location}.id`, `duplicates ${ids.get(job.id)}`)
      else ids.set(job.id, location)
    }

    if (isNonEmptyString(job.url)) {
      if (!isValidUrl(job.url)) push(errors, `${location}.url`, 'must be an absolute HTTP(S) URL')
      if (urls.has(job.url)) push(errors, `${location}.url`, `duplicates ${urls.get(job.url)}`)
      else urls.set(job.url, location)
    }

    if (job.source_url != null && !isValidUrl(job.source_url)) {
      push(errors, `${location}.source_url`, 'must be an absolute HTTP(S) URL')
    }

    if (job.apply_url != null) {
      const protocols = new Set([...HTTP_PROTOCOLS, 'mailto:'])
      if (!isValidUrl(job.apply_url, protocols)) {
        push(errors, `${location}.apply_url`, 'must be an absolute HTTP(S) or mailto URL')
      }
    }

    if (isNonEmptyString(job.source)) {
      sources.set(job.source, (sources.get(job.source) ?? 0) + 1)
    }

    for (const dateField of ['post_date', 'closing_date']) {
      if (job[dateField] == null || job[dateField] === '') continue
      if (!isNonEmptyString(job[dateField]) || !isValidDateOnly(job[dateField])) {
        push(errors, `${location}.${dateField}`, 'must be a real YYYY-MM-DD date')
      } else if (dateField === 'closing_date' && job[dateField] < today) {
        expiredCount += 1
      }
    }

    for (const timestampField of ['scraped_at', 'first_seen_at', 'last_seen_at']) {
      if (!isValidTimestamp(job[timestampField])) {
        push(errors, `${location}.${timestampField}`, 'must be a valid timestamp')
      }
    }
    if (
      isValidTimestamp(job.first_seen_at) &&
      isValidTimestamp(job.last_seen_at) &&
      Date.parse(job.first_seen_at) > Date.parse(job.last_seen_at)
    ) {
      push(errors, location, 'first_seen_at cannot be later than last_seen_at')
    }

    if (job.details != null && !isObject(job.details)) {
      push(errors, `${location}.details`, 'must be an object when present')
    }

    for (const arrayField of ['apply_emails', 'apply_phones']) {
      if (job[arrayField] != null) validateStringArray(errors, job[arrayField], `${location}.${arrayField}`)
    }

    if (!APPLICATION_METHODS.has(job.application_method)) {
      push(errors, `${location}.application_method`, 'must be email, web, phone, or unknown')
    } else if (
      job.application_method === 'email' &&
      !job.apply_emails?.length &&
      !job.apply_url?.startsWith('mailto:')
    ) {
      push(errors, location, 'email application method requires an email address or mailto URL')
    } else if (job.application_method === 'web' && !isValidUrl(job.apply_url)) {
      push(errors, location, 'web application method requires an HTTP(S) apply_url')
    } else if (job.application_method === 'phone' && !job.apply_phones?.length) {
      push(errors, location, 'phone application method requires at least one phone number')
    }

    if (job.application_subject != null && !isNonEmptyString(job.application_subject)) {
      push(errors, `${location}.application_subject`, 'must be a non-empty string or null')
    }
    if (job.application_subject_type != null && !SUBJECT_TYPES.has(job.application_subject_type)) {
      push(errors, `${location}.application_subject_type`, 'must be exact, reference, title_template, or null')
    }
    if (job.application_subject != null && job.application_subject_type == null) {
      push(errors, location, 'application_subject requires application_subject_type')
    }

    if (job.active !== true) push(errors, `${location}.active`, 'published jobs must be active')
    if (!isNonEmptyString(job.lifecycle_status)) {
      push(errors, `${location}.lifecycle_status`, 'must be a non-empty string')
    }
    if (!Number.isInteger(job.missed_runs) || job.missed_runs < 0) {
      push(errors, `${location}.missed_runs`, 'must be a non-negative integer')
    }

    if (job.also_found_on != null) {
      if (!Array.isArray(job.also_found_on)) {
        push(errors, `${location}.also_found_on`, 'must be an array')
      } else {
        job.also_found_on.forEach((match, matchIndex) => {
          const matchLocation = `${location}.also_found_on[${matchIndex}]`
          if (!isObject(match)) push(errors, matchLocation, 'must be an object')
          else if (!isValidUrl(match.url)) push(errors, `${matchLocation}.url`, 'must be an HTTP(S) URL')
        })
      }
    }

    if (job.relevance == null) {
      if (requireRelevance) push(errors, `${location}.relevance`, 'is required')
    } else {
      relevanceCount += 1
      validateRelevance(errors, job.relevance, `${location}.relevance`)
    }
  })

  if (sources.size < minSources) {
    push(errors, 'jobs', `contains ${sources.size} source(s); expected at least ${minSources}`)
  }
  if (maxExpired != null && expiredCount > maxExpired) {
    push(errors, 'jobs', `contains ${expiredCount} expired job(s); maximum is ${maxExpired}`)
  }
  if (!requireRelevance && jobs.length > 0 && relevanceCount !== jobs.length) {
    warnings.push(`relevance metadata covers ${relevanceCount}/${jobs.length} jobs`)
  }

  return {
    errors,
    warnings,
    metrics: {
      total: jobs.length,
      sources: Object.fromEntries([...sources.entries()].sort(([a], [b]) => a.localeCompare(b))),
      expired: expiredCount,
      relevanceCoverage: jobs.length === 0 ? 0 : relevanceCount / jobs.length,
    },
  }
}

export function validateSummary(summary, jobs) {
  const errors = []
  const warnings = []
  if (!isObject(summary)) return { errors: ['summary: top-level value must be an object'], warnings }
  if (!Array.isArray(jobs)) return { errors: ['jobs: top-level value must be an array'], warnings }

  const jobIds = new Set(jobs.map((job) => job?.id).filter(isNonEmptyString))
  const sourceCounts = jobs.reduce((counts, job) => {
    if (isNonEmptyString(job?.source)) counts.set(job.source, (counts.get(job.source) ?? 0) + 1)
    return counts
  }, new Map())

  if (summary.schema_version !== 2) push(errors, 'summary.schema_version', 'must be 2')
  if (!isValidTimestamp(summary.generated_at)) push(errors, 'summary.generated_at', 'must be a valid timestamp')
  if (!isNonEmptyString(summary.today) || !isValidDateOnly(summary.today)) {
    push(errors, 'summary.today', 'must be a real YYYY-MM-DD date')
  }
  if (summary.total_jobs !== jobs.length) {
    push(errors, 'summary.total_jobs', `is ${summary.total_jobs}; expected ${jobs.length}`)
  }

  for (const [listField, countField] of SUMMARY_ID_LISTS) {
    const ids = summary[listField]
    if (!Array.isArray(ids)) {
      push(errors, `summary.${listField}`, 'must be an array of job IDs')
      continue
    }
    const uniqueIds = new Set()
    ids.forEach((id, index) => {
      if (!isNonEmptyString(id)) push(errors, `summary.${listField}[${index}]`, 'must be a job ID string')
      else if (!jobIds.has(id)) push(errors, `summary.${listField}[${index}]`, `references unknown job ${id}`)
      else if (uniqueIds.has(id)) push(errors, `summary.${listField}[${index}]`, `duplicates job ${id}`)
      else uniqueIds.add(id)
    })
    if (summary[countField] !== ids.length) {
      push(errors, `summary.${countField}`, `is ${summary[countField]}; expected ${ids.length}`)
    }
  }

  const legacyPayloads = ['new_jobs', 'expiring_today', 'expiring_soon', 'tech_banking_jobs']
  legacyPayloads.forEach((field) => {
    if (field in summary) push(errors, `summary.${field}`, 'must be omitted; publish IDs instead of duplicate job records')
  })

  if (!Array.isArray(summary.sources)) {
    push(errors, 'summary.sources', 'must be an array')
  } else {
    const seenSources = new Set()
    let reportedTotal = 0
    summary.sources.forEach((source, index) => {
      const location = `summary.sources[${index}]`
      if (!isObject(source)) {
        push(errors, location, 'must be an object')
        return
      }
      if (!isNonEmptyString(source.name)) push(errors, `${location}.name`, 'must be a non-empty string')
      else if (seenSources.has(source.name)) push(errors, `${location}.name`, 'must be unique')
      else seenSources.add(source.name)
      if (!Number.isInteger(source.count) || source.count < 0) push(errors, `${location}.count`, 'must be a non-negative integer')
      else reportedTotal += source.count
      if (isNonEmptyString(source.name) && source.count !== sourceCounts.get(source.name)) {
        push(errors, `${location}.count`, `does not match jobs data (${sourceCounts.get(source.name) ?? 0})`)
      }
      for (const field of ['oldest_seen_at', 'latest_seen_at']) {
        if (source[field] != null && !isValidTimestamp(source[field])) {
          push(errors, `${location}.${field}`, 'must be a valid timestamp or null')
        }
      }
    })
    if (reportedTotal !== jobs.length) push(errors, 'summary.sources', `counts total ${reportedTotal}; expected ${jobs.length}`)
    if (seenSources.size !== sourceCounts.size) push(errors, 'summary.sources', 'does not contain every jobs source')
  }

  if (summary.source_count !== sourceCounts.size) {
    push(errors, 'summary.source_count', `is ${summary.source_count}; expected ${sourceCounts.size}`)
  }

  return { errors, warnings }
}

export function validateBaseline(currentJobs, baselineJobs, maxDropPercent) {
  const errors = []
  if (!Array.isArray(currentJobs) || !Array.isArray(baselineJobs)) {
    return { errors: ['baseline: current and baseline data must both be arrays'] }
  }
  if (!Number.isFinite(maxDropPercent) || maxDropPercent < 0 || maxDropPercent > 100) {
    return { errors: ['baseline: max drop percent must be between 0 and 100'] }
  }
  if (baselineJobs.length === 0) return { errors }

  const minimum = Math.ceil(baselineJobs.length * (1 - maxDropPercent / 100))
  if (currentJobs.length < minimum) {
    errors.push(
      `baseline: job count fell from ${baselineJobs.length} to ${currentJobs.length}; ` +
        `minimum allowed at ${maxDropPercent}% drop is ${minimum}`,
    )
  }
  return { errors }
}

async function loadJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`${label} (${filePath}) could not be read as JSON: ${error.message}`)
  }
}

function parseNumber(value, option) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${option} requires a number`)
  return number
}

function parseArguments(argv) {
  const positional = []
  const options = {
    minJobs: 1,
    minSources: 1,
    maxDropPercent: 35,
    requireRelevance: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) {
      positional.push(argument)
      continue
    }

    if (argument === '--require-relevance') {
      options.requireRelevance = true
      continue
    }

    const value = argv[index + 1]
    if (value == null || value.startsWith('--')) throw new Error(`${argument} requires a value`)
    index += 1
    if (argument === '--baseline') options.baseline = value
    else if (argument === '--max-drop-percent') options.maxDropPercent = parseNumber(value, argument)
    else if (argument === '--min-jobs') options.minJobs = parseNumber(value, argument)
    else if (argument === '--min-sources') options.minSources = parseNumber(value, argument)
    else if (argument === '--max-expired') options.maxExpired = parseNumber(value, argument)
    else if (argument === '--today') options.today = value
    else throw new Error(`unknown option ${argument}`)
  }

  return {
    jobsPath: positional[0] ?? 'docs/data/jobs.json',
    summaryPath: positional[1],
    options,
  }
}

export async function runValidation(argv) {
  const { jobsPath, summaryPath, options } = parseArguments(argv)
  const jobs = await loadJson(jobsPath, 'jobs data')
  const result = validateJobs(jobs, options)
  const errors = [...result.errors]
  const warnings = [...result.warnings]

  if (summaryPath) {
    const summary = await loadJson(summaryPath, 'summary data')
    const summaryResult = validateSummary(summary, jobs)
    errors.push(...summaryResult.errors)
    warnings.push(...summaryResult.warnings)
  }

  if (options.baseline) {
    const baselineJobs = await loadJson(options.baseline, 'baseline data')
    errors.push(...validateBaseline(jobs, baselineJobs, options.maxDropPercent).errors)
  }

  warnings.forEach((warning) => console.warn(`WARNING: ${warning}`))
  if (errors.length > 0) {
    console.error(`Data validation failed with ${errors.length} error(s):`)
    errors.forEach((error) => console.error(`  - ${error}`))
    return 1
  }

  const sourceText = Object.entries(result.metrics.sources)
    .map(([source, count]) => `${source}=${count}`)
    .join(', ')
  console.log(`Data validation passed: ${result.metrics.total} jobs (${sourceText || 'no sources'})`)
  return 0
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  runValidation(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode
    })
    .catch((error) => {
      console.error(`Data validation failed: ${error.message}`)
      process.exitCode = 1
    })
}
