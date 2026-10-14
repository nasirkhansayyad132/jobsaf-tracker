const { buildRemoteJob } = require("../lib/remote");
const { REMOTE_MISSED_RUN_GRACE, cleanCompany, finish, jsonFetcher } = require("./remote_common");

const API_URL = "https://www.workingnomads.com/api/exposed_jobs/";

const CATEGORY_NAMES = new Map([
  ["development", "Software Development"],
  ["system administration", "DevOps"],
]);

function parseJobs(data, now) {
  if (!Array.isArray(data)) throw new Error("workingnomads API returned a non-array payload");
  return data
    .filter(item => item && item.url && item.title)
    .map(item => {
      const rawCategory = String(item.category_name || "").trim();
      return buildRemoteJob({
        source: "workingnomads",
        url: item.url,
        title: item.title,
        company: cleanCompany(item.company_name),
        restriction: item.location,
        descriptionHtml: item.description,
        category: CATEGORY_NAMES.get(rawCategory.toLowerCase()) || rawCategory || null,
        tags: String(item.tags || "").split(","),
        postedAt: item.pub_date,
      }, { now, sourceLabel: "Working Nomads" });
    });
}

async function scrape(options = {}) {
  const fetchJson = jsonFetcher("workingnomads", options);
  const now = options.now || new Date().toISOString();
  const records = parseJobs(await fetchJson(API_URL), now);
  console.log(`[workingnomads] ${records.length} listings`);
  return finish("workingnomads", records);
}

module.exports = {
  kind: "remote",
  missedRunGrace: REMOTE_MISSED_RUN_GRACE,
  name: "workingnomads",
  parseJobs,
  scrape,
};
