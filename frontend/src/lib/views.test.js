import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getCategoryFacet,
    getGroupVacancyCount,
    getJobFacets,
    getJobStats,
    getRemoteEligibility,
    getScopeCounts,
    getVariantLocations,
    groupJobs,
    isNewSince,
    matchesScope,
    selectJobs,
} from './jobs.js';

const now = new Date(2026, 9, 14, 12);

function job(id, overrides = {}) {
    return {
        id,
        title: `Software Engineer ${id}`,
        company: 'Example',
        location: 'Kabul, Afghanistan',
        closing_date: '2026-10-30',
        post_date: '2026-10-12',
        first_seen_at: '2026-10-12T05:00:00Z',
        ...overrides,
    };
}

const remote = (id, overrides = {}) => job(id, { work_mode: 'remote', remote_scope: 'worldwide', location: 'Remote · Open worldwide', closing_date: null, ...overrides });

test('Afghanistan and Remote views split jobs, keeping Afghan-board remote roles in both', () => {
    const local = job('a');
    const worldwide = remote('b');
    const afghanRemote = remote('c', { remote_scope: 'afghanistan' });
    assert.deepEqual([local, worldwide, afghanRemote].filter(item => matchesScope(item, 'afghanistan')).map(item => item.id), ['a', 'c']);
    assert.deepEqual([local, worldwide, afghanRemote].filter(item => matchesScope(item, 'remote')).map(item => item.id), ['b', 'c']);
    assert.deepEqual(getScopeCounts([local, worldwide, afghanRemote], now), { afghanistan: 2, remote: 2, language: 0 });
    assert.equal(getRemoteEligibility(worldwide), 'Open worldwide');
    assert.equal(getRemoteEligibility(local), null);
});

test('province variants collapse into one card with every location and total openings', () => {
    const grouped = groupJobs([
        job('k', { group_id: 'g1', location: 'Kabul, Afghanistan', vacancies: 3 }),
        job('x'),
        job('h', { group_id: 'g1', location: 'Herat, Afghanistan', vacancies: 2 }),
    ]);
    assert.deepEqual(grouped.map(item => item.id), ['k', 'x']);
    assert.equal(grouped[0].variants.length, 2);
    assert.deepEqual(getVariantLocations(grouped[0]), ['Kabul', 'Herat']);
    assert.equal(getGroupVacancyCount(grouped[0]), 5);
    assert.equal(grouped[1].variants, undefined);
    assert.equal(getJobStats([job('k', { group_id: 'g1' }), job('h', { group_id: 'g1' })], now).total, 1);
});

test('skills, eligibility, saved and new-since filters narrow the list', () => {
    const jobs = [
        job('py', { skills: ['Python', 'AWS'] }),
        job('js', { skills: ['React'], first_seen_at: '2026-10-14T03:00:00Z' }),
        remote('asia', { remote_scope: 'asia', skills: ['Python'] }),
    ];
    assert.deepEqual(selectJobs(jobs, { now, skill: 'Python' }).map(item => item.id).sort(), ['asia', 'py']);
    assert.deepEqual(selectJobs(jobs, { now, scope: 'remote', eligibility: 'asia' }).map(item => item.id), ['asia']);
    assert.deepEqual(selectJobs(jobs, { now, savedKeys: new Set(['js']) }).map(item => item.id), ['js']);
    const lastVisit = Date.parse('2026-10-13T00:00:00Z');
    assert.equal(isNewSince(jobs[1], lastVisit), true);
    assert.deepEqual(selectJobs(jobs, { now, filter: 'new', newSince: lastVisit }).map(item => item.id), ['js']);
    assert.equal(getJobStats(jobs, now, { newSince: lastVisit }).new, 1);
    assert.deepEqual(selectJobs(jobs, { now, query: 'aws' }).map(item => item.id), ['py']);
});

test('facets report the most common skills and remote eligibility groups', () => {
    const facets = getJobFacets([
        job('a', { skills: ['Python', 'SQL'] }),
        job('b', { skills: ['Python'] }),
        remote('c', { remote_scope: 'language' }),
    ], now);
    assert.deepEqual(facets.skills[0], { name: 'Python', count: 2 });
    assert.deepEqual(facets.eligibility, [{ value: 'language', label: 'Needs Dari/Pashto', count: 1 }]);
});

