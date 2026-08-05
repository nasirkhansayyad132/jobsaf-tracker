const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { reconcileLifecycle, scrapeAll } = require("../scrape_all");
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
