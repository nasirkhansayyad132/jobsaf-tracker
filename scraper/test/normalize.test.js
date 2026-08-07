const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractApplicationSubject,
  extractMailtoEmails,
  extractPhones,
  normalizeJob,
  normalizePhone,
  parseClosingDate,
} = require("../lib/normalize");

test("normalizes real calendar dates and rejects impossible dates", () => {
  assert.equal(parseClosingDate("2026-07-23 08:26:40.9+00"), "2026-07-23");
  assert.equal(parseClosingDate("5 August, 2026"), "2026-08-05");
  assert.equal(parseClosingDate("August 5, 2026"), "2026-08-05");
  assert.equal(parseClosingDate("30-12-2025"), "2025-12-30");
  assert.equal(parseClosingDate("31/02/2026"), null);
});

test("post dates are promoted to a canonical top-level date", () => {
  const fromInput = normalizeJob({
    source: "jobs.af",
    url: "https://jobs.af/jobs/1",
    title: "Software Engineer",
    post_date: "2026-07-23 08:26:40.9+00",
  }, { now: "2026-08-05T00:00:00Z" });
  assert.equal(fromInput.post_date, "2026-07-23");

  const fromDetails = normalizeJob({
    source: "acbar",
    url: "https://acbar.org/jobs/1",
    title: "Software Engineer",
    details: { "Post Date": "Aug 04, 2026" },
  }, { now: "2026-08-05T00:00:00Z" });
  assert.equal(fromDetails.post_date, "2026-08-04");
});

test("phone extraction keeps Afghan phones and rejects IPs, ranges, dates, and references", () => {
  const text = [
    "Call +93 70 123 4567 or 020 293 0024.",
    "Server: 178.18.249.112",
    "Salary: 8000 - 12000",
    "Reference: 0408026001 8",
    "Vacancy Number: 070 555 4444",
    "Date: 2026-08-05",
  ].join("\n");
  assert.deepEqual(extractPhones(text), ["+93701234567", "+93202930024"]);
  assert.equal(normalizePhone("0093 (79) 123-4567"), "+93791234567");
  assert.equal(normalizePhone("178.18.249.112"), null);
  assert.equal(normalizePhone("0 8000 - 12000"), null);
  assert.deepEqual(extractPhones("Vacancy Number: 070 555 4444"), []);
});

test("normalizeJob revalidates supplied phone arrays", () => {
  const job = normalizeJob({
    source: "jobs.af",
    url: "https://jobs.af/jobs/2",
    title: "Network Engineer",
    apply_phones: ["178.18.249.112", "070 123 4567", "0408026001 8"],
  }, { now: "2026-08-05T00:00:00Z" });
  assert.deepEqual(job.apply_phones, ["+93701234567"]);
});

test("phone extraction never joins a vacancy reference to a date on the next detail line", () => {
  const job = normalizeJob({
    source: "jobs.af",
    url: "https://jobs.af/jobs/2b",
    title: "Network Engineer",
    details: {
      Reference: "AUB/EA/VA/026-034",
      "Post Date": "2026-08-01 00:00:00+00",
    },
  }, { now: "2026-08-05T00:00:00Z" });
  assert.deepEqual(job.apply_phones, []);
});

test("extracts exact and reference-based application subjects without calling templates exact", () => {
  assert.deepEqual(
    extractApplicationSubject("Subject Line Must be: Application – Senior Developer (DEV-1)", {}, "Senior Developer"),
    { value: "Application – Senior Developer (DEV-1)", type: "exact" }
  );
  assert.deepEqual(
    extractApplicationSubject(
      "Please mention the Vacancy Number in the email subject line.",
      { "Vacancy Number": "DEV-2" },
      "Developer"
    ),
    { value: "DEV-2", type: "reference" }
  );
  assert.deepEqual(
    extractApplicationSubject(
      "Include the position title and reference number in the subject line.",
      { Reference: "DEV-3" },
      "PHP Developer"
    ),
    { value: "PHP Developer + DEV-3", type: "title_template" }
  );
});

test("normalizes application method from the real application channel", () => {
  const email = normalizeJob({
    source: "jobs.af",
    url: "https://jobs.af/jobs/3",
    title: "Software Engineer",
    apply_url: "mailto:Jobs@Example.com",
  }, { now: "2026-08-05T00:00:00Z" });
  assert.equal(email.application_method, "email");
  assert.deepEqual(email.apply_emails, ["jobs@example.com"]);

  const unknown = normalizeJob({
    source: "acbar",
    url: "https://acbar.org/jobs/3",
    title: "Software Engineer",
    apply_url: "https://acbar.org/jobs/3",
  }, { now: "2026-08-05T00:00:00Z" });
  assert.equal(unknown.application_method, "unknown");
});

