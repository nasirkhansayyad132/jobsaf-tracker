const { htmlToText, normalizeJob, normSpace, unique } = require("./normalize");

// Kabul is UTC+4:30 all year (Afghanistan does not observe daylight saving).
const KABUL_UTC_OFFSET = 4.5;
// Remote listings link to the full original; keep the published text compact.
const MAX_DESCRIPTION_CHARS = 4_000;

// Remote listings are kept only when someone living in Afghanistan can
// realistically apply. Labels are shown verbatim in the UI.
const SCOPE_LABELS = {
  worldwide: "Open worldwide",
  afghanistan: "Open to Afghanistan",
  asia: "Open in Asia",
  timezone: "Time zones include Afghanistan",
  language: "Needs Dari/Pashto",
};

const WORLDWIDE_PATTERN = /\b(?:worldwide|world\s*wide|anywhere(?:\s+in\s+the\s+world)?|global(?:ly)?|international(?:ly)?(?:\s+located)?|all\s+countries|any\s+(?:country|location)|work\s+from\s+anywhere|location\s+independent)\b/i;
// "Anywhere in India" restricts to India; it is not a worldwide role.
const ANYWHERE_IN_PATTERN = /\banywhere\s+in\s+(?!the\s+world\b)([a-z][a-z .'-]+)/i;
const OUTSIDE_PATTERN = /\b(?:outside(?:\s+of)?|not\s+(?:located\s+)?in|excluding|except)\b/i;
const AFGHANISTAN_PATTERN = /\b(?:afghanistan|kabul|herat|mazar|kandahar|jalalabad)\b/i;
const ASIA_PATTERN = /\b(?:asia|south\s+asia|central\s+asia|middle\s+east|mena)\b/i;
// Region names that exclude Afghanistan. APAC and EMEA are deliberately not
// treated as eligible: employers rarely mean Afghanistan by either.
const RESTRICTED_PATTERN = /\b(?:usa?|u\.s\.a?\.?|united\s+states|america[s]?|north\s+america|latam|latin\s+america|canada|mexico|brazil|argentina|uk|u\.k\.|united\s+kingdom|britain|england|ireland|europe(?:an)?|eu|eea|emea|apac|asia[-\s]pacific|germany|france|spain|portugal|italy|netherlands|poland|nordics?|sweden|norway|denmark|finland|switzerland|austria|belgium|australia|new\s+zealand|india|philippines|singapore|japan|korea|china|africa|nigeria|kenya|south\s+africa|israel|turkey|egypt|uae|saudi|pakistan|indonesia|vietnam|malaysia|thailand|bangladesh)\b/i;

// Titles such as "Backend Developer - Remote from EU" or "Engineer (US only)"
// restrict a listing the board itself marks worldwide. Short codes are matched
// case-sensitively so words like "us" in "Join us" do not count.
const TITLE_REGION_CODES = /\b(?:US|USA|U\.S\.|UK|EU|EMEA|APAC|LATAM|CET|EST|PST)\b/;
const TITLE_REGION_NAMES = /\b(?:united\s+states|north\s+america|americas|latin\s+america|canada|mexico|brazil|argentina|united\s+kingdom|europe(?:an)?|germany|france|spain|portugal|italy|netherlands|poland|nordics?|australia|new\s+zealand|india|philippines|singapore|japan|africa)\b/i;

function titleRestricts(title) {
  const text = String(title || "");
  if (WORLDWIDE_PATTERN.test(text) || AFGHANISTAN_PATTERN.test(text)) return false;
  return TITLE_REGION_CODES.test(text) || TITLE_REGION_NAMES.test(text);
}

const TIMEZONE_BASES = {
  utc: 0, gmt: 0, wet: 0, cet: 1, cest: 2, eet: 2, eest: 3, msk: 3, gst: 4, pkt: 5, ist: 5.5,
  est: -5, edt: -4, cst: -6, cdt: -5, mst: -7, mdt: -6, pst: -8, pdt: -7, et: -5, ct: -6, pt: -8,
};

function parseOffset(sign, hours, minutes) {
  const value = Number(hours) + (Number(minutes) || 0) / 60;
  return sign === "-" ? -value : value;
}

/**
 * Return the UTC offset window a location text allows, or null when the text
 * does not describe time zones. Supports "UTC+3 to UTC+6", "GMT+4:30",
 * "CET (+/- 3 hours)" and "EST ± 2h".
 */
function timezoneWindow(text) {
  const value = String(text || "").toLowerCase();
  const offsets = [];
  for (const match of value.matchAll(/\b(?:utc|gmt)\s*([+-−])\s*(\d{1,2})(?::?(\d{2}))?/g)) {
    offsets.push(parseOffset(match[1] === "−" ? "-" : match[1], match[2], match[3]));
  }
  const tolerance = value.match(/(?:\+\s*\/\s*-|±|plus\s+or\s+minus)\s*(\d{1,2})(?:\.(\d))?\s*(?:h|hours?)?/);
  const named = value.match(/\b(utc|gmt|wet|cet|cest|eet|eest|msk|gst|pkt|ist|est|edt|cst|cdt|mst|mdt|pst|pdt|et|ct|pt)\b/);
  if (tolerance && (offsets.length === 1 || named)) {
    const center = offsets.length === 1 ? offsets[0] : TIMEZONE_BASES[named[1]];
    const spread = Number(tolerance[1]) + (Number(tolerance[2]) || 0) / 10;
    return { min: center - spread, max: center + spread };
  }
  if (offsets.length >= 2) return { min: Math.min(...offsets), max: Math.max(...offsets) };
  if (offsets.length === 1 && /\b(?:utc|gmt)\s*[+-−]/.test(value)) {
    return { min: offsets[0], max: offsets[0] };
  }
  return null;
}

const LANGUAGE_CONTEXT = "speak(?:s|er|ers|ing)?|language|languages|fluent|fluency|native|proficien(?:t|cy)|translat(?:or|ion)|interpret(?:er|ing)|pashto|persian|farsi|english";
const AFGHAN_LANGUAGE_PATTERNS = [
  // "dari" is also Indonesian for "from", so require nearby language context.
  ["Dari", new RegExp(
    `\\bdari\\b(?=[^.\\n]{0,40}\\b(?:${LANGUAGE_CONTEXT})\\b)|\\b(?:${LANGUAGE_CONTEXT})\\b[^.\\n]{0,40}\\bdari\\b|دری`,
    "i",
  )],
  ["Pashto", /\b(?:pashto|pushto|pakhto|pashtu|pushtu)\b|پښتو|پشتو/i],
  ["Persian", /\bpersian\s+(?:language|speaker|speaking|translator|interpreter)|\b(?:in|speak|speaks|fluent|native)\s+persian\b|\bfarsi\b|فارسی/i],
];

/** Afghan languages a listing asks for (Persian/Farsi is close to Dari). */
function detectAfghanLanguages(...texts) {
  const text = texts.filter(Boolean).join("\n");
  return AFGHAN_LANGUAGE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

/**
 * Decide whether a remote listing is open to someone in Afghanistan.
 *
 * `restriction` is the board's location/eligibility text. `emptyMeansWorldwide`
 * is set only for boards that document an empty restriction as worldwide.
 * Returns `{ scope, label }`, where a null scope means "not eligible".
 */
function classifyRemoteEligibility(restriction, options = {}) {
  const text = normSpace(restriction);
  const languages = options.languages || [];
  const languageFallback = languages.length
    ? { scope: "language", label: SCOPE_LABELS.language }
    : { scope: null, label: null };

  if (!text || /^remote$/i.test(text)) {
    if (options.emptyMeansWorldwide) return { scope: "worldwide", label: SCOPE_LABELS.worldwide };
    return languageFallback;
  }
  if (AFGHANISTAN_PATTERN.test(text)) return { scope: "afghanistan", label: SCOPE_LABELS.afghanistan };

  const anywhereIn = text.match(ANYWHERE_IN_PATTERN);
  if (anywhereIn && !ASIA_PATTERN.test(anywhereIn[1])) return languageFallback;

  // "Internationally located (not in the US, CA, UK…)" lists exclusions, not
  // the only eligible countries. "Europe (excluding UK)" is still Europe-only.
  const outside = text.match(OUTSIDE_PATTERN);
  if (outside && !RESTRICTED_PATTERN.test(text.slice(0, outside.index))) {
    return { scope: "worldwide", label: `${SCOPE_LABELS.worldwide} (with exclusions)` };
  }
  if (WORLDWIDE_PATTERN.test(text) && !anywhereIn) {
    return { scope: "worldwide", label: SCOPE_LABELS.worldwide };
  }
  if (ASIA_PATTERN.test(text.replace(/asia[-\s]*pacific/gi, " "))) {
    return { scope: "asia", label: SCOPE_LABELS.asia };
  }

  const window = timezoneWindow(text);
  if (window && !RESTRICTED_PATTERN.test(text.replace(/\b(?:utc|gmt|cet|est|pst|ist)\b/gi, ""))) {
    if (KABUL_UTC_OFFSET >= window.min && KABUL_UTC_OFFSET <= window.max) {
      return { scope: "timezone", label: SCOPE_LABELS.timezone };
    }
    return languageFallback;
  }
  if (RESTRICTED_PATTERN.test(text)) return { scope: null, label: null };
  // Unrecognised text (a city, a company office) is treated as restricted.
  return languageFallback;
}

function truncateDescription(text) {
  const clean = String(text || "").trim();
  if (clean.length <= MAX_DESCRIPTION_CHARS) return clean || null;
  const cut = clean.slice(0, MAX_DESCRIPTION_CHARS);
  const lastBreak = cut.lastIndexOf("\n");
  return `${cut.slice(0, lastBreak > MAX_DESCRIPTION_CHARS * 0.8 ? lastBreak : cut.length).trim()}\n\n…`;
}

function isoDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && String(value).trim() !== ""
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function formatSalary(min, max, currency = "USD", period = "year") {
  const low = Number(min);
  const high = Number(max);
  const fmt = value => Math.round(value).toLocaleString("en-US");
  const unit = currency ? ` ${currency}` : "";
  const per = period ? ` per ${String(period).replace(/ly$/i, "").replace(/^annual$/i, "year")}` : "";
  if (low > 0 && high > 0 && high !== low) return `${fmt(low)} - ${fmt(high)}${unit}${per}`;
  if (low > 0 || high > 0) return `${fmt(Math.max(low || 0, high || 0))}${unit}${per}`;
  return null;
}

/**
 * Normalize one remote-board listing into the tracker schema. Adapters supply
 * board fields; this function owns eligibility, language detection and the
 * shared remote presentation.
 */
function buildRemoteJob(input, options = {}) {
  const description = truncateDescription(
    input.descriptionHtml ? htmlToText(input.descriptionHtml) : input.description
  );
  const languages = unique([
    ...(input.languages || []),
    ...detectAfghanLanguages(input.title, description, input.restriction),
  ]);
  const boardEligibility = classifyRemoteEligibility(input.restriction, {
    emptyMeansWorldwide: options.emptyMeansWorldwide,
    languages,
  });
  const eligibility = boardEligibility.scope && titleRestricts(input.title)
    ? { scope: null, label: null }
    : boardEligibility;
  const tags = unique((input.tags || []).map(tag => normSpace(tag)).filter(Boolean)).slice(0, 12);
  const postDate = isoDate(input.postedAt);

  return normalizeJob({
    source: input.source,
    url: input.url,
    source_url: input.url,
    title: normSpace(input.title),
    company: normSpace(input.company) || null,
    location: eligibility.label ? `Remote · ${eligibility.label}` : "Remote",
    post_date: postDate,
    post_date_raw: postDate,
    closing_date: isoDate(input.closesAt),
    category: input.category || null,
    job_type: input.jobType || null,
    salary: input.salary || null,
    apply_url: input.applyUrl || null,
    description,
    work_mode: "remote",
    remote_scope: eligibility.scope,
    remote_regions: normSpace(input.restriction) || null,
    languages,
    details: {
      "Remote eligibility": eligibility.label || "Not open to Afghanistan",
      "Location restriction": normSpace(input.restriction) || (options.emptyMeansWorldwide ? "None (worldwide)" : "Not stated"),
      "Post Date": postDate,
      Category: input.category || null,
      Tags: tags.join(", ") || null,
      Languages: languages.join(", ") || null,
      Source: options.sourceLabel || input.source,
    },
    scraped_at: options.now,
  }, { now: options.now });
}

module.exports = {
  KABUL_UTC_OFFSET,
  SCOPE_LABELS,
  buildRemoteJob,
  classifyRemoteEligibility,
  detectAfghanLanguages,
  formatSalary,
  isoDate,
  timezoneWindow,
  titleRestricts,
  truncateDescription,
};
