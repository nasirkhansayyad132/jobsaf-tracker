const crypto = require("crypto");

function normSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function emptyToNull(value) {
  const text = normSpace(value);
  return text ? text : null;
}

function cleanDescription(value) {
  const text = String(value || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text || null;
}

function unique(values) {
  return Array.from(new Set((values || []).map(value => normSpace(value)).filter(Boolean)));
}

function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div|tr|table|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&#x27;/g, "'")
    .split("\n")
    .map(normSpace)
    .filter(Boolean)
    .join("\n");
}

function extractEmails(text) {
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  return unique((String(text || "").match(re) || []).map(email => email.toLowerCase())).slice(0, 20);
}

/** Normalize Afghanistan national numbers to E.164 and reject ranges, IPs and IDs. */
function normalizePhone(value) {
  const original = String(value || "");
  if (/[\r\n]/.test(original)) return null;
  const raw = normSpace(original);
  if (!raw) return null;
  if (/(?:^|\D)(?:\d{1,3}\.){3}\d{1,3}(?:\D|$)/.test(raw)) return null;
  if (/\d\s+[-–—]\s*\d|\d\s*[-–—]\s+\d/.test(raw)) return null;

  const withoutExtension = raw.replace(/\s*(?:ext\.?|extension|x)\s*\d+\s*$/i, "");
  const digits = withoutExtension.replace(/\D/g, "");
  let national = null;

  if (digits.startsWith("0093") && digits.length === 13) national = digits.slice(4);
  else if (digits.startsWith("93") && digits.length === 11) national = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 10) national = digits.slice(1);

  // Afghanistan national significant numbers are nine digits. The first digit
  // identifies a fixed/mobile service; 0/1/8/9 here usually means an ID/amount.
  if (!national || !/^[2-7]\d{8}$/.test(national)) return null;
  return `+93${national}`;
}

function extractPhones(text) {
  const withoutIps = String(text || "").replace(/(?:^|\D)(?:\d{1,3}\.){3}\d{1,3}(?=\D|$)/g, " ");
  // Do not let whitespace cross a line boundary: otherwise a vacancy number on
  // one detail line can be concatenated with a year on the next one.
  const re = /(?:^|[^\d])((?:\+93|0093|93|0)(?:[ \t().-]*\d){8,10})(?=$|[^\d])/g;
  const candidates = [];
  for (const match of withoutIps.matchAll(re)) {
    const raw = match[1];
    const context = withoutIps.slice(Math.max(0, match.index - 70), Math.min(withoutIps.length, match.index + raw.length + 70));
    const hasInternationalPrefix = /^\s*(?:\+93|0093)/.test(raw);
    const hasPhoneContext = /\b(?:phone|telephone|mobile|contact|call|tel|whatsapp)\b|شماره|تماس|تلفن|موبایل|شمېره|اړیک/i.test(context);
    if (hasInternationalPrefix || hasPhoneContext) candidates.push(raw);
  }
  return unique(candidates.map(normalizePhone).filter(Boolean)).slice(0, 20);
}

function dateFromParts(year, monthName, day) {
  const months = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", sept: "09", september: "09",
    oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12",
  };
  const key = String(monthName || "").toLowerCase();
  const month = months[key] || months[key.slice(0, 3)];
  if (!month) return null;
  return validDateParts(year, month, day);
}

function validDateParts(year, month, day) {
  const yyyy = Number(year);
  const mm = Number(month);
  const dd = Number(day);
  if (!Number.isInteger(yyyy) || yyyy < 2000 || yyyy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    return null;
  }
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (date.getUTCFullYear() !== yyyy || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null;
  return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function parseClosingDate(raw) {
  const text = normSpace(raw);
  if (!text) return null;

  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return validDateParts(iso[1], iso[2], iso[3]);

  const dmy = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,}),?\s*(20\d{2})\b/);
  if (dmy) return dateFromParts(dmy[3], dmy[2], dmy[1]);

  const mdy = text.match(/\b([A-Za-z]{3,})\s+(\d{1,2}),?\s*(20\d{2})\b/);
  if (mdy) return dateFromParts(mdy[3], mdy[1], mdy[2]);

  const numeric = text.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
  if (numeric) return validDateParts(numeric[3], numeric[2], numeric[1]);
  return null;
}

