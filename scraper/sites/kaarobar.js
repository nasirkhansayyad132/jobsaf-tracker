const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { requestText } = require("../lib/http");
const {
  attachCoverage,
  DEFAULT_MAX_PAGES,
  enrichCandidates,
  reportedPageCount,
  requireDiscoveredJobs,
} = require("../lib/html_adapter");
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
    const link = root.find('.job-post-info h6 a[href*="/jobs/"], a[href^="/jobs/"]')
      .filter((__, anchor) => !/\/jobs\/apply\//i.test($(anchor).attr("href") || ""))
      .first();
    const href = link.attr("href");
    if (!href) return;

    const text = normSpace(root.text());
    const date = text.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] || null;
    const company = normSpace(root.find('.job-post-info a[href*="/companies/"]').first().text());
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
  const maxPages = parseInt(options.maxPages || String(DEFAULT_MAX_PAGES), 10);
  const debugDir = options.debugDir;
  const concurrency = parseInt(options.concurrency || "4", 10);
  const fetchHtml = options.getHtml || getHtml;
  const enrichDetail = options.enrich || enrich;
  const summaries = [];
  const seenUrls = new Set();
  let pagesFetched = 0;
  let reportedPages = null;
  let listingFailures = 0;
  let listingFailureReason = null;
  let listingComplete = false;

  for (let page = 1; page <= maxPages; page++) {
    let html;
    try {
      html = await fetchHtml(pageUrl(page));
    } catch (error) {
      if (!summaries.length) throw error;
      listingFailures += 1;
      listingFailureReason = `page ${page} failed after ${summaries.length} jobs: ${error.message}`;
      console.log(`[kaarobar] partial listing coverage: ${listingFailureReason}`);
      break;
    }
    pagesFetched = page;
    const detectedPages = reportedPageCount(html, page);
    // A link to only the current page does not prove it is the last page.
    // Establish a total only from a future-page link, then keep updating it.
    if (detectedPages !== null && (reportedPages !== null || detectedPages > page)) {
      reportedPages = Math.max(reportedPages || 1, detectedPages);
    }
    if (page === 1) writeDebug(debugDir, "kaarobar.html", html);
    const pageJobs = parseList(html);
    const newJobs = pageJobs.filter(job => job.source_url && !seenUrls.has(job.source_url));
    newJobs.forEach(job => seenUrls.add(job.source_url));
    summaries.push(...newJobs);
    console.log(`[kaarobar] page ${page}: ${pageJobs.length} jobs (${newJobs.length} new)`);
    if (reportedPages !== null && reportedPages > maxPages) {
      throw new Error(`kaarobar pagination requires ${reportedPages} pages but max-pages is ${maxPages}`);
    }
    if (!pageJobs.length) {
      if (reportedPages !== null && page < reportedPages) {
        listingFailures += 1;
        listingFailureReason = `page ${page} was empty before reported page ${reportedPages}`;
      } else {
        listingComplete = true;
      }
      break;
    }
    if (!newJobs.length) {
      listingFailures += 1;
      listingFailureReason = `pagination stalled at page ${page}`
        + (reportedPages !== null ? ` of ${reportedPages}` : " with no reported total");
      break;
    }
    if (reportedPages !== null && page >= reportedPages) {
      listingComplete = true;
      break;
    }
  }

  if (!listingComplete && listingFailures === 0 && pagesFetched >= maxPages) {
    throw new Error(`kaarobar reached max-pages ${maxPages} without a verified pagination end`);
  }

  const seen = new Map(summaries.map(job => [job.source_url, normalizeJob(job)]));
  const candidates = requireDiscoveredJobs("kaarobar", Array.from(seen.values()));
  console.log(`[kaarobar] enriching ${candidates.length} unique summaries before relevance filtering`);
  const enrichment = await enrichCandidates({
    siteName: "kaarobar",
    candidates,
    concurrency: Math.min(2, concurrency),
    requestGapMs: 250,
    enrich: enrichDetail,
    allowStrongTitleFallback: true,
    allowUnsafeResults: true,
    onFailure: (job, error) => {
      console.log(`[kaarobar] detail failed ${job.url}: ${error.message}`);
    },
  });

  return attachCoverage(enrichment.records, {
    discoveredCount: enrichment.discoveredCount,
    detailFailures: enrichment.detailFailures,
    enrichedCount: enrichment.enrichedCount,
    fallbackCount: enrichment.fallbackCount,
    auditRecords: enrichment.auditRecords,
    unsafeCoverage: enrichment.unsafeCoverage,
    listingFailures,
    listingFailureReason,
    pagesFetched,
    reportedPages,
  });
}

module.exports = {
  name: "kaarobar",
  pageUrl,
  parseList,
  scrape,
};