test("requires real recipients in mailto application URLs", () => {
  for (const applyUrl of ["mailto:", "mailto:not-an-email", "mailto:?subject=Application"]) {
    const job = normalizeJob({
      source: "jobs.af",
      url: "https://jobs.af/jobs/invalid-mailto",
      title: "Software Engineer",
      application_method: "email",
      apply_url: applyUrl,
    }, { now: "2026-08-07T00:00:00Z" });
    assert.equal(job.apply_url, null, applyUrl);
    assert.deepEqual(job.apply_emails, [], applyUrl);
    assert.equal(job.application_method, "unknown", applyUrl);
  }
});

test("preserves valid encoded and multi-recipient mailto application URLs", () => {
  const applyUrl = "mailto:Jobs%40Example.com,HR%40Example.org?subject=Application";
  const job = normalizeJob({
    source: "jobs.af",
    url: "https://jobs.af/jobs/valid-mailto",
    title: "Software Engineer",
    apply_url: applyUrl,
  }, { now: "2026-08-07T00:00:00Z" });

  assert.deepEqual(extractMailtoEmails(applyUrl), ["jobs@example.com", "hr@example.org"]);
  assert.equal(job.apply_url, applyUrl);
  assert.deepEqual(job.apply_emails, ["jobs@example.com", "hr@example.org"]);
  assert.equal(job.application_method, "email");
});

test("does not turn an unbacked Jobs.af link label into a web application", () => {
  const job = normalizeJob({
    source: "jobs.af",
    url: "https://jobs.af/jobs/procurement-bidding-specialist",
    source_url: "https://jobs.af/jobs/procurement-bidding-specialist",
    title: "Procurement Bidding Specialist",
    apply_url: null,
    details: { "Submission Through": "link" },
  }, { now: "2026-08-07T00:00:00Z" });

  assert.equal(job.apply_url, null);
  assert.equal(job.application_method, "unknown");
  assert.equal(job.source_url, "https://jobs.af/jobs/procurement-bidding-specialist");
});

test("falls through inconsistent declared application methods to backed channels", () => {
  const cases = [
    {
      name: "unbacked web declaration with an email",
      input: { application_method: "web", apply_emails: ["jobs@example.com"] },
      expected: "email",
    },
    {
      name: "unbacked email declaration with a web form",
      input: { application_method: "email", apply_url: "https://apply.example.com/jobs/1" },
      expected: "web",
    },
    {
      name: "unbacked phone declaration without another channel",
      input: { application_method: "phone" },
      expected: "unknown",
    },
    {
      name: "unknown declaration with a normalized phone",
      input: { application_method: "unknown", apply_phones: ["070 123 4567"] },
      expected: "phone",
    },
    {
      name: "web declaration backed only by the listing URL",
      input: {
        application_method: "web",
        apply_url: "https://jobs.af/jobs/1",
      },
      expected: "unknown",
    },
  ];

  for (const { name, input, expected } of cases) {
    const job = normalizeJob({
      source: "jobs.af",
      url: "https://jobs.af/jobs/1",
      source_url: "https://jobs.af/jobs/1",
      title: "Software Engineer",
      ...input,
    }, { now: "2026-08-07T00:00:00Z" });
    assert.equal(job.application_method, expected, name);
  }
});

test("preserves declared application methods when normalized evidence backs them", () => {
  const cases = [
    {
      application_method: "web",
      apply_url: "https://apply.example.com/jobs/2",
      expected: "web",
    },
    {
      application_method: "email",
      apply_emails: ["Recruitment@Example.com"],
      expected: "email",
    },
    {
      application_method: "phone",
      apply_phones: ["0093 (79) 123-4567"],
      expected: "phone",
    },
  ];

  for (const input of cases) {
    const job = normalizeJob({
      source: "jobs.af",
      url: "https://jobs.af/jobs/2",
      title: "Software Engineer",
      ...input,
    }, { now: "2026-08-07T00:00:00Z" });
    assert.equal(job.application_method, input.expected);
  }
});

test("migrates legacy ACBAR job aliases to the current reachable route", () => {
  const normalized = normalizeJob({
    source: "acbar",
    url: "https://www.acbar.org/jobs/131005/software-developer.jsp",
    source_url: "https://www.acbar.org/jobs/131005/software-developer.jsp",
    title: "Software Developer",
  });
  assert.equal(normalized.url, "https://www.acbar.org/en/jobs/details/131005/software-developer");
  assert.equal(normalized.source_url, normalized.url);
});
