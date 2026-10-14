const { buildRemoteJob, formatSalary } = require("../lib/remote");
const { REMOTE_MISSED_RUN_GRACE, cleanCompany, finish, jsonFetcher } = require("./remote_common");

const API_URL = "https://jobicy.com/api/v2/remote-jobs";
// The unfiltered feed returns the latest 100 jobs; the "anywhere" filter
// reaches further back for the worldwide roles this tracker cares about.
const QUERIES = ["count=100", "count=100&geo=anywhere"];

function parseJobs(data, now) {
  if (!Array.isArray(data?.jobs)) throw new Error("jobicy API returned no jobs array");
  return data.jobs
    .filter(item => item && item.url && item.jobTitle)
    .map(item => {
      const industries = [].concat(item.jobIndustry || []).filter(Boolean);
      return buildRemoteJob({
        source: "jobicy",
        url: item.url,
        title: item.jobTitle,
        company: cleanCompany(item.companyName),
        restriction: item.jobGeo,
        descriptionHtml: item.jobDescription || item.jobExcerpt,
        category: industries.join(", ") || null,
        jobType: [].concat(item.jobType || []).join(", ") || null,
        postedAt: item.pubDate,
        salary: formatSalary(item.salaryMin, item.salaryMax, item.salaryCurrency, item.salaryPeriod),
      }, { now, sourceLabel: "Jobicy" });
    });
}

async function scrape(options = {}) {
  const fetchJson = jsonFetcher("jobicy", options);
  const now = options.now || new Date().toISOString();
  const byUrl = new Map();
  let listingFailures = 0;
  let listingFailureReason = null;
  for (const query of QUERIES) {
    try {
      for (const record of parseJobs(await fetchJson(`${API_URL}?${query}`), now)) {
        if (!byUrl.has(record.url)) byUrl.set(record.url, record);
      }
    } catch (error) {
      listingFailures += 1;
      listingFailureReason = `${query}: ${error.message}`;
      console.log(`[jobicy] query failed ${query}: ${error.message}`);
    }
  }
  const records = [...byUrl.values()];
  console.log(`[jobicy] ${records.length} listings`);
  return finish("jobicy", records, { listingFailures, listingFailureReason });
}

module.exports = {
  kind: "remote",
  missedRunGrace: REMOTE_MISSED_RUN_GRACE,
  name: "jobicy",
  parseJobs,
  scrape,
};
