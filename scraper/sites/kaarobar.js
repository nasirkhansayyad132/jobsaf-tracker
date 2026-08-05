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

const BASE_URL = "https://www.kaarobar.net";

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
    onRetry: ({ attempt, delay }) => console.log(`[kaarobar] retry ${attempt} in ${delay}ms: ${url}`),
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

  $("ul.post-job-bx > li._li, li._li").each((_, item) => {
    const root = $(item);
    const link = root.find('a[href^="/jobs/"]').first();
    const href = link.attr("href");
    if (!href) return;

    const text = normSpace(root.text());
    const date = text.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] || null;
    const company = normSpace(root.find('.job-post-info a[href^="/companies/"]').first().text());
    const location = normSpace(root.find('[title="Location"]').last().text())
      || normSpace(root.find(".fa-globe").parent().text()).replace(/\|.*$/, "");
    const jobType = normSpace(root.find(".job-time span").first().text());
    const gender = text.match(/\b(Male|Female|Any)\b/i)?.[1] || null;
    const title = normSpace(root.find(".job-post-info h6").first().text()) || normSpace(link.text());

    jobs.push({
      source: "kaarobar",
      url: absUrl(href),
      source_url: absUrl(href),
      title,
      company,
      location,
      closing_date_raw: date,
      closing_date: parseClosingDate(date),
      job_type: jobType,
      gender,
    });
  });

  return jobs;
}

function tableDetails($, root) {
  const details = {};
  root.find("table tr").each((_, row) => {
    const key = normSpace($(row).find("th").first().text()).replace(/:$/, "");
    const value = normSpace($(row).find("td").first().text());
    if (key && value) details[key] = value;
  });
  return details;
}

function sections($, root) {
  const parts = [];
  root.find(".row-bottom.data").each((_, section) => {
    const title = normSpace($(section).find("h5").first().text()).replace(/:$/, "");
    const clone = $(section).clone();
    clone.find("h5").first().remove();
    const body = htmlToText(clone.html());
    if (title && body) parts.push(`${title}\n${body}`);
  });
  return parts;
}

async function enrich(summary) {
  const html = await getHtml(summary.url);
  const $ = cheerio.load(html);
  const detailRoot = $(".widget.bg-white").first();
  const root = detailRoot.length ? detailRoot : $("body");
  const details = tableDetails($, root);
  const textSections = sections($, root);
  const description = textSections.join("\n\n");
  if (!detailRoot.length || !description || Object.keys(details).length === 0) {
    throw new Error("detail page DOM was missing the expected job content");
  }
  const title = normSpace(root.find("h5").first().text()).replace(/^Position Title:\s*/i, "") || summary.title;
  const applyHref = root.find('a[title="apply"], a[href*="/jobs/apply/"]').first().attr("href");
  const emails = extractEmails(description);

  return normalizeJob({
    ...summary,
    title,
    company: details.Organization || summary.company,
    location: details["Job Location"] || summary.location,
    closing_date_raw: details["Close date"] || summary.closing_date_raw,
    closing_date: parseClosingDate(details["Close date"]) || summary.closing_date,
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
      "Closing Date": details["Close date"] || summary.closing_date_raw,
      "Functional Area": details.Category,
      "Job Type": details["Employment Type"] || summary.job_type,
      Source: "Kaarobar",
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
    if (page === 1) writeDebug(debugDir, "kaarobar.html", html);
    const pageJobs = parseList(html);
    summaries.push(...pageJobs);
    console.log(`[kaarobar] page ${page}: ${pageJobs.length} jobs`);
    if (!pageJobs.length) break;
  }

  const seen = new Map(summaries.map(job => [job.source_url, normalizeJob(job)]));
  const candidates = requireDiscoveredJobs("kaarobar", Array.from(seen.values()));
  console.log(`[kaarobar] enriching ${candidates.length} unique summaries before relevance filtering`);
  const { records } = await enrichCandidates({
    siteName: "kaarobar",
    candidates,
    concurrency,
    enrich,
    onFailure: (job, error) => {
      console.log(`[kaarobar] detail failed ${job.url}: ${error.message}`);
    },
  });

  return records;
}

module.exports = {
  name: "kaarobar",
  scrape,
};
