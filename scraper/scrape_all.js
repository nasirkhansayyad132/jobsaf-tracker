#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const acbar = require("./sites/acbar");
const jobsaf = require("./sites/jobsaf");
const kaarobar = require("./sites/kaarobar");
const wazifaha = require("./sites/wazifaha");
const { dedupeJobs } = require("./lib/dedupe");
const { isRelatedJob } = require("./lib/keywords");
const { normalizeJob, todayKabulISO } = require("./lib/normalize");
const { writeCSV } = require("./lib/csv");

const SITES = [jobsaf, acbar, kaarobar, wazifaha];

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

function loadExisting(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data.map(normalizeJob) : [];
  } catch (error) {
    console.log(`[load] could not read existing jobs: ${error.message}`);
    return [];
  }
}

function pageLimitFor(siteName, options) {
  const flag = `--${siteName.replace(/[^a-z0-9]/gi, "").toLowerCase()}-pages`;
  return parseInt(arg(flag, String(options.maxPages)), 10);
}

function writeSiteError(debugDir, siteName, error) {
  if (!debugDir) return;
  fs.mkdirSync(debugDir, { recursive: true });
  fs.writeFileSync(
    path.join(debugDir, `${siteName.replace(/[^a-z0-9.-]/gi, "_")}.txt`),
    `${error.stack || error.message || error}\n`,
    "utf-8"
  );
}

async function runSite(site, options) {
  const siteOptions = {
    debugDir: options.debugDir,
    concurrency: options.concurrency,
    rawUrl: options.jobsafRawUrl,
    maxPages: pageLimitFor(site.name, options),
  };
  const records = await site.scrape(siteOptions);
  console.log(`[${site.name}] found ${records.length} jobs`);
  return records;
}

function filterOpenJobs(jobs) {
  const today = todayKabulISO();
  return jobs.filter(job => !job.closing_date || job.closing_date >= today);
}

function sortJobs(jobs) {
  jobs.sort((a, b) => {
    const closeCompare = (a.closing_date || "9999-12-31").localeCompare(b.closing_date || "9999-12-31");
    if (closeCompare !== 0) return closeCompare;
    return (a.title || "").localeCompare(b.title || "");
  });
}

async function scrapeAll(options = {}) {
  const outJson = options.outJson;
  const outCsv = options.outCsv;
  const debugDir = options.debugDir;
  ensureDir(outJson);
  ensureDir(outCsv);
  fs.mkdirSync(debugDir, { recursive: true });

  const existing = loadExisting(outJson);
  console.log(`[load] existing ${existing.length} jobs`);

  const scraped = [];
  for (const site of SITES) {
    try {
      const records = await runSite(site, options);
      scraped.push(...records.map(normalizeJob));
    } catch (error) {
      console.log(`[${site.name}] failed: ${error.message}`);
      writeSiteError(debugDir, site.name, error);
    }
  }

  const combined = [...existing, ...scraped];
  const related = combined.filter(isRelatedJob);
  console.log(`[filter] kept ${related.length} related jobs`);

  const deduped = dedupeJobs(related);
  let finalJobs = deduped.jobs;
  console.log(`[dedupe] removed ${deduped.removed} duplicates`);

  if (options.onlyOpen) {
    const before = finalJobs.length;
    finalJobs = filterOpenJobs(finalJobs);
    console.log(`[filter] kept ${finalJobs.length}/${before} open jobs`);
  }

  sortJobs(finalJobs);

  fs.writeFileSync(outJson, JSON.stringify(finalJobs, null, 2), "utf-8");
  writeCSV(outCsv, finalJobs);

  console.log(`[save] total ${finalJobs.length} jobs saved`);
  console.log(`[save] json ${outJson}`);
  console.log(`[save] csv ${outCsv}`);

  return {
    jobs: finalJobs,
    scrapedCount: scraped.length,
    relatedCount: related.length,
    duplicatesRemoved: deduped.removed,
  };
}

async function main() {
  const outJson = arg("--json", path.join(process.cwd(), "..", "docs", "data", "jobs.json"));
  const outCsv = arg("--csv", path.join(process.cwd(), "..", "data", "jobs.csv"));
  const debugDir = arg("--debug-dir", path.join(process.cwd(), "debug"));
  const maxPages = parseInt(arg("--max-pages", "10"), 10);
  const concurrency = parseInt(arg("--concurrency", "3"), 10);
  const jobsafRawUrl = arg("--raw-url");

  await scrapeAll({
    outJson,
    outCsv,
    debugDir,
    maxPages,
    concurrency,
    jobsafRawUrl,
    onlyOpen: !hasFlag("--include-expired"),
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error("[fatal]", error);
    process.exit(1);
  });
}

module.exports = {
  scrapeAll,
};
