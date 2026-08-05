const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { requestText } = require("../lib/http");
const { enrichCandidates, requireDiscoveredJobs } = require("../lib/html_adapter");
const {
  extractEmails,
  extractPhones,
  htmlToText,
  normalizeJob,
  normSpace,
  parseClosingDate,
} = require("../lib/normalize");

const BASE_URL = "https://wazifaha.org";

function pageUrl(page) {
  return page <= 1 ? `${BASE_URL}/jobs/` : `${BASE_URL}/jobs/?page=${page}`;
}

function absUrl(href) {
  try {
    return new URL(href, BASE_URL).toString();
  } catch {
    return null;
  }
}

async function getHtml(url) {
  return requestText(url, {
    onRetry: ({ attempt, delay }) => console.log(`[wazifaha] retry ${attempt} in ${delay}ms: ${url}`),
  });
}

function writeDebug(debugDir, file, content) {
  if (!debugDir) return;
  fs.mkdirSync(debugDir, { recursive: true });
  fs.writeFileSync(path.join(debugDir, file), content, "utf-8");
}

function parseList(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  $(".wz-job").each((_, item) => {
    const root = $(item);
    const link = root.find("a.wz-job-name").first();
    const href = link.attr("href");
    if (!href) return;

    const metaItems = root.find(".wz-job-meta-item").map((__, el) => normSpace($(el).text())).get();
    const company = normSpace(root.find('.wz-job-meta-item a[href^="/companies/"]').first().text());
    const location = metaItems.find(text => text && text !== company) || null;
    const gender = normSpace(root.find(".wz-tag").first().text()).replace(/^\S+\s*/, "");

    jobs.push({
      source: "wazifaha",
      url: absUrl(href),
      source_url: absUrl(href),
      title: normSpace(link.text()),
      company,
      location,
      gender,
    });
  });

  return jobs;
}

function parseJobPostingJsonLd($) {
  let found = null;
  $('script[type="application/ld+json"]').each((_, script) => {
    if (found) return;
    try {
      const parsed = JSON.parse($(script).text());
      if (parsed && parsed["@type"] === "JobPosting") found = parsed;
    } catch {
      // Ignore non-JSON or malformed JSON-LD.
    }
  });
  return found || {};
}

function gridDetails($) {
  const details = {};
  $(".wz-grid-item").each((_, item) => {
    const key = normSpace($(item).find(".wz-grid-label").text()).replace(/^[^\p{L}\p{N}]+/u, "");
    const value = normSpace($(item).find(".wz-grid-value").text());
    if (key && value) details[key] = value;
  });
  return details;
}

function contentSections($) {
  const parts = [];
  $(".wz-content-section").each((_, section) => {
    const title = normSpace($(section).find(".wz-section-heading").first().text());
    const body = htmlToText($(section).find(".wz-section-body").first().html());
    if (title && body) parts.push(`${title}\n${body}`);
  });
  return parts;
}

async function enrich(summary) {
  const html = await getHtml(summary.url);
  const $ = cheerio.load(html);
  const ld = parseJobPostingJsonLd($);
  const details = gridDetails($);
  const sections = contentSections($);
  const description = sections.join("\n\n") || htmlToText(ld.description);
  const recognizedDetail = $(".wz-hero-title").length > 0
    && ($(".wz-content-section").length > 0 || Object.keys(details).length > 0 || ld["@type"] === "JobPosting");
  if (!recognizedDetail || !description) {
    throw new Error("detail page DOM was missing the expected job content");
  }
  const applyEmail = normSpace($(".wz-apply-email").first().text());
  const emails = extractEmails([description, applyEmail].join("\n"));
  const applyHref = $(".wz-apply-btn").first().attr("href");
  const title = normSpace($(".wz-hero-title").first().text()) || normSpace(ld.title) || summary.title;
  const company = normSpace($(".wz-hero-org a").first().text()) || ld.hiringOrganization?.name || summary.company;

  if (ld.datePosted) details["Post Date"] = ld.datePosted;

  return normalizeJob({
    ...summary,
    title,
    company,
    location: details.Location || ld.jobLocation?.address?.addressRegion || summary.location,
    closing_date_raw: details["Closing Date"] || summary.closing_date_raw,
    closing_date: parseClosingDate(details["Closing Date"]) || summary.closing_date,
    category: details.Category,
    job_type: details["Employment Type"] || summary.job_type,
    gender: details.Gender || summary.gender,
    vacancies: details["No of Job"] || details["No of Jobs"] || details["No. of Jobs"] || details["No. Of Jobs"],
    salary: details.Salary,
    apply_url: applyHref ? absUrl(applyHref) : (emails[0] ? `mailto:${emails[0]}` : summary.url),
    apply_emails: emails,
    apply_phones: extractPhones(description),
    description,
    details: {
      ...details,
      "Closing Date": details["Closing Date"] || summary.closing_date_raw,
      "Functional Area": details.Category,
      "Job Type": details["Employment Type"] || summary.job_type,
      Source: "Wazifaha",
    },
  });
}

async function scrape(options = {}) {
  const maxPages = parseInt(options.maxPages || "10", 10);
  const debugDir = options.debugDir;
  const concurrency = parseInt(options.concurrency || "4", 10);
  const summaries = [];

  for (let page = 1; page <= maxPages; page++) {
    const html = await getHtml(pageUrl(page));
    if (page === 1) writeDebug(debugDir, "wazifaha.html", html);
    const pageJobs = parseList(html);
    summaries.push(...pageJobs);
    console.log(`[wazifaha] page ${page}: ${pageJobs.length} jobs`);
    if (!pageJobs.length) break;
  }

  const seen = new Map(summaries.map(job => [job.source_url, normalizeJob(job)]));
  const candidates = requireDiscoveredJobs("wazifaha", Array.from(seen.values()));
  console.log(`[wazifaha] enriching ${candidates.length} unique summaries before relevance filtering`);
  const { records } = await enrichCandidates({
    siteName: "wazifaha",
    candidates,
    // This source starts returning 503/ECONNREFUSED under higher detail-page
    // pressure. Two concurrent requests keeps the crawl bounded and polite.
    concurrency: Math.min(2, concurrency),
    enrich,
    onFailure: (job, error) => {
      console.log(`[wazifaha] detail failed ${job.url}: ${error.message}`);
    },
  });

  return records;
}

module.exports = {
  name: "wazifaha",
  scrape,
};
