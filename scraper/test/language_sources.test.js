const assert = require("node:assert/strict");
const test = require("node:test");
const freelancer = require("../sites/freelancer");
const gotranscript = require("../sites/gotranscript");
const mercor = require("../sites/mercor");
const welocalize = require("../sites/welocalize");
const { prepareRecords } = require("../scrape_all");

const NOW = "2026-11-17T06:00:00Z";

test("Welocalize keeps remote postings and reads Lever's location list", () => {
  const posting = (text, locations, workplaceType = "remote") => ({
    text,
    hostedUrl: `https://jobs.lever.co/weloglobal/${encodeURIComponent(text)}`,
    applyUrl: "https://jobs.lever.co/weloglobal/x/apply",
    workplaceType,
    createdAt: Date.parse("2025-08-13T00:00:00Z"),
    categories: { location: locations[0], allLocations: locations, commitment: "Freelance" },
    descriptionPlain: "Native or near-native Persian. Annotation, search evaluation and prompt writing.",
  });
  const records = welocalize.parsePostings([
    posting("AI Trainers Network - Persian", ["Afghanistan", "Remote, Worldwide", "Remote - Europe"]),
    posting("Ads Quality Rater - Farsi (Turkey)", ["Turkey"]),
    posting("Project The Persian | Robotics Lead", ["California"], "onsite"),
  ], NOW);
  assert.equal(records.length, 2);
  assert.equal(records[0].remote_scope, "worldwide");
  assert.equal(records[1].remote_scope, null);

  const kept = prepareRecords(records, { now: NOW });
  assert.deepEqual(kept.map(job => job.title), ["AI Trainers Network - Persian"]);
  assert.equal(kept[0].track, "language");
  assert.equal(welocalize.restrictionFor({ categories: { allLocations: ["Remote - Europe", "Turkey"] } }), "Only: Europe, Turkey");
});

test("Freelancer.com projects are online work, kept only when they need an Afghan language", () => {
  const project = (id, title, description, extra = {}) => ({
    id, title, description, status: "active", local: false, seo_url: `translation/${id}`,
    time_submitted: 1794397340, type: "fixed", currency: { code: "USD" }, budget: { minimum: 30, maximum: 250 },
    jobs: [{ name: "Translation" }], ...extra,
  });
  const records = freelancer.parseProjects({ result: { projects: [
    project(1, "Dari/Pashto Virtual Research Assistant", "Remote research with Afghan communities."),
    project(2, "Translate a website", "Translate 20 pages from English into Pashto."),
    project(3, "Day shift data entry", "Simple data entry."),
    project(4, "Pashto interpreter in Peshawar", "Meet clients in person.", { local: true }),
  ] } }, NOW);
  assert.equal(records.length, 3);
  assert.equal(records[0].url, "https://www.freelancer.com/projects/translation/1");
  assert.equal(records[0].remote_scope, "worldwide");
  assert.equal(records[0].salary, "30 - 250 USD per project");

  const kept = prepareRecords(records, { now: NOW });
  assert.deepEqual(kept.map(job => job.title).sort(), ["Dari/Pashto Virtual Research Assistant", "Translate a website"]);
  assert.ok(kept.every(job => job.track === "language"));
});

test("Mercor reads language listings from its sitemap and trusts the listing's own eligibility", () => {
  const sitemap = `<urlset>
    <url><loc>https://work.mercor.com/jobs/list_AAA/pashto-music-expert</loc></url>
    <url><loc>https://work.mercor.com/jobs/list_BBB/senior-software-engineer</loc></url>
    <url><loc>https://work.mercor.com/explore</loc></url>
  </urlset>`;
  const urls = mercor.listingUrls(sitemap);
  assert.deepEqual(urls.map(url => url.split("/").pop()), ["pashto-music-expert", "senior-software-engineer"]);
  assert.deepEqual(urls.filter(mercor.isLanguageSlug).map(url => url.split("/").pop()), ["pashto-music-expert"]);

  const page = (eligible, status = "active") => `<html><head><title>Pashto Music Expert</title>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Pashto Music Expert",
      identifier: { value: "list_AAA" },
      datePosted: "2026-07-09T00:00:00.000Z",
      validThrough: "2026-12-30T00:00:00.000Z",
      employmentType: "PART_TIME",
      applicantLocationRequirements: [{ "@type": "Country", name: "US" }],
      description: "<p>Evaluate lyrics with strong Pashto fluency.</p>",
      baseSalary: { currency: "USD", value: { minValue: 50, maxValue: 70, unitText: "HOUR" } },
    })}</script></head><body><script>{"listingId":"list_AAA","status":"${status}","eligibleLocation":${eligible},"ineligibleLocation":null}</script></body></html>`;

  const open = mercor.parseListing(page("null"), urls[0], NOW);
  assert.equal(open.remote_scope, "worldwide");
  assert.equal(open.salary, "50 - 70 USD per hour");
  assert.equal(open.closing_date, "2026-12-30");
  assert.equal(mercor.parseListing(page('["USA"]'), urls[0], NOW).remote_scope, null);
  assert.equal(mercor.parseListing(page("null", "closed"), urls[0], NOW), null);
});

