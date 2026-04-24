const { normSpace, unique } = require("./normalize");

function normalizeComparableText(value) {
  return normSpace(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/\b(re[\s-]*announced|urgent|new|position title)\b/gi, " ")
    .replace(/[۰٠]/g, "0")
    .replace(/[۱١]/g, "1")
    .replace(/[۲٢]/g, "2")
    .replace(/[۳٣]/g, "3")
    .replace(/[۴٤]/g, "4")
    .replace(/[۵٥]/g, "5")
    .replace(/[۶٦]/g, "6")
    .replace(/[۷٧]/g, "7")
    .replace(/[۸٨]/g, "8")
    .replace(/[۹٩]/g, "9")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalUrl(job) {
  return normSpace(job.source_url || job.url).replace(/\/+$/, "");
}

function fingerprint(job) {
  return [
    normalizeComparableText(job.title),
    normalizeCompany(job.company),
    normalizeLocation(job.location),
    normalizeComparableText(job.closing_date),
  ].join("|");
}

function normalizeCompany(value) {
  return normalizeComparableText(String(value || "").replace(/\([^)]*\)/g, " "));
}

function normalizeLocation(value) {
  return normalizeComparableText(value)
    .replace(/\bafghanistan\b/g, " ")
    .replace(/\bprovince\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function foundRef(job) {
  const url = canonicalUrl(job);
  if (!job.source || !url) return null;
  return { source: job.source, url };
}

function mergeAlsoFound(main, duplicate) {
  const refs = [];
  const mainUrl = canonicalUrl(main);
  for (const item of [...(main.also_found_on || []), foundRef(duplicate), ...(duplicate.also_found_on || [])]) {
    if (!item || !item.source || !item.url) continue;
    const cleanUrl = normSpace(item.url).replace(/\/+$/, "");
    if (!cleanUrl || cleanUrl === mainUrl) continue;
    refs.push({ source: item.source, url: cleanUrl });
  }

  const seen = new Set();
  main.also_found_on = refs.filter(item => {
    const key = `${item.source}|${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fillMissing(main, duplicate) {
  for (const key of [
    "title", "company", "location", "closing_date", "closing_date_raw", "category",
    "job_type", "gender", "vacancies", "salary", "apply_url", "description",
  ]) {
    if ((main[key] === null || main[key] === undefined || main[key] === "") && duplicate[key]) {
      main[key] = duplicate[key];
    }
  }
  main.apply_emails = unique([...(main.apply_emails || []), ...(duplicate.apply_emails || [])]);
  main.apply_phones = unique([...(main.apply_phones || []), ...(duplicate.apply_phones || [])]);
  main.details = { ...(duplicate.details || {}), ...(main.details || {}) };
}

function mergeDuplicate(main, duplicate) {
  fillMissing(main, duplicate);
  mergeAlsoFound(main, duplicate);
  return main;
}

function dedupeJobs(records) {
  const byUrl = new Map();
  let exactRemoved = 0;

  for (const record of records) {
    if (!record) continue;
    const key = canonicalUrl(record);
    if (!key) continue;
    if (byUrl.has(key)) {
      exactRemoved++;
      mergeDuplicate(byUrl.get(key), record);
    } else {
      byUrl.set(key, record);
    }
  }

  const byFingerprint = new Map();
  const output = [];
  let fingerprintRemoved = 0;

  for (const record of byUrl.values()) {
    const fp = fingerprint(record);
    const hasStrongFingerprint = fp.split("|").filter(Boolean).length >= 3;
    if (hasStrongFingerprint && byFingerprint.has(fp)) {
      fingerprintRemoved++;
      mergeDuplicate(byFingerprint.get(fp), record);
      continue;
    }
    if (hasStrongFingerprint) byFingerprint.set(fp, record);
    output.push(record);
  }

  return {
    jobs: output,
    removed: exactRemoved + fingerprintRemoved,
    exactRemoved,
    fingerprintRemoved,
  };
}

module.exports = {
  dedupeJobs,
  fingerprint,
  normalizeComparableText,
};
