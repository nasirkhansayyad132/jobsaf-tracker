const cheerio = require("cheerio");
const { requestText } = require("../lib/http");
const { attachCoverage, enrichCandidates } = require("../lib/html_adapter");
const {
  extractEmails,
  extractPhones,
  htmlToText,
  normalizeJob,
  normSpace,
  parseClosingDate,
} = require("../lib/normalize");

// Impactpool aggregates UN-system and international NGO vacancies (UNICEF,
// UNDP, UNOPS, WFP…) that rarely appear on the local boards.
const BASE_URL = "https://www.impactpool.org";
const LIST_URL = `${BASE_URL}/countries/Afghanistan`;

function absUrl(href) {
  try {
    return new URL(href, BASE_URL).toString();
  } catch {
    return null;
  }
}

async function getHtml(url) {
  return requestText(url, {
    headers: { "Accept-Language": "en" },
    onRetry: ({ attempt, delay }) => console.log(`[impactpool] retry ${attempt} in ${delay}ms: ${url}`),
  });
}

function parseList(html) {
  const $ = cheerio.load(html);
  const jobs = [];
  $(".job").each((_, element) => {
    const root = $(element);
    if (/job is closed/i.test(root.find(".extra").text())) return;
    const link = root.find('a[href^="/jobs/"]').first();
    const href = link.attr("href");
    const title = normSpace(link.find("h3").first().text());
    if (!href || !title) return;
    const lines = link.find(".ip-typography[type='bodyEmphasis']").map((__, node) => normSpace($(node).text())).get();
    jobs.push({
      source: "impactpool",
      url: absUrl(href),
      source_url: absUrl(href),
      title,
      company: lines[0] || null,
      location: !lines[1] || /afghanistan/i.test(lines[1]) ? lines[1] || "Afghanistan" : `${lines[1]}, Afghanistan`,
      details: { Level: lines[2] || null },
    });
  });
  return jobs;
}

function parseDetail(html, summary) {
  const $ = cheerio.load(html);
  const content = $(".main-content").first().clone();
  // Drop Impactpool's own disclaimer blocks that follow the vacancy text.
  content.find(".ip-layout, hr, script, style").remove();
  const description = htmlToText(content.html());
  if (!description || description.length < 200) throw new Error("detail page DOM was missing the vacancy text");
  const deadlineText = $("div.ip-typography").filter((_, node) => /Application deadline/i.test($(node).text())).first().text();
  const deadline = normSpace(deadlineText).replace(/^Application deadline:\s*/i, "") || null;
  const applyHref = $("a").filter((_, node) => /^apply$/i.test(normSpace($(node).text()))).first().attr("href");

  return normalizeJob({
    ...summary,
    title: normSpace($("h1").first().text()) || summary.title,
    closing_date_raw: deadline,
    closing_date: parseClosingDate(deadline),
    apply_url: applyHref ? absUrl(applyHref) : null,
    apply_emails: extractEmails(description),
    apply_phones: extractPhones(description),
    description,
    details: {
      ...summary.details,
      Organization: summary.company,
      "Closing Date": deadline,
      Countries: "Afghanistan",
      Source: "Impactpool",
    },
  });
}

async function scrape(options = {}) {
  const fetchHtml = options.getHtml || getHtml;
  const candidates = parseList(await fetchHtml(LIST_URL)).map(job => normalizeJob(job));
  if (!candidates.length) throw new Error("impactpool listed no open Afghanistan jobs; refusing to treat a possibly changed page as healthy");
  console.log(`[impactpool] enriching ${candidates.length} open Afghanistan listings`);
  const enrichment = await enrichCandidates({
    siteName: "impactpool",
    candidates,
    concurrency: 2,
    requestGapMs: 400,
    enrich: async summary => parseDetail(await fetchHtml(summary.url), summary),
    allowStrongTitleFallback: true,
    allowUnsafeResults: true,
    onFailure: (job, error) => console.log(`[impactpool] detail failed ${job.url}: ${error.message}`),
  });
  return attachCoverage(enrichment.records, {
    discoveredCount: enrichment.discoveredCount,
    detailFailures: enrichment.detailFailures,
    enrichedCount: enrichment.enrichedCount,
    fallbackCount: enrichment.fallbackCount,
    auditRecords: enrichment.auditRecords,
    unsafeCoverage: enrichment.unsafeCoverage,
  });
}

module.exports = {
  name: "impactpool",
  parseDetail,
  parseList,
  scrape,
};
