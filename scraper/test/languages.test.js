const assert = require("node:assert/strict");
const test = require("node:test");
const { assessJobRelevance } = require("../lib/keywords");
const { assessLanguageRole, detectAfghanLanguages } = require("../lib/languages");
const { classifyRemoteEligibility } = require("../lib/remote");
const meridial = require("../sites/meridial");
const sigma = require("../sites/sigma");
const workable = require("../sites/workable");
const { SITES, filterOpenJobs, prepareRecords } = require("../scrape_all");

const NOW = "2026-11-09T06:00:00Z";

test("Afghan languages are found in job titles without Indonesian or geographic false positives", () => {
  assert.deepEqual(detectAfghanLanguages("Dari Transcribers (Remote)"), ["Dari"]);
  assert.deepEqual(detectAfghanLanguages("Pashto Language Specialist - Freelance AI Trainer Project"), ["Pashto"]);
  assert.deepEqual(detectAfghanLanguages("Persian Trilingual Language Specialist"), ["Persian"]);
  assert.deepEqual(detectAfghanLanguages("English - Farsi Interpreter"), ["Persian"]);
  assert.deepEqual(detectAfghanLanguages("Fluent in English and Persian"), ["Persian"]);
  assert.deepEqual(detectAfghanLanguages("Kerja remote dari rumah"), []);
  assert.deepEqual(detectAfghanLanguages("Logistics lead, Persian Gulf region"), []);
});

test("remote language work in Afghan languages is its own track", () => {
  const remote = fields => ({ work_mode: "remote", ...fields });
  assert.equal(assessLanguageRole(remote({ title: "Dari Linguistic Projects (Remote)" })).matched, true);
  assert.equal(assessLanguageRole(remote({
    title: "Freelance Translator",
    description: "Languages required: Arabic, Dari, Farsi, Pashto, Urdu.",
  })).matched, true);
  // Mentioning Dari is not enough when the role is not language work.
  assert.equal(assessLanguageRole(remote({
    title: "HR Intern: Support Refugee Application Process",
    description: "Fluency in Dari or Pashto is an asset.",
  })).matched, false);
  // Onsite translators stay out; only online work is in scope.
  assert.equal(assessLanguageRole({ title: "Pashto Translator", work_mode: "onsite" }).matched, false);

  const interpreter = assessJobRelevance(remote({ title: "English - Farsi Interpreter" }));
  assert.equal(interpreter.decision, "include");
  assert.equal(interpreter.track, "language");
  assert.ok(interpreter.score >= interpreter.threshold);
  const onsite = assessJobRelevance({ title: "Translator", work_mode: "onsite", description: "Dari and Pashto required." });
  assert.equal(onsite.decision, "exclude");
  assert.equal(assessJobRelevance({ title: "Backend Developer" }).track, "tech");
});

test("a board's own country whitelist decides eligibility even for language roles", () => {
  const languages = ["Dari"];
  assert.equal(classifyRemoteEligibility("Only: Nepal", { languages }).scope, null);
  assert.equal(classifyRemoteEligibility("Only: Afghanistan", { languages }).scope, "afghanistan");
  assert.equal(classifyRemoteEligibility("Only: Pakistan", { languages }).scope, null);
  assert.equal(classifyRemoteEligibility("Worldwide", { languages }).scope, "worldwide");
  // With no stated restriction, a Dari/Pashto role is assumed open to Afghans.
  assert.equal(classifyRemoteEligibility("", { languages }).scope, "language");
});

test("Meridial keeps worldwide or Afghan-language postings and reads their full text", () => {
  const posting = (title, location) => ({ id: 1, title, absolute_url: "https://job-boards.eu.greenhouse.io/agency/jobs/1", location: { name: location } });
  assert.equal(meridial.isCandidate(posting("Pashto Language Expert - Freelance AI Trainer Project", "Pakistan")), true);
  assert.equal(meridial.isCandidate(posting("Software Engineer - Freelance AI Trainer Project", "World Wide - Remote")), true);
  assert.equal(meridial.isCandidate(posting("Software Engineer - Freelance AI Trainer Project", "United States of America")), false);
  assert.equal(meridial.isCandidate(posting("Mandarin Chinese Voice Actor", "World Wide - Remote")), false);

  const record = meridial.toRecord(
    { ...posting("Pashto Language Specialist - Freelance AI Trainer Project", "World Wide - Remote"), first_published: "2025-08-14T20:03:26-04:00" },
    { content: "&lt;p&gt;Converse with AI models in &lt;strong&gt;Pashto&lt;/strong&gt;.&lt;/p&gt;" },
    NOW,
  );
  assert.equal(record.remote_scope, "worldwide");
  assert.equal(record.post_date, "2025-08-15");
  assert.match(record.description, /Converse with AI models in Pashto/);
  assert.deepEqual(record.languages, ["Pashto"]);

  const pakistan = meridial.toRecord(posting("Dari Language Expert - Freelance Project", "Pakistan"), null, NOW);
  assert.equal(pakistan.remote_scope, null);
});

