# Afghanistan Tech Jobs

A public, multi-source tracker for software, IT, data, networking, cybersecurity,
telecom, and computer-science opportunities in Afghanistan, plus remote
technology roles that people living in Afghanistan can apply for.

The project combines a deterministic Node.js scraper, a validated JSON feed,
an accessible React PWA, optional email digests, and GitHub Actions automation.

## How it works

```text
Afghanistan: Jobs.af · ACBAR · Kaarobar · Wazifaha · Impactpool · ReliefWeb*
Remote:      Himalayas · We Work Remotely · Remote OK · Remotive · Jobicy · Working Nomads
                  │
                  ▼
     fetch → enrich → normalize → score relevance → remote eligibility
                  │
                  ▼
   deduplicate (exact + fuzzy) → group variants → reconcile lifecycle → validate
                  │
                  ▼
        docs/data/jobs.json + summary.json
               ┌──┴──┐
               ▼     ▼
          React PWA  email digest
```

\* ReliefWeb runs once a free API appname is configured (see below).

The production site is intentionally public. GitHub Pages and the published
JSON feed are public, so a client-side password cannot provide private access.
A genuinely private deployment would require an authenticated backend and a
private data store.

## What the tracker does well

- Collects full job details from six Afghan job boards and UN/NGO portals and
  six remote boards instead of trusting list-page titles alone.
- Publishes remote roles only when someone in Afghanistan can apply, and
  highlights roles that ask for Dari or Pashto.
- Merges the same vacancy across boards even when the employer or title is
  spelled differently, and shows per-province copies of one posting as a
  single card.
- Keeps working when sources fail: each source has a time limit, a collapsed
  source keeps its last good jobs, a dependency advisory never stops the
  daily refresh, and a broken run opens a GitHub issue automatically.
- Uses timeout-aware, status-aware retries with exponential backoff, jitter,
  and `Retry-After` support.
- Scores relevance from title, category, functional area, technical duties,
  and explicit computing-degree requirements. Employer names never affect the
  score.
- Excludes medical, finance, audit, cashier, generic administration, customer
  service, and pure design/social/content roles even when their employer has a
  technical-sounding name.
- Stores an explanation with every inclusion under `relevance.reasons`.
- Lets fresh source data update deadlines and descriptions while retaining
  `first_seen_at` and advancing `last_seen_at`.
- Merges same-URL jobs, stable vacancy references, and confident cross-source
  duplicates while preserving alternate source links.
- Preserves last-known-good data during source outages and refuses corrupt,
  empty, or suspiciously collapsed output.
- Writes JSON and CSV through validated temporary files.
- Normalizes posting/closing dates, Afghan phone numbers, application channels,
  and subject-line confidence.
- Provides search, open/recent/expiring views, normalized technology categories,
  collapsed-on-demand company/location/salary/vacancy filters, useful sorting,
  deep-linked job details, safely structured descriptions, reliable application
  guidance, offline cached data, and keyboard-accessible dialogs.

## Relevance policy

The tracker targets technical work, not every vacancy at a technology company.

Strong examples include:

- software, web, mobile, and API development;
- data engineering, analytics, databases, AI, and machine learning;
- systems, networks, cloud, DevOps, IT support, and cybersecurity;
- technical ICT/telecom roles; and
- computer-science or software-engineering teaching roles.

Pure graphic design, video/content creation, social media, digital marketing,
data entry, and non-technical business roles are outside the default scope.
An explicit Computer Science, Software Engineering, IT, Information Systems,
cybersecurity, data-science, or related computing degree adds supporting
evidence to an ambiguous technical title/category. A degree mention cannot
qualify a generic role by itself or override a clearly non-technical title.
Rules and regression fixtures live in `scraper/lib/keywords.js` and
`scraper/test/fixtures/relevance.json`.

Each published job has:

```json
"relevance": {
  "version": 2,
  "score": 80,
  "threshold": 55,
  "decision": "include",
  "reasons": ["title: “software developer” (+80)"]
}
```

## Remote jobs

Remote boards list thousands of roles, most limited to a few countries. A
remote role is published only when it passes the same technical relevance
rules as local jobs and the listing is open to Afghanistan:

| Eligibility | Meaning |
| --- | --- |
| Open worldwide | “Worldwide”, “Anywhere”, “Global”, or an exclusion list that does not include Afghanistan |
| Open to Afghanistan | The listing names Afghanistan or an Afghan city |
| Open in Asia | Asia, South/Central Asia, or the Middle East (APAC and EMEA are not assumed to include Afghanistan) |
| Time zones include Afghanistan | A stated UTC window covers Kabul (UTC+4:30) |
| Needs Dari/Pashto | No location limit, and the listing asks for Dari, Pashto, or Persian |

