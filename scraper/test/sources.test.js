const assert = require("node:assert/strict");
const test = require("node:test");
const himalayas = require("../sites/himalayas");
const impactpool = require("../sites/impactpool");
const jobicy = require("../sites/jobicy");
const reliefweb = require("../sites/reliefweb");
const remoteok = require("../sites/remoteok");
const remotive = require("../sites/remotive");
const weworkremotely = require("../sites/weworkremotely");
const workingnomads = require("../sites/workingnomads");

const NOW = "2026-10-14T06:00:00Z";

test("Remote OK skips the legal notice row and links back to Remote OK", () => {
  const [job] = remoteok.parseJobs([
    { legal: "notice" },
    {
      id: "1", position: "Golang Engineer", company: "Acme ", url: "https://remoteok.com/remote-jobs/1",
      location: "Worldwide", description: "<p>Go services</p>", tags: ["golang"], epoch: 1791956710,
      salary_min: 80000, salary_max: 100000, apply_url: "https://remoteok.com/l/1",
    },
  ], NOW);
  assert.equal(job.source, "remoteok");
  assert.equal(job.url, "https://remoteok.com/remote-jobs/1");
  assert.equal(job.company, "Acme");
  assert.equal(job.remote_scope, "worldwide");
  assert.equal(job.salary, "80,000 - 100,000 USD per year");
});

test("Remotive maps candidate_required_location to eligibility", () => {
  const jobs = remotive.parseJobs({
    jobs: [
      { url: "https://remotive.com/remote-jobs/software-dev/a-1", title: "Shopify Developer", company_name: "A",
        candidate_required_location: "Worldwide", category: "Software Development", description: "<p>x</p>",
        job_type: "full_time", publication_date: "2026-10-11T20:17:27" },
      { url: "https://remotive.com/remote-jobs/software-dev/b-2", title: "Shopify Developer", company_name: "B",
        candidate_required_location: "USA", category: "Software Development", description: "<p>x</p>" },
    ],
  }, NOW);
  assert.deepEqual(jobs.map(job => job.remote_scope), ["worldwide", null]);
  assert.equal(jobs[0].job_type, "full time");
  assert.equal(jobs[0].post_date, "2026-10-11");
});

