const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { assignGroups, companyKeys, dedupeJobs, similarTitles } = require("../lib/dedupe");
const { normalizeJob } = require("../lib/normalize");
const { extractSkills } = require("../lib/skills");
const { filterOpenJobs, reconcileLifecycle, scrapeAll } = require("../scrape_all");

const NOW = "2026-10-14T04:30:00Z";

function job(source, id, overrides = {}) {
  return normalizeJob({
    source,
    url: `https://${source.replace(/[^a-z]/g, "")}.example/jobs/${id}`,
    title: "Software Engineer",
    company: "Example Co",
    location: "Kabul",
    closing_date: "2026-10-30",
    scraped_at: "2026-10-13T00:00:00Z",
    ...overrides,
  }, { now: NOW });
}

function makeTemp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jobsaf-robust-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return {
    json: path.join(directory, "jobs.json"),
    csv: path.join(directory, "jobs.csv"),
    debug: path.join(directory, "debug"),
    health: path.join(directory, "debug", "source-health.json"),
  };
}

test("employer spellings with acronyms share a comparable key", () => {
  const full = companyKeys("UNICEF - United Nations Children’s Fund");
  const reordered = companyKeys("United Nations Children's Fund (UNICEF)");
  assert.ok(full.some(key => reordered.includes(key)));
});

test("title similarity tolerates typos and punctuation but not different seniority", () => {
  assert.equal(similarTitles("Agency Baking Support Staff", "Agency Banking Support Staff"), true);
  assert.equal(similarTitles("Senior Software Engineer, Identity Platform", "Senior Software Engineer - Identity Platform"), true);
  assert.equal(similarTitles("Senior Software Engineer", "Software Engineer"), false);
  assert.equal(similarTitles("Network Engineer", "Network Administrator"), false);
});

test("a cross-posted vacancy with a different employer spelling is merged once", () => {
  const result = dedupeJobs([
    job("acbar", "1", { company: "World Food Programme (WFP)", title: "IT Operations Assistant" }),
    job("impactpool", "2", { company: "WFP - World Food Programme", title: "IT Operations Assistant", location: "Kabul, Afghanistan" }),
  ]);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.fuzzyRemoved, 1);
  assert.deepEqual(result.jobs[0].also_found_on.map(item => item.source), ["impactpool"]);
});

test("two postings on the same board are never fuzzily merged", () => {
  const result = dedupeJobs([
    job("jobs.af", "1", { company: "Azizi Bank", location: "Kabul" }),
    job("jobs.af", "2", { company: "Azizi Bank", location: "Kabul, Afghanistan", closing_date: "2026-11-30" }),
  ]);
  assert.equal(result.jobs.length, 2);
});

test("province variants and typo copies share one display group", () => {
  const grouped = assignGroups([
    job("jobs.af", "1", { title: "Agency Banking Support Staff", company: "Azizi Bank", location: "Kabul" }),
    job("jobs.af", "2", { title: "Agency Banking Support Staff", company: "Azizi Bank", location: "Herat" }),
    job("jobs.af", "3", { title: "Agency Baking Support Staff", company: "Azizi Bank", location: "Nangarhar" }),
    job("jobs.af", "4", { title: "Network Engineer", company: "Azizi Bank" }),
  ]);
  const ids = grouped.map(item => item.group_id);
  assert.ok(ids[0]);
  assert.equal(ids[1], ids[0]);
  assert.equal(ids[2], ids[0]);
  assert.equal(ids[3], null);
});

test("skills are extracted in title-first order", () => {
  assert.deepEqual(
    extractSkills({ title: "React Developer", description: "We use Node.js, PostgreSQL and AWS. Python is a plus." }),
    ["React", "Node.js", "PostgreSQL", "AWS", "Python"],
  );
  assert.deepEqual(extractSkills({ title: "Go to market lead", description: "Let's go" }), []);
});

test("jobs without a deadline retire by age, sooner for remote roles", () => {
  const kept = filterOpenJobs([
    job("a", "1", { closing_date: null, post_date: "2026-09-25", work_mode: "remote", remote_scope: "worldwide" }),
    job("a", "2", { closing_date: null, post_date: "2026-09-01", work_mode: "remote", remote_scope: "worldwide" }),
    job("a", "3", { closing_date: null, post_date: "2026-09-01" }),
    job("a", "4", { closing_date: null, post_date: "2026-07-01" }),
  ], NOW);
  assert.deepEqual(kept.map(item => item.url.split("/").pop()), ["1", "3"]);
});

test("remote sources keep unseen jobs for their own longer grace", () => {
  const old = job("remoteboard", "A", { missed_runs: 5 });
  const health = [{ source: "remoteboard", status: "healthy" }];
  assert.equal(reconcileLifecycle([old], [], health, { now: NOW, missedRunGrace: 2 }).length, 0);
  const kept = reconcileLifecycle([old], [], health, { now: NOW, missedRunGrace: 2, sourceGrace: new Map([["remoteboard", 14]]) });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].missed_runs, 6);
});

test("Afghan boards mark remote roles as open locally", () => {
  const remote = normalizeJob({ source: "jobs.af", url: "https://jobs.af/jobs/x", title: "Developer", job_type: "Remote" });
  assert.equal(remote.work_mode, "remote");
  assert.equal(remote.remote_scope, "afghanistan");
  const onsite = normalizeJob({ source: "jobs.af", url: "https://jobs.af/jobs/y", title: "Developer", job_type: "Onsite" });
  assert.equal(onsite.work_mode, "onsite");
  assert.equal(onsite.remote_scope, null);
});

test("one collapsed source keeps its last good jobs while healthy sources publish", async t => {
  const files = makeTemp(t);
  const existing = Array.from({ length: 8 }, (_, index) => job("alpha", `A-${index}`, { title: `Software Engineer ${index}` }));
  fs.writeFileSync(files.json, JSON.stringify(existing, null, 2));

  const result = await scrapeAll({
    outJson: files.json,
    outCsv: files.csv,
    debugDir: files.debug,
    healthJson: files.health,
    sites: [
      { name: "alpha", scrape: async () => [job("alpha", "NEW", { title: "Data Engineer", scraped_at: NOW })] },
      { name: "beta", kind: "remote", scrape: async () => [job("beta", "B", { title: "Database Administrator", scraped_at: NOW })] },
    ],
    onlyOpen: false,
    now: NOW,
  });

  assert.equal(result.sourceHealth.find(item => item.source === "alpha").status, "major_drop");
  assert.equal(result.jobs.filter(item => item.source === "alpha").length, 9);
  assert.equal(result.jobs.filter(item => item.lifecycle_status === "source_unavailable").length, 8);
  const health = JSON.parse(fs.readFileSync(files.health, "utf-8"));
  assert.deepEqual(health.map(item => [item.source, item.kind, item.status]), [
    ["alpha", "afghanistan", "major_drop"],
    ["beta", "remote", "healthy"],
  ]);
});

test("a hung source times out without blocking the others", async t => {
  const files = makeTemp(t);
  const result = await scrapeAll({
    outJson: files.json,
    outCsv: files.csv,
    debugDir: files.debug,
    sites: [
      { name: "hung", scrape: () => new Promise(() => {}) },
      { name: "fine", scrape: async () => [job("fine", "1", { scraped_at: NOW })] },
    ],
    sourceTimeoutMinutes: 0.001,
    onlyOpen: false,
    now: NOW,
  });
  assert.equal(result.sourceHealth.find(item => item.source === "hung").status, "failed");
  assert.match(result.sourceHealth.find(item => item.source === "hung").reason, /did not finish/);
  assert.equal(result.jobs.length, 1);
});
