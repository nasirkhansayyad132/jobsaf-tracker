const cheerio = require("cheerio");
const { buildRemoteJob } = require("../lib/remote");
const { normSpace } = require("../lib/normalize");
const { finish, textFetcher } = require("./remote_common");

// GoTranscript keeps standing, always-open freelance recruitment pages per
// language. A page that still loads is an open opportunity; one that is
// removed or stops naming its language drops out of the feed.
const BASE_URL = "https://gotranscript.com";
const PAGES = [
  { path: "/pashto-transcription-job", language: /pashto/i },
  { path: "/pashto-translation-jobs", language: /pashto/i },
  { path: "/dari-persian-translation-jobs", language: /\bdari\b/i },
  { path: "/persian-translation-jobs", language: /persian|farsi/i },
];

function cleanTitle(value) {
  return normSpace(value).replace(/\s*[|–-]\s*GoTranscript\s*$/i, "").replace(/,?\s*Hiring Now!?$/i, "").trim();
}

function parsePage(html, page, now) {
  const $ = cheerio.load(String(html || ""));
  const title = cleanTitle($("h1").first().text() || $("title").text());
  $("script, style, nav, header, footer, form, noscript").remove();
  const main = $("main").length ? $("main") : $("body");
  const description = normSpace($('meta[name="description"]').attr("content")) + "\n\n" + main.find("h2, h3, p, li")
    .map((_, element) => normSpace($(element).text()))
    .get()
    .filter(Boolean)
    .join("\n");
  if (!title || !page.language.test(`${title}\n${description}`)) return null;
  return buildRemoteJob({
    source: "gotranscript",
    url: `${BASE_URL}${page.path}`,
    title,
    company: "GoTranscript",
    restriction: /\b(?:worldwide|anywhere in the world|any country|all countries)\b/i.test(description) ? "Worldwide" : "",
    description,
    category: /translat/i.test(page.path) ? "Translation" : "Transcription",
    jobType: "Freelance",
  }, { now, sourceLabel: "GoTranscript" });
}

async function scrape(options = {}) {
  const fetchText = textFetcher("gotranscript", options);
  const now = options.now || new Date().toISOString();
  let listingFailures = 0;
  let listingFailureReason = null;
  const records = (await Promise.all(PAGES.map(async page => {
    try {
      return parsePage(await fetchText(`${BASE_URL}${page.path}`), page, now);
    } catch (error) {
      // A removed page (GoTranscript answers 400 or 404) means the
      // opportunity closed, not that the source is broken.
      if (![400, 404, 410].includes(error.status)) {
        listingFailures += 1;
        listingFailureReason = `${page.path}: ${error.message}`;
      }
      console.log(`[gotranscript] ${page.path}: ${error.message}`);
      return null;
    }
  }))).filter(Boolean);
  console.log(`[gotranscript] ${records.length}/${PAGES.length} recruitment pages open`);
  return finish("gotranscript", records, { discoveredCount: PAGES.length, listingFailures, listingFailureReason });
}

module.exports = {
  kind: "language",
  listsOnlyOpenJobs: true,
  name: "gotranscript",
  PAGES,
  cleanTitle,
  parsePage,
  scrape,
};
