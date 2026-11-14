const cheerio = require("cheerio");
const { assessJobRelevance } = require("../lib/keywords");
const { detectAfghanLanguages } = require("../lib/languages");
const { buildRemoteJob, isoDate } = require("../lib/remote");
const { normSpace } = require("../lib/normalize");
const { finish, jsonFetcher } = require("./remote_common");

// Meridial is Invisible Technologies' freelance AI-training marketplace. Its
// public Greenhouse board lists one evergreen posting per language and skill.
const BOARD_URL = "https://boards-api.greenhouse.io/v1/boards/agency/jobs";

// Greenhouse returns the posting body as entity-escaped HTML.
function decodeContent(value) {
  return cheerio.load(`<div>${String(value || "")}</div>`)("div").text();
}

// "Pashto Language Specialist - Freelance AI Trainer Project" is published
// elsewhere as "Pashto Language Specialist - AI Trainer"; use that form so
// copies on other boards merge, and record "Freelance" as the job type.
function cleanTitle(value) {
  const text = normSpace(value);
  const trainer = /\s*[-–]?\s*(?:freelance\s+)?ai\s+trainer\s+project\b/gi;
  const base = text.replace(trainer, "").replace(/\s*[-–]\s*freelance(?:\s+project)?\s*$/i, "").replace(/\s*[-–]\s*$/, "").trim();
  return trainer.test(text) ? `${base} - AI Trainer` : base;
}

function restrictionFor(job) {
  const place = normSpace(job.location?.name);
  if (!place) return "";
  return /world\s*wide|anywhere/i.test(place) ? "Worldwide" : `Only: ${place}`;
}

/**
 * Only Afghan-language postings, and technical postings open worldwide, can
 * end up in the feed; fetch full text for those alone.
 */
function isCandidate(job) {
  const title = job.title || "";
  if (detectAfghanLanguages(title).length) return true;
  return restrictionFor(job) === "Worldwide"
    && assessJobRelevance({ title, work_mode: "remote" }).decision === "include";
}

function toRecord(job, detail, now) {
  return buildRemoteJob({
    source: "meridial",
    url: job.absolute_url,
    title: cleanTitle(job.title),
    company: "Meridial (Invisible Technologies)",
    restriction: restrictionFor(job),
    descriptionHtml: detail ? decodeContent(detail.content) : null,
    category: "AI training",
    jobType: "Freelance",
    postedAt: isoDate(job.first_published || job.updated_at),
  }, { now, sourceLabel: "Meridial" });
}

async function scrape(options = {}) {
  const fetchJson = jsonFetcher("meridial", options);
  const now = options.now || new Date().toISOString();
  const board = await fetchJson(BOARD_URL);
  if (!Array.isArray(board?.jobs)) throw new Error("meridial board returned no jobs array");
  const listings = board.jobs.filter(job => job && job.id && job.title && job.absolute_url);
  const candidates = listings.filter(isCandidate);
  let detailFailures = 0;
  const details = new Map(await Promise.all(candidates.map(async job => {
    try {
      return [job.id, await fetchJson(`${BOARD_URL}/${job.id}`)];
    } catch (error) {
      detailFailures += 1;
      console.log(`[meridial] detail failed ${job.id}: ${error.message}`);
      return [job.id, null];
    }
  })));
  const records = listings.map(job => toRecord(job, details.get(job.id), now));
  console.log(`[meridial] ${listings.length} postings; read ${candidates.length - detailFailures}/${candidates.length} candidates in full`);
  return finish("meridial", records, { detailFailures, fallbackCount: detailFailures });
}

module.exports = {
  kind: "language",
  listsOnlyOpenJobs: true,
  missedRunGrace: 2,
  name: "meridial",
  cleanTitle,
  decodeContent,
  isCandidate,
  restrictionFor,
  scrape,
  toRecord,
};