function normalizeTimestamp(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function makeId(source, url, title = "") {
  const seed = `${source || ""}|${url || ""}|${title || ""}`;
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

function normalizeDetails(details) {
  const out = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (value === null || value === undefined || value === "") continue;
    const cleanKey = normSpace(key);
    const cleanValue = Array.isArray(value) ? value.map(normSpace).filter(Boolean).join(", ") : value;
    if (cleanKey && cleanValue !== "") out[cleanKey] = cleanValue;
  }
  return out;
}

function detailValue(details, keyPattern) {
  const entry = Object.entries(details || {}).find(([key]) => keyPattern.test(normSpace(key)));
  return entry ? emptyToNull(entry[1]) : null;
}

function extractVacancyReference(details) {
  return detailValue(details, /^(?:vacancy\s*(?:number|no\.?|id)|reference(?:\s*(?:number|no\.?|id))?|job\s*id|announcement\s*(?:number|no\.?))$/i);
}

function cleanSubject(value) {
  const subject = normSpace(value)
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.;]+$/, "")
    .trim();
  if (!subject || subject.length < 2 || subject.length > 220) return null;
  return subject;
}

function extractApplicationSubject(description, details, title) {
  const explicit = detailValue(details, /^(?:application|email)\s+subject(?:\s+line)?$|^subject\s+line$/i);
  if (explicit) return { value: cleanSubject(explicit), type: "exact" };

  const text = String(description || "");
  const exactPatterns = [
    /(?:email\s+)?subject(?:\s+line)?\s*(?:(?:must\s+be|should\s+be|is)\s*[:–-]?|:)\s*["“]?([^\n\r"”]{2,220})/i,
    /use\s+the\s+subject\s+line\s*:\s*["“]?([^\n\r"”]{2,220})/i,
  ];
  for (const pattern of exactPatterns) {
    const match = text.match(pattern);
    const value = cleanSubject(match?.[1]);
    if (value) return { value, type: "exact" };
  }

  const reference = extractVacancyReference(details);
  const subjectInstruction = text.split(/\n+/).find(line => /subject(?:\s+line)?/i.test(line)) || "";
  if (!subjectInstruction) return { value: null, type: null };

  const needsTitle = /position\s+title|name\s+of\s+the\s+position|job\s+title/i.test(subjectInstruction);
  const needsReference = /vacancy\s*(?:id|number|no\.)|reference\s*(?:id|number|no\.)/i.test(subjectInstruction);
  if (needsTitle && needsReference && title && reference) {
    return { value: `${normSpace(title)} + ${reference}`, type: "title_template" };
  }
  if (needsReference && reference) return { value: reference, type: "reference" };
  if (needsTitle && title) return { value: normSpace(title), type: "title_template" };
  return { value: null, type: null };
}

