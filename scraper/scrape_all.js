#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const acbar = require("./sites/acbar");
const jobsaf = require("./sites/jobsaf");
const kaarobar = require("./sites/kaarobar");
const wazifaha = require("./sites/wazifaha");
const {
  canonicalUrl,
  dedupeJobs,
  referenceKey,
  resolveApplicationMethod,
} = require("./lib/dedupe");
const { expandBundledJob } = require("./lib/bundles");
const { assessJobRelevance } = require("./lib/keywords");
const { normalizeJob, normalizeTimestamp, todayKabulISO } = require("./lib/normalize");
const { toCSV } = require("./lib/csv");

const SITES = [jobsaf, acbar, kaarobar, wazifaha];
const DEFAULT_MISSED_RUN_GRACE = 2;
const DEFAULT_MAJOR_SOURCE_SIZE = 8;
const DEFAULT_MAJOR_DROP_RATIO = 0.2;
const DEFAULT_MAX_PAGES = 50;

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
  return job;
}

function prepareRecords(records, options = {}) {
  const normalized = records
    .filter(Boolean)
    .flatMap(record => expandBundledJob(record, { now: options.now }))
    .map(record => annotateRelevance(record, options.now))
    .filter(job => job.title && job.url && job.relevance.decision === "include");
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
  return { name: site.name, rawCount, records: related, coverage, error: null };
}

async function collectSiteResults(sites, options) {
  return Promise.all(sites.map(async site => {
    try {
      const result = await runSite(site, options);
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
      return { name: site.name, rawCount: 0, records: [], error };
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

  if (!succeeded.length && !(options.allowMajorDrop && majorDrops.length)) {
    throw new Error("[health] All sources failed or returned an unsafe major drop; existing output was preserved");
  }
  if (majorDrops.length && !options.allowMajorDrop) {
    const detail = majorDrops.map(item => `${item.source} ${item.previous_count}->${item.current_count}`).join(", ");
    throw new Error(`[health] Refusing major source drop (${detail}); existing output was preserved`);
  }
  if (freshCount === 0 && (existing.length > 0 || rawCount === 0)) {
    throw new Error("[health] No technical jobs were produced; existing output was preserved");
  }
}

function lifecycleKeys(record) {
  return [canonicalUrl(record), referenceKey(record)].filter(Boolean).map(key => `${record.source}|${key}`);
}

function reconcileLifecycle(existing, fresh, health, options = {}) {
  const now = normalizeTimestamp(options.now || new Date());
  const grace = Math.max(0, Number.parseInt(options.missedRunGrace ?? DEFAULT_MISSED_RUN_GRACE, 10));
  const statusBySource = new Map(health.map(item => [item.source, item.status]));
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
      if (missedRuns > grace) continue;
      combined.push({
        ...oldRecord,
        active: true,
        lifecycle_status: "unconfirmed",
        missed_runs: missedRuns,
      });
      continue;
    }

    if (sourceStatus === "failed" || sourceStatus === "partial") {
      combined.push({ ...oldRecord, active: true, lifecycle_status: "source_unavailable" });
      continue;
    }

    // Unknown/unmanaged historical sources are preserved and can be reviewed
    // explicitly instead of disappearing because no adapter ran for them.
    combined.push({ ...oldRecord, lifecycle_status: oldRecord.lifecycle_status || "unmanaged" });
  }
  return combined;
}

function filterOpenJobs(jobs, now) {
  const today = todayKabulISO(now);
  return jobs.filter(job => !job.closing_date || job.closing_date >= today);
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
  const results = await collectSiteResults(options.sites || SITES, options);
  const sourceHealth = evaluateSourceHealth(results, existingRelated, options);
  for (const item of sourceHealth) {
    console.log(`[health] ${item.source}: ${item.status} (${item.previous_count} -> ${item.current_count})${item.reason ? `: ${item.reason}` : ""}`);
  }
  assertHealthyRun(results, sourceHealth, existingRelated, options);

  const fresh = results.flatMap(result => result.records);
  const reconciled = reconcileLifecycle(existingRelated, fresh, sourceHealth, options);
  const processed = reprocessJobs(reconciled, options);
  validateOutput(processed.jobs, existing.length > 0);
  writeOutputsAtomic(outJson, outCsv, processed.jobs);

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

  await scrapeAll({
    outJson,
    outCsv,
    debugDir,
    maxPages,
    concurrency,
    jobsafRawUrl,
    onlyOpen: !hasFlag("--include-expired"),
    reprocessOnly: hasFlag("--reprocess-only"),
    allowMajorDrop: hasFlag("--allow-major-drop"),
    missedRunGrace: Number.parseInt(arg("--missed-run-grace", String(DEFAULT_MISSED_RUN_GRACE)), 10),
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error("[fatal]", error);
    process.exit(1);
  });
}

module.exports = {
  assertHealthyRun,
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
