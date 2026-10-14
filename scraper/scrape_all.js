#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const acbar = require("./sites/acbar");
const himalayas = require("./sites/himalayas");
const impactpool = require("./sites/impactpool");
const jobicy = require("./sites/jobicy");
const jobsaf = require("./sites/jobsaf");
const kaarobar = require("./sites/kaarobar");
const reliefweb = require("./sites/reliefweb");
const remoteok = require("./sites/remoteok");
const remotive = require("./sites/remotive");
const wazifaha = require("./sites/wazifaha");
const weworkremotely = require("./sites/weworkremotely");
const workingnomads = require("./sites/workingnomads");
const {
  assignGroups,
  canonicalUrl,
  dedupeJobs,
  referenceKey,
  resolveApplicationMethod,
} = require("./lib/dedupe");
const { expandBundledJob } = require("./lib/bundles");
const { assessJobRelevance } = require("./lib/keywords");
const { extractSkills } = require("./lib/skills");
const { normalizeJob, normalizeTimestamp, todayKabulISO } = require("./lib/normalize");
const { toCSV } = require("./lib/csv");

const SITES = [
  // Afghanistan job boards and UN/NGO portals.
  jobsaf, acbar, kaarobar, wazifaha, reliefweb, impactpool,
  // Remote boards; only roles open to applicants in Afghanistan are kept.
  himalayas, remoteok, remotive, weworkremotely, jobicy, workingnomads,
];

// Remote roles posted on Afghan boards are always kept; the cap only applies
// to international remote boards.
const SITE_KINDS_LOCAL = new Set(SITES.filter(site => site.kind !== "remote").map(site => site.name));

// Sources that need configuration (for example an API key) opt out until set.
function activeSites() {
  return SITES.filter(site => typeof site.enabled !== "function" || site.enabled());
}
const DEFAULT_MISSED_RUN_GRACE = 2;
const DEFAULT_MAJOR_SOURCE_SIZE = 8;
const DEFAULT_MAJOR_DROP_RATIO = 0.2;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_SOURCE_TIMEOUT_MINUTES = 15;
// Jobs without a published deadline (most remote boards) would otherwise stay
// listed forever. Retire them once they are this old.
const MAX_AGE_WITHOUT_DEADLINE_DAYS = { remote: 30, default: 60 };
const DAY_MS = 24 * 60 * 60 * 1000;
// Remote boards list thousands of roles; publish the most reachable ones.
const MAX_REMOTE_JOBS = 300;
const REMOTE_SCOPE_RANK = { language: 0, afghanistan: 1, asia: 2, timezone: 3, worldwide: 4 };

