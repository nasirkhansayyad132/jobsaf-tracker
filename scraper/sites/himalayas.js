const { KABUL_UTC_OFFSET, buildRemoteJob, formatSalary, isoDate } = require("../lib/remote");
const { REMOTE_MISSED_RUN_GRACE, cleanCompany, finish, jsonFetcher, sleep } = require("./remote_common");

const API_URL = "https://himalayas.app/jobs/api/search";
// Worldwide-only search, one query per technical family. Results are roughly
// recency-ordered, so a bounded number of pages per day plus the pipeline's
// two-week retention keeps coverage without crawling the whole board.
const SEARCH_TERMS = ["developer", "engineer", "data", "devops", "security"];
const DEFAULT_PAGES_PER_TERM = 10;
const MAX_AGE_DAYS = 30;
const REQUEST_GAP_MS = 800;

function formatOffset(value) {
  const sign = value < 0 ? "-" : "+";
  const absolute = Math.abs(value);
  const hours = Math.floor(absolute);
  const minutes = Math.round((absolute - hours) * 60);
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

/**
 * Himalayas lists the UTC offsets a role accepts. An empty list, or one that
 * spans Kabul's offset, places no barrier on applicants in Afghanistan.
 */
function restrictionFor(job) {
  const countries = (job.locationRestrictions || []).map(item => (typeof item === "string" ? item : item?.name)).filter(Boolean);
  if (countries.length) return `Only: ${countries.join(", ")}`;
  const offsets = (job.timezoneRestrictions || []).map(Number).filter(Number.isFinite);
  if (!offsets.length) return "";
  const min = Math.min(...offsets);
  const max = Math.max(...offsets);
  if (min <= KABUL_UTC_OFFSET && max >= KABUL_UTC_OFFSET && offsets.length >= 20) return "";
  return `Time zones ${formatOffset(min)} to ${formatOffset(max)}`;
}

function parseJobs(data, now) {
  if (!Array.isArray(data?.jobs)) throw new Error("himalayas API returned no jobs array");
  const cutoff = Date.parse(now) - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return data.jobs
    .filter(item => item && item.title && (item.applicationLink || item.guid))
    .filter(item => !item.pubDate || Number(item.pubDate) * 1000 >= cutoff)
    .map(item => buildRemoteJob({
      source: "himalayas",
      url: item.guid || item.applicationLink,
      title: item.title,
      company: cleanCompany(item.companyName),
      restriction: restrictionFor(item),
      descriptionHtml: item.description || item.excerpt,
      category: (item.parentCategories || []).join(", ") || null,
      tags: (item.categories || []).map(value => String(value).replace(/-/g, " ")),
      jobType: item.employmentType || null,
      postedAt: item.pubDate,
      closesAt: isoDate(item.expiryDate),
      salary: formatSalary(item.minSalary, item.maxSalary, item.currency, item.salaryPeriod),
    }, { now, sourceLabel: "Himalayas", emptyMeansWorldwide: true }));
}

async function scrape(options = {}) {
  const fetchJson = jsonFetcher("himalayas", options);
  const wait = options.sleep || sleep;
  const now = options.now || new Date().toISOString();
  const pagesPerTerm = options.himalayasPages || DEFAULT_PAGES_PER_TERM;
  const byUrl = new Map();
  let requests = 0;
  let listingFailures = 0;
  let listingFailureReason = null;

  for (const term of SEARCH_TERMS) {
    for (let page = 1; page <= pagesPerTerm; page += 1) {
      if (requests > 0) await wait(REQUEST_GAP_MS);
      requests += 1;
      const params = new URLSearchParams({ worldwide: "true", sort: "recent", q: term, page: String(page) });
      let data;
      try {
        data = await fetchJson(`${API_URL}?${params}`);
      } catch (error) {
        listingFailures += 1;
        listingFailureReason = `${term} page ${page}: ${error.message}`;
        console.log(`[himalayas] ${listingFailureReason}`);
        break;
      }
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
      for (const record of parseJobs(data, now)) {
        if (!byUrl.has(record.url)) byUrl.set(record.url, record);
      }
      if (jobs.length < (Number(data?.limit) || 20)) break;
    }
  }
  const records = [...byUrl.values()];
  console.log(`[himalayas] ${records.length} recent worldwide listings from ${requests} requests`);
  return finish("himalayas", records, { listingFailures, listingFailureReason });
}

module.exports = {
  kind: "remote",
  missedRunGrace: REMOTE_MISSED_RUN_GRACE,
  name: "himalayas",
  parseJobs,
  restrictionFor,
  scrape,
};
