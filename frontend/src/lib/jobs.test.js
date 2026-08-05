import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getApplicationInfo,
    getAfghanistanToday,
    getCategoryFacet,
    getComparableSalary,
    getJobFacets,
    getJobStats,
    getLocationFacet,
    getPostDate,
    getPostDateRaw,
    getSalaryKind,
    getSalaryText,
    getVacancyCount,
    formatVacancyCount,
    needsFreshnessCheck,
    getReadableMatchReasons,
    getTechLabels,
    isRecentJob,
    parseCalendarDate,
    selectJobs,
} from './jobs.js';

function dateParts(date) {
    return date && [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

test('parseCalendarDate accepts scraper date variants without timezone day shifts', () => {
    assert.deepEqual(dateParts(parseCalendarDate('2026-08-04')), [2026, 8, 4]);
    assert.deepEqual(dateParts(parseCalendarDate('2026-08-04 23:59:59.123+00')), [2026, 8, 4]);
    assert.deepEqual(dateParts(parseCalendarDate('2026-08-04T23:59:59Z')), [2026, 8, 4]);
    assert.deepEqual(dateParts(parseCalendarDate('Aug 4, 2026')), [2026, 8, 4]);
    assert.deepEqual(dateParts(parseCalendarDate('4 August 2026')), [2026, 8, 4]);
    assert.equal(parseCalendarDate('2026-02-31'), null);
    assert.equal(parseCalendarDate('not a date'), null);
});

test('Afghanistan today follows Kabul calendar boundaries', () => {
    const kabulAfterMidnight = getAfghanistanToday(new Date('2026-08-04T20:00:00Z'));
    assert.deepEqual(dateParts(kabulAfterMidnight), [2026, 8, 5]);
});

test('post date resolution prefers normalized fields and supports first_seen_at', () => {
    assert.equal(getPostDateRaw({ post_date: '2026-08-04', first_seen_at: '2026-08-03' }), '2026-08-04');
    assert.equal(getPostDateRaw({ first_seen_at: '2026-08-03', details: { 'Post Date': '2026-08-02' } }), '2026-08-02');
    assert.equal(getPostDateRaw({ first_seen_at: '2026-08-03' }), '2026-08-03');
    assert.equal(getPostDateRaw({ details: { 'Post Date': '2026-08-02 10:20:30+00' } }), '2026-08-02 10:20:30+00');
    assert.deepEqual(
        dateParts(getPostDate({ details: { 'Post Date': 'N/A' }, first_seen_at: '2026-08-04T20:00:00Z' })),
        [2026, 8, 5],
    );
});

test('recent jobs use an inclusive seven-calendar-day window', () => {
    const now = new Date(2026, 7, 5, 23, 30);
    assert.equal(isRecentJob({ post_date: '2026-08-05' }, now), true);
    assert.equal(isRecentJob({ post_date: '2026-07-30 00:01:00+00' }, now), true);
    assert.equal(isRecentJob({ post_date: '2026-07-29' }, now), false);
    assert.equal(isRecentJob({ post_date: '2026-08-06' }, now), false);
});

test('statistics count only open jobs and recognize normalized recent dates', () => {
    const now = new Date(2026, 7, 5, 12);
    const jobs = [
        { title: 'A', closing_date: '2026-08-05', post_date: '2026-08-04' },
        { title: 'B', closing_date: '2026-08-08', details: { 'Post Date': '2026-08-01 08:20:00+00' } },
        { title: 'C', closing_date: '2026-08-09', post_date: '2026-07-01' },
        { title: 'D', closing_date: '2026-08-04', post_date: '2026-08-04' },
        { title: 'E' },
        { title: 'F', active: false },
    ];

    assert.deepEqual(getJobStats(jobs, now), { total: 4, expiring: 2, recent: 2 });
});

test('freshness warnings use source capture time and lifecycle state', () => {
    const now = new Date(2026, 7, 5, 12);
    assert.equal(needsFreshnessCheck({ last_seen_at: '2026-08-01T10:00:00Z' }, now), false);
    assert.equal(needsFreshnessCheck({ last_seen_at: '2026-07-01T10:00:00Z' }, now), true);
    assert.equal(needsFreshnessCheck({ lifecycle_status: 'source_unavailable', last_seen_at: '2026-08-05T00:00:00Z' }, now), true);
});

test('selectJobs searches details by every term and sorts status views', () => {
    const now = new Date(2026, 7, 5, 12);
    const jobs = [
        {
            title: 'Network Engineer',
            company: 'Example',
            location: 'Kabul',
            closing_date: '2026-08-08',
            post_date: '2026-08-01',
            details: { Category: 'Information Technology' },
        },
        {
            title: 'Backend Developer',
            company: 'Example',
            location: 'Herat',
            closing_date: '2026-08-06',
            post_date: '2026-08-04',
            details: { Skills: 'Node.js PostgreSQL' },
        },
    ];

    assert.equal(selectJobs(jobs, { query: 'node postgre', now })[0]?.title, 'Backend Developer');
    assert.deepEqual(
        selectJobs(jobs, { filter: 'recent', now }).map(job => job.title),
        ['Backend Developer', 'Network Engineer'],
    );
    assert.deepEqual(
        selectJobs(jobs, { filter: 'expiring', now }).map(job => job.title),
        ['Backend Developer', 'Network Engineer'],
    );
});

test('vacancy helpers normalize source types without guessing from unrelated numbers', () => {
    assert.equal(getVacancyCount({ vacancies: 4 }), 4);
    assert.equal(getVacancyCount({ vacancies: '16 positions' }), 16);
    assert.equal(getVacancyCount({ details: { 'No. of Jobs': '4 (four)' } }), 4);
    assert.equal(getVacancyCount({ vacancies: '2-4 depending on funding' }), null);
    assert.equal(formatVacancyCount({ vacancies: '1' }), '1 opening');
    assert.equal(formatVacancyCount({ vacancies: '6' }), '6 openings');
});

test('salary helpers preserve source wording and compare only explicit compatible units', () => {
    assert.equal(getSalaryText({ salary: '  Company salary scale  ' }), 'Company salary scale');
    assert.equal(getSalaryKind({ salary: 'Company salary scale' }), 'scale');
    assert.equal(getSalaryKind({ salary: 'Negotiable' }), 'negotiable');
    assert.equal(getSalaryKind({ salary: 'Not disclosed' }), 'undisclosed');
    assert.deepEqual(getComparableSalary({ salary: 'AFN 20,000 - 30,000 per month' }), {
        minimum: 20000,
        maximum: 30000,
        currency: 'AFN',
        period: 'month',
    });
    assert.equal(getComparableSalary({ salary: '30,000 AFN' }), null);
    assert.equal(getComparableSalary({ salary: 'USD 500 per month plus AFN allowance' }), null);
});

test('technology and location facets are normalized independently of publisher categories', () => {
    assert.equal(
        getCategoryFacet({ title: 'Full-Stack Developer', category: 'Banking' }),
        'Software development',
    );
    assert.equal(
        getCategoryFacet({ title: 'Deputy Network Manager', category: 'Banking' }),
        'Networking, telecom & security',
    );
    assert.equal(
        getCategoryFacet({ title: 'Chief Information Technology Officer' }),
        'IT leadership & delivery',
    );
    assert.deepEqual(getLocationFacet({ location: 'Balkh, Herat, Kabul, Afghanistan' }), [
        'Balkh',
        'Herat',
        'Kabul',
    ]);
});

test('job facets report honest salary and opening groups', () => {
    const now = new Date(2026, 7, 5, 12);
    const jobs = [
        { title: 'Backend Developer', company: 'Beta', location: 'Kabul, Afghanistan', closing_date: '2026-08-20', vacancies: 1, salary: 'Company scale' },
        { title: 'Network Engineer', company: 'Alpha', location: 'Herat, Kabul', closing_date: '2026-08-19', vacancies: '4', salary: 'Negotiable' },
        { title: 'IT Technician', company: 'Gamma', location: 'Balkh', closing_date: '2026-08-18', vacancies: 12, salary: 'Not disclosed' },
    ];
    const facets = getJobFacets(jobs, now);

    assert.deepEqual(facets.companies, ['Alpha', 'Beta', 'Gamma']);
    assert.deepEqual(facets.locations, ['Balkh', 'Herat', 'Kabul']);
    assert.deepEqual(facets.salary, {
        listed: 2,
        comparable: 0,
        canSort: false,
        undisclosed: 1,
        scale: 1,
        negotiable: 1,
        other: 0,
    });
    assert.equal(facets.vacancies.single, 1);
    assert.equal(facets.vacancies.twoToFive, 1);
    assert.equal(facets.vacancies.elevenPlus, 1);
});

test('selectJobs combines facets and supports useful non-salary sorting', () => {
    const now = new Date(2026, 7, 5, 12);
    const jobs = [
        { title: 'Backend Developer', company: 'Beta', location: 'Kabul', closing_date: '2026-08-20', post_date: '2026-08-04', vacancies: 1, salary: 'Company scale' },
        { title: 'Network Engineer', company: 'Alpha', location: 'Herat, Kabul', closing_date: '2026-08-19', post_date: '2026-08-01', vacancies: 4, salary: 'Negotiable' },
        { title: 'IT Technician', company: 'Gamma', location: 'Balkh', closing_date: '2026-08-18', post_date: '2026-08-03', vacancies: 12, salary: 'Not disclosed' },
    ];

    assert.deepEqual(
        selectJobs(jobs, { now, location: 'Kabul', salary: 'negotiable', vacancy: '2-5' }).map(job => job.title),
        ['Network Engineer'],
    );
    assert.deepEqual(
        selectJobs(jobs, { now, category: 'Software development' }).map(job => job.title),
        ['Backend Developer'],
    );
    assert.deepEqual(
        selectJobs(jobs, { now, sort: 'vacancies' }).map(job => job.title),
        ['IT Technician', 'Network Engineer', 'Backend Developer'],
    );
    assert.deepEqual(
        selectJobs(jobs, { now, sort: 'company' }).map(job => job.company),
        ['Alpha', 'Beta', 'Gamma'],
    );
});

test('application info never treats mailto as a website and preserves subject confidence', () => {
    const exact = getApplicationInfo({
        apply_url: 'mailto:jobs@example.org?body=hello',
        apply_emails: ['jobs@example.org', 'jobs@example.org'],
        application_subject: 'VAC-42 — Developer',
        application_subject_type: 'exact',
        url: 'https://example.org/jobs/42',
    });
    assert.deepEqual(exact.emails, ['jobs@example.org']);
    assert.equal(exact.applicationUrl, null);
    assert.equal(exact.sourceUrl, 'https://example.org/jobs/42');
    assert.equal(exact.subjectType, 'exact');

    const suggested = getApplicationInfo({
        apply_emails: ['hr@example.org'],
        application_subject: 'Developer — REF-1',
        application_subject_type: 'title_template',
    });
    assert.equal(suggested.subjectType, 'reference');
});

test('relevance display exposes useful labels but hides scoring internals', () => {
    const job = {
        category: 'Information Technology',
        details: { 'Functional Area': 'Software Engineering, Data' },
        relevance: {
            reasons: [
                'title: “software developer” (+80)',
                'Strong software engineering title (+8 points)',
                'non-technical title: “cashier” (-120)',
                'score: 12',
                '{"machine":"value"}',
            ],
        },
    };

    assert.deepEqual(getTechLabels(job), ['Information Technology', 'Software Engineering', 'Data']);
    assert.deepEqual(getReadableMatchReasons(job), [
        'the title matches “software developer”',
        'Strong software engineering title',
    ]);
});
