#!/usr/bin/env node

/**
 * Jobs.af scraper.
 *
 * The Jobs.af web UI is now a client-rendered Next.js app. The old Puppeteer
 * selector approach looked for /jobs/ anchors in the rendered page, but the
 * page now loads job data from the public API instead. Use that API directly.
 */

const fs = require("fs");
const path = require("path");
const pLimit = require("p-limit");
const { toCSV } = require("./lib/csv");
const {
  attachCoverage,
  boundedConcurrency,
  strongTitleSummaryFallback,
} = require("./lib/html_adapter");
const { requestJson } = require("./lib/http");
const { extractPhones, normalizeJob } = require("./lib/normalize");

const API_BASE = "https://api.jobs.af/public";
const SITE_BASE = "https://jobs.af";
const ITEMS_PER_PAGE = 100;
const UNFILTERED_RAW_URL = "https://jobs.af/jobs?search";
const DEFAULT_RAW_URL = UNFILTERED_RAW_URL;
const LEGACY_FILTERED_RAW_URL = "https://jobs.af/jobs?search&category=IT%20-%20Hardware&category=IT%20-%20Software&category=IT%20Billing&category=Data%20Security%2FProtection&category=Software%20Development%20and%20Data%20Management&category=Software%20developer&category=Software%20engineering&category=software%20development%20&category=software%20development&category=software%20analysis&category=Database%20Developing&category=Data%20Management&category=Data%20Collection%20&category=Data%20Entry&category=Data%20analysis&category=Data%20Science&category=Computer%20Science&category=Computer%20Operator&category=Telecommunication%20&category=Computing&category=Database%20Development&category=Data%20Management,%20IT,%20Administration,%20GIS,%20Warehouse,%20Network&category=Data%20analysis%20&category=Banking&category=Finance%20and%20Banking";

