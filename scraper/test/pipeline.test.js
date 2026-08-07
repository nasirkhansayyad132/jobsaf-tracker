const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { reconcileLifecycle, scrapeAll, validateOutput } = require("../scrape_all");
const { attachCoverage, strongTitleSummaryFallback } = require("../lib/html_adapter");
const { normalizeJob } = require("../lib/normalize");

const NOW = "2026-08-05T04:30:00Z";

function makeTemp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jobsaf-pipeline-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    json: path.join(directory, "jobs.json"),
    csv: path.join(directory, "jobs.csv"),
    debug: path.join(directory, "debug"),
  };
}

function techJob(source, id, overrides = {}) {
  return {
    source,
    url: `https://${source.replace(/[^a-z]/g, "")}.example/jobs/${id}`,
    source_url: `https://${source.replace(/[^a-z]/g, "")}.example/jobs/${id}`,
    title: `Software Engineer ${id}`,
    company: "Example Co",
    location: "Kabul",
    closing_date: "2026-09-30",
    scraped_at: "2026-08-01T00:00:00Z",
    details: { Reference: id },
    ...overrides,
  };
}

function site(name, scrape) {
  return { name, scrape };
}

test("an all-source outage leaves the canonical JSON byte-for-byte unchanged", async t => {
  const files = makeTemp(t);
  const original = `${JSON.stringify([techJob("alpha", "A")], null, 2)}\n`;
  fs.writeFileSync(files.json, original);

  await assert.rejects(
    scrapeAll({
      outJson: files.json,
      outCsv: files.csv,
      debugDir: files.debug,
      sites: [site("alpha", async () => { throw new Error("offline"); })],
      onlyOpen: false,
      now: NOW,
    }),
    /All sources failed/
  );
  assert.equal(fs.readFileSync(files.json, "utf-8"), original);
  assert.match(fs.readFileSync(path.join(files.debug, "alpha.txt"), "utf-8"), /offline/);
});

test("a zero-result adapter is a failed source and preserves last-known-good data", async t => {
  const files = makeTemp(t);
  const original = `${JSON.stringify([techJob("alpha", "A")], null, 2)}\n`;
  fs.writeFileSync(files.json, original);

  await assert.rejects(
    scrapeAll({
      outJson: files.json,
      outCsv: files.csv,
      debugDir: files.debug,
      sites: [site("alpha", async () => [])],
      onlyOpen: false,
      now: NOW,
    }),
    /zero jobs|All sources failed/,
  );
  assert.equal(fs.readFileSync(files.json, "utf-8"), original);
  assert.match(fs.readFileSync(path.join(files.debug, "alpha.txt"), "utf-8"), /zero jobs/);
});

test("a successful source clears only its exact stale diagnostic", async t => {
  const files = makeTemp(t);
  fs.mkdirSync(files.debug, { recursive: true });
  fs.writeFileSync(path.join(files.debug, "alpha.txt"), "stale source failure\n");
  fs.writeFileSync(path.join(files.debug, "unrelated.txt"), "keep me\n");

  await scrapeAll({
    outJson: files.json,
    outCsv: files.csv,
    debugDir: files.debug,
    sites: [site("alpha", async () => [techJob("alpha", "A", { scraped_at: NOW })])],
    onlyOpen: false,
    now: NOW,
  });

  assert.equal(fs.existsSync(path.join(files.debug, "alpha.txt")), false);
  assert.equal(fs.readFileSync(path.join(files.debug, "unrelated.txt"), "utf-8"), "keep me\n");
  const audit = JSON.parse(fs.readFileSync(path.join(files.debug, "alpha.relevance.json"), "utf-8"));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].title, "Software Engineer A");
  assert.equal(audit[0].decision, "include");
  assert.equal("description" in audit[0], false);
  assert.equal("company" in audit[0], false);
});

test("a major established-source collapse aborts before publication", async t => {
  const files = makeTemp(t);
  const existing = Array.from({ length: 8 }, (_, index) => techJob("alpha", `A-${index}`));
  const original = JSON.stringify(existing, null, 2);
  fs.writeFileSync(files.json, original);

  await assert.rejects(
    scrapeAll({
      outJson: files.json,
      outCsv: files.csv,
      debugDir: files.debug,
      sites: [site("alpha", async () => [techJob("alpha", "NEW", { scraped_at: NOW })])],
      onlyOpen: false,
      now: NOW,
    }),
    /major source drop|All sources failed/
  );
  assert.equal(fs.readFileSync(files.json, "utf-8"), original);
});

