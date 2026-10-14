import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
    assert.deepEqual(getScopeCounts([local, worldwide, afghanRemote], now), { afghanistan: 2, remote: 2 });
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
