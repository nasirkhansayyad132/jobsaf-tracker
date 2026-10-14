const cheerio = require("cheerio");
const { requestJson, requestText } = require("../lib/http");
const { attachCoverage } = require("../lib/html_adapter");
const { normSpace } = require("../lib/normalize");

// Remote boards publish a rolling window of recent jobs. A listing that drops
// out of that window is usually still open, so keep it for two weeks of runs;
// the pipeline separately retires deadline-less jobs after 30 days.
const REMOTE_MISSED_RUN_GRACE = 14;

function logRetry(siteName) {
  return ({ attempt, delay, url }) => console.log(`[${siteName}] retry ${attempt} in ${delay}ms: ${url}`);
}

function jsonFetcher(siteName, options = {}) {
  return options.fetchJson || (url => requestJson(url, { onRetry: logRetry(siteName) }));
}

function textFetcher(siteName, options = {}) {
  return options.fetchText || (url => requestText(url, { onRetry: logRetry(siteName) }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Parse RSS 2.0 items into plain objects keyed by child element name. */
function parseRssItems(xml) {
  const $ = cheerio.load(String(xml || ""), { xmlMode: true });
  return $("item").map((_, item) => {
    const fields = {};
    $(item).children().each((__, child) => {
      const name = child.tagName || child.name;
      if (!name || name in fields) return;
      fields[name] = $(child).text();
    });
    return fields;
  }).get();
}

function finish(siteName, records, coverage = {}) {
  if (!records.length) throw new Error(`${siteName} returned no listings; refusing to treat a possibly changed feed as healthy`);
  return attachCoverage(records, { discoveredCount: records.length, ...coverage });
}

// Some boards append registry details to the employer name.
function cleanCompany(value) {
  return normSpace(value)
    .replace(/[,.]?\s+(?:company\s+no\.?|vat\s+(?:number|no\.?)|registered\s+(?:in|no\.?)|reg\.?\s+no\.?)\b.*$/i, "")
    .trim() || null;
}

module.exports = {
  REMOTE_MISSED_RUN_GRACE,
  cleanCompany,
  finish,
  jsonFetcher,
  parseRssItems,
  sleep,
  textFetcher,
};