test("a partial outage preserves failed-source data and updates healthy-source data", async t => {
  const files = makeTemp(t);
  const existing = [
    techJob("alpha", "A"),
    techJob("beta", "B", { closing_date: "2026-08-10" }),
  ];
  fs.writeFileSync(files.json, JSON.stringify(existing, null, 2));

  const result = await scrapeAll({
    outJson: files.json,
    outCsv: files.csv,
    debugDir: files.debug,
    sites: [
      site("alpha", async () => { throw new Error("offline"); }),
      site("beta", async () => [techJob("beta", "B", { closing_date: "2026-09-20", scraped_at: NOW })]),
    ],
    onlyOpen: false,
    now: NOW,
  });

  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs.find(job => job.source === "alpha").lifecycle_status, "source_unavailable");
  assert.equal(result.jobs.find(job => job.source === "beta").closing_date, "2026-09-20");
  assert.ok(fs.existsSync(files.csv));
});

test("partial detail coverage publishes successes without aging out unseen source jobs", async t => {
  const files = makeTemp(t);
  const existing = [techJob("alpha", "A"), techJob("alpha", "B")];
  fs.writeFileSync(files.json, JSON.stringify(existing, null, 2));
  const partialRecords = attachCoverage([
    techJob("alpha", "A", { closing_date: "2026-10-15", scraped_at: NOW }),
  ], {
    discoveredCount: 2,
    detailFailures: 1,
    enrichedCount: 1,
    fallbackCount: 0,
  });

  const result = await scrapeAll({
    outJson: files.json,
    outCsv: files.csv,
    debugDir: files.debug,
    sites: [site("alpha", async () => partialRecords)],
    onlyOpen: false,
    now: NOW,
  });

  assert.equal(result.sourceHealth[0].status, "partial");
  assert.equal(result.sourceHealth[0].detail_failures, 1);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs.find(job => job.title === "Software Engineer A").closing_date, "2026-10-15");
  const unseen = result.jobs.find(job => job.title === "Software Engineer B");
  assert.equal(unseen.lifecycle_status, "source_unavailable");
  assert.equal(unseen.missed_runs, 0);
  assert.match(fs.readFileSync(path.join(files.debug, "alpha.txt"), "utf-8"), /partial coverage: 1\/2/);
});

test("a strong-title summary fallback stays visibly marked for source recheck", async t => {
  const files = makeTemp(t);
  const fallback = strongTitleSummaryFallback(techJob("alpha", "FALLBACK"));
  const partialRecords = attachCoverage([fallback], {
    discoveredCount: 1,
    detailFailures: 1,
    enrichedCount: 0,
    fallbackCount: 1,
    unsafeCoverage: true,
  });

  const result = await scrapeAll({
    outJson: files.json,
    outCsv: files.csv,
    debugDir: files.debug,
    sites: [site("alpha", async () => partialRecords)],
    onlyOpen: false,
    now: NOW,
  });

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].lifecycle_status, "source_unavailable");
  assert.equal(result.jobs[0].application_method, "unknown");
  assert.match(result.jobs[0].details["Enrichment Status"], /Summary only/);
});

test("missing jobs expire only after the configured successful-run grace", () => {
  const old = normalizeJob(techJob("alpha", "A", { missed_runs: 2 }), { now: NOW });
  const reconciled = reconcileLifecycle([old], [], [{ source: "alpha", status: "healthy" }], {
    now: NOW,
    missedRunGrace: 2,
  });
  assert.deepEqual(reconciled, []);
});

test("reprocess-only cleans and annotates existing data without invoking a source", async t => {
  const files = makeTemp(t);
  fs.writeFileSync(files.json, JSON.stringify([
    techJob("alpha", "A"),
    {
      source: "alpha",
      url: "https://alpha.example/jobs/doctor",
      title: "Pediatrician",
      company: "Development Network",
      category: "Health Care",
      scraped_at: "2026-08-01T00:00:00Z",
    },
  ], null, 2));
  let invoked = false;

  const result = await scrapeAll({
    outJson: files.json,
    outCsv: files.csv,
    debugDir: files.debug,
    sites: [site("alpha", async () => { invoked = true; return []; })],
    reprocessOnly: true,
    onlyOpen: false,
    now: NOW,
  });
  assert.equal(invoked, false);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].relevance.decision, "include");
  assert.equal(result.jobs[0].post_date, null);
});

