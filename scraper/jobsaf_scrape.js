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

const API_BASE = "https://api.jobs.af/public";
const SITE_BASE = "https://jobs.af";
const ITEMS_PER_PAGE = 10;

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

function extractPhones(text) {
  const re = /(\+?\d[\d\s().-]{7,}\d)/g;
  return unique((text.match(re) || []).map(normSpace))
    .filter(x => x.length >= 9 && x.length <= 25)
    .slice(0, 10);
}

function toCSV(rows, fields) {
  const esc = (v) => {
    const s = (v === null || v === undefined) ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [
    fields.join(","),
    ...rows.map(r => fields.map(f => esc(r[f])).join(","))
  ].join("\n");
}

async function fetchJson(endpoint, params = {}) {
  const url = new URL(`${API_BASE}/${endpoint.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "jobsaf-tracker/1.0 (+https://github.com/nasirkhansayyad132/jobsaf-tracker)",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} for ${url}: ${body.slice(0, 200)}`);
  }

  return res.json();
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

const TECHNICAL_KEYWORDS = [
  "software", "developer", "engineer", "data", "security", "it officer",
  "compute", "database", "network", "system", "programming", "analyst",
  "web", "devops", "cloud", "information technology", "programmer",
  "information security", "technology", "ict", "tech", "digit", "help desk"
];

function isTechnical(job) {
  const haystack = [
    job.title,
    ...(areaNames(job)),
  ].join(" ").toLowerCase();
  return TECHNICAL_KEYWORDS.some(kw => haystack.includes(kw));
}

function shouldKeep(job) {
  const areas = areaNames(job).join(" ").toLowerCase();
  const restricted = areas.includes("banking") || areas.includes("finance");
  return !restricted || isTechnical(job);
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

  return {
    url: `${SITE_BASE}/jobs/${job.slug}`,
    source: "jobs.af",
    title: job.title || null,
    company: job.company?.name || null,
    location: formatLocation(job) || null,
    closing_date_raw: job.expiryDate || null,
    closing_date: closingDate,
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
  };
}

async function collectJobSummaries(areaIds, maxPages) {
  const summaries = [];
  let totalPages = 1;

  for (let page = 1; page <= Math.min(maxPages, totalPages); page++) {
    const params = {
      itemsPerPage: ITEMS_PER_PAGE,
      page,
    };
    if (areaIds.length) {
      params["filter[functionalAreas.area.id]"] = `$in:${areaIds.join(",")}`;
    }

    const res = await fetchJson("jobs", params);
    const jobs = res.data || [];
    totalPages = res.meta?.totalPages || totalPages;
    summaries.push(...jobs);
    console.log(`    Page ${page}: Found ${jobs.length} jobs.`);
  }

  return summaries;
}

async function main() {
  const rawUrl = arg("--raw-url");
  if (!rawUrl) {
    console.log("Usage:");
    console.log("  node jobsaf_scrape.js --raw-url \"https://jobs.af/jobs?...\" --max-pages 80 --only-open --json out.json --csv out.csv");
    process.exit(1);
  }

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

  const requestedCategories = parseCategories(rawUrl);
  console.log("[i] Source: Jobs.af public API");
  console.log("[i] Categories requested:", requestedCategories.length || "none");

  const functionalAreas = await loadFunctionalAreas();
  const areaIds = areaIdsForCategories(requestedCategories, functionalAreas);
  console.log("[i] Matched functional areas:", areaIds.length || "none; scanning all active jobs");

  const summaries = await collectJobSummaries(areaIds, maxPages);
  const uniqueSummaries = Array.from(new Map(summaries.map(job => [job.slug || job.id, job])).values());
  console.log("[i] Candidate jobs:", uniqueSummaries.length);

  const nowISO = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const newRecords = [];

  let i = 0;
  for (const summary of uniqueSummaries) {
    const slug = summary.slug;
    if (!slug) continue;

    const url = `${SITE_BASE}/jobs/${slug}`;
    if (existingUrls.has(url)) continue;

    i++;
    try {
      const detail = await fetchJson(`jobs/${encodeURIComponent(slug)}`);
      const job = detail.data || detail;
      if (!shouldKeep(job)) {
        console.log(`[i] Skipped non-technical finance/banking job: ${job.title || slug}`);
        continue;
      }
      const record = buildRecord(job, nowISO);
      newRecords.push(record);
      console.log(`[job] ${i}/${uniqueSummaries.length} ${record.title || slug}`);
    } catch (e) {
      console.log(`[!] failed ${url}: ${String(e).slice(0, 160)}`);
    }
  }

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

main().catch(e => {
  console.error("[FATAL]", e);
  process.exit(1);
});
