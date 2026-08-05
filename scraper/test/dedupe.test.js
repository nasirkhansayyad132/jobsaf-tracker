const assert = require("node:assert/strict");
const test = require("node:test");
const { dedupeJobs, referenceKey, stableLogicalId } = require("../lib/dedupe");
const { normalizeJob } = require("../lib/normalize");

function job(overrides = {}) {
  return normalizeJob({
    source: "jobs.af",
    url: "https://jobs.af/jobs/dev-1",
    title: "Software Developer",
    company: "Example Co",
    location: "Kabul",
    closing_date: "2026-08-10",
    scraped_at: "2026-08-01T00:00:00Z",
    details: { Reference: "DEV-1" },
    ...overrides,
  });
}

test("fresh same-URL data overrides stale fields while first/last seen span both", () => {
  const stale = job({ closing_date: "2026-08-01", description: "Old", scraped_at: "2026-07-01T00:00:00Z" });
  const fresh = job({ closing_date: "2026-09-01", description: "Fresh", scraped_at: "2026-08-05T00:00:00Z" });

  for (const records of [[stale, fresh], [fresh, stale]]) {
    const result = dedupeJobs(records);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].closing_date, "2026-09-01");
    assert.equal(result.jobs[0].description, "Fresh");
    assert.equal(result.jobs[0].first_seen_at, "2026-07-01T00:00:00Z");
    assert.equal(result.jobs[0].last_seen_at, "2026-08-05T00:00:00Z");
  }
});

test("stable vacancy references merge cross-source deadline disagreements", () => {
  const first = job();
  const second = job({
    source: "kaarobar",
    url: "https://www.kaarobar.net/jobs/dev-1",
    source_url: "https://www.kaarobar.net/jobs/dev-1",
    closing_date: "2026-09-10",
    scraped_at: "2026-08-05T00:00:00Z",
  });
  const result = dedupeJobs([first, second]);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].closing_date, "2026-09-10");
  assert.equal(result.jobs[0].also_found_on.length, 1);
});

test("cross-source canonical record and logical ID ignore input order and scrape timing", () => {
  const jobsAf = job({
    post_date: "2026-08-02",
    closing_date: "2026-08-10",
    description: "Canonical jobs.af description",
    scraped_at: "2026-08-01T00:00:00Z",
  });
  const acbar = job({
    source: "acbar",
    url: "https://www.acbar.org/jobs/44/software-developer.jsp",
    source_url: "https://www.acbar.org/jobs/44/software-developer.jsp",
    post_date: "2026-07-31",
    closing_date: "2026-09-10",
    description: "ACBAR description",
    scraped_at: "2026-08-05T00:00:00Z",
  });
  const kaarobar = job({
    source: "kaarobar",
    url: "https://www.kaarobar.net/jobs/55/software-developer",
    source_url: "https://www.kaarobar.net/jobs/55/software-developer",
    post_date: "2026-08-01",
    closing_date: "2026-09-01",
    description: "Kaarobar description",
    scraped_at: "2026-08-03T00:00:00Z",
  });
  const withSeenAt = (record, timestamp) => ({
    ...record,
    scraped_at: timestamp,
    first_seen_at: timestamp,
    last_seen_at: timestamp,
  });
  const variants = [
    [jobsAf, acbar, kaarobar],
    [kaarobar, acbar, jobsAf],
    [
      withSeenAt(jobsAf, "2026-08-05T00:00:00Z"),
      withSeenAt(acbar, "2026-08-01T00:00:00Z"),
      withSeenAt(kaarobar, "2026-08-03T00:00:00Z"),
    ],
  ].map(records => dedupeJobs(records).jobs[0]);

  assert.deepEqual(variants[1], variants[0]);
  assert.deepEqual(variants[2], variants[0]);
  assert.equal(variants[0].id, stableLogicalId(referenceKey(jobsAf)));
  assert.equal(variants[0].source, "jobs.af");
  assert.equal(variants[0].url, "https://jobs.af/jobs/dev-1");
  assert.equal(variants[0].description, "Canonical jobs.af description");
  assert.equal(variants[0].post_date, "2026-07-31");
  assert.equal(variants[0].closing_date, "2026-09-10");
  assert.deepEqual(variants[0].also_found_on, [
    { source: "acbar", url: "https://www.acbar.org/en/jobs/details/44/software-developer" },
    { source: "kaarobar", url: "https://www.kaarobar.net/jobs/55/software-developer" },
  ]);
});

test("refreshing the canonical URL preserves an existing cross-source logical ID", () => {
  const first = job();
  const duplicate = job({
    source: "acbar",
    url: "https://www.acbar.org/jobs/44/software-developer.jsp",
    source_url: "https://www.acbar.org/jobs/44/software-developer.jsp",
  });
  const merged = dedupeJobs([first, duplicate]).jobs[0];
  const refreshed = job({
    description: "Fresh canonical description",
    scraped_at: "2026-08-06T00:00:00Z",
  });
  const next = dedupeJobs([merged, refreshed]).jobs[0];

  assert.equal(next.id, merged.id);
  assert.equal(next.description, "Fresh canonical description");
  assert.deepEqual(next.also_found_on, merged.also_found_on);
});

test("an already-merged legacy record migrates to its stable logical ID", () => {
  const legacy = job({
    id: "legacy-source-specific-id",
    source: "kaarobar",
    url: "https://www.kaarobar.net/jobs/55/software-developer",
    source_url: "https://www.kaarobar.net/jobs/55/software-developer",
    also_found_on: [
      { source: "acbar", url: "https://www.acbar.org/jobs/44/software-developer.jsp" },
    ],
  });
  const migrated = dedupeJobs([legacy]).jobs[0];

  assert.equal(migrated.id, stableLogicalId(referenceKey(legacy)));
  assert.equal(migrated.source, "acbar");
  assert.equal(migrated.url, "https://www.acbar.org/en/jobs/details/44/software-developer");
  assert.deepEqual(migrated.also_found_on, [
    { source: "kaarobar", url: "https://www.kaarobar.net/jobs/55/software-developer" },
  ]);
});

test("cross-source role identity can merge an extension even without references", () => {
  const first = job({ details: {}, closing_date: "2026-08-10" });
  const second = job({
    source: "acbar",
    url: "https://www.acbar.org/jobs/44",
    source_url: "https://www.acbar.org/jobs/44",
    details: {},
    closing_date: "2026-09-10",
    scraped_at: "2026-08-05T00:00:00Z",
  });
  assert.equal(dedupeJobs([first, second]).jobs.length, 1);
});

test("distinct stable references prevent role or fingerprint false merges", () => {
  const first = job({ details: { Reference: "DEV-1" } });
  const second = job({
    source: "acbar",
    url: "https://www.acbar.org/jobs/45",
    source_url: "https://www.acbar.org/jobs/45",
    details: { Reference: "DEV-2" },
  });
  assert.equal(dedupeJobs([first, second]).jobs.length, 2);
});