function arg(name, def = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) return def;
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadExisting(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    throw new Error(`[load] Refusing to replace unreadable existing data at ${filePath}: ${error.message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error(`[load] Refusing to replace ${filePath}: expected a JSON array`);
  }
  return data.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`[load] Invalid record at index ${index} in ${filePath}`);
    }
    return normalizeJob(record, { now: options.now });
  });
}

function pageLimitFor(siteName, options) {
  const flag = `--${siteName.replace(/[^a-z0-9]/gi, "").toLowerCase()}-pages`;
  const parsed = Number.parseInt(arg(flag, String(options.maxPages || DEFAULT_MAX_PAGES)), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PAGES;
}

function safeSiteName(siteName) {
  const safe = String(siteName || "unknown").replace(/[^a-z0-9.-]/gi, "_");
  return safe || "unknown";
}

function siteErrorPath(debugDir, siteName) {
  return path.join(debugDir, `${safeSiteName(siteName)}.txt`);
}

function relevanceAuditPath(debugDir, siteName) {
  return path.join(debugDir, `${safeSiteName(siteName)}.relevance.json`);
}

function writeSiteError(debugDir, siteName, error) {
  if (!debugDir) return;
  fs.mkdirSync(debugDir, { recursive: true });
  fs.writeFileSync(
    siteErrorPath(debugDir, siteName),
    `${error.stack || error.message || error}\n`,
    "utf-8"
  );
}

function clearSiteError(debugDir, siteName) {
  if (!debugDir) return;
  const errorFile = siteErrorPath(debugDir, siteName);
  try {
    fs.unlinkSync(errorFile);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.log(`[debug] could not clear stale diagnostic ${errorFile}: ${error.message}`);
    }
  }
}

function clearRelevanceAudit(debugDir, siteName) {
  if (!debugDir) return;
  try {
    fs.unlinkSync(relevanceAuditPath(debugDir, siteName));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.log(`[debug] could not clear stale relevance audit for ${siteName}: ${error.message}`);
    }
  }
}

function writeRelevanceAudit(debugDir, siteName, records, now) {
  if (!debugDir) return;
  fs.mkdirSync(debugDir, { recursive: true });
  const audit = (Array.isArray(records) ? records : [])
    .filter(record => record?.title && record?.url)
    .flatMap(record => expandBundledJob(record, { now }))
    .map(record => annotateRelevance(record, now))
    .map(job => ({
      source: job.source,
      title: job.title,
      url: job.url,
      category: job.category,
      score: job.relevance.score,
      threshold: job.relevance.threshold,
      decision: job.relevance.decision,
      reasons: job.relevance.reasons,
      enrichment_status: job.details?.["Enrichment Status"] || "complete",
    }))
    .sort((a, b) => `${a.decision}|${a.title}|${a.url}`.localeCompare(`${b.decision}|${b.title}|${b.url}`));
  fs.writeFileSync(relevanceAuditPath(debugDir, siteName), `${JSON.stringify(audit, null, 2)}\n`, "utf-8");
}

function annotateRelevance(record, now) {
  const job = normalizeJob(record, { now });
  job.relevance = assessJobRelevance(job);
  job.skills = extractSkills(job);
  return job;
}

function prepareRecords(records, options = {}) {
  const normalized = records
    .filter(Boolean)
    .flatMap(record => expandBundledJob(record, { now: options.now }))
    .map(record => annotateRelevance(record, options.now))
    .filter(job => job.title && job.url && job.relevance.decision === "include")
    // Remote listings are only useful when someone in Afghanistan may apply.
    .filter(job => job.work_mode !== "remote" || Boolean(job.remote_scope));
  if (options.skipDedupe) return normalized;
  return dedupeJobs(normalized).jobs.map(job => annotateRelevance(job, options.now));
}

async function runSite(site, options) {
  const siteOptions = {
    debugDir: options.debugDir,
    concurrency: options.concurrency,
    rawUrl: options.jobsafRawUrl,
    maxPages: pageLimitFor(site.name, options),
  };
  const records = await site.scrape(siteOptions);
  if (!Array.isArray(records)) throw new Error(`${site.name} adapter returned a non-array result`);
  if (records.length === 0) {
    throw new Error(`${site.name} discovered zero jobs; refusing to treat a possibly changed source as healthy`);
  }
  const coverage = records.coverage || {};
  writeRelevanceAudit(options.debugDir, site.name, coverage.auditRecords || records, options.now);
  const related = prepareRecords(records, options);
  const rawCount = coverage.discoveredCount || records.length;
  const detailFailures = Number.parseInt(coverage.detailFailures || 0, 10) || 0;
  const listingFailures = Number.parseInt(coverage.listingFailures || 0, 10) || 0;
  console.log(
    `[${site.name}] discovered ${rawCount}; kept ${related.length} technical jobs`
    + (detailFailures ? `; ${detailFailures} detail failures, ${coverage.fallbackCount || 0} title fallbacks` : "")
    + (listingFailures ? `; partial pagination (${coverage.listingFailureReason || "listing page failed"})` : "")
  );
  return { name: site.name, kind: site.kind || "afghanistan", rawCount, records: related, coverage, error: null };
}

function withTimeout(promise, minutes, label) {
  const limit = Number(minutes);
  if (!Number.isFinite(limit) || limit <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not finish within ${limit} minutes`)),
      limit * 60 * 1000,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function collectSiteResults(sites, options) {
  return Promise.all(sites.map(async site => {
    try {
      // One hung board must not hold every other source hostage.
      const result = await withTimeout(runSite(site, options), options.sourceTimeoutMinutes, site.name);
      if (result.coverage.detailFailures || result.coverage.listingFailures) {
        writeSiteError(
          options.debugDir,
          site.name,
          new Error(
            `${site.name} partial coverage: ${result.coverage.detailFailures || 0}/${result.coverage.discoveredCount} `
            + `detail failures (${result.coverage.fallbackCount || 0} strong-title fallbacks); `
            + `${result.coverage.listingFailures || 0} listing failures`
            + (result.coverage.listingFailureReason ? ` (${result.coverage.listingFailureReason})` : "")
          )
        );
      } else {
        clearSiteError(options.debugDir, site.name);
      }
      return result;
    } catch (error) {
      console.log(`[${site.name}] failed: ${error.message}`);
      clearRelevanceAudit(options.debugDir, site.name);
      writeSiteError(options.debugDir, site.name, error);
      return { name: site.name, kind: site.kind || "afghanistan", rawCount: 0, records: [], error };
    }
  }));
}

