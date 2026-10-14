const { buildRemoteJob } = require("../lib/remote");
const { REMOTE_MISSED_RUN_GRACE, cleanCompany, finish, jsonFetcher } = require("./remote_common");

// Remotive asks API users to link back to the Remotive listing and to name
// Remotive as the source. Its feed is delayed by 24 hours.
const API_URL = "https://remotive.com/api/remote-jobs";

function parseJobs(data, now) {
  if (!Array.isArray(data?.jobs)) throw new Error("remotive API returned no jobs array");
  return data.jobs
    .filter(item => item && item.url && item.title)
    .map(item => buildRemoteJob({
      source: "remotive",
      url: item.url,
      title: item.title,
      company: cleanCompany(item.company_name),
      restriction: item.candidate_required_location,
      descriptionHtml: item.description,
      category: item.category,
      tags: item.tags,
      jobType: String(item.job_type || "").replace(/_/g, " ") || null,
      postedAt: item.publication_date,
      salary: item.salary || null,
    }, { now, sourceLabel: "Remotive" }));
}

async function scrape(options = {}) {
  const fetchJson = jsonFetcher("remotive", options);
  const now = options.now || new Date().toISOString();
  const records = parseJobs(await fetchJson(API_URL), now);
  console.log(`[remotive] ${records.length} listings`);
  return finish("remotive", records);
}

module.exports = {
  kind: "remote",
  missedRunGrace: REMOTE_MISSED_RUN_GRACE,
  name: "remotive",
  parseJobs,
  scrape,
};
