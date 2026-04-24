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

  return text ? text : null;
}

function unique(values) {
  return Array.from(new Set((values || []).map(v => normSpace(v)).filter(Boolean)));
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
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .split("\n")
    .map(normSpace)
    .filter(Boolean)
    .join("\n");
}

function extractEmails(text) {
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  return unique(String(text || "").match(re) || []).slice(0, 20);
}

function extractPhones(text) {
  const re = /(\+?\d[\d\s().-]{7,}\d)/g;
  return unique((String(text || "").match(re) || []).map(normSpace))
    .filter(phone => {
      const digits = phone.replace(/\D/g, "");
      if (/\b20\d{2}[-\s]?\d{1,2}/.test(phone)) return false;
      return phone.length >= 9 && phone.length <= 30 && /^(0|93|0093)/.test(digits);
    })
    .slice(0, 20);
}

function parseClosingDate(raw) {
  const text = normSpace(raw);
  if (!text) return null;

  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    return [
      iso[1],
      String(parseInt(iso[2], 10)).padStart(2, "0"),
      String(parseInt(iso[3], 10)).padStart(2, "0"),
    ].join("-");
  }

  const dmy = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,}),?\s*(20\d{2})\b/);
  if (dmy) return dateFromParts(dmy[3], dmy[2], dmy[1]);

  const mdy = text.match(/\b([A-Za-z]{3,})\s+(\d{1,2}),?\s*(20\d{2})\b/);
  if (mdy) return dateFromParts(mdy[3], mdy[1], mdy[2]);

  return null;
}

function dateFromParts(year, monthName, day) {
  const months = {
    jan: "01", january: "01",
    feb: "02", february: "02",
    mar: "03", march: "03",
    apr: "04", april: "04",
    may: "05",
    jun: "06", june: "06",
    jul: "07", july: "07",
    aug: "08", august: "08",
    sep: "09", sept: "09", september: "09",
    oct: "10", october: "10",
    nov: "11", november: "11",
    dec: "12", december: "12",
  };
  const key = String(monthName || "").toLowerCase();
  const month = months[key] || months[key.slice(0, 3)];
  if (!month) return null;
  return `${year}-${month}-${String(parseInt(day, 10)).padStart(2, "0")}`;
}

function makeId(source, url, title = "") {
  const seed = `${source || ""}|${url || ""}|${title || ""}`;
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16);
}

function normalizeDetails(details) {
  const out = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (value === null || value === undefined || value === "") continue;
    out[normSpace(key)] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

function normalizeJob(input) {
  const source = emptyToNull(input.source) || "unknown";
  const sourceUrl = emptyToNull(input.source_url) || emptyToNull(input.url);
  const url = emptyToNull(input.url) || sourceUrl;
  const details = normalizeDetails(input.details);
  const description = cleanDescription(input.description);  
  const textForContacts = [
    description,
    ...Object.values(details).map(v => String(v || "")),
  ].join("\n");
  const applyEmails = unique([
    ...(Array.isArray(input.apply_emails) ? input.apply_emails : []),
    ...extractEmails(textForContacts),
  ]);
  const applyPhones = unique([
    ...(Array.isArray(input.apply_phones) ? input.apply_phones : []),
    ...extractPhones(textForContacts),
  ]);
  const closingRaw = emptyToNull(input.closing_date_raw) || emptyToNull(input.closing_date);
  const closingDate = emptyToNull(input.closing_date) || parseClosingDate(closingRaw);

  return {
    id: emptyToNull(input.id) || makeId(source, sourceUrl || url, input.title),
    source,
    source_url: sourceUrl,
    url,
    title: emptyToNull(input.title),
    company: emptyToNull(input.company),
    location: emptyToNull(input.location),
    closing_date: closingDate,
    closing_date_raw: closingRaw,
    category: emptyToNull(input.category),
    job_type: emptyToNull(input.job_type),
    gender: emptyToNull(input.gender),
    vacancies: input.vacancies === undefined || input.vacancies === "" ? null : input.vacancies,
    salary: emptyToNull(input.salary),
    apply_url: emptyToNull(input.apply_url),
    apply_emails: applyEmails,
    apply_phones: applyPhones,
    description,
    details,
    scraped_at: emptyToNull(input.scraped_at) || new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    also_found_on: Array.isArray(input.also_found_on) ? input.also_found_on : [],
  };
}

function todayKabulISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 270);
  return d.toISOString().split("T")[0];
}

module.exports = {
  cleanDescription,
  emptyToNull,
  extractEmails,
  extractPhones,
  htmlToText,
  makeId,
  normalizeJob,
  normSpace,
  parseClosingDate,
  todayKabulISO,
  unique,
};