function countBySource(records) {
  const counts = new Map();
  for (const record of records) counts.set(record.source, (counts.get(record.source) || 0) + 1);
  return counts;
}

function evaluateSourceHealth(results, existing, options = {}) {
  const existingCounts = countBySource(existing);
  const minimumSize = options.majorSourceSize ?? DEFAULT_MAJOR_SOURCE_SIZE;
  const dropRatio = options.majorDropRatio ?? DEFAULT_MAJOR_DROP_RATIO;
  const health = [];

  for (const result of results) {
    const previous = existingCounts.get(result.name) || 0;
    const current = result.records.length;
    const detailFailures = Number.parseInt(result.coverage?.detailFailures || 0, 10) || 0;
    const listingFailures = Number.parseInt(result.coverage?.listingFailures || 0, 10) || 0;
    let status = result.error ? "failed" : detailFailures || listingFailures ? "partial" : "healthy";
    let reason = result.error?.message
      || [
        detailFailures
          ? `${detailFailures}/${result.coverage.discoveredCount || result.rawCount} detail enrichments failed`
          : null,
        listingFailures ? result.coverage.listingFailureReason || `${listingFailures} listing pages failed` : null,
      ].filter(Boolean).join("; ")
      || null;
    if (status === "healthy" && previous >= minimumSize && current < Math.max(1, Math.ceil(previous * dropRatio))) {
      status = "major_drop";
      reason = `technical job count fell from ${previous} to ${current}`;
    }
    health.push({
      source: result.name,
      status,
      previous_count: previous,
      current_count: current,
      raw_count: result.rawCount,
      detail_failures: detailFailures,
      listing_failures: listingFailures,
      fallback_count: result.coverage?.fallbackCount || 0,
      reason,
    });
  }
  return health;
}

function assertHealthyRun(results, health, existing, options = {}) {
  const succeeded = health.filter(item => item.status === "healthy" || item.status === "partial");
  const majorDrops = health.filter(item => item.status === "major_drop");
  const freshCount = results.reduce((total, result) => total + result.records.length, 0);
  const rawCount = results.reduce((total, result) => total + result.rawCount, 0);

  // A collapsed source keeps its last-known-good jobs (see reconcileLifecycle)
  // while healthy sources publish normally. Only a run in which no source is
  // trustworthy is refused outright.
  if (!succeeded.length && !(options.allowMajorDrop && majorDrops.length)) {
    const detail = majorDrops.map(item => `${item.source} ${item.previous_count}->${item.current_count}`).join(", ");
    throw new Error(
      "[health] All sources failed"
      + (detail ? ` or returned an unsafe major source drop (${detail})` : "")
      + "; existing output was preserved"
    );
  }
  for (const item of majorDrops) {
    console.log(`[health] ${item.source}: keeping last-known-good jobs after a major drop (${item.reason})`);
  }
  if (freshCount === 0 && (existing.length > 0 || rawCount === 0)) {
    throw new Error("[health] No technical jobs were produced; existing output was preserved");
  }
}

function lifecycleKeys(record) {
  return [canonicalUrl(record), referenceKey(record)].filter(Boolean).map(key => `${record.source}|${key}`);
}

