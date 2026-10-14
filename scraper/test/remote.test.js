const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildRemoteJob,
  classifyRemoteEligibility,
  detectAfghanLanguages,
  formatSalary,
  timezoneWindow,
  titleRestricts,
} = require("../lib/remote");
const { cleanCompany } = require("../sites/remote_common");
const { prepareRecords } = require("../scrape_all");

const NOW = "2026-10-14T06:00:00Z";

test("remote eligibility keeps only roles open to applicants in Afghanistan", () => {
  const scope = text => classifyRemoteEligibility(text).scope;
  assert.equal(scope("Worldwide"), "worldwide");
  assert.equal(scope("Anywhere in the World"), "worldwide");
  assert.equal(scope("Global"), "worldwide");
  assert.equal(scope("Internationally located (not in the US, CA, UK, NZ, or AU)"), "worldwide");
  assert.equal(scope("Kabul, Afghanistan"), "afghanistan");
  assert.equal(scope("Asia"), "asia");
  assert.equal(scope("UTC+3 to UTC+6"), "timezone");
  assert.equal(scope("GMT+4:30"), "timezone");

  for (const restricted of [
    "USA", "Remote, USA Only", "Anywhere in India", "Europe (excluding UK)", "APAC", "Asia-Pacific",
    "EMEA or APAC time zones only", "CET (+/- 3 hours)", "Europe, LATAM, APAC, the U.S., Canada",
    "Philippines, Guatemala, South Africa, Nicaragua", "Remote", "Fully remote - US",
  ]) {
    assert.equal(scope(restricted), null, restricted);
  }
});

test("an empty restriction is worldwide only for boards that document it", () => {
  assert.equal(classifyRemoteEligibility("").scope, null);
  assert.equal(classifyRemoteEligibility("", { emptyMeansWorldwide: true }).scope, "worldwide");
});

test("Afghan-language roles stay eligible unless explicitly restricted elsewhere", () => {
  assert.equal(classifyRemoteEligibility("", { languages: ["Pashto"] }).scope, "language");
  assert.equal(classifyRemoteEligibility("USA", { languages: ["Pashto"] }).scope, null);
});

test("time zone windows understand UTC ranges and named zones with tolerance", () => {
  assert.deepEqual(timezoneWindow("UTC+3 to UTC+6"), { min: 3, max: 6 });
  assert.deepEqual(timezoneWindow("CET (+/- 3 hours)"), { min: -2, max: 4 });
  assert.deepEqual(timezoneWindow("GMT+4:30"), { min: 4.5, max: 4.5 });
  assert.equal(timezoneWindow("Germany"), null);
});

test("titles that name a region restrict a board-wide worldwide label", () => {
  assert.equal(titleRestricts("Backend Developer .Net - Remote from EU - Deadline 27/10/26"), true);
  assert.equal(titleRestricts("Senior Engineer (US only)"), true);
  assert.equal(titleRestricts("Come build with us: Engineer"), false);
  assert.equal(titleRestricts("Worldwide Backend Engineer, EU or Asia"), false);
});

test("registry details are stripped from employer names", () => {
  assert.equal(cleanCompany("Codest Ltd. Company No. 12590542, VAT number: GB363431020"), "Codest Ltd");
  assert.equal(cleanCompany("  Acme  "), "Acme");
});

test("Afghan language detection needs language context for the word dari", () => {
  assert.deepEqual(detectAfghanLanguages("Fluent in Dari and Pashto"), ["Dari", "Pashto"]);
  assert.deepEqual(detectAfghanLanguages("Native Dari speaker"), ["Dari"]);
  assert.deepEqual(detectAfghanLanguages("Lowongan kerja dari rumah"), []);
  assert.deepEqual(detectAfghanLanguages("Farsi required"), ["Persian"]);
  assert.deepEqual(detectAfghanLanguages("Persian rug designer"), []);
});

test("salary formatting never invents a unit", () => {
  assert.equal(formatSalary(90000, 120000, "USD", "year"), "90,000 - 120,000 USD per year");
  assert.equal(formatSalary(null, null), null);
  assert.equal(formatSalary(40, 0, "USD", "hourly"), "40 USD per hour");
});

test("a worldwide remote engineering job is published with remote metadata", () => {
  const job = buildRemoteJob({
    source: "remoteok",
    url: "https://remoteok.com/remote-jobs/1",
    title: "Senior Backend Engineer",
    company: "Acme",
    restriction: "Worldwide",
    descriptionHtml: "<p>Build APIs in Python and PostgreSQL. Fluent English and Dari a plus.</p>",
    postedAt: 1791956710,
  }, { now: NOW });

  assert.equal(job.work_mode, "remote");
  assert.equal(job.remote_scope, "worldwide");
  assert.equal(job.location, "Remote · Open worldwide");
  assert.deepEqual(job.languages, ["Dari"]);
  assert.equal(job.post_date, "2026-10-14");
  const [published] = prepareRecords([job], { now: NOW });
  assert.equal(published.relevance.decision, "include");
  assert.deepEqual(published.skills, ["Python", "PostgreSQL"]);
});

test("restricted or non-technical remote listings are not published", () => {
  const restricted = buildRemoteJob({
    source: "remoteok", url: "https://remoteok.com/remote-jobs/2", title: "Senior Backend Engineer",
    company: "Acme", restriction: "USA only", description: "Python APIs",
  }, { now: NOW });
  const recruiter = buildRemoteJob({
    source: "remoteok", url: "https://remoteok.com/remote-jobs/3", title: "Technical Recruiter",
    company: "Acme", restriction: "Worldwide", description: "Hire software engineers who write code in Python.",
  }, { now: NOW });
  assert.equal(restricted.remote_scope, null);
  assert.deepEqual(prepareRecords([restricted, recruiter], { now: NOW }), []);
});