test("corrupt existing JSON is never treated as an empty dataset", async t => {
  const files = makeTemp(t);
  fs.writeFileSync(files.json, "{broken");
  await assert.rejects(
    scrapeAll({ outJson: files.json, outCsv: files.csv, debugDir: files.debug, reprocessOnly: true, now: NOW }),
    /Refusing to replace unreadable existing data/
  );
  assert.equal(fs.readFileSync(files.json, "utf-8"), "{broken");
});

test("pipeline preserves a coherent method when merged sources contribute different channels", async t => {
  const files = makeTemp(t);
  const result = await scrapeAll({
    outJson: files.json,
    outCsv: files.csv,
    debugDir: files.debug,
    sites: [site("alpha", async () => [
      techJob("alpha", "A", { application_method: "unknown", scraped_at: NOW }),
      techJob("alpha", "A", {
        application_method: "web",
        apply_url: "https://alpha.example/jobs/A/apply",
        scraped_at: "2026-08-04T00:00:00Z",
      }),
    ])],
    onlyOpen: false,
    now: NOW,
  });

  assert.equal(result.jobs[0].application_method, "web");
  assert.equal(result.jobs[0].apply_url, "https://alpha.example/jobs/A/apply");
});

test("pipeline excludes the procurement false positive before output validation", async t => {
  const files = makeTemp(t);
  const procurement = {
    source: "alpha",
    url: "https://alpha.example/jobs/procurement-bidding-specialist",
    source_url: "https://alpha.example/jobs/procurement-bidding-specialist",
    title: "Procurement Bidding Specialist",
    company: "Example Co",
    location: "Kabul",
    category: "Information Technology",
    closing_date: "2026-09-30",
    apply_url: null,
    application_method: "web",
    description: "Manage procurement bids, supplier evaluation, and contracts.",
    details: {
      "Submission Through": "link",
      Education: "Bachelor's degree in Computer Science",
      Reference: "PROC-1",
    },
    scraped_at: NOW,
  };

  const result = await scrapeAll({
    outJson: files.json,
    outCsv: files.csv,
    debugDir: files.debug,
    sites: [site("alpha", async () => [techJob("alpha", "VALID"), procurement])],
    onlyOpen: false,
    now: NOW,
  });

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].title, "Software Engineer VALID");
  assert.equal(result.jobs.some(job => job.title === procurement.title), false);
});

test("output validation rejects an application method that contradicts apply_url", () => {
  const normalized = normalizeJob(techJob("alpha", "A", {
    application_method: "unknown",
    apply_url: "mailto:apply@example.com",
    relevance: { score: 80, threshold: 55, decision: "include", reasons: [] },
  }), { now: NOW });
  const inconsistent = { ...normalized, application_method: "unknown" };

  assert.throws(
    () => validateOutput([inconsistent], true),
    /unbacked application_method unknown; expected email/,
  );
});

test("output validation rejects an unbacked web method before publication", () => {
  const normalized = normalizeJob(techJob("alpha", "A", {
    relevance: { score: 80, threshold: 55, decision: "include", reasons: [] },
  }), { now: NOW });
  const inconsistent = {
    ...normalized,
    application_method: "web",
    apply_url: null,
    apply_emails: [],
    apply_phones: [],
  };

  assert.throws(
    () => validateOutput([inconsistent], true),
    /unbacked application_method web; expected unknown/,
  );
});

test("output validation rejects a missing company before publication", () => {
  const normalized = normalizeJob(techJob("alpha", "A", {
    company: null,
    relevance: { score: 80, threshold: 55, decision: "include", reasons: [] },
  }), { now: NOW });

  assert.throws(
    () => validateOutput([normalized], true),
    /missing title\/company\/source\/url/,
  );
});

test("output validation rejects malformed mailto as email evidence", () => {
  const normalized = normalizeJob(techJob("alpha", "A", {
    relevance: { score: 80, threshold: 55, decision: "include", reasons: [] },
  }), { now: NOW });
  const inconsistent = {
    ...normalized,
    application_method: "email",
    apply_url: "mailto:not-an-email",
    apply_emails: [],
  };

  assert.throws(
    () => validateOutput([inconsistent], true),
    /unbacked application_method email; expected unknown/,
  );
});
