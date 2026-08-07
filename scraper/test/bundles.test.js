const assert = require("node:assert/strict");
const test = require("node:test");
const { expandBundledJob, splitStructuredRoles } = require("../lib/bundles");
const { prepareRecords } = require("../scrape_all");

const NOW = "2026-08-07T04:30:00Z";

function bundle(overrides = {}) {
  return {
    source: "jobs.af",
    source_url: "https://jobs.af/jobs/multiple-positions",
    url: "https://jobs.af/jobs/multiple-positions",
    title: "Call for CV - Multiple Positions",
    company: "Example Co",
    location: "Kabul",
    closing_date: "2026-09-30",
    vacancies: 3,
    application_method: "email",
    application_subject: "BUNDLE-7",
    application_subject_type: "reference",
    apply_url: "mailto:jobs@example.com",
    apply_emails: ["jobs@example.com"],
    description: [
      "Role Summary",
      "Applications are invited for several positions.",
      "1. CHEF – 2 POSITIONS",
      "Prepare meals and maintain the kitchen.",
      "Requirements:",
      "Hospitality experience.",
      "2. IT SPECIALIST – 1 POSITION",
      "Maintain computers, networks, backups, and cybersecurity controls.",
      "Requirements:",
      "Degree in Computer Science or Information Technology.",
      "Job Requirements",
      "Candidates must be eligible to work in Afghanistan.",
      "Submission Guidelines",
      "Use the reference number in the subject line.",
    ].join("\n"),
    details: { Reference: "BUNDLE-7" },
    scraped_at: NOW,
    ...overrides,
  };
}

test("structured same-line vacancy headings split a mixed listing into role records", () => {
  const roles = splitStructuredRoles(bundle().description);
  assert.deepEqual(roles.map(role => [role.title, role.vacancies]), [
    ["CHEF", 2],
    ["IT SPECIALIST", 1],
  ]);
  assert.match(roles[0].description, /Prepare meals/);
  assert.doesNotMatch(roles[0].description, /Maintain computers/);
  assert.match(roles[0].description, /Candidates must be eligible/);
  assert.match(roles[1].description, /Maintain computers/);
});

test("next-line vacancy counts and role references are parsed from ACBAR-style bundles", () => {
  const roles = splitStructuredRoles([
    "Job Summary",
    "Telecom careers.",
    "I. NETWORK OPERATIONS CENTER (NOC)",
    "1. System Administrator (Core Network & Infrastructure)",
    "Positions: 01",
    "Location: Kabul",
    "Reference: NOC-SYS-ADM-02",
    "Configure routers, firewalls, VLANs, BGP and Linux servers.",
    "II. ADMINISTRATIVE DIVISION",
    "2. Administrative Assistant",
    "Positions: 03",
    "Reference: ADM-AA-06",
    "Maintain office records and logistics.",
    "Job Requirements",
    "General eligibility applies.",
  ].join("\n"));

  assert.equal(roles.length, 2);
  assert.equal(roles[0].reference, "NOC-SYS-ADM-02");
  assert.equal(roles[0].vacancies, 1);
  assert.doesNotMatch(roles[0].description, /II\. ADMINISTRATIVE/);
  assert.equal(roles[1].reference, "ADM-AA-06");
  assert.equal(roles[1].vacancies, 3);
});

test("bundle expansion creates stable role URLs, IDs, details, and role-specific subjects", () => {
  const expanded = expandBundledJob(bundle({
    application_subject: "Call for CV - Multiple Positions + BUNDLE-7",
    application_subject_type: "title_template",
    description: `${bundle().description}\nState the Position Title and Reference Number in the subject line.`,
  }), { now: NOW });

  assert.equal(expanded.length, 2);
  assert.notEqual(expanded[0].id, expanded[1].id);
  assert.match(expanded[0].url, /\?role=1-chef$/);
  assert.match(expanded[1].url, /\?role=2-it-specialist$/);
  assert.equal(expanded[1].vacancies, 1);
  assert.equal(expanded[1].details["Parent Listing Title"], "Call for CV - Multiple Positions");
  assert.equal(expanded[1].details.Reference, "BUNDLE-7 / role 2");
  assert.equal(expanded[1].application_subject, "Call for CV - Multiple Positions + BUNDLE-7");
});