function arg(name, def = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const val = process.argv[idx + 1];
  if (!val || val.startsWith("--")) return def;
  return val;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function ensureDir(p) {
  if (!p) return;
  fs.mkdirSync(p, { recursive: true });
}

function normSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function normalizeLabel(s) {
  return normSpace(s)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[\/_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function stableSummaryKey(job) {
  const slug = normSpace(String(job?.slug ?? ""));
  if (slug) return `slug:${slug}`;

  const id = normSpace(String(job?.id ?? ""));
  return id ? `id:${id}` : null;
}

function parseCategories(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.searchParams
      .getAll("category")
      .flatMap(value => value.split(","))
      .map(value => normSpace(value))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseClosingDate(raw) {
  const r = (raw || "").trim();
  if (!r) return null;

  const iso = r.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  const m = r.match(/\b([A-Za-z]{3,})\s+(\d{1,2}),?\s*(20\d{2})\b/);
  if (m) {
    const monthName = m[1].toLowerCase();
    const day = String(parseInt(m[2], 10)).padStart(2, "0");
    const year = m[3];
    const months = {
      jan: "01", january: "01",
      feb: "02", february: "02",
      mar: "03", march: "03",
      apr: "04", april: "04",
      may: "05",
      jun: "06", june: "06",
      jul: "07", july: "07",
      aug: "08", august: "08",
      sep: "09", sept: "09", september: "09",
      oct: "10", october: "10",
      nov: "11", november: "11",
      dec: "12", december: "12",
    };
    const mm = months[monthName] || months[monthName.slice(0, 3)];
    if (mm) return `${year}-${mm}-${day}`;
  }

  return null;
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 270);
  return d.toISOString().split("T")[0];
}

function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .split("\n")
    .map(normSpace)
    .filter(Boolean)
    .join("\n");
}

function extractEmails(text) {
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  return unique(text.match(re) || []).slice(0, 10);
}

async function fetchJson(endpoint, params = {}) {
  const url = new URL(`${API_BASE}/${endpoint.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return requestJson(url.toString(), {
    onRetry: ({ attempt, delay }) => {
      console.log(`[jobs.af] retry ${attempt} in ${delay}ms: ${url.pathname}`);
    },
  });
}

async function loadFunctionalAreas() {
  const res = await fetchJson("functional-areas");
  return Array.isArray(res) ? res : (res.data || []);
}

function areaIdsForCategories(categories, functionalAreas) {
  const byName = new Map();
  for (const area of functionalAreas) {
    byName.set(normalizeLabel(area.name), area.id);
  }

  const aliases = {
    "software developer": ["software development", "it software"],
    "software development and data management": ["software development", "data management"],
    "database development": ["database developing", "database administration"],
    "data management it administration gis warehouse network": [
      "data management",
      "information technology",
      "database administration",
      "gis geographic information system",
      "networking",
    ],
    "computing": ["information technology", "computer science"],
  };

  const ids = [];
  for (const category of categories) {
    const normalized = normalizeLabel(category);
    const candidates = [normalized, ...(aliases[normalized] || [])];

    for (const candidate of candidates) {
      const id = byName.get(candidate);
      if (id) ids.push(id);
    }
  }

  return unique(ids);
}

function areaNames(job) {
  return unique((job.functionalAreas || [])
    .map(item => item.area?.name || item.name)
    .filter(Boolean));
}

function provinceNames(job) {
  const provinces = (job.provinces || [])
    .map(item => item.province?.name || item.name)
    .filter(Boolean);
  if (provinces.length > 1) return ["Multi Location"];
  return provinces;
}

function formatLocation(job) {
  const provinces = provinceNames(job);
  const country = job.country?.name || job.country || "";
  if (provinces.length) return country ? `${provinces.join(", ")}, ${country}` : provinces.join(", ");
  return country || "";
}

function salaryText(job) {
  if (job.salaryType === "fixed" && job.fixedSalary) return `${job.fixedSalary} ${job.currency || ""}`.trim();
  if (job.salaryType === "range" && job.minimumSalary && job.maximumSalary) {
    return `${job.minimumSalary} - ${job.maximumSalary} ${job.currency || ""}`.trim();
  }
  if (job.salaryType === "negotiable") return "Negotiable";
  if (job.salaryType === "as_per_company_scale") return "Company salary scale";
  return job.salaryType || null;
}

function buildDescription(job) {
  return [
    job.roleSummary && `Role Summary\n${htmlToText(job.roleSummary)}`,
    job.dutiesAndResponsibilities && `Duties and Responsibilities\n${htmlToText(job.dutiesAndResponsibilities)}`,
    job.jobRequirements && `Job Requirements\n${htmlToText(job.jobRequirements)}`,
    job.submissionGuidelines && `Submission Guidelines\n${htmlToText(job.submissionGuidelines)}`,
  ].filter(Boolean).join("\n\n");
}

function buildRecord(job, nowISO) {
  const closingDate = parseClosingDate(job.expiryDate);
  const description = buildDescription(job);
  const emails = unique([
    job.submissionEmail,
    ...extractEmails(description),
  ]).slice(0, 10);

  return normalizeJob({
    url: `${SITE_BASE}/jobs/${job.slug}`,
    source_url: `${SITE_BASE}/jobs/${job.slug}`,
    source: "jobs.af",
    title: job.title || null,
    company: job.company?.name || null,
    location: formatLocation(job) || null,
    closing_date_raw: job.expiryDate || null,
    closing_date: closingDate,
    category: areaNames(job).join(", ") || null,
    job_type: job.workType || null,
    gender: job.gender || null,
    vacancies: job.numberOfVacancies || null,
    salary: salaryText(job),
    apply_url: job.submissionLink || (job.submissionEmail ? `mailto:${job.submissionEmail}` : null),
    apply_emails: emails,
    apply_phones: extractPhones(description),
    description: description || null,
    details: {
      Reference: job.reference || null,
      "Post Date": job.publishDate || null,
      "Closing Date": job.expiryDate || null,
      "Functional Area": areaNames(job).join(", ") || null,
      Countries: job.country?.name || null,
      Provinces: provinceNames(job).join(", ") || null,
      "Job Type": job.workType || null,
      "Contract Type": job.contractType || null,
      Gender: job.gender || null,
      Education: job.educationLevel || null,
      Experience: [job.minimumExperience, job.maximumExperience].filter(v => v !== null && v !== undefined).join(" - ") || null,
      Salary: salaryText(job),
      Vacancies: job.numberOfVacancies || null,
      "Submission Through": job.submissionThroughout || null,
    },
    scraped_at: nowISO,
  });
}

async function collectJobSummaries(areaIds, maxPages, options = {}) {
  const fetchPage = options.fetchPage || fetchJson;
  const pageLimit = Math.max(1, Number.parseInt(maxPages, 10) || 1);
  const summaries = [];
  const seenStableKeys = new Set();
  const pageByFingerprint = new Map();
  let totalPages = null;
  let pagesFetched = 0;

  for (let page = 1; page <= (totalPages || 1); page++) {
    const params = {
      itemsPerPage: ITEMS_PER_PAGE,
      page,
    };
    if (areaIds.length) {
      params["filter[functionalAreas.area.id]"] = `$in:${areaIds.join(",")}`;
    }

    const res = await fetchPage("jobs", params);
    if (!Array.isArray(res?.data)) throw new Error(`jobs.af page ${page} returned malformed job data`);
    const jobs = res.data;
    pagesFetched = page;
    const reportedPages = Number.parseInt(res.meta?.totalPages, 10);
    if (Number.isFinite(reportedPages) && reportedPages >= 1) {
      totalPages = Math.max(page, reportedPages);
    } else if (jobs.length >= ITEMS_PER_PAGE) {
      throw new Error(`jobs.af page ${page} omitted pagination metadata for a full page`);
    } else {
      totalPages = page;
    }
    if (totalPages > pageLimit) {
      throw new Error(`jobs.af pagination requires ${totalPages} pages but max-pages is ${pageLimit}`);
    }
    if (page < totalPages && jobs.length === 0) {
      throw new Error(`jobs.af pagination returned an empty page ${page} of ${totalPages}`);
    }

    // Some APIs acknowledge the requested page number while repeatedly
    // returning an earlier page. Page counts alone would make that truncated
    // crawl look complete, so verify forward progress using identifiers that
    // remain stable when ordering or titles change.
    const stableKeys = unique(jobs.map(stableSummaryKey));
    const fingerprint = [...stableKeys].sort().join("\n");
    if (page > 1 && stableKeys.length > 0) {
      const repeatedPage = pageByFingerprint.get(fingerprint);
      if (repeatedPage !== undefined) {
        throw new Error(
          `jobs.af pagination stalled at page ${page}: repeated stable slug/ID keys from page ${repeatedPage}`
        );
      }
      if (stableKeys.every(key => seenStableKeys.has(key))) {
        throw new Error(
          `jobs.af pagination stalled at page ${page}: no new stable slug/ID keys`
        );
      }
    }
    if (fingerprint) pageByFingerprint.set(fingerprint, page);
    stableKeys.forEach(key => seenStableKeys.add(key));

    summaries.push(...jobs);
    console.log(`    Page ${page}: Found ${jobs.length} jobs.`);
  }

  return { summaries, pagesFetched, totalPages: totalPages || 1 };
}

async function scrapeJobsAf(options = {}) {
  const rawUrl = options.rawUrl || DEFAULT_RAW_URL;
  const maxPages = parseInt(options.maxPages || "80", 10);
  const concurrency = boundedConcurrency(options.concurrency, 4);
  const skipExistingUrls = options.skipExistingUrls || new Set();

  const requestedCategories = parseCategories(rawUrl);
  console.log("[i] Source: Jobs.af public API");
  console.log("[i] Categories requested:", requestedCategories.length || "none");

  const loadAreas = options.loadFunctionalAreas || loadFunctionalAreas;
  const collectSummaries = options.collectJobSummaries || collectJobSummaries;
  const functionalAreas = requestedCategories.length ? await loadAreas() : [];
  const areaIds = requestedCategories.length
    ? areaIdsForCategories(requestedCategories, functionalAreas)
    : [];
  console.log("[i] Matched functional areas:", areaIds.length || "none; scanning all active jobs");

  const pagination = await collectSummaries(areaIds, maxPages);
  const summaries = pagination.summaries;
  const uniqueSummaries = Array.from(new Map(summaries.map(job => [job.slug || job.id, job])).values());
  console.log("[i] Candidate jobs:", uniqueSummaries.length);

  const nowISO = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const limit = pLimit(concurrency);
  let completed = 0;
  let attempted = 0;
  let detailFailures = 0;
  let fallbackCount = 0;
  const results = await Promise.all(uniqueSummaries.map(summary => limit(async () => {
    const slug = summary.slug;
    if (!slug) return null;

    const url = `${SITE_BASE}/jobs/${slug}`;
    if (skipExistingUrls.has(url)) return null;
    attempted += 1;

    try {
      const detail = await fetchJson(`jobs/${encodeURIComponent(slug)}`);
      const job = detail.data || detail;
      const record = buildRecord(job, nowISO);
      completed += 1;
      console.log(`[job] ${completed}/${uniqueSummaries.length} ${record.title || slug}`);
      return record;
    } catch (error) {
      detailFailures += 1;
      console.log(`[!] failed ${url}: ${String(error).slice(0, 160)}`);
      const fallback = strongTitleSummaryFallback(buildRecord(summary, nowISO));
      if (fallback) fallbackCount += 1;
      return fallback;
    }
  })));

  const records = results.filter(Boolean);
  if (attempted && detailFailures === attempted && records.length === 0) {
    throw new Error(`jobs.af detail failure rate was ${detailFailures}/${attempted}`);
  }

  return attachCoverage(records, {
    auditRecords: results.map((record, index) => (
      record || buildRecord(uniqueSummaries[index], nowISO)
    )),
    discoveredCount: uniqueSummaries.length,
    detailFailures,
    enrichedCount: completed,
    fallbackCount,
    unsafeCoverage: attempted > 0 && (
      detailFailures === attempted || (detailFailures >= 5 && detailFailures / attempted >= 0.5)
    ),
    pagesFetched: pagination.pagesFetched,
    reportedPages: pagination.totalPages,
  });
}

async function main() {
  const rawUrl = arg("--raw-url", DEFAULT_RAW_URL);

  const maxPages = parseInt(arg("--max-pages", "80"), 10);
  const onlyOpen = hasFlag("--only-open");
  const outJson = arg("--json", path.join(process.cwd(), "jobs.json"));
  const outCsv = arg("--csv", path.join(process.cwd(), "jobs.csv"));
  const debugDir = arg("--debug-dir", path.join(process.cwd(), "debug"));

  ensureDir(path.dirname(outJson));
  ensureDir(path.dirname(outCsv));
  ensureDir(debugDir);

  let existingJobs = [];
  const existingUrls = new Set();
  if (fs.existsSync(outJson)) {
    try {
      existingJobs = JSON.parse(fs.readFileSync(outJson, "utf-8"));
      existingJobs.forEach(job => existingUrls.add(job.url));
      console.log(`[i] Loaded ${existingJobs.length} existing jobs.`);
    } catch (e) {
      console.log(`[!] Failed to load existing jobs: ${e.message}`);
    }
  }

  const newRecords = await scrapeJobsAf({
    rawUrl,
    maxPages,
    skipExistingUrls: existingUrls,
  });

  const dedupMap = new Map();
  [...existingJobs, ...newRecords].forEach(record => {
    if (record && record.url) dedupMap.set(record.url, record);
  });

  let out = Array.from(dedupMap.values());
  if (onlyOpen) {
    const today = todayISO();
    const before = out.length;
    out = out.filter(record => !record.closing_date || record.closing_date >= today);
    console.log(`[i] only-open: kept ${out.length}/${before} (removed expired)`);
  }

  out.sort((a, b) => (b.scraped_at || "").localeCompare(a.scraped_at || ""));

  fs.writeFileSync(outJson, JSON.stringify(out, null, 2), "utf-8");

  const fields = [
    "title", "company", "location", "closing_date", "apply_url", "url", "source",
    "scraped_at", "closing_date_raw", "apply_emails", "apply_phones"
  ];
  const rows = out.map(record => ({
    ...record,
    apply_emails: (record.apply_emails || []).join(" | "),
    apply_phones: (record.apply_phones || []).join(" | "),
  }));
  fs.writeFileSync(outCsv, toCSV(rows, fields), "utf-8");

  console.log("\nDone.");
  console.log(`Scraped New: ${newRecords.length}, Total Saved: ${out.length}`);
  console.log("JSON:", outJson);
  console.log("CSV :", outCsv);
}

if (require.main === module) {
  main().catch(e => {
    console.error("[FATAL]", e);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_RAW_URL,
  ITEMS_PER_PAGE,
  LEGACY_FILTERED_RAW_URL,
  UNFILTERED_RAW_URL,
  collectJobSummaries,
  scrapeJobsAf,
};
