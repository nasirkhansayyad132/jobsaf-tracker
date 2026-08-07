const { UNFILTERED_RAW_URL, scrapeJobsAf } = require("../jobsaf_scrape");
const { DEFAULT_MAX_PAGES } = require("../lib/html_adapter");

async function scrape(options = {}) {
  return scrapeJobsAf({
    // The relevance classifier, not a brittle publisher category list, owns
    // the CS/IT scope. Scanning all active API jobs prevents new or mislabeled
    // technical roles from disappearing before classification.
    rawUrl: options.rawUrl || UNFILTERED_RAW_URL,
    maxPages: options.maxPages || DEFAULT_MAX_PAGES,
    concurrency: options.concurrency || 4,
  });
}

module.exports = {
  defaultRawUrl: UNFILTERED_RAW_URL,
  name: "jobs.af",
  scrape,
};