test('cards get stable monograms, colours, relative dates and deadline labels', async () => {
    const { formatRelativeDate, getAvatarTone, getCompanyInitials, getDeadlineInfo } = await import('./jobs.js');
    assert.equal(getCompanyInitials('Unique Atlantic Telecommunication'), 'UA');
    assert.equal(getCompanyInitials('UNICEF - United Nations Children’s Fund'), 'UU');
    assert.equal(getCompanyInitials('Azizi Bank'), 'AB');
    assert.equal(getCompanyInitials('Phantom'), 'PH');
    assert.equal(getCompanyInitials(''), '?');
    assert.equal(getAvatarTone('Azizi Bank'), getAvatarTone('Azizi Bank'));
    assert.ok(getAvatarTone('Azizi Bank') >= 0 && getAvatarTone('Azizi Bank') < 8);

    assert.equal(formatRelativeDate(new Date(2026, 9, 14, 12), now), 'Today');
    assert.equal(formatRelativeDate(new Date(2026, 9, 13, 12), now), 'Yesterday');
    assert.equal(formatRelativeDate(new Date(2026, 9, 10, 12), now), '4 days ago');
    assert.equal(formatRelativeDate(new Date(2026, 9, 1, 12), now), '1 week ago');

    assert.deepEqual(getDeadlineInfo(job('t', { closing_date: '2026-10-15' }), now), { label: 'Closes tomorrow', urgent: true, days: 1 });
    assert.equal(getDeadlineInfo(job('t', { closing_date: '2026-10-30' }), now).urgent, false);
    assert.equal(getDeadlineInfo(job('t', { closing_date: null }), now), null);
});

test('a grouped card uses the spelling most of its copies share', () => {
    const [group] = groupJobs([
        job('typo', { group_id: 'g', title: 'Agency Baking Support Staff' }),
        job('a', { group_id: 'g', title: 'Agency Banking Support Staff' }),
        job('b', { group_id: 'g', title: 'Agency Banking Support Staff' }),
    ]);
    assert.equal(group.title, 'Agency Banking Support Staff');
    assert.equal(group.variants.length, 3);
});

test('listings warn only after going unseen for two days or more', async () => {
    const { getUnconfirmedDays } = await import('./jobs.js');
    assert.equal(getUnconfirmedDays(job('a', { last_seen_at: '2026-10-14T04:30:00Z' }), now), null);
    assert.equal(getUnconfirmedDays(job('a', { last_seen_at: '2026-10-13T04:30:00Z' }), now), null);
    assert.equal(getUnconfirmedDays(job('a', { last_seen_at: '2026-10-10T04:30:00Z' }), now), 4);
});

test('the Languages view holds remote Afghan-language work, apart from the tech views', () => {
    const language = (id, title, languages, overrides = {}) => remote(id, { title, languages, track: 'language', ...overrides });
    const interpreter = language('l1', 'English - Farsi Interpreter', ['Persian'], { remote_scope: 'afghanistan' });
    const trainer = language('l2', 'Pashto Language Specialist - AI Trainer', ['Pashto'], { post_date: '2026-10-13' });
    const transcriber = language('l3', 'Dari Transcribers (Remote)', ['Dari']);
    const tech = remote('t1');
    const all = [interpreter, trainer, transcriber, tech, job('a')];

    assert.deepEqual(all.filter(item => matchesScope(item, 'language')).map(item => item.id), ['l1', 'l2', 'l3']);
    assert.deepEqual(all.filter(item => matchesScope(item, 'remote')).map(item => item.id), ['t1']);
    // A language role open to Afghanistan is not an Afghanistan tech job.
    assert.deepEqual(all.filter(item => matchesScope(item, 'afghanistan')).map(item => item.id), ['a']);
    assert.equal(getScopeCounts(all, now).language, 3);

    assert.equal(getCategoryFacet(interpreter), 'Interpreting');
    assert.equal(getCategoryFacet(trainer), 'AI training & evaluation');
    assert.equal(getCategoryFacet(transcriber), 'Transcription');

    const facets = getJobFacets(all.filter(item => matchesScope(item, 'language')), now);
    assert.deepEqual(facets.languages.map(item => item.name), ['Dari', 'Pashto', 'Persian']);
    assert.equal(facets.categoryCounts.length, 3);
    assert.deepEqual(selectJobs(all, { scope: 'language', language: 'Pashto', now }).map(item => item.id), ['l2']);
    // Newest first by default, as for remote boards.
    assert.equal(selectJobs(all, { scope: 'language', now })[0].id, 'l2');
});
