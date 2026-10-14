// Loads the published feed. The compact index renders the list quickly; a
// job's full description is fetched only when it is opened. Deployments that
// predate the index (or a failed index request) fall back to jobs.json.

const BASE = import.meta.env.BASE_URL || './';
const detailCache = new Map();
let fullFeedPromise = null;

async function fetchJson(path) {
    const response = await fetch(`${BASE}${path}`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`The jobs feed returned ${response.status}.`);
    return response.json();
}

function usable(data) {
    if (!Array.isArray(data)) throw new Error('The jobs feed has an unexpected format.');
    return data.filter(job => job && typeof job === 'object' && job.title);
}

function loadFullFeed() {
    fullFeedPromise ||= fetchJson('data/jobs.json').then(usable).catch(error => {
        fullFeedPromise = null;
        throw error;
    });
    return fullFeedPromise;
}

export async function loadFeed() {
    try {
        return { jobs: usable(await fetchJson('data/jobs-index.json')), complete: false };
    } catch {
        return { jobs: await loadFullFeed(), complete: true };
    }
}

export async function loadSummary() {
    try {
        return await fetchJson('data/summary.json');
    } catch {
        // Summary metadata is helpful but must never prevent the jobs from rendering.
        return null;
    }
}

/** Return the job with its full description, fetching it if needed. */
export async function loadJobDetail(job) {
    if (!job || job.description !== undefined || !job.has_description) return job;
    const key = String(job.id || '');
    let detail = detailCache.get(key);
    if (!detail) {
        try {
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) throw new Error('unsafe id');
            detail = await fetchJson(`data/jobs/${key}.json`);
        } catch {
            detail = (await loadFullFeed()).find(item => item.id === job.id) || {};
        }
        detailCache.set(key, detail);
    }
    // Keep the display grouping of the list the job was opened from.
    return { ...job, ...detail, variants: job.variants };
}
