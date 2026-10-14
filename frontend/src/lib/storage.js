// Per-viewer conveniences kept in this browser only. Storage can be blocked
// (private windows, hardened browsers), so every access is guarded and the
// site works without it.

const SAVED_KEY = 'jobsaf_saved_jobs';
const VISIT_KEY = 'jobsaf_last_visit';
const VIEW_KEY = 'jobsaf_view';
const SAME_VISIT_MS = 60 * 60 * 1000;

function read(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // The preference simply lasts for this session.
    }
}

export function readSavedJobs() {
    try {
        const parsed = JSON.parse(read(SAVED_KEY) || '[]');
        return new Set(Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : []);
    } catch {
        return new Set();
    }
}

export function writeSavedJobs(keys) {
    write(SAVED_KEY, JSON.stringify([...keys]));
}

/**
 * When the viewer's previous visit ended, for "new since your last visit".
 * Reloads within an hour count as the same visit, so refreshing the page
 * does not clear the markers.
 */
export function takeLastVisit(now = Date.now()) {
    let state = {};
    try {
        state = JSON.parse(read(VISIT_KEY) || '{}') || {};
    } catch {
        state = {};
    }
    const lastActive = Number(state.lastActive);
    const known = Number.isFinite(lastActive) && lastActive > 0;
    const baseline = known && now - lastActive < SAME_VISIT_MS
        ? Number(state.baseline) || null
        : known ? lastActive : null;
    write(VISIT_KEY, JSON.stringify({ baseline, lastActive: now }));
    return baseline;
}

export function readView() {
    const value = read(VIEW_KEY);
    return ['afghanistan', 'remote', 'saved'].includes(value) ? value : null;
}

export function writeView(value) {
    write(VIEW_KEY, value);
}
