const { attachCoverage } = require("../lib/html_adapter");
const { requestJson } = require("../lib/http");
const {
  extractEmails,
  extractPhones,
  htmlToText,
  normalizeJob,
  normSpace,
} = require("../lib/normalize");

// ReliefWeb serves its API only to registered applications (a free "appname"
// from https://apidoc.reliefweb.int/parameters#appname) and challenges other
// automated clients. The source therefore runs only when RELIEFWEB_APPNAME is
// configured; it never imitates a browser or another client.
const API_URL = "https://api.reliefweb.int/v2/jobs";
const PAGE_SIZE = 100;
const FIELDS = [
  "title", "body-html", "how_to_apply-html", "date", "source", "city", "career_categories",
  "type", "experience", "url", "url_alias",
];

function appName() {
  return normSpace(process.env.RELIEFWEB_APPNAME) || null;
}

function names(list) {
  return (Array.isArray(list) ? list : []).map(item => normSpace(item?.name)).filter(Boolean);
}

function dateOnly(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseJobs(payload, now) {
  if (!Array.isArray(payload?.data)) throw new Error("reliefweb API returned no data array");
  return payload.data
    .map(item => item?.fields)
    .filter(fields => fields?.title && (fields.url_alias || fields.url))
    .map(fields => {
      const url = fields.url_alias || fields.url;
      const description = [
        htmlToText(fields["body-html"]),
        fields["how_to_apply-html"] ? `How to Apply\n${htmlToText(fields["how_to_apply-html"])}` : null,
      ].filter(Boolean).join("\n\n");
      const organization = names(fields.source)[0] || null;
      const cities = names(fields.city);
      const categories = names(fields.career_categories);
      const postDate = dateOnly(fields.date?.created);
      const closingDate = dateOnly(fields.date?.closing);
      return normalizeJob({
        source: "reliefweb",
        url,
        source_url: url,
        title: normSpace(fields.title),
        company: organization,
        location: cities.length ? `${cities.join(", ")}, Afghanistan` : "Afghanistan",
        post_date: postDate,
        closing_date: closingDate,
        closing_date_raw: closingDate,
        category: categories.join(", ") || null,
        job_type: names(fields.type).join(", ") || null,
        apply_emails: extractEmails(description),
        apply_phones: extractPhones(description),
        description: description || null,
        details: {
          Organization: organization,
          "Post Date": postDate,
          "Closing Date": closingDate,
          "Functional Area": categories.join(", ") || null,
          Experience: names(fields.experience).join(", ") || null,
          Countries: "Afghanistan",
          Source: "ReliefWeb",
        },
        scraped_at: now,
      }, { now });
    });
}

function pageUrl(app, offset) {
  const params = new URLSearchParams({
    appname: app,
    "filter[field]": "country.iso3",
    "filter[value]": "AFG",
    limit: String(PAGE_SIZE),
    offset: String(offset),
    "sort[]": "date.created:desc",
  });
  for (const field of FIELDS) params.append("fields[include][]", field);
  return `${API_URL}?${params}`;
}

async function scrape(options = {}) {
  const app = options.appName ?? appName();
  if (!app) throw new Error("RELIEFWEB_APPNAME is not configured");
  const fetchJson = options.fetchJson
    || (url => requestJson(url, { onRetry: ({ attempt, delay }) => console.log(`[reliefweb] retry ${attempt} in ${delay}ms`) }));
  const now = options.now || new Date().toISOString();
  const records = [];
  for (let offset = 0; offset < 1000; offset += PAGE_SIZE) {
    const payload = await fetchJson(pageUrl(app, offset));
    const page = parseJobs(payload, now);
    records.push(...page);
    if (page.length < PAGE_SIZE || records.length >= Number(payload.totalCount || 0)) break;
  }
  if (!records.length) throw new Error("reliefweb API returned no Afghanistan jobs; refusing to treat it as healthy");
  console.log(`[reliefweb] ${records.length} Afghanistan listings`);
  return attachCoverage(records, { discoveredCount: records.length });
}

module.exports = {
  enabled: () => Boolean(appName()),
  name: "reliefweb",
  pageUrl,
  parseJobs,
  scrape,
};