function graceFor(source, options) {
  const perSource = options.sourceGrace?.get?.(source);
  const value = perSource ?? options.missedRunGrace ?? DEFAULT_MISSED_RUN_GRACE;
  return Math.max(0, Number.parseInt(value, 10));
}

function reconcileLifecycle(existing, fresh, health, options = {}) {
  const now = normalizeTimestamp(options.now || new Date());
  const statusBySource = new Map(health.map(item => {
    // An explicitly accepted drop is treated as the source's new truth.
    const status = item.status === "major_drop" && options.allowMajorDrop ? "healthy" : item.status;
    return [item.source, status];
  }));
  const seen = new Set(fresh.flatMap(lifecycleKeys));
  const combined = fresh.map(record => ({
    ...record,
    active: true,
    lifecycle_status: record.details?.["Enrichment Status"] ? "source_unavailable" : "active",
    missed_runs: 0,
    last_seen_at: now,
  }));

  for (const oldRecord of existing) {
    const sourceStatus = statusBySource.get(oldRecord.source);
    const wasSeen = lifecycleKeys(oldRecord).some(key => seen.has(key));
    if (wasSeen) {
      combined.push(oldRecord);
      continue;
    }

    if (sourceStatus === "healthy") {
      const missedRuns = (oldRecord.missed_runs || 0) + 1;
      if (missedRuns > graceFor(oldRecord.source, options)) continue;
      combined.push({
        ...oldRecord,
        active: true,
        lifecycle_status: "unconfirmed",
        missed_runs: missedRuns,
      });
      continue;
    }

    if (sourceStatus === "failed" || sourceStatus === "partial" || sourceStatus === "major_drop") {
      combined.push({ ...oldRecord, active: true, lifecycle_status: "source_unavailable" });
      continue;
    }

    // Unknown/unmanaged historical sources are preserved and can be reviewed
    // explicitly instead of disappearing because no adapter ran for them.
    combined.push({ ...oldRecord, lifecycle_status: oldRecord.lifecycle_status || "unmanaged" });
  }
  return combined;
}

function ageInDays(job, now) {
  const reference = job.post_date ? `${job.post_date}T00:00:00Z` : job.first_seen_at;
  const started = Date.parse(reference || "");
  if (Number.isNaN(started)) return 0;
  return (Date.parse(normalizeTimestamp(now || new Date())) - started) / DAY_MS;
}

function filterOpenJobs(jobs, now) {
  const today = todayKabulISO(now);
  return jobs.filter(job => {
    if (job.closing_date) return job.closing_date >= today;
    const limit = job.work_mode === "remote"
      ? MAX_AGE_WITHOUT_DEADLINE_DAYS.remote
      : MAX_AGE_WITHOUT_DEADLINE_DAYS.default;
    return ageInDays(job, now) <= limit;
  });
}

function limitRemoteJobs(jobs, limit = MAX_REMOTE_JOBS) {
  const remote = jobs.filter(job => job.work_mode === "remote" && !SITE_KINDS_LOCAL.has(job.source));
  if (remote.length <= limit) return jobs;
  const keep = new Set(remote
    .slice()
    .sort((a, b) => (
      (REMOTE_SCOPE_RANK[a.remote_scope] ?? 9) - (REMOTE_SCOPE_RANK[b.remote_scope] ?? 9)
      || (b.post_date || b.first_seen_at || "").localeCompare(a.post_date || a.first_seen_at || "")
      || (a.url || "").localeCompare(b.url || "")
    ))
    .slice(0, limit));
  const capped = new Set(remote);
  return jobs.filter(job => !capped.has(job) || keep.has(job));
}

function sortJobs(jobs) {
  jobs.sort((a, b) => {
    const closeCompare = (a.closing_date || "9999-12-31").localeCompare(b.closing_date || "9999-12-31");
    if (closeCompare !== 0) return closeCompare;
    const postCompare = (b.post_date || "0000-00-00").localeCompare(a.post_date || "0000-00-00");
    if (postCompare !== 0) return postCompare;
    return (a.title || "").localeCompare(b.title || "");
  });
}