function normalizeUrl(value) {
  const raw = emptyToNull(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      /^(?:www\.)?acbar\.org$/i.test(url.hostname)
      && /^\/jobs\/\d+\/.+\.jsp$/i.test(url.pathname)
    ) {
      const [, id, slug] = url.pathname.match(/^\/jobs\/(\d+)\/(.+)\.jsp$/i);
      url.pathname = `/en/jobs/details/${id}/${slug}`;
      url.search = "";
      url.hash = "";
    }
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function detectApplicationMethod(input, details, applyUrl, emails, phones) {
  const explicit = normSpace(input.application_method).toLowerCase();
  if (["email", "web", "phone", "unknown"].includes(explicit)) return explicit;

  const submission = normSpace(detailValue(details, /^submission\s+(?:through|method)$/i)).toLowerCase();
  if (/e-?mail/.test(submission)) return "email";
  if (/link|online|website|portal|form/.test(submission)) return "web";
  if (applyUrl?.startsWith("mailto:")) return "email";
  if (applyUrl && applyUrl !== normalizeUrl(input.source_url || input.url)) return "web";
  if (emails.length) return "email";
  if (phones.length) return "phone";
  return "unknown";
}

function normalizeAlsoFound(items) {
  const seen = new Set();
  const output = [];
  for (const item of Array.isArray(items) ? items : []) {
    const source = emptyToNull(item?.source);
    const url = normalizeUrl(item?.url);
    if (!source || !url) continue;
    const key = `${source}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ source, url });
  }
  return output;
}

function normalizeRelevance(relevance) {
  if (!relevance || typeof relevance !== "object") return null;
  const score = Number(relevance.score);
  const threshold = Number(relevance.threshold);
  if (!Number.isFinite(score) || !Number.isFinite(threshold)) return null;
  return {
    version: Number(relevance.version) || 2,
    score,
    threshold,
    decision: relevance.decision === "exclude" ? "exclude" : "include",
    reasons: unique(relevance.reasons),
  };
}

function normalizeJob(input, options = {}) {
  const now = normalizeTimestamp(options.now || new Date()) || new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const source = emptyToNull(input.source) || "unknown";
  const sourceUrl = normalizeUrl(input.source_url) || normalizeUrl(input.url);
  const url = normalizeUrl(input.url) || sourceUrl;
  const details = normalizeDetails(input.details);
  const description = cleanDescription(input.description);
  const textForContacts = [
    description,
    ...Object.entries(details).map(([key, value]) => `${key}: ${String(value || "")}`),
  ].join("\n");
  const mailtoEmail = url?.startsWith("mailto:") ? url.slice("mailto:".length).split("?")[0] : null;
  const applyUrl = normalizeUrl(input.apply_url);
  const applyMail = applyUrl?.startsWith("mailto:") ? applyUrl.slice("mailto:".length).split("?")[0] : null;
  const applyEmails = unique([
    ...(Array.isArray(input.apply_emails) ? input.apply_emails.map(email => normSpace(email).toLowerCase()) : []),
    mailtoEmail,
    applyMail,
    ...extractEmails(textForContacts),
  ].map(email => normSpace(email).toLowerCase())).filter(email => extractEmails(email).length === 1).slice(0, 20);
  const applyPhones = unique([
    ...(Array.isArray(input.apply_phones) ? input.apply_phones.map(normalizePhone) : []),
    ...extractPhones(textForContacts),
  ].filter(Boolean)).slice(0, 20);

  const closingRaw = emptyToNull(input.closing_date_raw) || emptyToNull(input.closing_date);
  const closingDate = parseClosingDate(input.closing_date) || parseClosingDate(closingRaw);
  const postRaw = emptyToNull(input.post_date_raw)
    || emptyToNull(input.post_date)
    || detailValue(details, /^(?:post|posted|publish|published|announcement|activation)\s+date$/i);
  const postDate = parseClosingDate(postRaw);
  const scrapedAt = normalizeTimestamp(input.scraped_at, now);
  let firstSeenAt = normalizeTimestamp(input.first_seen_at, scrapedAt);
  let lastSeenAt = normalizeTimestamp(input.last_seen_at, scrapedAt);
  if (firstSeenAt > lastSeenAt) [firstSeenAt, lastSeenAt] = [lastSeenAt, firstSeenAt];

  const extractedSubject = extractApplicationSubject(description, details, input.title);
  const applicationSubject = emptyToNull(input.application_subject) || extractedSubject.value;
  const requestedSubjectType = emptyToNull(input.application_subject_type);
  const applicationSubjectType = requestedSubjectType === "title" || requestedSubjectType === "title_and_reference"
    ? "title_template"
    : requestedSubjectType || (applicationSubject ? extractedSubject.type || "exact" : null);

  return {
    id: emptyToNull(input.id) || makeId(source, sourceUrl || url, input.title),
    source,
    source_url: sourceUrl,
    url,
    title: emptyToNull(input.title),
    company: emptyToNull(input.company),
    location: emptyToNull(input.location),
    post_date: postDate,
    post_date_raw: postRaw,
    closing_date: closingDate,
    closing_date_raw: closingRaw,
    category: emptyToNull(input.category),
    job_type: emptyToNull(input.job_type),
    gender: emptyToNull(input.gender),
    vacancies: input.vacancies === undefined || input.vacancies === "" ? null : input.vacancies,
    salary: emptyToNull(input.salary),
    application_method: detectApplicationMethod(input, details, applyUrl, applyEmails, applyPhones),
    application_subject: applicationSubject,
    application_subject_type: applicationSubjectType,
    apply_url: applyUrl,
    apply_emails: applyEmails,
    apply_phones: applyPhones,
    description,
    details,
    scraped_at: scrapedAt,
    first_seen_at: firstSeenAt,
    last_seen_at: lastSeenAt,
    active: input.active !== false,
    lifecycle_status: emptyToNull(input.lifecycle_status) || "active",
    missed_runs: Math.max(0, Number.parseInt(input.missed_runs || 0, 10) || 0),
    relevance: normalizeRelevance(input.relevance),
    also_found_on: normalizeAlsoFound(input.also_found_on),
  };
}

function todayKabulISO(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kabul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(now));
}

module.exports = {
  cleanDescription,
  detailValue,
  emptyToNull,
  extractApplicationSubject,
  extractEmails,
  extractPhones,
  extractVacancyReference,
  htmlToText,
  makeId,
  normalizeJob,
  normalizePhone,
  normalizeTimestamp,
  normalizeUrl,
  normSpace,
  parseClosingDate,
  todayKabulISO,
  unique,
};
