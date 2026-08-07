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
  unique,
} = require("../lib/normalize");

const BASE_URL = "https://www.acbar.org";

function pageUrl(page) {
  return page <= 1 ? `${BASE_URL}/en/jobs` : `${BASE_URL}/en/jobs?page=${page}`;
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
    onRetry: ({ attempt, delay }) => console.log(`[acbar] retry ${attempt} in ${delay}ms: ${url}`),
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

  // Current ACBAR listing (August 2026). The former /jobs table now redirects
  // to the homepage, so use the localized route and card markup explicitly.
  $(".job-card").each((_, item) => {
    const root = $(item);
    const link = root.find('a.job-card__title[href*="/en/jobs/details/"]').first();
    const href = link.attr("href");
    if (!href) return;

    const companyRoot = root.find(".job-card__company").first().clone();
    const jobType = normSpace(companyRoot.find(".job-pill").first().text());
    companyRoot.children().remove();
    const locationPill = root.find(".job-card__meta .job-pill").filter((__, pill) => (
      $(pill).find(".fa-map-marker").length > 0
    )).first();
    const deadlinePill = root.find(".job-card__meta .job-pill").filter((__, pill) => (
      $(pill).find(".fa-calendar").length > 0
    )).first();

    jobs.push({
      source: "acbar",
      url: absUrl(href),
      source_url: absUrl(href),
      title: normSpace(link.text()),
      company: normSpace(companyRoot.text()).replace(/[•·]+\s*$/, ""),
      location: normSpace(locationPill.text()),
      closing_date_raw: normSpace(deadlinePill.text()),
      closing_date: parseClosingDate(deadlinePill.text()),
      job_type: jobType,
    });
  });

  if (jobs.length) return jobs;

  // Retain compatibility with the previous table markup if ACBAR rolls back.
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

function detailsFromDefinitionList($, root) {
  const details = {};
  root.find(".acbar-jd__info-row").each((_, row) => {
    const key = normSpace($(row).find(".acbar-jd__info-term").first().text()).replace(/:$/, "");
    const value = normSpace($(row).find(".acbar-jd__info-desc").first().text());
    if (key && value) details[key] = value;
  });
  root.find(".acbar-jd__info-text").each((_, item) => {
    const key = normSpace($(item).find(".acbar-jd__info-text-title").first().text()).replace(/:$/, "");
    const value = normSpace($(item).find(".acbar-jd__info-text-value").first().text());
    if (key && value) details[key] = value;
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

function sectionsFromCards($, root) {
  const parts = [];
  root.find(".acbar-jd__card").each((_, card) => {
    const title = normSpace($(card).find(".acbar-jd__card-title").first().text()).replace(/:$/, "");
    if (!title || /^about the (company|organization)$/i.test(title)) return;
    const body = htmlToText($(card).find(".acbar-jd__rich").first().html());
    if (body) parts.push(`${title}\n${body}`);
  });
  return parts;
}

function parseDetail(html, summary) {
  const $ = cheerio.load(html);
  const currentRoot = $(".acbar-jd").first();
  const legacyRoot = $(".job-detail-box").parent();
  const root = currentRoot.length ? currentRoot : (legacyRoot.length ? legacyRoot : $("body"));
  const currentDetails = detailsFromDefinitionList($, root);
  const details = Object.keys(currentDetails).length ? currentDetails : detailsFromListItems($, root);
  const currentSections = sectionsFromCards($, root);
  const sections = currentSections.length ? currentSections : sectionsFromHeadings($, root);
  const description = sections.join("\n\n");
  const recognizedDetail = currentRoot.length
    ? root.find(".acbar-jd__title").length > 0 && root.find(".acbar-jd__card").length > 0
    : legacyRoot.length > 0 && root.find("h2.job-title").length > 0;
  if (!recognizedDetail || !description || Object.keys(details).length === 0) {
    throw new Error("detail page DOM was missing the expected job content");
  }
  const title = normSpace(root.find(".acbar-jd__title").first().text())
    || normSpace($("h2.job-title").first().text()).replace(/^Position Title:\s*/i, "")
    || summary.title;
  const company = normSpace(root.find(".acbar-jd__org").first().text()) || details.Organization || summary.company;
  const deadline = normSpace(root.find(".acbar-jd__deadline-value").first().text());
  const posted = normSpace($(".date_posted").first().text());
  const activation = posted.match(/Activation Date:\s*([^&]+?)(?:Announced Date:|Expire Date:|$)/i);
  const emailText = normSpace(root.find(".acbar-jd__email").first().text());
  const emails = extractEmails(`${description}\n${emailText}`);
  const applyHref = root.find('a[href^="mailto:"], a[href*="/applicationform"]').first().attr("href");

  if (details.Published) details["Post Date"] = details.Published;
  else if (activation) details["Post Date"] = parseClosingDate(activation[1]) || normSpace(activation[1]);
  details.Organization = company;

  return normalizeJob({
    ...summary,
    title,
    company,
    location: details.Location || details["Job Location"] || summary.location,
    category: details.Category,
    job_type: details.Type || details["Employment Type"] || summary.job_type,
    gender: details.Gender,
    vacancies: details["No of Job"] || details["No of Jobs"] || details["No. of Jobs"] || details["No. Of Jobs"],
    salary: details.Salary,
    closing_date_raw: deadline || details["Close date"] || summary.closing_date_raw,
    closing_date: parseClosingDate(deadline) || parseClosingDate(details["Close date"]) || summary.closing_date,
    apply_url: applyHref ? absUrl(applyHref) : (emails[0] ? `mailto:${emails[0]}` : summary.url),
    apply_emails: emails,
    apply_phones: extractPhones(description),
    description,
    details: {
      ...details,
      "Post Date": details["Post Date"],
      "Closing Date": deadline || details["Close date"] || summary.closing_date_raw,
      "Functional Area": details.Category,
      "Job Type": details.Type || details["Employment Type"] || summary.job_type,
      Source: "ACBAR",
    },
  });
}

async function enrich(summary) {
  const html = await getHtml(summary.url);
  return parseDetail(html, summary);
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
      console.log(`[acbar] partial listing coverage: ${listingFailureReason}`);
      break;
    }
    pagesFetched = page;
    const detectedPages = reportedPageCount(html, page);
    // A link to only the current page does not prove it is the last page.
    // Establish a total only from a future-page link, then keep updating it.
    if (detectedPages !== null && (reportedPages !== null || detectedPages > page)) {
      reportedPages = Math.max(reportedPages || 1, detectedPages);
    }
    if (page === 1) writeDebug(debugDir, "acbar.html", html);
    const pageJobs = parseList(html);
    const newJobs = pageJobs.filter(job => job.source_url && !seenUrls.has(job.source_url));
    newJobs.forEach(job => seenUrls.add(job.source_url));
    summaries.push(...newJobs);
    console.log(`[acbar] page ${page}: ${pageJobs.length} jobs (${newJobs.length} new)`);
    if (reportedPages !== null && reportedPages > maxPages) {
      throw new Error(`acbar pagination requires ${reportedPages} pages but max-pages is ${maxPages}`);
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
    throw new Error(`acbar reached max-pages ${maxPages} without a verified pagination end`);
  }

  const seen = new Map(summaries.map(job => [job.source_url, normalizeJob(job)]));
  // List pages rarely expose category/functional area. Enrich first so a
  // generic title such as "Officer" is not discarded before we see IT details.
  const candidates = requireDiscoveredJobs("acbar", Array.from(seen.values()));
  console.log(`[acbar] enriching ${candidates.length} unique summaries before relevance filtering`);
  const enrichment = await enrichCandidates({
    siteName: "acbar",
    candidates,
    concurrency: Math.min(2, concurrency),
    requestGapMs: 200,
    enrich: enrichDetail,
    allowStrongTitleFallback: true,
    allowUnsafeResults: true,
    onFailure: (job, error) => {
      console.log(`[acbar] detail failed ${job.url}: ${error.message}`);
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
  name: "acbar",
  pageUrl,
  parseDetail,
  parseList,
  scrape,
};
