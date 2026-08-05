const { extractVacancyReference, makeId, normalizeUrl, normSpace, unique } = require("./normalize");

// Use a fixed representative order so request timing cannot change the public
// URL, source, title, or logical ID of a cross-source vacancy. Legacy ACBAR
// aliases are migrated to its current route during URL normalization.
const SOURCE_PRIORITY = new Map([
  ["jobs.af", 0],
  ["acbar", 1],
  ["kaarobar", 2],
  ["wazifaha", 3],
]);

function normalizeComparableText(value) {
  return normSpace(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/\b(re[\s-]*announced|urgent|new|position title)\b/gi, " ")
    .replace(/[۰٠]/g, "0").replace(/[۱١]/g, "1").replace(/[۲٢]/g, "2")
    .replace(/[۳٣]/g, "3").replace(/[۴٤]/g, "4").replace(/[۵٥]/g, "5")
    .replace(/[۶٦]/g, "6").replace(/[۷٧]/g, "7").replace(/[۸٨]/g, "8")
    .replace(/[۹٩]/g, "9")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function canonicalUrl(job) {
  const raw = normSpace(job.source_url || job.url);
  if (!raw) return "";
  try {
    const url = new URL(normalizeUrl(raw) || raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function normalizedReference(job) {
  return normalizeComparableText(extractVacancyReference(job.details))
    .replace(/\b(?:vacancy|reference|ref|number|no)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function referenceKey(job) {
  const reference = normalizedReference(job);
  const company = normalizeCompany(job.company);
  const title = normalizeComparableText(job.title);
  if (!reference || reference.length < 2 || (!company && !title)) return null;
  return `reference|${reference}|${company || title}`;
}

function fingerprint(job) {
  return [
    normalizeComparableText(job.title),
    normalizeCompany(job.company),
    normalizeLocation(job.location),
    normalizeComparableText(job.closing_date),
  ].join("|");
}

function roleKey(job) {
  const parts = [
    normalizeComparableText(job.title),
    normalizeCompany(job.company),
    normalizeLocation(job.location),
  ];
  return parts.every(Boolean) ? `role|${parts.join("|")}` : null;
}

function fingerprintKey(job) {
  const parts = fingerprint(job).split("|");
  // Without a stable reference, require title + employer + location + closing
  // date. This avoids merging two similarly named openings at one employer.
  return parts.every(Boolean) ? `fingerprint|${parts.join("|")}` : null;
}

function foundRef(job) {
  const url = canonicalUrl(job);
  if (!job.source || !url) return null;
  return { source: job.source, url };
}

function sourceRank(record) {
  return SOURCE_PRIORITY.get(normSpace(record.source).toLowerCase()) ?? SOURCE_PRIORITY.size;
}

function canonicalRecordKey(record) {
  return [
    String(sourceRank(record)).padStart(4, "0"),
    normSpace(record.source).toLowerCase(),
    canonicalUrl(record),
    normalizeComparableText(record.title),
    normSpace(record.id),
  ].join("|");
}

function compareCanonicalRecords(a, b) {
  return canonicalRecordKey(a).localeCompare(canonicalRecordKey(b));
}

function mergeAlsoFound(main, duplicate) {
  const refs = [];
  const mainUrl = canonicalUrl(main);
  for (const item of [
    ...(main.also_found_on || []),
    foundRef(duplicate),
    ...(duplicate.also_found_on || []),
  ]) {
    if (!item?.source || !item?.url) continue;
    const cleanUrl = canonicalUrl(item);
    if (!cleanUrl || cleanUrl === mainUrl) continue;
    refs.push({ source: item.source, url: cleanUrl });
  }

  const seen = new Set();
  main.also_found_on = refs.filter(item => {
    const key = `${item.source}|${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => `${a.source}|${a.url}`.localeCompare(`${b.source}|${b.url}`));
}

function recordTime(record) {
  const value = Date.parse(record.last_seen_at || record.scraped_at || 0);
  return Number.isNaN(value) ? 0 : value;
}

function completeness(record) {
  return [
    "title", "company", "location", "post_date", "closing_date", "category", "job_type",
    "gender", "vacancies", "salary", "application_method", "application_subject", "apply_url",
    "description",
  ].reduce((total, key) => total + (record[key] !== null && record[key] !== undefined && record[key] !== "" ? 1 : 0), 0)
    + Object.keys(record.details || {}).length / 20;
}

function preferredRecord(a, b) {
  const timeDiff = recordTime(a) - recordTime(b);
  if (timeDiff !== 0) return timeDiff > 0 ? [a, b] : [b, a];
  const completenessDiff = completeness(a) - completeness(b);
  if (completenessDiff !== 0) return completenessDiff > 0 ? [a, b] : [b, a];
  return compareCanonicalRecords(a, b) <= 0 ? [a, b] : [b, a];
}

function canonicalRecords(a, b) {
  return compareCanonicalRecords(a, b) <= 0 ? [a, b] : [b, a];
}

function fillMissing(main, fallback) {
  for (const key of [
    "title", "company", "location", "post_date", "post_date_raw", "closing_date", "closing_date_raw",
    "category", "job_type", "gender", "vacancies", "salary", "application_method",
    "application_subject", "application_subject_type", "apply_url", "description",
  ]) {
    if ((main[key] === null || main[key] === undefined || main[key] === "") && fallback[key] !== null && fallback[key] !== undefined && fallback[key] !== "") {
      main[key] = fallback[key];
    }
  }
  main.apply_emails = unique([...(main.apply_emails || []), ...(fallback.apply_emails || [])]);
  main.apply_phones = unique([...(main.apply_phones || []), ...(fallback.apply_phones || [])]);
  main.details = { ...(fallback.details || {}), ...(main.details || {}) };
}

function chooseDateFields(main, records, prefix, direction) {
  const field = `${prefix}_date`;
  const rawField = `${prefix}_date_raw`;
  const candidates = records
    .filter(record => record[field])
    .sort((a, b) => {
      const dateCompare = String(a[field]).localeCompare(String(b[field]));
      if (dateCompare !== 0) return direction === "latest" ? -dateCompare : dateCompare;
      return compareCanonicalRecords(a, b);
    });
  if (!candidates.length) return;
  main[field] = candidates[0][field];
  main[rawField] = candidates[0][rawField] || candidates[0][field];
}

function earliestTimestamp(...values) {
  return values.filter(Boolean).sort()[0] || null;
}

function latestTimestamp(...values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function logicalIdentityKey(...records) {
  for (const keyFunction of [referenceKey, roleKey, fingerprintKey]) {
    const keys = unique(records.map(keyFunction).filter(Boolean)).sort();
    if (keys.length) return keys[0];
  }
  return null;
}

function stableLogicalId(identityKey) {
  return identityKey ? makeId("logical", identityKey) : null;
}

function hasCrossSourceLocations(record) {
  const locations = [foundRef(record), ...(record.also_found_on || [])]
    .filter(item => item?.source && item?.url)
    .map(item => `${normSpace(item.source).toLowerCase()}|${canonicalUrl(item)}`);
  return new Set(locations).size > 1;
}

function ensureStableLogicalRecord(record) {
  if (!hasCrossSourceLocations(record)) return record;
  const identityKey = logicalIdentityKey(record);
  const id = stableLogicalId(identityKey);
  const locations = [foundRef(record), ...(record.also_found_on || [])]
    .filter(item => item?.source && item?.url)
    .map(item => ({ source: item.source, url: canonicalUrl(item) }))
    .filter(item => item.url)
    .sort(compareCanonicalRecords);
  const uniqueLocations = locations.filter((item, index) => (
    index === 0 || `${item.source}|${item.url}` !== `${locations[index - 1].source}|${locations[index - 1].url}`
  ));
  const primary = uniqueLocations[0];
  if (!primary) return id && id !== record.id ? { ...record, id } : record;
  return {
    ...record,
    id: id || record.id,
    source: primary.source,
    source_url: primary.url,
    url: primary.url,
    also_found_on: uniqueLocations.slice(1)
      .sort((a, b) => `${a.source}|${a.url}`.localeCompare(`${b.source}|${b.url}`)),
  };
}

function mergeDuplicate(a, b, options = {}) {
  const logicalMerge = options.logicalMerge === true;
  const [preferred, fallback] = logicalMerge ? canonicalRecords(a, b) : preferredRecord(a, b);
  const merged = {
    ...preferred,
    apply_emails: [...(preferred.apply_emails || [])],
    apply_phones: [...(preferred.apply_phones || [])],
    details: { ...(preferred.details || {}) },
    also_found_on: [...(preferred.also_found_on || [])],
  };
  fillMissing(merged, fallback);
  if (logicalMerge) {
    // Extensions should retain the longest valid application window, while the
    // original posting date remains the earliest date reported by any source.
    chooseDateFields(merged, [a, b], "closing", "latest");
    chooseDateFields(merged, [a, b], "post", "earliest");
    merged.scraped_at = latestTimestamp(a.scraped_at, b.scraped_at);
  }
  merged.first_seen_at = earliestTimestamp(a.first_seen_at, a.scraped_at, b.first_seen_at, b.scraped_at);
  merged.last_seen_at = latestTimestamp(a.last_seen_at, a.scraped_at, b.last_seen_at, b.scraped_at);
  merged.active = a.active !== false || b.active !== false;
  merged.missed_runs = Math.min(a.missed_runs || 0, b.missed_runs || 0);
  if (merged.missed_runs === 0) merged.lifecycle_status = "active";
  mergeAlsoFound(merged, fallback);

  const shouldUseLogicalId = logicalMerge || hasCrossSourceLocations(merged);
  if (shouldUseLogicalId) {
    const identityKey = options.identityKey || logicalIdentityKey(a, b, merged);
    merged.id = stableLogicalId(identityKey) || merged.id;
  }
  return merged;
}

function dedupeJobs(records) {
  const byUrl = new Map();
  let exactRemoved = 0;

  const orderedRecords = records
    .filter(Boolean)
    .map(ensureStableLogicalRecord)
    .sort(compareCanonicalRecords);
  for (const record of orderedRecords) {
    const key = canonicalUrl(record);
    if (!key) continue;
    if (byUrl.has(key)) {
      exactRemoved += 1;
      byUrl.set(key, mergeDuplicate(byUrl.get(key), record));
    } else {
      byUrl.set(key, record);
    }
  }

  const output = [];
  const referenceIndexes = new Map();
  const roleIndexes = new Map();
  const fingerprintIndexes = new Map();
  let referenceRemoved = 0;
  let roleRemoved = 0;
  let fingerprintRemoved = 0;

  for (const record of byUrl.values()) {
    const refKey = referenceKey(record);
    const crossSourceRoleKey = roleKey(record);
    const fpKey = fingerprintKey(record);
    const currentReference = normalizedReference(record);
    let existingIndex = refKey ? referenceIndexes.get(refKey) : undefined;
    let matchType = existingIndex !== undefined ? "reference" : null;

    if (existingIndex === undefined && crossSourceRoleKey) {
      const candidateIndex = roleIndexes.get(crossSourceRoleKey);
      const candidate = candidateIndex === undefined ? null : output[candidateIndex];
      const candidateReference = candidate ? normalizedReference(candidate) : "";
      const distinctReferences = currentReference && candidateReference && currentReference !== candidateReference;
      if (candidate && candidate.source !== record.source && !distinctReferences) {
        existingIndex = candidateIndex;
        matchType = "role";
      }
    }

    if (existingIndex === undefined && fpKey) {
      const candidateIndex = fingerprintIndexes.get(fpKey);
      const candidate = candidateIndex === undefined ? null : output[candidateIndex];
      const candidateReference = candidate ? normalizedReference(candidate) : "";
      const distinctReferences = currentReference && candidateReference && currentReference !== candidateReference;
      if (candidate && !distinctReferences) {
        existingIndex = candidateIndex;
        matchType = "fingerprint";
      }
    }

    if (existingIndex !== undefined && existingIndex !== null) {
      const identityKey = matchType === "reference"
        ? refKey
        : matchType === "role"
          ? crossSourceRoleKey
          : fpKey;
      output[existingIndex] = mergeDuplicate(output[existingIndex], record, {
        logicalMerge: true,
        identityKey,
      });
      if (matchType === "reference") referenceRemoved += 1;
      else if (matchType === "role") roleRemoved += 1;
      else fingerprintRemoved += 1;
      if (refKey) referenceIndexes.set(refKey, existingIndex);
      if (crossSourceRoleKey) roleIndexes.set(crossSourceRoleKey, existingIndex);
      if (fpKey) fingerprintIndexes.set(fpKey, existingIndex);
      continue;
    }

    const index = output.length;
    output.push(record);
    if (refKey) referenceIndexes.set(refKey, index);
    if (crossSourceRoleKey) roleIndexes.set(crossSourceRoleKey, index);
    if (fpKey) fingerprintIndexes.set(fpKey, index);
  }

  return {
    jobs: output,
    removed: exactRemoved + referenceRemoved + roleRemoved + fingerprintRemoved,
    exactRemoved,
    referenceRemoved,
    roleRemoved,
    fingerprintRemoved,
  };
}

module.exports = {
  SOURCE_PRIORITY,
  canonicalUrl,
  compareCanonicalRecords,
  dedupeJobs,
  ensureStableLogicalRecord,
  fingerprint,
  logicalIdentityKey,
  mergeDuplicate,
  normalizeComparableText,
  normalizedReference,
  referenceKey,
  roleKey,
  stableLogicalId,
};
