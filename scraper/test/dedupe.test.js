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

test("merge preserves a backed email preference when both email and web channels remain", () => {
  const emailOnly = job({
    application_method: "email",
    apply_emails: ["jobs@example.com"],
  });
  const webApplication = job({
    source: "kaarobar",
    url: "https://www.kaarobar.net/jobs/dev-1",
    source_url: "https://www.kaarobar.net/jobs/dev-1",
    application_method: "web",
    apply_url: "https://www.kaarobar.net/jobs/apply/dev-1",
  });

  assert.equal(emailOnly.application_method, "email");
  assert.equal(emailOnly.apply_url, null);
  const merged = dedupeJobs([emailOnly, webApplication]).jobs[0];

  assert.equal(merged.apply_url, "https://www.kaarobar.net/jobs/apply/dev-1");
  assert.equal(merged.application_method, "email");
  assert.deepEqual(merged.apply_emails, ["jobs@example.com"]);
});

test("merge re-derives web method when another source supplies the only application channel", () => {
  const noChannel = job({ application_method: "unknown" });
  const webApplication = job({
    source: "kaarobar",
    url: "https://www.kaarobar.net/jobs/dev-1",
    source_url: "https://www.kaarobar.net/jobs/dev-1",
    application_method: "web",
    apply_url: "https://www.kaarobar.net/jobs/apply/dev-1",
  });

  const merged = dedupeJobs([noChannel, webApplication]).jobs[0];
  assert.equal(merged.apply_url, "https://www.kaarobar.net/jobs/apply/dev-1");
  assert.equal(merged.application_method, "web");
});

test("merge re-derives email method when another source supplies a mailto application URL", () => {
  const noChannel = job({ application_method: "unknown" });
  const emailApplication = job({
    source: "kaarobar",
    url: "https://www.kaarobar.net/jobs/dev-1",
    source_url: "https://www.kaarobar.net/jobs/dev-1",
    application_method: "email",
    apply_url: "mailto:apply@example.com",
  });

  assert.equal(noChannel.application_method, "unknown");
  assert.equal(noChannel.apply_url, null);
  const merged = dedupeJobs([noChannel, emailApplication]).jobs[0];

  assert.equal(merged.apply_url, "mailto:apply@example.com");
  assert.equal(merged.application_method, "email");
  assert.deepEqual(merged.apply_emails, ["apply@example.com"]);
});

test("dedupe repairs a stale method even when it arrives after normalization", () => {
  const normalized = job({
    application_method: "unknown",
    apply_url: "https://jobs.af/jobs/dev-1/apply",
  });
  assert.equal(normalized.application_method, "web");
  const stale = { ...normalized, application_method: "unknown" };

  const repaired = dedupeJobs([stale]).jobs[0];
  assert.equal(repaired.application_method, "web");
  assert.equal(repaired.apply_url, "https://jobs.af/jobs/dev-1/apply");
});

test("dedupe replaces an unbacked web method with unknown", () => {
  const normalized = job();
  const stale = {
    ...normalized,
    application_method: "web",
    apply_url: null,
    apply_emails: [],
    apply_phones: [],
  };

  assert.equal(dedupeJobs([stale]).jobs[0].application_method, "unknown");
});

test("dedupe does not treat a stale malformed mailto URL as email evidence", () => {
  const stale = {
    ...job(),
    application_method: "email",
    apply_url: "mailto:not-an-email",
    apply_emails: [],
  };

  const repaired = dedupeJobs([stale]).jobs[0];
  assert.equal(repaired.application_method, "unknown");
});

test("an alternate-source listing fallback does not become a web application channel", () => {
  const kaarobarUrl = "https://www.kaarobar.net/jobs/dev-1";
  const record = job({
    source: "kaarobar",
    url: kaarobarUrl,
    source_url: kaarobarUrl,
    application_method: "unknown",
    apply_url: kaarobarUrl,
    also_found_on: [
      { source: "jobs.af", url: "https://jobs.af/jobs/dev-1" },
    ],
  });

  const stabilized = dedupeJobs([record]).jobs[0];
  assert.equal(stabilized.source, "jobs.af");
  assert.equal(stabilized.apply_url, kaarobarUrl);
  assert.equal(stabilized.application_method, "unknown");
  assert.deepEqual(stabilized.also_found_on, [
    { source: "kaarobar", url: kaarobarUrl },
  ]);
});

test("a listing fallback cannot hide a duplicate source's real application form", () => {
  const listingOnly = job({
    application_method: "web",
    apply_url: "https://jobs.af/jobs/dev-1",
  });
  const webApplication = job({
    source: "kaarobar",
    url: "https://www.kaarobar.net/jobs/dev-1",
    source_url: "https://www.kaarobar.net/jobs/dev-1",
    application_method: "web",
    apply_url: "https://www.kaarobar.net/jobs/apply/dev-1",
  });

  assert.equal(listingOnly.application_method, "unknown");
  for (const records of [[listingOnly, webApplication], [webApplication, listingOnly]]) {
    const merged = dedupeJobs(records).jobs[0];
    assert.equal(merged.source, "jobs.af");
    assert.equal(merged.apply_url, "https://www.kaarobar.net/jobs/apply/dev-1");
    assert.equal(merged.application_method, "web");
  }
});