A title such as “Backend Developer – Remote from EU” overrides a board's
worldwide label. At most 300 remote roles are published, ordered by
eligibility (Afghan-language and Afghanistan first) and then recency; roles
without a deadline retire after 30 days.

## Recent jobs

“Recent” means posted during the current seven-calendar-day Kabul window. When
a source does not publish a posting date, the UI clearly falls back to the day
the tracker first discovered the job. Supported legacy date formats are
normalized upstream and parsed defensively in the frontend.

## Job discovery and pay data

Publisher categories are preserved in the detail view, but browsing uses a
small role-based technology taxonomy so a bank's software developer is not
misleadingly presented as a banking job. Users can refine by technology focus,
province, company, salary disclosure, and number of openings, then sort by
posting date, deadline, company, or vacancy count. The detailed refinement
controls stay hidden until the user opens them with the **Show filters** button.

Salary wording is shown exactly as published. Values such as “company scale,”
“negotiable,” and “not disclosed” stay distinct. Numeric salary ranking is only
enabled when both currency and pay period are explicit and comparable; the UI
does not invent amounts or compare unlike units.

## Application guidance

The scraper distinguishes `email`, `web`, `phone`, and unknown application
methods. The details screen separates the application link from the original
listing and never labels a `mailto:` link as a website.

Subject confidence is explicit:

- `exact`: the publisher supplied the full subject;
- `reference`: the publisher requires a vacancy/reference value; and
- `title_template`: the publisher requires a title and/or reference, but the
  stored value is guidance rather than a guaranteed exact subject.

When no verified instruction exists, the UI tells the user to check the source
instead of inventing a subject that could cause rejection.

## Repository structure

```text
.
├── frontend/
│   ├── src/                    React UI, components, and frontend tests
│   ├── public/                 PWA icons only; no copied jobs dataset
│   ├── dist/                   local build output, ignored by Git
│   └── vite.config.js          PWA caching and canonical dev-data middleware
├── scraper/
│   ├── sites/                  source adapters
│   ├── lib/                    HTTP, normalization, relevance, dedupe, CSV
│   ├── test/                   deterministic scraper and pipeline tests
│   ├── scrape_all.js           primary multi-source pipeline
│   ├── generate_summary.js     compact public summary generator
│   └── server.js               optional loopback-only local control API
├── docs/
│   ├── data/                   canonical public jobs and summary datasets
│   └── ...                     generated fallback Pages shell
├── scripts/
│   ├── build-pages.mjs         validated Pages artifact builder
│   ├── split-feed.mjs          fast list index + per-job detail files
│   ├── sync-docs-snapshot.mjs  data-preserving fallback-shell updater
│   ├── validate-data.mjs       schema and quality gates
│   └── notify_email.py         optional private-recipient email digest
└── .github/workflows/
    ├── ci.yml                  tests, lint, build, validation, audits
    ├── daily.yml               scrape → validate → publish → deploy/notify
    ├── pages.yml               artifact-based Pages deployment
    └── scrape.yml              isolated manual scraper check
```

`docs/data/jobs.json` is the single canonical public dataset. A normal frontend
build writes only to `frontend/dist`; it cannot clear or replace production
data. During `npm run dev`, Vite serves the canonical data directly through a
development-only middleware.

## Local development

Node.js 24 is used in CI. Start with clean, lockfile-based installs.

### Frontend

```bash
cd frontend
npm ci
npm test
npm run lint
npm run dev
```

Open `http://localhost:5173`. To build the exact validated Pages artifact:

```bash
npm run build:pages
npm run preview
```

### Scraper

```bash
cd scraper
npm ci
npm test
node scrape_all.js \
  --json ../docs/data/jobs.json \
  --csv ../data/jobs.csv \
  --debug-dir debug \
  --max-pages 50
```

Re-normalize, re-score, and deduplicate the current dataset without network
requests:

```bash
node scrape_all.js \
  --json ../docs/data/jobs.json \
  --csv ../data/jobs.csv \
  --reprocess-only
```

Regenerate and validate the compact summary:

```bash
node generate_summary.js \
  ../docs/data/jobs.json \
  ../docs/data/summary.json

cd ..
node scripts/validate-data.mjs \
  docs/data/jobs.json \
  docs/data/summary.json \
  --min-jobs 10 \
  --min-sources 3 \
  --max-expired 0 \
  --require-relevance
```

### Optional local scraper API

```bash
cd scraper
node server.js
```

It binds to `127.0.0.1:3001` by default. Exposing another interface requires
both `SCRAPER_HOST` and `SCRAPER_API_TOKEN`. The public frontend does not depend
on this server. Local API runs scan up to 50 listing pages by default; set
`SCRAPER_MAX_PAGES` only when intentionally testing a different guarded cap.

## GitHub Pages deployment

