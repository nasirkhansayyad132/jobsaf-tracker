const fs = require('fs');
const path = require('path');
const { canonicalUrl } = require('./lib/dedupe');

function getKabulDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kabul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function readJobs(file, label) {
    let value;
    try {
        value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`Could not read ${label} ${file}: ${error.message}`);
    }
    if (!Array.isArray(value)) throw new Error(`${label} ${file} must contain a JSON array`);
    return value;
}

function isBankingTechJob(job) {
    const details = job.details || {};
    const sectorText = [job.company, job.category, details['Functional Area'], details.Industry]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    const roleText = [job.title, job.category, details['Functional Area']]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const bankingSignal = /\b(bank|banking|financial services|fintech|microfinance|payments?)\b/i;
    const technicalSignal = /\b(software|developer|programmer|engineer|information technology|it|ict|data|database|network|systems?|cyber|security|digital|application|cloud|devops|qa|quality assurance|technical support)\b/i;
    return bankingSignal.test(sectorText) && technicalSignal.test(roleText);
}

function seenTimestamp(job) {
    const candidates = [job.last_seen_at, job.scraped_at, job.first_seen_at];
    return candidates.find(value => typeof value === 'string' && !Number.isNaN(Date.parse(value))) || null;
}

function buildSourceSummary(jobs) {
    const sources = new Map();
    for (const job of jobs) {
        const name = job.source || 'unknown';
        const timestamp = seenTimestamp(job);
        const entry = sources.get(name) || {
            name,
            count: 0,
            oldest_seen_at: null,
            latest_seen_at: null,
        };
        entry.count += 1;
        if (timestamp && (!entry.oldest_seen_at || timestamp < entry.oldest_seen_at)) {
            entry.oldest_seen_at = timestamp;
        }
        if (timestamp && (!entry.latest_seen_at || timestamp > entry.latest_seen_at)) {
            entry.latest_seen_at = timestamp;
        }
        sources.set(name, entry);
    }
    return [...sources.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function jobIdentityTokens(job) {
    const tokens = [];
    if (job.id) tokens.push(`id:${job.id}`);
    for (const location of [job, ...(job.also_found_on || [])]) {
        const url = canonicalUrl(location);
        if (url) tokens.push(`url:${url}`);
    }
    return [...new Set(tokens)];
}

function findNewJobs(jobs, previousJobs) {
    const previousTokens = new Set(previousJobs.flatMap(jobIdentityTokens));
    return jobs.filter(job => !jobIdentityTokens(job).some(token => previousTokens.has(token)));
}

function writeJsonAtomically(file, value) {
    const directory = path.dirname(file);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryFile = path.join(directory, `.${path.basename(file)}.${process.pid}.tmp`);
    try {
        fs.writeFileSync(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        fs.renameSync(temporaryFile, file);
    } finally {
        if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    }
}

function generateSummary() {
    const jobsFile = process.argv[2] || '../docs/data/jobs.json';
    const summaryFile = process.argv[3] || '../docs/data/summary.json';
    const lastJobsFile = process.argv[4];

    if (!fs.existsSync(jobsFile)) throw new Error(`Jobs file not found: ${jobsFile}`);
    const jobs = readJobs(jobsFile, 'jobs data');
    const today = getKabulDate();

    let newJobs = [];
    if (lastJobsFile && fs.existsSync(lastJobsFile)) {
        const lastJobs = readJobs(lastJobsFile, 'previous jobs data');
        newJobs = findNewJobs(jobs, lastJobs);
    }

    const techBankingJobs = jobs.filter(isBankingTechJob);
    const expiringToday = [];
    const expiringSoon = [];
    const todayDate = new Date(`${today}T00:00:00.000Z`);

    for (const job of jobs) {
        if (!job.closing_date || job.closing_date < today) continue;
        if (job.closing_date === today) {
            expiringToday.push(job);
            continue;
        }

        const closeDate = new Date(`${job.closing_date}T00:00:00.000Z`);
        if (Number.isNaN(closeDate.valueOf())) continue;
        const daysUntilClose = Math.round((closeDate - todayDate) / 86_400_000);
        if (daysUntilClose > 0 && daysUntilClose <= 3) expiringSoon.push(job);
    }

    const sources = buildSourceSummary(jobs);
    const summary = {
        schema_version: 2,
        generated_at: new Date().toISOString(),
        today,
        total_jobs: jobs.length,
        source_count: sources.length,
        sources,
        new_count: newJobs.length,
        expiring_today_count: expiringToday.length,
        expiring_soon_count: expiringSoon.length,
        tech_banking_count: techBankingJobs.length,
        new_job_ids: newJobs.map(job => job.id),
        expiring_today_ids: expiringToday.map(job => job.id),
        expiring_soon_ids: expiringSoon.map(job => job.id),
        tech_banking_job_ids: techBankingJobs.map(job => job.id),
    };

    writeJsonAtomically(summaryFile, summary);
    console.log(`Summary generated at ${summaryFile}`);
    console.log(`Total: ${jobs.length}, New: ${newJobs.length}, Expire Today: ${expiringToday.length}`);
}

if (require.main === module) {
    try {
        generateSummary();
    } catch (error) {
        console.error(`[summary] ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { findNewJobs, generateSummary, jobIdentityTokens };
