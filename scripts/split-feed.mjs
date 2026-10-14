// Derive the fast-loading feed files the site reads from the canonical
// jobs.json: a compact list index (no long descriptions) and one detail file
// per job, fetched only when someone opens that job.

const DETAIL_VALUE_LIMIT = 300

export function indexRecord(job) {
  const { description: _description, ...rest } = job
  const details = {}
  for (const [key, value] of Object.entries(job.details || {})) {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (text && text.length <= DETAIL_VALUE_LIMIT) details[key] = value
  }
  return { ...rest, details, has_description: Boolean(job.description) }
}

export function detailFileName(job) {
  const id = String(job.id || '')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`Job id ${JSON.stringify(id)} cannot be used as a file name`)
  return `${id}.json`
}