In repository **Settings → Pages**, select **GitHub Actions** as the publishing
source. `.github/workflows/pages.yml` then lints, tests, validates, builds, and
deploys an isolated artifact. No generated build needs to overwrite canonical
data.

The repository also keeps a clean fallback shell under `docs/`. Update it only
with the guarded command below; the script verifies that both canonical data
files remain byte-for-byte unchanged:

```bash
cd frontend
npm run build:docs-snapshot
```

## Daily automation and email

The daily workflow is scheduled for 04:30 UTC (09:00 Kabul). GitHub controls the
actual start time, so the schedule is a target rather than a real-time promise.

The scrape job has read-only repository access. Only a separate publish job can
write the three validated publication files. If code reached `main` during the
scrape, the data is still published on top of it; if newer *data* reached
`main`, the older artifact is refused. The same workflow then calls the Pages
workflow with the exact validated artifact and the newest site code, so
deployment does not depend on a bot commit triggering a second workflow.
Notification failure is visible without undoing already validated data
publication.

Reliability safeguards:

- `npm audit` is advisory in scheduled runs and blocking in CI, and Dependabot
  opens weekly dependency updates, so a newly published advisory cannot freeze
  the data again.
- A failing run opens a **“Daily job refresh is failing”** issue (GitHub
  notifies the repository owner); the next healthy run closes it.
- Each source must finish within 15 minutes, all sources share a bounded
  number of concurrent requests, and a source whose count collapses keeps its
  last good jobs while the others publish.
- The site warns visitors when the data is more than 36 hours old and lists
  every source's status from the last refresh.

Optional repository secrets:

| Secret | Purpose |
| --- | --- |
| `SMTP_HOST` | SMTP host; defaults to `smtp.gmail.com` |
| `SMTP_PORT` | SMTP SSL port; defaults to `465` |
| `SMTP_USER` | SMTP login and sender |
| `SMTP_PASS` | SMTP password or app password |
| `EMAIL_TO` | One address or a comma-separated recipient list |

Multiple recipients are sent through an undisclosed-recipient header so the
subscriber list is not exposed to other recipients.

Optional ReliefWeb source: ReliefWeb only serves its API to registered
applications. Request a free appname at
<https://apidoc.reliefweb.int/parameters#appname> and save it as the
repository variable (or secret) `RELIEFWEB_APPNAME`; the source is skipped
until then.

## Data contract

The complete feed is an array of normalized job objects. Important fields are:

```json
{
  "id": "stable-id",
  "source": "jobs.af",
  "source_url": "https://source.example/job",
  "url": "https://source.example/job",
  "title": "Software Engineer",
  "company": "Example",
  "location": "Kabul",
  "post_date": "2026-08-04",
  "closing_date": "2026-08-20",
  "category": "Information Technology",
  "application_method": "email",
  "application_subject": "REF-42",
  "application_subject_type": "reference",
  "apply_url": "mailto:jobs@example.org",
  "apply_emails": ["jobs@example.org"],
  "apply_phones": ["+93700123456"],
  "first_seen_at": "2026-08-04T04:30:00Z",
  "last_seen_at": "2026-08-05T04:30:00Z",
  "lifecycle_status": "active",
  "missed_runs": 0,
  "relevance": {
    "version": 2,
    "score": 80,
    "threshold": 55,
    "decision": "include",
    "reasons": ["title: “software engineer” (+80)"]
  },
  "also_found_on": [],
  "work_mode": "remote",
  "remote_scope": "worldwide",
  "remote_regions": "Anywhere in the World",
  "languages": ["Dari"],
  "skills": ["Python", "PostgreSQL"],
  "group_id": null
}
```

`work_mode` is `remote`, `hybrid`, `onsite`, or `null`; every remote job states
who may apply in `remote_scope`. Postings that share a `group_id` are copies of
one role (for example one per province) and are shown as a single card.

The Pages build also derives `data/jobs-index.json` (every job without its
description, loaded first) and `data/jobs/<id>.json` (one full job, loaded when
opened), so the list renders from a small download on slow connections.

`summary.json` contains counts, source freshness, per-source health from the
last run, and job IDs only. Email
rendering hydrates those IDs from `jobs.json` in memory, avoiding a second copy
of every public job description and contact in the repository.

## Safety and limitations

- Scraped information can be incomplete or changed by the publisher. Always
  confirm eligibility, deadline, documents, and application instructions on
  the original listing.
- Source HTML and APIs change. Adapter failures and unusual count drops are
  blocked and surfaced, but selectors still require maintenance.
- Public job descriptions and publisher-provided application contacts are
  republished in the public feed. Do not add private applicant information.
- Never commit SMTP credentials or `.env` files.

## License

MIT — see [LICENSE](LICENSE).
