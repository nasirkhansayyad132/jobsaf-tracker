const { buildRemoteJob } = require("../lib/remote");
const { normSpace, unique } = require("../lib/normalize");
const { finish, jsonFetcher } = require("./remote_common");

// Welocalize (Welo Data) recruits AI trainers and linguists per language
// ("AI Trainers Network - Persian") through its public Lever board.
const BOARD_URL = "https://api.lever.co/v0/postings/weloglobal?mode=json";

/** Lever lists every location a posting accepts; any worldwide one opens it to all. */
function restrictionFor(posting) {
  const places = unique([
    ...(posting.categories?.allLocations || []),
    posting.categories?.location,
  ].map(place => normSpace(place)).filter(Boolean));
  if (!places.length) return "";
  if (places.some(place => /world\s*wide|anywhere|global/i.test(place))) return "Worldwide";
  return `Only: ${places.map(place => place.replace(/^remote\s*[-–,]\s*/i, "")).join(", ")}`;
}

function isRemote(posting) {
  const mode = String(posting.workplaceType || "").toLowerCase();
  if (mode === "remote") return true;
  return mode !== "onsite" && mode !== "hybrid" && /\bremote\b/i.test(posting.categories?.location || "");
}

function descriptionHtml(posting) {
  return [
    posting.description || posting.descriptionPlain,
    ...(posting.lists || []).map(list => `<h3>${list.text || ""}</h3>${list.content || ""}`),
    posting.additional || posting.additionalPlain,
  ].filter(Boolean).join("\n");
}

function parsePostings(data, now) {
  if (!Array.isArray(data)) throw new Error("welocalize board returned no postings array");
  return data
    .filter(posting => posting && posting.text && posting.hostedUrl && isRemote(posting))
    .map(posting => buildRemoteJob({
      source: "welocalize",
      url: posting.hostedUrl,
      applyUrl: posting.applyUrl,
      title: posting.text,
      // Aggregators (Jobicy, Himalayas) list Welocalize's hubs as "Welo Global".
      company: "Welocalize (Welo Global)",
      restriction: restrictionFor(posting),
      descriptionHtml: descriptionHtml(posting),
      // Lever teams ("Data", "Application") describe Welocalize's business
      // lines, not the role; as a category they would make every language
      // hub look technical. Keep them as tags only.
      tags: [posting.categories?.team, posting.categories?.department],
      jobType: normSpace(posting.categories?.commitment) || null,
      postedAt: posting.createdAt,
    }, { now, sourceLabel: "Welocalize" }));
}

async function scrape(options = {}) {
  const fetchJson = jsonFetcher("welocalize", options);
  const now = options.now || new Date().toISOString();
  const data = await fetchJson(BOARD_URL);
  const records = parsePostings(data, now);
  console.log(`[welocalize] ${Array.isArray(data) ? data.length : 0} postings, ${records.length} remote`);
  return finish("welocalize", records, { discoveredCount: Array.isArray(data) ? data.length : records.length });
}

module.exports = {
  kind: "language",
  listsOnlyOpenJobs: true,
  name: "welocalize",
  isRemote,
  parsePostings,
  restrictionFor,
  scrape,
};