test("pipeline publishes only the technical roles from a mixed bundle", () => {
  const jobs = prepareRecords([bundle()], { now: NOW });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "IT SPECIALIST");
  assert.equal(jobs[0].vacancies, 1);
  assert.equal(jobs[0].relevance.decision, "include");
  assert.doesNotMatch(jobs[0].description, /Prepare meals/);
});

test("UA Telecom-style bundle preserves five technical roles and all 16 openings", () => {
  const record = bundle({
    source: "acbar",
    source_url: "https://www.acbar.org/en/jobs/details/142738/ua-telecom-careers",
    url: "https://www.acbar.org/en/jobs/details/142738/ua-telecom-careers",
    title: "IT, Technical, Revenue & Administrative Careers | UA Telecom",
    company: "Unique Atlantic Telecommunication",
    category: "Administration, Information Technology, Telecommunications",
    vacancies: 30,
    description: [
      "Job Summary",
      "Multiple technical and administrative careers.",
      "1. System/Customer Support Officer",
      "Positions: 02",
      "Reference: NOC-SYS-CSO-01",
      "Monitor networks, routers and customer technical incidents. Computer Science degree required.",
      "2. System Administrator (Core Network & Infrastructure)",
      "Positions: 01",
      "Reference: NOC-SYS-ADM-02",
      "Administer Linux servers, firewalls, BGP, OSPF and VLANs.",
      "3. Microwave Technician",
      "Positions: 01",
      "Reference: TECH-MW-03",
      "Install microwave links and conduct RF testing.",
      "4. Field IT Technician (ISP Operations)",
      "Positions: 10",
      "Reference: TECH-FIT-04",
      "Install wireless, VSAT, routers, switches and customer LAN systems.",
      "5. Field Technician – ISP (Tower Site)",
      "Positions: 02",
      "Reference: TECH-TWR-05",
      "Maintain ISP wireless infrastructure and support NOC outage resolution. Information Technology degree required.",
      "6. Administrative Assistant",
      "Positions: 03",
      "Reference: ADM-AA-06",
      "Maintain office records, procurement and logistics.",
      "Job Requirements",
      "Requirements differ by position.",
    ].join("\n"),
    details: { "Vacancy Number": "UAT-ALL", Category: "Information Technology, Administration" },
  });

  const jobs = prepareRecords([record], { now: NOW });
  assert.deepEqual(jobs.map(job => job.title), [
    "System/Customer Support Officer",
    "System Administrator (Core Network & Infrastructure)",
    "Microwave Technician",
    "Field IT Technician (ISP Operations)",
    "Field Technician – ISP (Tower Site)",
  ]);
  assert.equal(jobs.reduce((total, job) => total + Number(job.vacancies), 0), 16);
  assert.equal(jobs.some(job => job.title === "Administrative Assistant"), false);
});

test("ordinary numbered requirements are not mistaken for bundled vacancies", () => {
  const record = bundle({
    title: "Software Engineer",
    description: "1. Build APIs\n2. Maintain databases\n3. Write tests",
  });
  const expanded = expandBundledJob(record, { now: NOW });
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].title, "Software Engineer");
});

test("a role without its own count cannot borrow the next role's vacancies", () => {
  const roles = splitStructuredRoles([
    "1. Software Engineer",
    "2. Network Engineer",
    "Positions: 02",
    "3. Database Engineer",
    "Positions: 01",
  ].join("\n"));

  assert.deepEqual(roles.map(role => [role.title, role.vacancies]), [
    ["Network Engineer", 2],
    ["Database Engineer", 1],
  ]);
});
