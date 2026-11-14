const { buildRemoteJob } = require("../lib/remote");
const { normSpace } = require("../lib/normalize");
const { REMOTE_MISSED_RUN_GRACE, cleanCompany, finish, jsonFetcher, sleep } = require("./remote_common");

// Workable's public job search spans every employer hosting jobs on Workable,
// including translation agencies and localization studios. Its matching is
// fuzzy ("dari" also finds "day shift"), so the pipeline's language-role check
// decides what is kept.
const API_URL = "https://jobs.workable.com/api/v1/jobs";
const QUERIES = [
  "farsi", "pashto", "pashto interpreter", "dari translator", "dari interpreter",
  "persian translator", "persian interpreter",
];
const PAGES_PER_QUERY = 2;
const REQUEST_GAP_MS = 500;

/** A posting is published once per country it hires in; that country is the restriction. */
function restrictionFor(job) {
  const country = normSpace(job.location?.countryName);
  return country ? `Only: ${country}` : "";
}

function parseJobs(data, now) {
  if (!Array.isArray(data?.jobs)) throw new Error("workable search returned no jobs array");
  return data.jobs
    .filter(job => job && job.url && job.title && job.workplace === "remote" && (!job.state || job.state === "published"))
    .map(job => buildRemoteJob({
      source: "workable",
      url: job.url,
      title: job.title,
      company: cleanCompany(job.company?.title || job.company),
      restriction: restrictionFor(job),
      descriptionHtml: [job.description, job.requirementsSection, job.benefitsSection].filter(Boolean).join("\n"),
      category: normSpace(job.department) || null,
      jobType: normSpace(job.employmentType) || null,
      postedAt: job.created,
    }, { now, sourceLabel: "Workable" }));
}

async function scrape(options = {}) {
  const fetchJson = jsonFetcher("workable", options);
  const wait = options.sleep || sleep;
  const now = options.now || new Date().toISOString();
  const byUrl = new Map();
  let requests = 0;
  let listingFailures = 0;
  let listingFailureReason = null;

  for (const query of QUERIES) {
    let pageToken = null;
    for (let page = 1; page <= PAGES_PER_QUERY; page += 1) {
      if (requests > 0) await wait(REQUEST_GAP_MS);
      requests += 1;
      const params = new URLSearchParams({ query, workplace: "remote" });
      if (pageToken) params.set("pageToken", pageToken);
      let data;
      try {
        data = await fetchJson(`${API_URL}?${params}`);
      } catch (error) {
        listingFailures += 1;
        listingFailureReason = `${query} page ${page}: ${error.message}`;
        console.log(`[workable] ${listingFailureReason}`);
        break;
      }
      for (const record of parseJobs(data, now)) {
        if (!byUrl.has(record.url)) byUrl.set(record.url, record);
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
  }
  const records = [...byUrl.values()];
  console.log(`[workable] ${records.length} remote postings from ${requests} searches`);
  return finish("workable", records, { listingFailures, listingFailureReason });
}

module.exports = {
  kind: "language",
  listsOnlyOpenJobs: true,
  // Fuzzy search ranks postings differently from day to day.
  missedRunGrace: REMOTE_MISSED_RUN_GRACE,
  name: "workable",
  QUERIES,
  parseJobs,
  restrictionFor,
  scrape,
};