test("We Work Remotely treats a country whitelist as the real restriction", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Acme: Backend Engineer</title><region>Anywhere in the World</region><country></country>
      <category>Back-End Programming</category><type>Full-Time</type>
      <description>&lt;p&gt;Ruby APIs&lt;/p&gt;</description><pubDate>Tue, 13 Oct 2026 08:59:20 +0000</pubDate>
      <expires_at>Thu, 12 Nov 2026 08:59:20 +0000</expires_at><link>https://weworkremotely.com/remote-jobs/acme-backend</link></item>
    <item><title>Beta: Data Analyst</title><region>Anywhere in the World</region>
      <country>🇩🇪 Germany, and 🇮🇪 Ireland</country><category>All Other Remote</category>
      <description>x</description><link>https://weworkremotely.com/remote-jobs/beta-data</link></item>
  </channel></rss>`;
  const [open, whitelisted] = weworkremotely.parseFeed(xml, NOW);
  assert.equal(open.company, "Acme");
  assert.equal(open.title, "Backend Engineer");
  assert.equal(open.category, "Software Development");
  assert.equal(open.closing_date, "2026-11-12");
  assert.equal(open.remote_scope, "worldwide");
  assert.equal(whitelisted.remote_scope, null);
  assert.match(whitelisted.remote_regions, /^Only: Germany, and Ireland$/);
});

test("Jobicy and Working Nomads use their location fields", () => {
  const [jobicyJob] = jobicy.parseJobs({ jobs: [{
    url: "https://jobicy.com/jobs/1", jobTitle: "Staff Software Engineer (SRE)", companyName: "Phantom",
    jobGeo: "Anywhere", jobIndustry: ["DevOps & Infrastructure"], jobDescription: "<p>SRE</p>",
    pubDate: "2026-10-13T02:12:36+00:00",
  }] }, NOW);
  assert.equal(jobicyJob.remote_scope, "worldwide");
  assert.equal(jobicyJob.category, "DevOps & Infrastructure");

  const [nomad] = workingnomads.parseJobs([{
    url: "https://www.workingnomads.com/job/go/1/", title: "Senior Django Developer", company_name: "X",
    category_name: "Development", location: "CET (+/- 3 hours)", description: "<p>Django</p>", pub_date: "2026-10-10",
  }], NOW);
  assert.equal(nomad.category, "Software Development");
  assert.equal(nomad.remote_scope, null);
});

test("Himalayas accepts empty or Kabul-spanning time zones and drops stale jobs", () => {
  const allZones = [-11, -8, -5, 0, 1, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  assert.equal(himalayas.restrictionFor({ timezoneRestrictions: allZones }), "");
  assert.equal(himalayas.restrictionFor({ timezoneRestrictions: [-8, -7, -6, -5] }), "Time zones UTC-8 to UTC-5");
  const jobs = himalayas.parseJobs({ jobs: [
    { title: "Senior Mobile Developer", companyName: "micro1", guid: "https://himalayas.app/companies/micro1/jobs/a",
      locationRestrictions: [], timezoneRestrictions: allZones, parentCategories: ["Developer"],
      pubDate: Date.parse("2026-10-13T00:00:00Z") / 1000, expiryDate: Date.parse("2026-12-01T00:00:00Z") / 1000 },
    { title: "Old Developer", companyName: "x", guid: "https://himalayas.app/companies/x/jobs/b",
      pubDate: Date.parse("2026-08-01T00:00:00Z") / 1000 },
    { title: "Time-zone Developer", companyName: "y", guid: "https://himalayas.app/companies/y/jobs/c",
      timezoneRestrictions: [-8, -5], pubDate: Date.parse("2026-10-13T00:00:00Z") / 1000 },
  ] }, NOW);
  assert.deepEqual(jobs.map(job => job.title), ["Senior Mobile Developer", "Time-zone Developer"]);
  assert.equal(jobs[0].remote_scope, "worldwide");
  assert.equal(jobs[0].closing_date, "2026-12-01");
  assert.equal(jobs[1].remote_scope, null);
});

test("Impactpool skips closed jobs and parses the vacancy text and deadline", () => {
  const list = `<div class='job'><div class='extra'><span>Job is closed</span></div>
      <a href="/jobs/1"><h3>Closed Role</h3></a></div>
    <div class='job'><div class='extra'></div><a href="/jobs/2"><h3>IT Operations Assistant (G5)</h3>
      <div class='ip-typography' type='bodyEmphasis'>WFP - World Food Programme</div>
      <div class='ip-typography' type='bodyEmphasis'>Kabul</div>
      <div class='ip-typography' type='bodyEmphasis'>G5 - Junior level</div></a></div>`;
  const [summary] = impactpool.parseList(list);
  assert.equal(summary.title, "IT Operations Assistant (G5)");
  assert.equal(summary.location, "Kabul, Afghanistan");
  assert.equal(summary.details.Level, "G5 - Junior level");

  const detail = `<h1>IT Operations Assistant (G5)</h1>
    <div class='ip-typography'>Application deadline: October 30, 2026</div><a href="/jobs/2/apply">Apply</a>
    <div class="main-content"><p>${"Maintain servers, networks and end-user support for WFP offices. ".repeat(5)}</p>
      <div class='ip-layout'>At Impactpool we do our best…</div></div>`;
  const job = impactpool.parseDetail(detail, summary);
  assert.equal(job.closing_date, "2026-10-30");
  assert.equal(job.apply_url, "https://www.impactpool.org/jobs/2/apply");
  assert.equal(job.details.Level, "G5 - Junior level");
  assert.doesNotMatch(job.description, /Impactpool we do our best/);
});

test("ReliefWeb runs only with a registered appname and parses API fields", async () => {
  assert.equal(typeof reliefweb.enabled, "function");
  await assert.rejects(reliefweb.scrape({ appName: "" }), /RELIEFWEB_APPNAME/);
  const [job] = reliefweb.parseJobs({ data: [{ fields: {
    title: "ICT Officer", url_alias: "https://reliefweb.int/job/1/ict-officer",
    "body-html": "<p>Manage the LAN, servers and helpdesk.</p>", "how_to_apply-html": "<p>Email jobs@ngo.org</p>",
    date: { created: "2026-10-10T00:00:00+00:00", closing: "2026-10-30T00:00:00+00:00" },
    source: [{ name: "Example NGO" }], city: [{ name: "Herat" }],
    career_categories: [{ name: "Information and Communications Technology" }],
  } }] }, NOW);
  assert.equal(job.location, "Herat, Afghanistan");
  assert.equal(job.closing_date, "2026-10-30");
  assert.equal(job.company, "Example NGO");
  assert.deepEqual(job.apply_emails, ["jobs@ngo.org"]);
  assert.match(reliefweb.pageUrl("demo", 0), /country\.iso3.*AFG/);
});
