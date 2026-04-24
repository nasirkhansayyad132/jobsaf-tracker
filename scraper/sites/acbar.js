const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const pLimit = require("p-limit");
const {
  extractEmails,
  extractPhones,
  htmlToText,
  normalizeJob,
  normSpace,
  parseClosingDate,
  unique,
} = require("../lib/normalize");
const { isRelatedJob } = require("../lib/keywords");

const BASE_URL = "https://www.acbar.org";

function pageUrl(page) {
  return page <= 1 ? `${BASE_URL}/jobs` : `${BASE_URL}/jobs?page=${page}`;
}

function absUrl(href) {
  try {
    return new URL(href, BASE_URL).toString();
  } catch {
    return null;
  }
}

async function getHtml(url) {
  return getHtmlWithRetry(url);
}

async function getHtmlWithRetry(url, attempt = 1) {
  try {
    const res = await axios.get(url, {
      timeout: 30000,
      headers: { "User-Agent": "jobsaf-tracker/1.0" },
    });
    return res.data;
  } catch (error) {
    if (attempt >= 3) throw error;
    await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    return getHtmlWithRetry(url, attempt + 1);
  }
}

function writeDebug(debugDir, file, content) {
  if (!debugDir) return;
  fs.mkdirSync(debugDir, { recursive: true });
  fs.writeFileSync(path.join(debugDir, file), content, "utf-8");
}

function parseList(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 5) return;

    const link = $(cells[1]).find('a[href*="/jobs/"]').first();
    const href = link.attr("href");
    if (!href) return;

    const locations = $(cells[3]).find("a").map((__, a) => normSpace($(a).text())).get();
    jobs.push({
      source: "acbar",
      url: absUrl(href),
      source_url: absUrl(href),
      title: normSpace(link.text()),
      company: normSpace($(cells[2]).text()),
      location: unique(locations).join(", ") || normSpace($(cells[3]).text()).replace(/,$/, ""),
      closing_date_raw: normSpace($(cells[4]).text()),
      closing_date: parseClosingDate($(cells[4]).text()),
    });
  });

  return jobs;
}

function detailsFromListItems($, root) {
  const details = {};
  root.find("li.list-group-item").each((_, item) => {
    const label = normSpace($(item).find("span").first().text()).replace(/:$/, "");
    if (!label) return;
    const clone = $(item).clone();
    clone.find("span").first().remove();
    details[label] = normSpace(clone.text());
  });
  return details;
}

function sectionsFromHeadings($, root) {
  const parts = [];
  root.find("h3").each((_, heading) => {
    const title = normSpace($(heading).text()).replace(/:$/, "");
    const bodyHtml = $(heading).siblings(".paragraph").first().html()
      || $(heading).parent().find(".paragraph").first().html();
    const body = htmlToText(bodyHtml);
    if (title && body) parts.push(`${title}\n${body}`);
  });
  return parts;
}

async function enrich(summary) {
  const html = await getHtml(summary.url);
  const $ = cheerio.load(html);
  const root = $(".job-detail-box").parent().length ? $(".job-detail-box").parent() : $("body");
  const details = detailsFromListItems($, root);
  const sections = sectionsFromHeadings($, root);
  const description = sections.join("\n\n");
  const title = normSpace($("h2.job-title").first().text()).replace(/^Position Title:\s*/i, "") || summary.title;
  const posted = normSpace($(".date_posted").first().text());
  const activation = posted.match(/Activation Date:\s*([^&]+?)(?:Announced Date:|Expire Date:|$)/i);
  const emails = extractEmails(description);

  if (activation) details["Post Date"] = parseClosingDate(activation[1]) || normSpace(activation[1]);

  return normalizeJob({
    ...summary,
    title,
    company: details.Organization || summary.company,
    location: details["Job Location"] || summary.location,
    category: details.Category,
    job_type: details["Employment Type"],
    gender: details.Gender,
    vacancies: details["No. Of Jobs"] || details["Vacancy Number"],
    salary: details.Salary,
    closing_date_raw: details["Close date"] || summary.closing_date_raw,
    closing_date: parseClosingDate(details["Close date"]) || summary.closing_date,
    apply_url: emails[0] ? `mailto:${emails[0]}` : summary.url,
    apply_emails: emails,
    apply_phones: extractPhones(description),
    description,
    details: {
      ...details,
      "Post Date": details["Post Date"],
      "Closing Date": details["Close date"] || summary.closing_date_raw,
      "Functional Area": details.Category,
      "Job Type": details["Employment Type"],
      Source: "ACBAR",
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
    if (page === 1) writeDebug(debugDir, "acbar.html", html);
    const pageJobs = parseList(html);
    summaries.push(...pageJobs);
    console.log(`[acbar] page ${page}: ${pageJobs.length} jobs`);
    if (!pageJobs.length) break;
  }

  const seen = new Map(summaries.map(job => [job.source_url, normalizeJob(job)]));
  const candidates = Array.from(seen.values()).filter(isRelatedJob);
  console.log(`[acbar] detail candidates: ${candidates.length}/${seen.size}`);
  const limit = pLimit(concurrency);
  const records = await Promise.all(candidates.map(job => (
    limit(() => enrich(job).catch(error => {
      console.log(`[acbar] detail failed ${job.url}: ${error.message}`);
      return normalizeJob(job);
    }))
  )));

  return records.filter(Boolean);
}

module.exports = {
  name: "acbar",
  scrape,
};
