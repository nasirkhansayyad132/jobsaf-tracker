const { DEFAULT_RAW_URL, scrapeJobsAf } = require("../jobsaf_scrape");

async function scrape(options = {}) {
  return scrapeJobsAf({
    rawUrl: options.rawUrl || DEFAULT_RAW_URL,
    maxPages: options.maxPages || 10,
    concurrency: options.concurrency || 4,
  });
}

module.exports = {
  name: "jobs.af",
  scrape,
};