function reprocessJobs(records, options = {}) {
  const prepared = prepareRecords(records, { ...options, skipDedupe: true });
  const deduped = dedupeJobs(prepared);
  let jobs = deduped.jobs
    .map(job => annotateRelevance(job, options.now))
    .filter(job => job.active !== false && job.relevance.decision === "include");
  if (options.onlyOpen) jobs = filterOpenJobs(jobs, options.now);
  jobs = assignGroups(limitRemoteJobs(jobs, options.maxRemoteJobs));
  sortJobs(jobs);
  return { jobs, dedupe: deduped };
}

function validateOutput(jobs, hadInput = false) {
  if (!Array.isArray(jobs)) throw new Error("[validate] Output is not an array");
  if (hadInput && jobs.length === 0) throw new Error("[validate] Refusing to replace non-empty input with empty output");
  const urls = new Set();
  for (const [index, job] of jobs.entries()) {
    if (!job.title || !job.company || !job.source || !job.url) {
      throw new Error(`[validate] Job ${index} is missing title/company/source/url`);
    }
    if (job.relevance?.decision !== "include" || job.relevance.score < job.relevance.threshold) {
      throw new Error(`[validate] Job ${index} has invalid relevance metadata`);
    }
    const url = canonicalUrl(job);
    if (urls.has(url)) throw new Error(`[validate] Duplicate canonical URL: ${url}`);
    urls.add(url);
    const resolvedApplicationMethod = resolveApplicationMethod(job);
    if (job.application_method !== resolvedApplicationMethod) {
      throw new Error(
        `[validate] Job ${index} has unbacked application_method ${job.application_method || "missing"}; `
        + `expected ${resolvedApplicationMethod} from its application fields`
      );
    }
    for (const field of ["post_date", "closing_date"]) {
      if (job[field] && !/^20\d{2}-\d{2}-\d{2}$/.test(job[field])) {
        throw new Error(`[validate] Job ${index} has invalid ${field}: ${job[field]}`);
      }
    }
  }
}

function writeOutputsAtomic(outJson, outCsv, jobs) {
  ensureDir(outJson);
  ensureDir(outCsv);
  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  const jsonTemp = `${outJson}${suffix}`;
  const csvTemp = `${outCsv}${suffix}`;
  try {
    fs.writeFileSync(jsonTemp, JSON.stringify(jobs, null, 2), "utf-8");
    fs.writeFileSync(csvTemp, `${toCSV(jobs)}\n`, "utf-8");
    const check = JSON.parse(fs.readFileSync(jsonTemp, "utf-8"));
    if (!Array.isArray(check) || check.length !== jobs.length) throw new Error("temporary JSON verification failed");
    // JSON is the canonical dataset, so replace it last.
    fs.renameSync(csvTemp, outCsv);
    fs.renameSync(jsonTemp, outJson);
  } catch (error) {
    if (fs.existsSync(jsonTemp)) fs.unlinkSync(jsonTemp);
    if (fs.existsSync(csvTemp)) fs.unlinkSync(csvTemp);
    throw error;
  }
}

function writeHealthReport(filePath, sourceHealth, results, now) {
  if (!filePath) return;
  const checkedAt = normalizeTimestamp(now || new Date());
  const kindByName = new Map(results.map(result => [result.name, result.kind || "afghanistan"]));
  const report = sourceHealth.map(item => ({
    source: item.source,
    kind: kindByName.get(item.source) || "afghanistan",
    status: item.status,
    checked_at: checkedAt,
    listed: item.raw_count,
    relevant: item.current_count,
    reason: item.reason,
  }));
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
}