test("Sigma's Teamtailor feed yields remote postings with their country lists", () => {
  const xml = `<?xml version="1.0"?><rss xmlns:tt="https://teamtailor.com/locations"><channel>
    <item><title>Dari Transcribers (Remote) | Sigma AI</title><link>https://careers.sigma.ai/jobs/1-dari</link>
      <description>&lt;p&gt;Native Dari speakers wanted.&lt;/p&gt;</description><pubDate>Fri, 06 Nov 2026 14:24:08 +0100</pubDate>
      <remoteStatus>fully</remoteStatus><tt:locations></tt:locations><tt:department>Annotation &amp; Translation</tt:department></item>
    <item><title>Spanish Speech Specialist (Remote) | Sigma AI</title><link>https://careers.sigma.ai/jobs/2-es</link>
      <description>Spanish</description><pubDate>Fri, 06 Nov 2026 14:24:08 +0100</pubDate><remoteStatus>fully</remoteStatus>
      <tt:locations><tt:location><tt:country>Colombia</tt:country></tt:location><tt:location><tt:country>Mexico</tt:country></tt:location></tt:locations></item>
    <item><title>Dutch Linguistic Projects (On-site London)</title><link>https://careers.sigma.ai/jobs/3-nl</link>
      <description>Dutch</description><remoteStatus>onsite</remoteStatus></item>
  </channel></rss>`;
  const items = sigma.parseFeed(xml);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, "Dari Transcribers (Remote)");
  assert.deepEqual(items[1].countries, ["Colombia", "Mexico"]);
  assert.equal(items[2].remoteStatus, "onsite");

  const dari = sigma.toRecord(items[0], NOW);
  assert.equal(dari.remote_scope, "language");
  assert.equal(dari.post_date, "2026-11-06");
  const [kept] = prepareRecords([dari, sigma.toRecord(items[1], NOW)], { now: NOW });
  assert.equal(kept.track, "language");
  assert.equal(kept.title, "Dari Transcribers (Remote)");
});

test("Workable search keeps remote postings and treats each posting's country as its restriction", () => {
  const job = (id, country, workplace = "remote") => ({
    id,
    title: "Senior Farsi Linguistic QA Tester (Remote)",
    state: "published",
    url: `https://jobs.workable.com/view/${id}`,
    description: "<p>Translate English into Farsi.</p>",
    requirementsSection: "<ul><li>Native Farsi</li></ul>",
    company: { title: "Acclaro" },
    location: { countryName: country },
    workplace,
    created: "2026-09-17T09:03:25.290Z",
  });
  const records = workable.parseJobs({ jobs: [job("a", "Afghanistan"), job("b", "Uzbekistan"), job("c", "Greece", "on_site")] }, NOW);
  assert.equal(records.length, 2);
  assert.equal(records[0].remote_scope, "afghanistan");
  assert.equal(records[1].remote_scope, null);
  const kept = prepareRecords(records, { now: NOW });
  assert.deepEqual(kept.map(item => item.url), ["https://jobs.workable.com/view/a"]);
  assert.equal(kept[0].track, "language");
});

test("employer boards that list only open roles are not retired by posting age", () => {
  assert.ok(SITES.some(site => site.name === "meridial" && site.listsOnlyOpenJobs));
  const evergreen = {
    source: "meridial", url: "https://x/1", title: "Pashto Language Specialist", work_mode: "remote",
    remote_scope: "worldwide", post_date: "2025-08-15", closing_date: null,
  };
  const aggregator = { ...evergreen, source: "himalayas", url: "https://x/2" };
  assert.deepEqual(filterOpenJobs([evergreen, aggregator], NOW).map(job => job.source), ["meridial"]);
});

test("the remote cap never pushes out language roles", () => {
  const { buildRemoteJob } = require("../lib/remote");
  const remote = (id, title, postedAt) => buildRemoteJob({
    source: "remotive", url: `https://remotive.com/jobs/${id}`, title, company: `Company ${id}`,
    restriction: "Worldwide", description: "Remote role.", postedAt,
  }, { now: NOW });
  const records = [
    remote("1", "Backend Developer", "2026-11-08"),
    remote("2", "Frontend Developer", "2026-11-07"),
    remote("3", "Pashto Translator", "2026-10-01"),
  ];
  const { jobs } = require("../scrape_all").reprocessJobs(records, { now: NOW, maxRemoteJobs: 1 });
  assert.deepEqual(jobs.map(job => job.title).sort(), ["Backend Developer", "Pashto Translator"]);
});

test("titles for another language are not language roles because of agency boilerplate", () => {
  const job = {
    work_mode: "remote",
    title: "English - Thai Interpreter",
    description: "We hire interpreters for Arabic, Dari, Farsi, Pashto, Thai and 200 other languages.",
  };
  assert.equal(assessLanguageRole(job).matched, false);
  assert.equal(assessLanguageRole({ ...job, title: "Expert Audio Transcriber, Tajik" }).matched, true);
});

test("Meridial titles use the short form other boards copy, so duplicates merge", () => {
  assert.equal(meridial.cleanTitle("Pashto Language Specialist - Freelance AI Trainer Project"), "Pashto Language Specialist - AI Trainer");
  assert.equal(meridial.cleanTitle("Data Science Specialist - AI Trainer Project- Freelance AI Trainer Project"), "Data Science Specialist - AI Trainer");
  assert.equal(meridial.cleanTitle("Dari Language Expert - Freelance Project"), "Dari Language Expert");

  const { buildRemoteJob } = require("../lib/remote");
  const direct = meridial.toRecord({
    id: 7, title: "Pashto Language Specialist - Freelance AI Trainer Project",
    absolute_url: "https://job-boards.eu.greenhouse.io/agency/jobs/7", location: { name: "World Wide - Remote" },
  }, null, NOW);
  const copy = buildRemoteJob({
    source: "himalayas", url: "https://himalayas.app/companies/inv/jobs/pashto", title: "Pashto Language Specialist - AI Trainer",
    company: "Invisible Technologies", restriction: "", postedAt: "2026-11-01",
  }, { now: NOW, emptyMeansWorldwide: true });
  const kept = prepareRecords([copy, direct], { now: NOW });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].source, "meridial");
  assert.deepEqual(kept[0].also_found_on.map(item => item.source), ["himalayas"]);
});
