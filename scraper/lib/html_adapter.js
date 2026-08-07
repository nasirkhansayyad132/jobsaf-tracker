const pLimit = require("p-limit");
const { assessJobRelevance } = require("./keywords");

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_FAILURE_RATIO = 0.5;
const DEFAULT_MINIMUM_FAILURES = 5;
const EXPLICIT_TECH_TITLE_PATTERNS = [
  /\b(?:software|developer|programmer|web|mobile|computer|network|cloud|devops|database|data|cyber|telecom(?:munications?)?|fiber|microwave)\b/i,
  /\b(?:IT|ICT|AI|ML|SOC|NOC|GIS|MIS|ERP|OFC|RF|ISP)\b/i,
  /\b(?:information security|security operations cent(?:er|re))\b/i,
  /(?:نرم\s*افزار|کمپیوتر|کامپیوتر|شبکه|تکنالوژی معلوماتی|فناوری اطلاعات|امنیت سایبری|دیتابیس|پایگاه داده|برنامه\s*نویس|انکشاف سیستم)/i,
];
const NON_IT_DOMAIN_TITLE_PATTERN = /\b(?:hvac|medical|clinical|biomedical|electrical|mechanical|civil|structural|construction|plumbing|irrigation|solar|power|energy|agricultur\w*|mining|petroleum|chemical|manufacturing|industrial)\b|(?:پزشکی|صحی|برق|میخانیک|ساختمان|زراعت)/i;

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

function reportedPageCount(html, currentPage = 1) {
  let highest = null;
  const text = String(html || "");
  const pagePattern = /(?:[?&]|&amp;)page=(\d+)/gi;
  let match;
  while ((match = pagePattern.exec(text)) !== null) {
    const page = Number.parseInt(match[1], 10);
    if (Number.isFinite(page)) highest = Math.max(highest || 1, page);
  }
  return highest;
}

function attachCoverage(records, coverage = {}) {
  if (!Array.isArray(records)) throw new Error("coverage can only be attached to a record array");
  Object.defineProperty(records, "coverage", {
    configurable: true,
    enumerable: false,
    value: {
      discoveredCount: records.length,
      detailFailures: 0,
      fallbackCount: 0,
      listingFailures: 0,
      listingFailureReason: null,
      ...coverage,
    },
  });
  return records;
}

function hasStrongTechnicalTitle(candidate) {
  const title = String(candidate?.title || "").trim();
  if (!title) return false;
  if (NON_IT_DOMAIN_TITLE_PATTERN.test(title)) return false;
  if (!EXPLICIT_TECH_TITLE_PATTERNS.some(pattern => pattern.test(title))) return false;
  const assessment = assessJobRelevance({
    title,
    company: null,
    category: null,
    description: null,
    details: {},
  });
  return assessment.decision === "include"
    && assessment.reasons.some(reason => /^title:\s*[“\"]/.test(reason) && /\(\+\d+\)/.test(reason));
}

function strongTitleSummaryFallback(candidate) {
  // The public schema requires a company. A listing-only fallback cannot
  // invent one, so omit it and preserve the last-known-good source data.
  if (!candidate?.company || !hasStrongTechnicalTitle(candidate)) return null;
  return {
    ...candidate,
    application_method: "unknown",
    apply_url: null,
    apply_emails: [],
    apply_phones: [],
    description: null,
    details: {
      ...(candidate.details || {}),
      "Enrichment Status": "Summary only — the detail page could not be retrieved. Confirm every field on the original listing.",
    },
  };
}

async function enrichCandidates(options = {}) {
  const siteName = options.siteName || "html source";
  const candidates = requireDiscoveredJobs(siteName, options.candidates);
  if (typeof options.enrich !== "function") throw new Error(`${siteName} enrich function is required`);

  const concurrency = boundedConcurrency(options.concurrency);
  const failureRatio = options.failureRatio ?? DEFAULT_FAILURE_RATIO;
  const minimumFailures = options.minimumFailures ?? DEFAULT_MINIMUM_FAILURES;
  const onFailure = options.onFailure || (() => {});
  const allowStrongTitleFallback = options.allowStrongTitleFallback === true;
  const allowUnsafeResults = options.allowUnsafeResults === true;
  const requestGapMs = Math.max(0, Number.parseInt(options.requestGapMs || 0, 10) || 0);
  const wait = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const limit = pLimit(concurrency);
  let startGate = Promise.resolve();
  let firstStart = true;
  let detailFailures = 0;
  let fallbackCount = 0;
  let enrichedCount = 0;

  const waitForStart = () => {
    const scheduled = startGate.then(async () => {
      if (firstStart) {
        firstStart = false;
        return;
      }
      if (requestGapMs) await wait(requestGapMs);
    });
    startGate = scheduled.catch(() => {});
    return scheduled;
  };

  const results = await Promise.all(candidates.map(candidate => (
    limit(async () => {
      await waitForStart();
      try {
        const record = await options.enrich(candidate);
        if (!record) throw new Error("detail parser returned no record");
        enrichedCount += 1;
        return record;
      } catch (error) {
        detailFailures += 1;
        onFailure(candidate, error);
        // Only an unambiguous technical title can fall back to a clearly
        // marked summary. Ambiguous/category-only summaries remain excluded.
        const fallback = allowStrongTitleFallback ? strongTitleSummaryFallback(candidate) : null;
        if (fallback) fallbackCount += 1;
        return fallback;
      }
    })
  )));

  const records = results.filter(Boolean);
  const actualFailureRatio = detailFailures / candidates.length;
  const unsafeCoverage = detailFailures === candidates.length
    || (detailFailures >= minimumFailures && actualFailureRatio >= failureRatio);
  if (records.length === 0 || (unsafeCoverage && !allowUnsafeResults)) {
    throw new Error(`${siteName} detail enrichment failure rate was ${detailFailures}/${candidates.length}`);
  }

  return {
    records,
    auditRecords: results.map((record, index) => record || candidates[index]),
    detailFailures,
    discoveredCount: candidates.length,
    enrichedCount,
    fallbackCount,
    unsafeCoverage,
  };
}

module.exports = {
  DEFAULT_MAX_PAGES,
  attachCoverage,
  boundedConcurrency,
  enrichCandidates,
  hasStrongTechnicalTitle,
  reportedPageCount,
  requireDiscoveredJobs,
  strongTitleSummaryFallback,
};