async function scrapeAll(options = {}) {
  const outJson = options.outJson;
  const outCsv = options.outCsv;
  if (!outJson || !outCsv) throw new Error("outJson and outCsv are required");
  if (options.debugDir) fs.mkdirSync(options.debugDir, { recursive: true });

  const existing = loadExisting(outJson, options);
  console.log(`[load] existing ${existing.length} jobs`);

  if (options.reprocessOnly) {
    const processed = reprocessJobs(existing, options);
    validateOutput(processed.jobs, existing.length > 0);
    writeOutputsAtomic(outJson, outCsv, processed.jobs);
    console.log(`[reprocess] kept ${processed.jobs.length}/${existing.length} normalized technical jobs`);
    return { jobs: processed.jobs, reprocessOnly: true, duplicatesRemoved: processed.dedupe.removed };
  }

  const existingRelated = prepareRecords(existing, options);
  const sites = options.sites || activeSites();
  const sourceGrace = new Map(
    sites.filter(site => Number.isFinite(site.missedRunGrace)).map(site => [site.name, site.missedRunGrace])
  );
  const results = await collectSiteResults(sites, options);
  const sourceHealth = evaluateSourceHealth(results, existingRelated, options);
  for (const item of sourceHealth) {
    console.log(`[health] ${item.source}: ${item.status} (${item.previous_count} -> ${item.current_count})${item.reason ? `: ${item.reason}` : ""}`);
  }
  assertHealthyRun(results, sourceHealth, existingRelated, options);

  const fresh = results.flatMap(result => result.records);
  const reconciled = reconcileLifecycle(existingRelated, fresh, sourceHealth, { ...options, sourceGrace });
  const processed = reprocessJobs(reconciled, options);
  validateOutput(processed.jobs, existing.length > 0);
  writeOutputsAtomic(outJson, outCsv, processed.jobs);

  writeHealthReport(options.healthJson, sourceHealth, results, options.now);

  console.log(`[dedupe] removed ${processed.dedupe.removed} duplicates`);
  console.log(`[save] total ${processed.jobs.length} jobs saved`);
  console.log(`[save] json ${outJson}`);
  console.log(`[save] csv ${outCsv}`);

  return {
    jobs: processed.jobs,
    scrapedCount: results.reduce((sum, result) => sum + result.records.length, 0),
    duplicatesRemoved: processed.dedupe.removed,
    sourceHealth,
  };
}

async function main() {
  const outJson = arg("--json", path.join(process.cwd(), "..", "docs", "data", "jobs.json"));
  const outCsv = arg("--csv", path.join(process.cwd(), "..", "data", "jobs.csv"));
  const debugDir = arg("--debug-dir", path.join(process.cwd(), "debug"));
  const maxPages = Number.parseInt(arg("--max-pages", String(DEFAULT_MAX_PAGES)), 10);
  const concurrency = Number.parseInt(arg("--concurrency", "4"), 10);
  const jobsafRawUrl = arg("--raw-url");
  const only = arg("--only");
  const sites = only
    ? SITES.filter(site => only.split(",").map(name => name.trim()).includes(site.name))
    : activeSites();
  if (!sites.length) throw new Error(`--only matched no sources (${only}); known: ${SITES.map(site => site.name).join(", ")}`);

  await scrapeAll({
    outJson,
    outCsv,
    debugDir,
    maxPages,
    concurrency,
    jobsafRawUrl,
    sites,
    healthJson: arg("--health-json", path.join(debugDir, "source-health.json")),
    sourceTimeoutMinutes: Number.parseFloat(arg("--source-timeout-minutes", String(DEFAULT_SOURCE_TIMEOUT_MINUTES))),
    onlyOpen: !hasFlag("--include-expired"),
    reprocessOnly: hasFlag("--reprocess-only"),
    allowMajorDrop: hasFlag("--allow-major-drop"),
    missedRunGrace: Number.parseInt(arg("--missed-run-grace", String(DEFAULT_MISSED_RUN_GRACE)), 10),
  });
}

if (require.main === module) {
  main()
    .then(() => {
      // A timed-out source can leave sockets open; the output is already
      // written, so do not let them keep the process (and the job) alive.
      setTimeout(() => process.exit(process.exitCode ?? 0), 2000).unref();
    })
    .catch(error => {
      console.error("[fatal]", error);
      process.exit(1);
    });
}

module.exports = {
  SITES,
  assertHealthyRun,
  filterOpenJobs,
  clearSiteError,
  collectSiteResults,
  evaluateSourceHealth,
  loadExisting,
  prepareRecords,
  reconcileLifecycle,
  reprocessJobs,
  scrapeAll,
  validateOutput,
  writeOutputsAtomic,
  writeSiteError,
};
