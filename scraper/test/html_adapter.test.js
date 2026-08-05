const assert = require("node:assert/strict");
const test = require("node:test");
const { boundedConcurrency, enrichCandidates, requireDiscoveredJobs } = require("../lib/html_adapter");
const acbar = require("../sites/acbar");

function candidates(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    url: `https://example.com/jobs/${index}`,
    title: `Software Engineer ${index}`,
  }));
}

test("HTML source discovery rejects an empty or URL-less listing", () => {
  assert.throws(() => requireDiscoveredJobs("acbar", []), /zero job URLs/);
  assert.throws(() => requireDiscoveredJobs("acbar", [{ title: "Missing URL" }]), /zero job URLs/);
});

test("detail failures are dropped instead of publishing listing summaries", async () => {
  const input = candidates(4);
  const result = await enrichCandidates({
    siteName: "fixture",
    candidates: input,
    concurrency: 3,
    enrich: async candidate => {
      if (candidate.id === 1) throw new Error("detail unavailable");
      return { ...candidate, description: "Complete job detail" };
    },
  });

  assert.equal(result.detailFailures, 1);
  assert.deepEqual(result.records.map(record => record.id), [0, 2, 3]);
  assert.equal(result.records.some(record => record.id === 1), false);
});

test("a high detail failure ratio fails the entire HTML source", async () => {
  await assert.rejects(
    enrichCandidates({
      siteName: "fixture",
      candidates: candidates(10),
      concurrency: 99,
      enrich: async candidate => {
        if (candidate.id < 5) throw new Error("detail unavailable");
        return { ...candidate, description: "Complete job detail" };
      },
    }),
    /failure rate was 5\/10/,
  );
  assert.equal(boundedConcurrency(99), 8);
  assert.equal(boundedConcurrency(0), 4);
});

test("ACBAR parses the current localized card listing", () => {
  const html = `
    <div class="job-card">
      <a class="job-card__title" href="/en/jobs/details/123/software-engineer"> Software Engineer </a>
      <div class="job-card__company">Example Co <span class="job-dot">•</span><span class="job-pill">Full Time</span></div>
      <div class="job-card__meta">
        <span class="job-pill"><i class="fa fa-map-marker"></i> Kabul</span>
        <span class="job-pill"><i class="fa fa-calendar"></i> 2026-09-30</span>
      </div>
    </div>`;
  const jobs = acbar.parseList(html);

  assert.equal(acbar.pageUrl(1), "https://www.acbar.org/en/jobs");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, "https://www.acbar.org/en/jobs/details/123/software-engineer");
  assert.equal(jobs[0].company, "Example Co");
  assert.equal(jobs[0].location, "Kabul");
  assert.equal(jobs[0].closing_date, "2026-09-30");
  assert.equal(jobs[0].job_type, "Full Time");
});

test("ACBAR rejects a 200 response whose detail DOM is not a job page", () => {
  const summary = {
    source: "acbar",
    url: "https://www.acbar.org/en/jobs/details/123/software-engineer",
    title: "Software Engineer",
    company: "Example Co",
  };
  assert.throws(
    () => acbar.parseDetail("<html><body><h1>ACBAR homepage</h1></body></html>", summary),
    /detail page DOM was missing/,
  );
});

test("ACBAR parses current detail signals and application data", () => {
  const html = `
    <div class="acbar-jd">
      <h1 class="acbar-jd__title">Software Engineer</h1>
      <p class="acbar-jd__org">Example Co</p>
      <div class="acbar-jd__info-row"><dt class="acbar-jd__info-term">Category</dt><dd class="acbar-jd__info-desc">Information Technology</dd></div>
      <div class="acbar-jd__info-row"><dt class="acbar-jd__info-term">Published</dt><dd class="acbar-jd__info-desc">2026-08-05</dd></div>
      <div class="acbar-jd__info-row"><dt class="acbar-jd__info-term">Vacancy Number</dt><dd class="acbar-jd__info-desc">DEV-7</dd></div>
      <div class="acbar-jd__info-row"><dt class="acbar-jd__info-term">No of Job</dt><dd class="acbar-jd__info-desc">3</dd></div>
      <p class="acbar-jd__deadline-value">2026-09-30</p>
      <article class="acbar-jd__card"><h2 class="acbar-jd__card-title">Job Summary</h2><div class="acbar-jd__rich"><p>Build and maintain web software.</p></div></article>
      <article class="acbar-jd__card"><h2 class="acbar-jd__card-title">Submission Guideline</h2><div class="acbar-jd__rich"><p>Email jobs@example.com and mention the Vacancy Number in the subject line.</p></div></article>
      <p class="acbar-jd__email">jobs@example.com</p>
    </div>`;
  const job = acbar.parseDetail(html, {
    source: "acbar",
    url: "https://www.acbar.org/en/jobs/details/123/software-engineer",
    title: "Software Engineer",
    company: "Example Co",
  });

  assert.equal(job.title, "Software Engineer");
  assert.equal(job.category, "Information Technology");
  assert.equal(job.post_date, "2026-08-05");
  assert.equal(job.closing_date, "2026-09-30");
  assert.equal(job.vacancies, "3");
  assert.deepEqual(job.apply_emails, ["jobs@example.com"]);
  assert.equal(job.application_subject, "DEV-7");
  assert.equal(job.application_subject_type, "reference");
});
