const {
  extractMailtoEmails,
  extractVacancyReference,
  makeId,
  normalizeUrl,
  normSpace,
  unique,
} = require("./normalize");

// Use a fixed representative order so request timing cannot change the public
// URL, source, title, or logical ID of a cross-source vacancy. Legacy ACBAR
// aliases are migrated to its current route during URL normalization.
const SOURCE_PRIORITY = new Map([
  ["jobs.af", 0],
  ["acbar", 1],
  ["kaarobar", 2],
  ["wazifaha", 3],
  ["reliefweb", 4],
  ["impactpool", 5],
  ["weworkremotely", 6],
  ["remotive", 7],
  ["remoteok", 8],
  ["himalayas", 9],
  ["jobicy", 10],
  ["workingnomads", 11],
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

function listingUrlSet(...jobs) {
  return new Set(jobs.flatMap(job => [
    job?.source_url,
    job?.url,
    ...(Array.isArray(job?.also_found_on) ? job.also_found_on.map(item => item?.url) : []),
  ]).map(url => canonicalUrl({ url })).filter(Boolean));
}

function isUsableApplicationUrl(applyUrl, listingUrls) {
  if (applyUrl?.startsWith("mailto:")) return extractMailtoEmails(applyUrl).length > 0;
  if (!/^https?:/i.test(applyUrl || "")) return false;
  return !listingUrls.has(canonicalUrl({ url: applyUrl }));
}

// Dedupe merges application fields from different source records. Resolve the
// method only from channels that remain usable after that merge. A backed
// existing method stays preferred when multiple channels are available.
function applicationChannelEvidence(job) {
  const applyUrl = normalizeUrl(job?.apply_url);
  const listingUrls = listingUrlSet(job);
  const emails = Array.isArray(job?.apply_emails) ? job.apply_emails : [];
  const phones = Array.isArray(job?.apply_phones) ? job.apply_phones : [];
  const hasMailtoRecipient = extractMailtoEmails(applyUrl).length > 0;
  return {
    email: hasMailtoRecipient || emails.some(Boolean),
    web: /^https?:/i.test(applyUrl || "") && isUsableApplicationUrl(applyUrl, listingUrls),
    phone: phones.some(Boolean),
    mailto: hasMailtoRecipient,
  };
}

function preferredApplicationUrl(primary, fallback) {
  const primaryUrl = normalizeUrl(primary?.apply_url);
  const fallbackUrl = normalizeUrl(fallback?.apply_url);
  const listingUrls = listingUrlSet(primary, fallback);
  if (isUsableApplicationUrl(primaryUrl, listingUrls)) return primaryUrl;
  if (isUsableApplicationUrl(fallbackUrl, listingUrls)) return fallbackUrl;
  return primaryUrl || fallbackUrl || null;
}

function resolveApplicationMethod(job) {
  const evidence = applicationChannelEvidence(job);
  const current = normSpace(job?.application_method).toLowerCase();
  if (["email", "web", "phone"].includes(current) && evidence[current]) return current;
  if (evidence.mailto) return "email";
  if (evidence.web) return "web";
  if (evidence.email) return "email";
  if (evidence.phone) return "phone";
  return "unknown";
}

function enforceApplicationInvariant(job) {
  const resolvedMethod = resolveApplicationMethod(job);
  if (normSpace(job.application_method).toLowerCase() === resolvedMethod) return job;
  return { ...job, application_method: resolvedMethod };
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
  const applyUrl = preferredApplicationUrl(preferred, fallback);
  const merged = {
    ...preferred,
    apply_emails: [...(preferred.apply_emails || [])],
    apply_phones: [...(preferred.apply_phones || [])],
    details: { ...(preferred.details || {}) },
    also_found_on: [...(preferred.also_found_on || [])],
  };
  fillMissing(merged, fallback);
  // A listing-page navigation fallback is non-empty but is not an application
  // channel. Do not let it hide a genuine form or mailto URL from a duplicate.
  merged.apply_url = applyUrl;
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
  return enforceApplicationInvariant(merged);
}

const COMPANY_NOISE = new Set([
  "the", "inc", "llc", "ltd", "limited", "gmbh", "co", "company", "corp", "corporation", "plc", "pvt",
  "private", "group", "sa", "bv", "ag", "organization", "organisation", "org",
]);
const TITLE_NOISE = new Set(["the", "a", "an", "of", "and", "for", "to", "in", "at", "with", "remote", "position", "title"]);

/**
 * Comparable spellings of an employer. "UNICEF - United Nations Children's
 * Fund", "United Nations Children's Fund (UNICEF)" and "UNICEF" share a key.
 */
function companyKeys(value) {
  const raw = normSpace(value);
  if (!raw) return [];
  const parts = [
    raw,
    ...raw.split(/\s+[-–—|]\s+/),
    ...(raw.match(/\(([^)]+)\)/g) || []).map(part => part.slice(1, -1)),
    raw.replace(/\([^)]*\)/g, " "),
  ];
  return unique(parts.map(part => normalizeComparableText(part)
    .split(" ")
    .filter(token => token && !COMPANY_NOISE.has(token))
    .join(" ")).filter(key => key.length >= 2));
}

