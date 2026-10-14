const { buildRemoteJob, formatSalary } = require("../lib/remote");
const { REMOTE_MISSED_RUN_GRACE, cleanCompany, finish, jsonFetcher } = require("./remote_common");

// Remote OK's terms require linking to the Remote OK listing and naming it as
// the source; the listing URL is therefore the canonical job URL.
const API_URL = "https://remoteok.com/api";

function parseJobs(data, now) {
  if (!Array.isArray(data)) throw new Error("remoteok API returned a non-array payload");
  return data
    .filter(item => item && item.id && item.position && item.url)
    .map(item => buildRemoteJob({
      source: "remoteok",
      url: item.url,
      title: item.position,
      company: cleanCompany(item.company),
      restriction: item.location,
      descriptionHtml: item.description,
      tags: item.tags,
      postedAt: item.epoch || item.date,
      salary: formatSalary(item.salary_min, item.salary_max, "USD", "year"),
      applyUrl: /^https?:/i.test(item.apply_url || "") ? item.apply_url : null,
    }, { now, sourceLabel: "Remote OK" }));
}

async function scrape(options = {}) {
  const fetchJson = jsonFetcher("remoteok", options);
  const now = options.now || new Date().toISOString();
  const records = parseJobs(await fetchJson(API_URL), now);
  console.log(`[remoteok] ${records.length} listings`);
  return finish("remoteok", records);
}

module.exports = {
  kind: "remote",
  missedRunGrace: REMOTE_MISSED_RUN_GRACE,
  name: "remoteok",
  parseJobs,
  scrape,
};
