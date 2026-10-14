const { buildRemoteJob, isoDate } = require("../lib/remote");
const { normSpace } = require("../lib/normalize");
const { REMOTE_MISSED_RUN_GRACE, finish, parseRssItems, textFetcher } = require("./remote_common");

const BASE_URL = "https://weworkremotely.com";
// The all-jobs feed carries only ten items per category; the technical
// category feeds go deeper. Listings are de-duplicated by URL below.
const FEEDS = [
  "/remote-jobs.rss",
  "/categories/remote-full-stack-programming-jobs.rss",
  "/categories/remote-back-end-programming-jobs.rss",
  "/categories/remote-front-end-programming-jobs.rss",
  "/categories/remote-programming-jobs.rss",
  "/categories/remote-devops-sysadmin-jobs.rss",
];

const CATEGORY_NAMES = new Map([
  ["full-stack programming", "Software Development"],
  ["back-end programming", "Software Development"],
  ["front-end programming", "Software Development"],
  ["programming", "Software Development"],
  ["devops and sysadmin", "DevOps"],
]);

function splitTitle(raw) {
  const text = normSpace(raw);
  const index = text.indexOf(": ");
  if (index <= 0) return { company: null, title: text };
  return { company: text.slice(0, index), title: text.slice(index + 2) };
}

/**
 * WWR shows "Anywhere in the World" even when the employer lists the only
 * countries it can hire in. A non-empty country list is the real restriction.
 */
function restrictionFor(item) {
  const countries = normSpace(String(item.country || "").replace(/\p{Regional_Indicator}/gu, ""));
  return countries ? `Only: ${countries}` : normSpace(item.region);
}

function parseFeed(xml, now) {
  return parseRssItems(xml)
    .filter(item => item.link && item.title)
    .map(item => {
      const { company, title } = splitTitle(item.title);
      const rawCategory = normSpace(item.category);
      return buildRemoteJob({
        source: "weworkremotely",
        url: normSpace(item.link),
        title,
        company,
        restriction: restrictionFor(item),
        descriptionHtml: item.description,
        category: CATEGORY_NAMES.get(rawCategory.toLowerCase()) || rawCategory || null,
        tags: String(item.skills || "").split(","),
        jobType: normSpace(item.type) || null,
        postedAt: item.pubDate,
        closesAt: isoDate(item.expires_at),
      }, { now, sourceLabel: "We Work Remotely" });
    });
}

async function scrape(options = {}) {
  const fetchText = textFetcher("weworkremotely", options);
  const now = options.now || new Date().toISOString();
  const byUrl = new Map();
  let listingFailures = 0;
  let listingFailureReason = null;
  for (const feed of FEEDS) {
    try {
      for (const record of parseFeed(await fetchText(`${BASE_URL}${feed}`), now)) {
        if (!byUrl.has(record.url)) byUrl.set(record.url, record);
      }
    } catch (error) {
      listingFailures += 1;
      listingFailureReason = `${feed}: ${error.message}`;
      console.log(`[weworkremotely] feed failed ${feed}: ${error.message}`);
    }
  }
  const records = [...byUrl.values()];
  console.log(`[weworkremotely] ${records.length} listings from ${FEEDS.length - listingFailures}/${FEEDS.length} feeds`);
  return finish("weworkremotely", records, { listingFailures, listingFailureReason });
}

module.exports = {
  kind: "remote",
  missedRunGrace: REMOTE_MISSED_RUN_GRACE,
  name: "weworkremotely",
  parseFeed,
  restrictionFor,
  scrape,
  splitTitle,
};
