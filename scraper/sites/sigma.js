const cheerio = require("cheerio");
const { buildRemoteJob } = require("../lib/remote");
const { normSpace, unique } = require("../lib/normalize");
const { finish, textFetcher } = require("./remote_common");

// Sigma AI recruits freelance linguists (transcription, translation, speech
// data) for AI projects. Its Teamtailor career site publishes an RSS feed of
// every open posting; Dari and Pashto projects open and close through it.
const FEED_URL = "https://careers.sigma.ai/jobs.rss";

function cleanTitle(value) {
  return normSpace(value).replace(/\s*(?:\||--|–|-)\s*Sigma(?:\.AI| AI| Group)?\s*$/i, "").trim();
}

/** Teamtailor lists the countries a posting accepts; none means anywhere. */
function parseFeed(xml) {
  const $ = cheerio.load(String(xml || ""), { xmlMode: true });
  return $("item").map((_, item) => {
    const node = $(item);
    const countries = unique(node.find("tt\\:location").map((__, location) => (
      normSpace($(location).find("tt\\:country").text())
    )).get().filter(Boolean));
    return {
      title: cleanTitle(node.children("title").text()),
      link: normSpace(node.children("link").text()),
      description: node.children("description").text(),
      pubDate: normSpace(node.children("pubDate").text()),
      remoteStatus: normSpace(node.children("remoteStatus").text()).toLowerCase(),
      department: normSpace(node.find("tt\\:department").first().text()),
      countries,
    };
  }).get();
}

function toRecord(item, now) {
  return buildRemoteJob({
    source: "sigma",
    url: item.link,
    title: item.title,
    company: "Sigma AI",
    restriction: item.countries.length ? `Only: ${item.countries.join(", ")}` : "",
    descriptionHtml: item.description,
    category: item.department || "Annotation & Translation",
    jobType: "Freelance",
    postedAt: item.pubDate,
  }, { now, sourceLabel: "Sigma AI" });
}

async function scrape(options = {}) {
  const fetchText = textFetcher("sigma", options);
  const now = options.now || new Date().toISOString();
  const items = parseFeed(await fetchText(FEED_URL)).filter(item => item.title && item.link);
  // On-site studio roles (London, Madrid) are not open to Afghanistan.
  const remote = items.filter(item => item.remoteStatus === "fully");
  console.log(`[sigma] ${items.length} postings, ${remote.length} fully remote`);
  return finish("sigma", remote.map(item => toRecord(item, now)), { discoveredCount: items.length });
}

module.exports = {
  kind: "language",
  listsOnlyOpenJobs: true,
  name: "sigma",
  cleanTitle,
  parseFeed,
  scrape,
  toRecord,
};
