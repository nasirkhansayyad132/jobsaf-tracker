const { buildRemoteJob, formatSalary } = require("../lib/remote");
const { normSpace } = require("../lib/normalize");
const { finish, jsonFetcher, sleep } = require("./remote_common");

// Freelancer.com's public projects API lists open client projects. Projects
// asking for Pashto, Dari or Persian work (translation, transcription,
// research, support) are found by keyword; the language-role check decides
// what is kept, because keyword matching also returns unrelated projects.
const API_URL = "https://www.freelancer.com/api/projects/0.1/projects/active/";
const QUERIES = ["pashto", "dari", "farsi", "persian", "afghan", "hazaragi"];
const PAGE_SIZE = 50;
const REQUEST_GAP_MS = 500;

function salaryFor(project) {
  const budget = project.budget || {};
  const period = project.type === "hourly" ? "hour" : "project";
  return formatSalary(budget.minimum, budget.maximum, project.currency?.code || null, period);
}

function parseProjects(data, now) {
  const projects = data?.result?.projects;
  if (!Array.isArray(projects)) throw new Error("freelancer API returned no projects array");
  return projects
    // "Local" projects need someone on site; everything else is done online.
    .filter(project => project && project.title && project.seo_url && project.status === "active" && !project.local)
    .map(project => buildRemoteJob({
      source: "freelancer",
      url: `https://www.freelancer.com/projects/${project.seo_url}`,
      title: project.title,
      company: "Freelancer.com client",
      restriction: "",
      description: project.description || project.preview_description,
      // Client-chosen skill tags ("Data Entry") are not a role category.
      tags: (project.jobs || []).map(job => normSpace(job?.name)),
      jobType: project.type === "hourly" ? "Freelance (hourly)" : "Freelance (fixed price)",
      postedAt: project.time_submitted,
      salary: salaryFor(project),
    }, { now, sourceLabel: "Freelancer.com", emptyMeansWorldwide: true }));
}

async function scrape(options = {}) {
  const fetchJson = jsonFetcher("freelancer", options);
  const wait = options.sleep || sleep;
  const now = options.now || new Date().toISOString();
  const byUrl = new Map();
  let listingFailures = 0;
  let listingFailureReason = null;
  for (const [index, query] of QUERIES.entries()) {
    if (index > 0) await wait(REQUEST_GAP_MS);
    const params = new URLSearchParams({ query, limit: String(PAGE_SIZE), full_description: "true", job_details: "true" });
    try {
      for (const record of parseProjects(await fetchJson(`${API_URL}?${params}`), now)) {
        if (!byUrl.has(record.url)) byUrl.set(record.url, record);
      }
    } catch (error) {
      listingFailures += 1;
      listingFailureReason = `${query}: ${error.message}`;
      console.log(`[freelancer] ${listingFailureReason}`);
    }
  }
  const records = [...byUrl.values()];
  console.log(`[freelancer] ${records.length} open online projects from ${QUERIES.length} searches`);
  return finish("freelancer", records, { listingFailures, listingFailureReason });
}

module.exports = {
  kind: "language",
  listsOnlyOpenJobs: true,
  name: "freelancer",
  QUERIES,
  parseProjects,
  scrape,
};