test("GoTranscript's standing recruitment pages become open language jobs", () => {
  const html = `<html><head><title>Pashto Transcription Job, Hiring Now! | GoTranscript</title>
    <meta name="description" content="Work from home as a Pashto transcriber."></head>
    <body><nav>Menu</nav><main><h1>Pashto Transcription Job, Hiring Now!</h1>
    <p>We hire native Pashto speakers from anywhere in the world.</p><li>Weekly payouts</li></main></body></html>`;
  const record = gotranscript.parsePage(html, gotranscript.PAGES[0], NOW);
  assert.equal(record.title, "Pashto Transcription Job");
  assert.equal(record.remote_scope, "worldwide");
  assert.equal(record.category, "Transcription");
  assert.doesNotMatch(record.description, /Menu/);
  assert.equal(prepareRecords([record], { now: NOW })[0].track, "language");

  // A page that no longer names the language is not an opening.
  assert.equal(gotranscript.parsePage(html.replace(/Pashto/g, "Spanish"), gotranscript.PAGES[0], NOW), null);
});

test("platform labels do not turn other-language hubs into tech jobs", () => {
  const hub = language => ({
    text: `AI Trainers Network - ${language}`,
    hostedUrl: `https://jobs.lever.co/weloglobal/${language}`,
    workplaceType: "remote",
    createdAt: Date.parse("2026-06-01T00:00:00Z"),
    categories: { allLocations: ["Remote, Worldwide"], team: "Data", department: "Application" },
    descriptionPlain: `Native ${language} speakers for AI evaluation.`,
  });
  const kept = prepareRecords(welocalize.parsePostings([hub("Albanian"), hub("Farsi")], NOW), { now: NOW });
  assert.deepEqual(kept.map(job => job.title), ["AI Trainers Network - Farsi"]);

  const gig = freelancer.parseProjects({ result: { projects: [{
    id: 9, title: "Entri & Rapikan Data Dokumen", description: "Kerja dari rumah untuk entri data dengan Excel.",
    status: "active", local: false, seo_url: "data-entry/9", time_submitted: 1794397340, type: "fixed",
    currency: { code: "IDR" }, budget: { minimum: 100000 }, jobs: [{ name: "Data Entry" }, { name: "Excel" }],
  }] } }, NOW);
  assert.deepEqual(prepareRecords(gig, { now: NOW }), []);
});

test("Jobicy's 'Welo Global' copy of a Welocalize hub merges into the employer's posting", () => {
  const { buildRemoteJob } = require("../lib/remote");
  const [own] = welocalize.parsePostings([{
    text: "AI Trainers Network - Persian",
    hostedUrl: "https://jobs.lever.co/weloglobal/287d2601",
    workplaceType: "remote",
    createdAt: Date.parse("2025-08-13T00:00:00Z"),
    categories: { allLocations: ["Afghanistan", "Remote, Worldwide"] },
    descriptionPlain: "Native or near-native Persian.",
  }], NOW);
  const copy = buildRemoteJob({
    source: "jobicy", url: "https://jobicy.com/jobs/158791-ai-trainers-network-persian",
    title: "AI Trainers Network - Persian", company: "Welo Global", restriction: "Anywhere",
    description: "Native or near-native Persian.", postedAt: "2026-11-04",
  }, { now: NOW });
  const kept = prepareRecords([copy, own], { now: NOW });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].source, "welocalize");
});
