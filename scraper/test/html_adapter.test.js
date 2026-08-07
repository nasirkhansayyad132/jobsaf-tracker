const assert = require("node:assert/strict");
const test = require("node:test");
const {
  boundedConcurrency,
  enrichCandidates,
  hasStrongTechnicalTitle,
  reportedPageCount,
  requireDiscoveredJobs,
} = require("../lib/html_adapter");
const acbar = require("../sites/acbar");
const kaarobar = require("../sites/kaarobar");

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

test("only strong technical titles receive a clearly marked summary fallback", async () => {
  const input = [
    { id: 1, url: "https://example.com/jobs/1", title: "SCOPE / ICT Officer", company: "Example Co" },
    { id: 2, url: "https://example.com/jobs/2", title: "Procurement Bidding Specialist", category: "IT" },
    { id: 3, url: "https://example.com/jobs/3", title: "Network Engineer" },
  ];
  const result = await enrichCandidates({
    siteName: "fixture",
    candidates: input,
    enrich: async () => { throw new Error("detail unavailable"); },
    allowStrongTitleFallback: true,
    allowUnsafeResults: true,
  });

  assert.equal(result.detailFailures, 3);
  assert.equal(result.fallbackCount, 1);
  assert.equal(result.unsafeCoverage, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].title, "SCOPE / ICT Officer");
  assert.equal(result.records.some(record => record.id === 3), false);
  assert.equal(result.records[0].application_method, "unknown");
  assert.equal(result.records[0].apply_url, null);
  assert.match(result.records[0].details["Enrichment Status"], /Summary only/);
  assert.equal(hasStrongTechnicalTitle({ title: "Application Officer", category: "IT" }), false);
  assert.equal(hasStrongTechnicalTitle({ title: "Network Engineer" }), true);
  for (const title of [
    "Security Operations Manager",
    "Systems Engineer - HVAC",
    "Application Engineer - Medical Devices",
    "Integration Engineer - Electrical Systems",
  ]) {
    assert.equal(hasStrongTechnicalTitle({ title, category: "IT" }), false, title);
  }
  for (const title of [
    "Software Developer",
    "ICT Officer",
    "Cyber Security Analyst",
    "مهندس شبکه و امنیت سایبری",
  ]) {
    assert.equal(hasStrongTechnicalTitle({ title }), true, title);
  }
});

test("detail starts can be paced even when enrichment is concurrent", async () => {
  const delays = [];
  const result = await enrichCandidates({
    siteName: "fixture",
    candidates: candidates(3),
    concurrency: 3,
    requestGapMs: 25,
    sleep: async delay => { delays.push(delay); },
    enrich: async candidate => candidate,
  });

  assert.equal(result.records.length, 3);
  assert.deepEqual(delays, [25, 25]);
});

test("pagination metadata reveals a cap before later jobs are silently skipped", () => {
  const html = '<a href="/jobs?page=2">2</a><a href="https://example.com/jobs?page=16">Last</a>';
  assert.equal(reportedPageCount(html, 1), 16);
  assert.equal(reportedPageCount("<p>No pagination</p>", 4), null);
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

test("ACBAR preserves page-one discoveries when a later listing page fails", async () => {
  const firstPage = `
    <div class="job-card">
      <a class="job-card__title" href="/en/jobs/details/123/software-engineer">Software Engineer</a>
      <div class="job-card__company">Example Co</div>
      <div class="job-card__meta"><span class="job-pill"><i class="fa fa-map-marker"></i>Kabul</span></div>
    </div>
    <a href="/en/jobs?page=2">Next</a>`;
  const records = await acbar.scrape({
    maxPages: 5,
    concurrency: 1,
    getHtml: async url => {
      if (url.includes("page=2")) throw new Error("temporary listing outage");
      return firstPage;
    },
    enrich: async summary => ({ ...summary, description: "Complete technical detail" }),
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].title, "Software Engineer");
  assert.equal(records.coverage.listingFailures, 1);
  assert.equal(records.coverage.pagesFetched, 1);
  assert.match(records.coverage.listingFailureReason, /page 2 failed/);
});

test("ACBAR without pagination metadata continues until an empty page", async () => {
  const listing = id => `
    <div class="job-card">
      <a class="job-card__title" href="/en/jobs/details/${id}/software-engineer-${id}">Software Engineer ${id}</a>
      <div class="job-card__company">Example Co</div>
    </div>`;
  const requestedPages = [];
  const records = await acbar.scrape({
    maxPages: 5,
    concurrency: 1,
    getHtml: async url => {
      const page = Number(new URL(url).searchParams.get("page") || 1);
      requestedPages.push(page);
      return page <= 3 ? `${listing(page)}<a href="?page=${page}">${page}</a>` : "<p>No jobs</p>";
    },
    enrich: async summary => ({ ...summary, description: "Develop and maintain software applications." }),
  });

  assert.deepEqual(requestedPages, [1, 2, 3, 4]);
  assert.equal(records.length, 3);
  assert.equal(records.coverage.pagesFetched, 4);
  assert.equal(records.coverage.reportedPages, null);
  assert.equal(records.coverage.listingFailures, 0);
});

test("ACBAR refuses an unbounded crawl that reaches max-pages with new jobs", async () => {
  await assert.rejects(
    acbar.scrape({
      maxPages: 2,
      getHtml: async url => {
        const page = Number(new URL(url).searchParams.get("page") || 1);
        return `<div class="job-card"><a class="job-card__title" href="/en/jobs/details/${page}/it-${page}">IT Officer ${page}</a><div class="job-card__company">Example Co</div></div>`;
      },
      enrich: async summary => summary,
    }),
    /reached max-pages 2 without a verified pagination end/,
  );
});

test("ACBAR still fails when the first listing page is unavailable", async () => {
  await assert.rejects(
    acbar.scrape({ getHtml: async () => { throw new Error("first page offline"); } }),
    /first page offline/,
  );
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

test("Kaarobar discovery accepts absolute job URLs and ignores apply links", () => {
  const html = `
    <ul class="post-job-bx"><li class="_li">
      <a href="/jobs/apply/321/software-engineer">Apply</a>
      <div class="job-post-info">
        <h6><a href="https://www.kaarobar.net/jobs/321/software-engineer">Software Engineer</a></h6>
        <a href="https://www.kaarobar.net/companies/example">Example Co</a>
      </div>
      <span title="Location">Kabul</span><div class="job-time"><span>Full Time</span></div>
      <span>2026-09-30</span>
    </li></ul>`;
  const jobs = kaarobar.parseList(html);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, "https://www.kaarobar.net/jobs/321/software-engineer");
  assert.equal(jobs[0].company, "Example Co");
});
