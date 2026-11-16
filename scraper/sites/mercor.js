const cheerio = require("cheerio");
const { buildRemoteJob, formatSalary, isoDate } = require("../lib/remote");
const { normSpace } = require("../lib/normalize");
const { finish, textFetcher } = require("./remote_common");

// Mercor hires language, music and subject experts to train AI models. Its
// sitemap lists every open listing; only language-related ones (by URL slug)
// are read in full. Mercor's robots.txt allows /jobs/ pages and disallows its
// API, so the API is never called.
const SITEMAP_URL = "https://work.mercor.com/sitemap.xml";
const LISTING_URL = /^https:\/\/work\.mercor\.com\/jobs\/list_[A-Za-z0-9_-]+\/[a-z0-9-]+$/;
const LANGUAGE_SLUG = /(?:pashto|pushto|pakhto|dari|farsi|persian|afghan|hazaragi|tajik|language|lingu|translat|transcri|interpret|multilingual|bilingual|voice|speech|audio|lyrics|music)/;

function listingUrls(xml) {
  const $ = cheerio.load(String(xml || ""), { xmlMode: true });
  return $("url > loc").map((_, loc) => normSpace($(loc).text())).get().filter(url => LISTING_URL.test(url));
}

function isLanguageSlug(url) {
  return LANGUAGE_SLUG.test(url.split("/").pop());
}

function jobPosting($) {
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(script).text());
      if (data?.["@type"] === "JobPosting") return data;
    } catch {
      // Other structured-data blocks are not job postings.
    }
  }
  return null;
}

// Mercor's structured data always claims "US"; the listing's own eligibility
// fields (embedded in the page) are what the application form enforces.
function embeddedField(html, listingId, field) {
  const text = String(html).replace(/\\"/g, '"');
  const start = Math.max(0, text.indexOf(`"listingId":"${listingId}"`));
  const match = text.slice(start).match(new RegExp(`"${field}":(null|"[^"]*"|\\[[^\\]]*\\])`));
  if (!match || match[1] === "null") return [];
  try {
    return [].concat(JSON.parse(match[1])).map(value => normSpace(value)).filter(Boolean);
  } catch {
    return [];
  }
}

function restrictionFor(html, listingId) {
  const eligible = [
    ...embeddedField(html, listingId, "eligibleLocation"),
    ...embeddedField(html, listingId, "eligibleResidenceLocation"),
  ];
  if (eligible.length) return `Only: ${[...new Set(eligible)].join(", ")}`;
  const excluded = [
    ...embeddedField(html, listingId, "ineligibleLocation"),
    ...embeddedField(html, listingId, "ineligibleResidenceLocation"),
  ];
  return excluded.length ? `Worldwide, excluding ${[...new Set(excluded)].join(", ")}` : "Worldwide";
}

function parseListing(html, url, now) {
  const $ = cheerio.load(String(html || ""));
  const posting = jobPosting($);
  if (!posting?.title) return null;
  if (/no longer accepting applications/i.test($("title").text() + $("h1").text())) return null;
  const listingId = posting.identifier?.value || (url.match(/list_[A-Za-z0-9_-]+/) || [])[0];
  if (embeddedField(html, listingId, "status").some(status => status !== "active")) return null;
  const salary = posting.baseSalary?.value;
  return buildRemoteJob({
    source: "mercor",
    url,
    title: posting.title,
    company: "Mercor",
    restriction: restrictionFor(html, listingId),
    descriptionHtml: posting.description,
    category: "AI training",
    jobType: String(posting.employmentType || "").replace(/_/g, " ").toLowerCase() || null,
    postedAt: posting.datePosted,
    closesAt: isoDate(posting.validThrough),
    salary: salary ? formatSalary(salary.minValue, salary.maxValue, posting.baseSalary.currency, String(salary.unitText || "").toLowerCase()) : null,
  }, { now, sourceLabel: "Mercor" });
}

function stubRecord(url, now) {
  const slug = url.split("/").pop();
  return buildRemoteJob({
    source: "mercor",
    url,
    title: slug.replace(/-/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()),
    company: "Mercor",
    restriction: "",
  }, { now, sourceLabel: "Mercor" });
}

async function scrape(options = {}) {
  const fetchText = textFetcher("mercor", options);
  const now = options.now || new Date().toISOString();
  const urls = listingUrls(await fetchText(SITEMAP_URL));
  if (!urls.length) throw new Error("mercor sitemap listed no job pages");
  const candidates = urls.filter(isLanguageSlug);
  let detailFailures = 0;
  const records = (await Promise.all(candidates.map(async url => {
    try {
      return parseListing(await fetchText(url), url, now);
    } catch (error) {
      detailFailures += 1;
      console.log(`[mercor] listing failed ${url}: ${error.message}`);
      return null;
    }
  }))).filter(Boolean);
  console.log(`[mercor] ${urls.length} open listings; read ${candidates.length - detailFailures}/${candidates.length} language-related ones`);
  // Other listings are recorded by title only. They state no eligibility, so
  // the pipeline drops them, but a day with no language listing still shows
  // the source as reachable rather than broken.
  const others = urls.filter(url => !isLanguageSlug(url)).map(url => stubRecord(url, now));
  return finish("mercor", [...records, ...others], { discoveredCount: urls.length, detailFailures });
}

module.exports = {
  kind: "language",
  listsOnlyOpenJobs: true,
  name: "mercor",
  isLanguageSlug,
  listingUrls,
  parseListing,
  restrictionFor,
  scrape,
};
