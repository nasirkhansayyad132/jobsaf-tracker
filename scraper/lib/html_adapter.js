const pLimit = require("p-limit");

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const DEFAULT_FAILURE_RATIO = 0.5;
const DEFAULT_MINIMUM_FAILURES = 5;

function boundedConcurrency(value, fallback = DEFAULT_CONCURRENCY) {
  const parsed = Number.parseInt(value, 10);
  const chosen = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.min(MAX_CONCURRENCY, Math.max(1, chosen));
}

function requireDiscoveredJobs(siteName, jobs) {
  const discovered = Array.isArray(jobs) ? jobs.filter(job => job?.url) : [];
  if (!discovered.length) {
    throw new Error(`${siteName} discovered zero job URLs; refusing to treat a possibly changed listing as healthy`);
  }
  return discovered;
}

async function enrichCandidates(options = {}) {
  const siteName = options.siteName || "html source";
  const candidates = requireDiscoveredJobs(siteName, options.candidates);
  if (typeof options.enrich !== "function") throw new Error(`${siteName} enrich function is required`);

  const concurrency = boundedConcurrency(options.concurrency);
  const failureRatio = options.failureRatio ?? DEFAULT_FAILURE_RATIO;
  const minimumFailures = options.minimumFailures ?? DEFAULT_MINIMUM_FAILURES;
  const onFailure = options.onFailure || (() => {});
  const limit = pLimit(concurrency);
  let detailFailures = 0;

  const results = await Promise.all(candidates.map(candidate => (
    limit(async () => {
      try {
        const record = await options.enrich(candidate);
        if (!record) throw new Error("detail parser returned no record");
        return record;
      } catch (error) {
        detailFailures += 1;
        onFailure(candidate, error);
        // A listing summary is not complete enough to publish. In particular,
        // it may lack a deadline, application channel, and the text needed for
        // a trustworthy relevance decision.
        return null;
      }
    })
  )));

  const records = results.filter(Boolean);
  const actualFailureRatio = detailFailures / candidates.length;
  if (
    records.length === 0 ||
    detailFailures === candidates.length ||
    (detailFailures >= minimumFailures && actualFailureRatio >= failureRatio)
  ) {
    throw new Error(`${siteName} detail enrichment failure rate was ${detailFailures}/${candidates.length}`);
  }

  return { records, detailFailures, discoveredCount: candidates.length };
}

module.exports = {
  boundedConcurrency,
  enrichCandidates,
  requireDiscoveredJobs,
};