function titleTokens(value) {
  return normalizeComparableText(value).split(" ").filter(token => token && !TITLE_NOISE.has(token));
}

function tokenSimilarity(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function editDistance(left, right, limit = 3) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMinimum = Math.min(rowMinimum, current[j]);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

/** Same role wording, allowing reordered words and small typos. */
function similarTitles(left, right) {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (!a.length || !b.length) return false;
  if (tokenSimilarity(a, b) >= 0.85) return true;
  const joinedA = a.join(" ");
  const joinedB = b.join(" ");
  return Math.min(joinedA.length, joinedB.length) >= 10 && editDistance(joinedA, joinedB, 2) <= 2;
}

function compatibleLocations(left, right) {
  const a = normalizeLocation(left.location);
  const b = normalizeLocation(right.location);
  if (!a || !b || a === b) return true;
  if (left.work_mode === "remote" && right.work_mode === "remote") return true;
  return a.includes(b) || b.includes(a);
}

function compatibleDeadlines(left, right) {
  if (!left.closing_date || !right.closing_date) return true;
  const gap = Math.abs(Date.parse(left.closing_date) - Date.parse(right.closing_date));
  return gap <= 10 * 24 * 60 * 60 * 1000;
}

/**
 * Last pass for cross-posted vacancies whose employer or title spelling
 * differs between boards. Only records from different sources merge: two
 * listings on one board are separate postings unless an exact key matched.
 */
function fuzzyCrossSourceMerge(records) {
  const output = [];
  const byCompany = new Map();
  let removed = 0;
  for (const record of records) {
    const keys = companyKeys(record.company);
    const candidates = [...new Set(keys.flatMap(key => byCompany.get(key) || []))];
    const matchIndex = candidates.find(index => {
      const candidate = output[index];
      const sources = new Set([candidate.source, ...(candidate.also_found_on || []).map(item => item.source)]);
      return !sources.has(record.source)
        && similarTitles(candidate.title, record.title)
        && compatibleLocations(candidate, record)
        && compatibleDeadlines(candidate, record)
        && !(normalizedReference(candidate) && normalizedReference(record)
          && normalizedReference(candidate) !== normalizedReference(record));
    });
    if (matchIndex !== undefined) {
      output[matchIndex] = mergeDuplicate(output[matchIndex], record, { logicalMerge: true });
      removed += 1;
      continue;
    }
    const index = output.length;
    output.push(record);
    for (const key of keys) byCompany.set(key, [...(byCompany.get(key) || []), index]);
  }
  return { jobs: output, removed };
}

/**
 * Give one shared group_id to postings of the same role at the same employer
 * (province variants, re-posts, typo copies) so the site can show them as a
 * single card. Records stay separate in the data: each has its own deadline,
 * vacancies and application link.
 */
function assignGroups(jobs) {
  const parent = jobs.map((_, index) => index);
  const find = index => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const byCompany = new Map();
  jobs.forEach((job, index) => {
    for (const key of companyKeys(job.company).slice(0, 1)) {
      for (const other of byCompany.get(key) || []) {
        if (similarTitles(jobs[other].title, job.title)) parent[find(index)] = find(other);
      }
      byCompany.set(key, [...(byCompany.get(key) || []), index]);
    }
  });
  const members = new Map();
  jobs.forEach((job, index) => {
    const root = find(index);
    members.set(root, [...(members.get(root) || []), job]);
  });
  return jobs.map((job, index) => {
    const group = members.get(find(index));
    if (group.length < 2) return job.group_id ? { ...job, group_id: null } : job;
    const anchor = group.map(member => `${member.source}|${canonicalUrl(member)}`).sort()[0];
    return { ...job, group_id: makeId("group", anchor) };
  });
}

function dedupeJobs(records) {
  const byUrl = new Map();
  let exactRemoved = 0;

  const orderedRecords = records
    .filter(Boolean)
    .map(ensureStableLogicalRecord)
    .map(enforceApplicationInvariant)
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

  const fuzzy = fuzzyCrossSourceMerge(output);

  return {
    jobs: fuzzy.jobs,
    removed: exactRemoved + referenceRemoved + roleRemoved + fingerprintRemoved + fuzzy.removed,
    exactRemoved,
    referenceRemoved,
    roleRemoved,
    fingerprintRemoved,
    fuzzyRemoved: fuzzy.removed,
  };
}

module.exports = {
  SOURCE_PRIORITY,
  assignGroups,
  canonicalUrl,
  companyKeys,
  compareCanonicalRecords,
  dedupeJobs,
  enforceApplicationInvariant,
  ensureStableLogicalRecord,
  applicationChannelEvidence,
  fingerprint,
  logicalIdentityKey,
  mergeDuplicate,
  normalizeComparableText,
  normalizedReference,
  referenceKey,
  resolveApplicationMethod,
  roleKey,
  similarTitles,
  stableLogicalId,
};
