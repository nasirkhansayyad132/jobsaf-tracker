import test from 'node:test'
import assert from 'node:assert/strict'

import { validateBaseline, validateJobs, validateSummary } from '../validate-data.mjs'

function validJob(overrides = {}) {
  return {
    id: 'job-1',
    source: 'example',
    source_url: 'https://example.com/jobs/1',
    url: 'https://example.com/jobs/1',
    title: 'Software Engineer',
    company: 'Example Ltd',
    closing_date: '2026-08-20',
    scraped_at: '2026-08-05T05:00:00.000Z',
    first_seen_at: '2026-08-04T05:00:00.000Z',
    last_seen_at: '2026-08-05T05:00:00.000Z',
    application_method: 'web',
    apply_url: 'https://example.com/jobs/1/apply',
    apply_emails: [],
    apply_phones: [],
    active: true,
    lifecycle_status: 'active',
    missed_runs: 0,
    details: {},
    relevance: {
      version: 2,
      score: 12,
      threshold: 6,
      decision: 'include',
      reasons: ['title: software engineer'],
    },
    ...overrides,
  }
}

function validSummary() {
  return {
    schema_version: 2,
    generated_at: '2026-08-05T05:00:00.000Z',
    today: '2026-08-05',
    total_jobs: 1,
    source_count: 1,
    sources: [
      {
        name: 'example',
        count: 1,
        oldest_seen_at: '2026-08-05T05:00:00.000Z',
        latest_seen_at: '2026-08-05T05:00:00.000Z',
      },
    ],
    new_count: 1,
    expiring_today_count: 0,
    expiring_soon_count: 0,
    tech_banking_count: 0,
    new_job_ids: ['job-1'],
    expiring_today_ids: [],
    expiring_soon_ids: [],
    tech_banking_job_ids: [],
  }
}

test('accepts a structurally valid, relevant job and compact summary', () => {
  const jobs = [validJob()]
  assert.deepEqual(
    validateJobs(jobs, { today: '2026-08-05', requireRelevance: true }).errors,
    [],
  )
  assert.deepEqual(validateSummary(validSummary(), jobs).errors, [])
})

test('rejects duplicate URLs and published jobs below the relevance threshold', () => {
  const jobs = [
    validJob({ relevance: { version: 2, score: 2, threshold: 6, decision: 'exclude', reasons: [] } }),
    validJob({ id: 'job-2' }),
  ]
  const { errors } = validateJobs(jobs, { today: '2026-08-05', requireRelevance: true })
  assert.ok(errors.some((error) => error.includes('duplicates jobs[0]')))
  assert.ok(errors.some((error) => error.includes('decision "include"')))
  assert.ok(errors.some((error) => error.includes('below its inclusion threshold')))
})

test('rejects summary IDs that do not exist in the jobs dataset', () => {
  const summary = validSummary()
  summary.new_job_ids = ['missing']
  assert.ok(validateSummary(summary, [validJob()]).errors.some((error) => error.includes('unknown job')))
})

test('rejects inconsistent application and lifecycle metadata', () => {
  const broken = validJob({
    application_method: 'email',
    apply_url: null,
    apply_emails: [],
    active: false,
    first_seen_at: '2026-08-06T05:00:00.000Z',
    last_seen_at: '2026-08-05T05:00:00.000Z',
  })
  const { errors } = validateJobs([broken], { today: '2026-08-05', requireRelevance: true })
  assert.ok(errors.some((error) => error.includes('requires an email address')))
  assert.ok(errors.some((error) => error.includes('must be active')))
  assert.ok(errors.some((error) => error.includes('first_seen_at cannot be later')))
})

test('blocks a job-count drop beyond the configured baseline tolerance', () => {
  const current = Array.from({ length: 6 }, (_, index) => validJob({ id: `new-${index}` }))
  const baseline = Array.from({ length: 10 }, (_, index) => validJob({ id: `old-${index}` }))
  assert.equal(validateBaseline(current, baseline, 35).errors.length, 1)
  assert.equal(validateBaseline(current, baseline, 40).errors.length, 0)
})
