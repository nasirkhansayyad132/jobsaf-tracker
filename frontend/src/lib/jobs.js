const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
};

const POST_DATE_KEYS = [
    'post date',
    'posted date',
    'date posted',
    'publish date',
    'published date',
    'publication date',
    'posted on',
];

const REFERENCE_KEYS = [
    'reference',
    'reference number',
    'job reference',
    'vacancy number',
    'vacancy id',
    'announcement number',
];

const SUBJECT_KEYS = ['application subject', 'email subject', 'subject line'];
const VACANCY_KEYS = [
    'no. of jobs',
    'no. of job',
    'no of job',
    'no of jobs',
    'number of jobs',
    'number of vacancies',
    'vacancies',
    'vacancy count',
    'number of positions',
    'positions',
];

const SALARY_KEYS = ['salary', 'salary range', 'compensation', 'pay range'];

const CATEGORY_FACETS = {
    software: 'Software development',
    data: 'Data, AI & analytics',
    cloud: 'Cloud & DevOps',
    network: 'Networking, telecom & security',
    operations: 'IT operations & support',
    leadership: 'IT leadership & delivery',
    other: 'Other technology',
};

const REMOTE_SCOPE_LABELS = {
    worldwide: 'Open worldwide',
    afghanistan: 'Open to Afghanistan',
    asia: 'Open in Asia',
    timezone: 'Time zones include Afghanistan',
    language: 'Needs Dari/Pashto',
};

const NUMBER_WORDS = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
};

function normalizeKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ');
}

function makeCalendarDate(year, monthIndex, day) {
    const date = new Date(year, monthIndex, day, 12, 0, 0, 0);
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== monthIndex ||
        date.getDate() !== day
    ) {
        return null;
    }
    return date;
}

export function getAfghanistanToday(reference = new Date()) {
    const parts = new Intl.DateTimeFormat('en', {
        timeZone: 'Asia/Kabul',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
    }).formatToParts(reference);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return makeCalendarDate(Number(values.year), Number(values.month) - 1, Number(values.day));
}

/**
 * Parse a date as a source calendar day, not as a UTC instant. This prevents
 * YYYY-MM-DD values from moving to the previous/next day in the viewer's zone.
 */
export function parseCalendarDate(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime())
            ? null
            : makeCalendarDate(value.getFullYear(), value.getMonth(), value.getDate());
    }

    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();

    let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
        return makeCalendarDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\D|$)/);
    if (match) {
        return makeCalendarDate(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    }

    match = text.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})/i);
    if (match && MONTHS[match[1].toLowerCase()] !== undefined) {
        return makeCalendarDate(
            Number(match[3]),
            MONTHS[match[1].toLowerCase()],
            Number(match[2]),
        );
    }

    match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)[,]?\s+(\d{4})/i);
    if (match && MONTHS[match[2].toLowerCase()] !== undefined) {
        return makeCalendarDate(
            Number(match[3]),
            MONTHS[match[2].toLowerCase()],
            Number(match[1]),
        );
    }

    const fallback = new Date(text);
    if (Number.isNaN(fallback.getTime())) return null;
    return makeCalendarDate(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
}

function calendarDayNumber(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

function parseKabulInstant(value) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return null;
    return getAfghanistanToday(instant);
}

function firstParseableDate(candidates) {
    for (const candidate of candidates) {
        const parsed = parseCalendarDate(candidate);
        if (parsed) return { raw: candidate, parsed };
    }
    return { raw: null, parsed: null };
}

function resolvePostDate(job) {
    const normalized = firstParseableDate([
        job?.post_date,
        findDetail(job, POST_DATE_KEYS),
    ]);
    if (normalized.parsed) return { ...normalized, label: 'Posted' };

    const firstSeen = job?.first_seen_at;
    if (!firstSeen) return { raw: null, parsed: null, label: 'First seen' };
    const parsed = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(firstSeen).trim())
        ? parseKabulInstant(firstSeen)
        : parseCalendarDate(firstSeen);
    return parsed
        ? { raw: firstSeen, parsed, label: 'First seen' }
        : { raw: null, parsed: null, label: 'First seen' };
}

export function findDetail(job, wantedKeys) {
    if (!job?.details || typeof job.details !== 'object') return null;
    const entries = Object.entries(job.details);
    for (const wanted of wantedKeys) {
        const normalizedWanted = normalizeKey(wanted);
        const match = entries.find(([key]) => normalizeKey(key) === normalizedWanted);
        if (match && match[1] !== null && String(match[1]).trim()) return match[1];
    }
    return null;
}

export function getPostDateRaw(job) {
    return resolvePostDate(job).raw;
}

export function getPostDateLabel(job) {
    return resolvePostDate(job).label;
}

export function getPostDate(job) {
    return resolvePostDate(job).parsed;
}

export function getClosingDate(job) {
    return parseCalendarDate(job?.closing_date || findDetail(job, ['closing date', 'close date']));
}

export function getJobReference(job) {
    const value = job?.reference || job?.vacancy_number || findDetail(job, REFERENCE_KEYS);
    return value === null || value === undefined ? null : String(value).trim() || null;
}

export function getJobCategory(job) {
    const value = job?.category || findDetail(job, ['category', 'functional area']);
    return value === null || value === undefined ? null : String(value).trim() || null;
}

function sortFacetValues(values) {
    return [...new Set(values.filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

export function getJobFacets(jobs, now = getAfghanistanToday()) {
    const openJobs = (Array.isArray(jobs) ? jobs : []).filter(job => isOpenJob(job, now));
    const salary = {
        listed: 0,
        comparable: 0,
        canSort: false,
        undisclosed: 0,
        scale: 0,
        negotiable: 0,
        other: 0,
    };
    const vacancies = {
        listed: 0,
        unknown: 0,
        single: 0,
        multiple: 0,
        one: 0,
        twoToFive: 0,
        sixToTen: 0,
        elevenPlus: 0,
    };
    const salaryUnits = new Set();

    for (const job of openJobs) {
        const salaryKind = getSalaryKind(job);
        if (salaryKind === 'undisclosed') salary.undisclosed += 1;
        else {
            salary.listed += 1;
            if (salaryKind === 'scale') salary.scale += 1;
            else if (salaryKind === 'negotiable') salary.negotiable += 1;
            else salary.other += 1;
        }
        const comparableSalary = getComparableSalary(job);
        if (comparableSalary) {
            salary.comparable += 1;
            salaryUnits.add(`${comparableSalary.currency}:${comparableSalary.period}`);
        }

        const count = getVacancyCount(job);
        if (count === null) vacancies.unknown += 1;
        else {
            vacancies.listed += 1;
            if (count === 1) {
                vacancies.single += 1;
                vacancies.one += 1;
            } else {
                vacancies.multiple += 1;
                if (count <= 5) vacancies.twoToFive += 1;
                else if (count <= 10) vacancies.sixToTen += 1;
                else vacancies.elevenPlus += 1;
            }
        }
    }
    salary.canSort = salary.comparable > 0 && salaryUnits.size === 1;

    const skillCounts = new Map();
    for (const job of openJobs) {
        for (const skill of getSkills(job)) skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1);
    }
    const eligibility = {};
    for (const job of openJobs.filter(isRemoteJob)) {
        if (job.remote_scope) eligibility[job.remote_scope] = (eligibility[job.remote_scope] || 0) + 1;
    }

    return {
        skills: [...skillCounts.entries()]
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 40)
            .map(([name, count]) => ({ name, count })),
        eligibility: Object.entries(eligibility)
            .sort((left, right) => right[1] - left[1])
            .map(([value, count]) => ({ value, label: REMOTE_SCOPE_LABELS[value] || value, count })),
        companies: sortFacetValues(openJobs.map(getCompanyFacet)),
        locations: sortFacetValues(openJobs.flatMap(getLocationFacet)),
        categories: sortFacetValues(openJobs.map(getCategoryFacet)),
        salary,
        vacancies,
    };
}

function cleanFacetValue(value) {
    if (value === null || value === undefined) return null;
    const cleaned = String(value).replace(/\s+/g, ' ').trim();
    return cleaned || null;
}

function normalizeDigits(value) {
    const easternArabic = '۰۱۲۳۴۵۶۷۸۹';
    const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
    return String(value || '').replace(/[٠-٩۰-۹]/g, digit => {
        const easternIndex = easternArabic.indexOf(digit);
        return String(easternIndex >= 0 ? easternIndex : arabicIndic.indexOf(digit));
    });
}

/** Convert an explicitly stated vacancy count to a positive integer. */
export function normalizeVacancyCount(value) {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value > 0 ? value : null;
    }

    const text = normalizeDigits(value).trim().toLowerCase();
    if (!text) return null;

    const wordMatch = text.match(/^(?:a\s+)?([a-z]+)(?:\s+(?:vacanc(?:y|ies)|jobs?|positions?|posts?|openings?))?$/);
    if (wordMatch && NUMBER_WORDS[wordMatch[1]]) return NUMBER_WORDS[wordMatch[1]];

    const numericMatch = text.match(
        /^(?:no\.?\s*(?:of\s+)?(?:jobs?|positions?|vacancies)\s*[:-]?\s*)?(\d{1,6})(?:\s*\([a-z\s-]+\))?(?:\s+(?:vacanc(?:y|ies)|jobs?|positions?|posts?|openings?))?$/,
    );
    if (!numericMatch) return null;
    const count = Number(numericMatch[1]);
    return Number.isSafeInteger(count) && count > 0 ? count : null;
}

export function getVacancyCount(job) {
    const direct = normalizeVacancyCount(job?.vacancies);
    if (direct !== null) return direct;
    return normalizeVacancyCount(findDetail(job, VACANCY_KEYS));
}

export function formatVacancyCount(job, { fallback = 'Not specified' } = {}) {
    const count = getVacancyCount(job);
    if (count === null) return fallback;
    return `${count.toLocaleString()} ${count === 1 ? 'opening' : 'openings'}`;
}

export function getSalaryText(job) {
    const value = cleanFacetValue(job?.salary) || cleanFacetValue(findDetail(job, SALARY_KEYS));
    if (!value || /^(?:n\/?a|none|null|not\s+(?:available|specified|provided|disclosed)|undisclosed|tbd|to be (?:determined|disclosed)|[-—])$/i.test(value)) {
        return null;
    }
    return value;
}

export function getSalaryKind(job) {
    const text = getSalaryText(job);
    if (!text) return 'undisclosed';
    if (/\bnegotiable\b/i.test(text)) return 'negotiable';
    if (/\b(?:scale|standard)\b|\baccording to\b|\bas per\b|\bbased (?:on|upon)\b/i.test(text)) {
        return 'scale';
    }
    return getComparableSalary(job) ? 'numeric' : 'listed';
}

export function hasSalaryInfo(job) {
    return getSalaryText(job) !== null;
}

/**
 * Return a numeric range only when both the currency and pay period are explicit.
 * The object is intentionally not converted across currencies or time periods.
 */
export function getComparableSalary(job) {
    const salary = getSalaryText(job);
    if (!salary) return null;
    const text = normalizeDigits(salary).replace(/\u00a0/g, ' ');

    const currencies = [
        ['AFN', /(?:\bAFN\b|\bAfs?\b|\bAfghanis?\b|؋)/gi],
        ['USD', /(?:\bUSD\b|\bUS\s*dollars?\b|US\$|\$)/gi],
        ['EUR', /(?:\bEUR\b|€)/gi],
        ['GBP', /(?:\bGBP\b|£)/gi],
    ];
    const matchedCurrencies = currencies.filter(([, pattern]) => pattern.test(text));
    if (matchedCurrencies.length !== 1) return null;

    const periods = [
        ['hour', /(?:per\s+hour|hourly|\/\s*(?:h|hr|hour)\b)/i],
        ['day', /(?:per\s+day|daily|\/\s*day\b)/i],
        ['week', /(?:per\s+week|weekly|\/\s*(?:wk|week)\b)/i],
        ['month', /(?:per\s+month|monthly|\/\s*(?:mo|month)\b)/i],
        ['year', /(?:per\s+year|yearly|annually|per\s+annum|\/\s*(?:yr|year)\b)/i],
    ];
    const matchedPeriods = periods.filter(([, pattern]) => pattern.test(text));
    if (matchedPeriods.length !== 1) return null;

    const amounts = [...text.matchAll(/\d+(?:[ ,]\d{3})*(?:\.\d+)?/g)]
        .map(match => Number(match[0].replace(/[ ,]/g, '')))
        .filter(amount => Number.isFinite(amount) && amount > 0);
    if (!amounts.length || amounts.length > 2) return null;
    if (amounts.length === 2 && amounts[1] < amounts[0]) return null;

    return {
        minimum: amounts[0],
        maximum: amounts[1] ?? amounts[0],
        currency: matchedCurrencies[0][0],
        period: matchedPeriods[0][0],
    };
}

export function getCompanyFacet(job) {
    return cleanFacetValue(job?.company)
        || cleanFacetValue(findDetail(job, ['organization', 'company', 'employer', 'institution']));
}

/** A job can contribute to more than one province facet. */
export function getLocationFacet(job) {
    const value = cleanFacetValue(job?.location)
        || cleanFacetValue(findDetail(job, ['job location', 'location', 'city', 'province']));
    if (!value) return [];
    return [...new Set(
        value
            .replace(/,?\s*Afghanistan\s*$/i, '')
            .split(/[,;|]/)
            .map(cleanFacetValue)
            .filter(Boolean),
    )];
}

/** Stable role taxonomy derived from the job itself, not publisher categories. */
export function getCategoryFacet(job) {
    const title = String(job?.title || '').toLocaleLowerCase();
    const context = `${title} ${String(job?.description || '').slice(0, 500)}`.toLocaleLowerCase();

    if (/\b(?:software|web|frontend|front-end|backend|back-end|full[ -]?stack|mobile|wordpress|php|programmer|application)\b/.test(title)
        && /\b(?:developer|development|engineer|intern|specialist|programmer)\b/.test(title)) {
        return CATEGORY_FACETS.software;
    }
    if (/\b(?:data\s+(?:engineer|scientist|analyst|architect)|machine\s+learning|ml|ai|llm|analytics|business\s+intelligence|bi\s+developer)\b/.test(title)) {
        return CATEGORY_FACETS.data;
    }
    if (/\b(?:devops|devsecops|sre|site\s+reliability|cloud|platform\s+engineer|kubernetes|infrastructure\s+engineer)\b/.test(title)) {
        return CATEGORY_FACETS.cloud;
    }
    if (/\b(?:network|telecom|telecommunication|microwave|fiber|fibre|ofc|cyber\s*security|security\s+engineer)\b/.test(title)
        || /\bict\s*(?:&|and)\s*communication\b/.test(title)) {
        return CATEGORY_FACETS.network;
    }
    if (/\b(?:chief\s+(?:information|technology)|cio|cto|head\s+of\s+it|it\s+director|product\s*&?\s*service\s+delivery|it\s+(?:project|program|delivery)\s+manager)\b/.test(title)) {
        return CATEGORY_FACETS.leadership;
    }
    if (/\b(?:system\s+administrator|sysadmin|database|technician|help\s*desk|helpdesk|support|ict\s+officer|it\s+officer|information\s+technology)\b/.test(context)) {
        return CATEGORY_FACETS.operations;
    }
    return CATEGORY_FACETS.other;
}

export function formatJobDate(value, options = {}) {
    const date = parseCalendarDate(value);
    if (!date) return options.fallback || 'Not specified';
    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: options.short ? 'short' : 'long',
        day: 'numeric',
    }).format(date);
}

export function daysUntilClosing(job, now = getAfghanistanToday()) {
    const closing = getClosingDate(job);
    if (!closing) return null;
    return calendarDayNumber(closing) - calendarDayNumber(now);
}

export function isOpenJob(job, now = getAfghanistanToday()) {
    const status = String(job?.status || '').trim().toLowerCase();
    if (job?.active === false || ['closed', 'expired', 'inactive', 'removed'].includes(status)) return false;
    const days = daysUntilClosing(job, now);
    return days === null || days >= 0;
}

export function isExpiringSoon(job, now = getAfghanistanToday(), windowDays = 3) {
    const days = daysUntilClosing(job, now);
    return days !== null && days >= 0 && days <= windowDays;
}

export function isRecentJob(job, now = getAfghanistanToday(), windowDays = 7) {
    const posted = getPostDate(job);
    if (!posted) return false;
    const ageInDays = calendarDayNumber(now) - calendarDayNumber(posted);
    return ageInDays >= 0 && ageInDays < windowDays;
}

export function getLastSeenDate(job) {
    const value = job?.last_seen_at || job?.scraped_at || job?.first_seen_at;
    if (!value) return null;
    return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value).trim())
        ? parseKabulInstant(value)
        : parseCalendarDate(value);
}

export function needsFreshnessCheck(job, now = getAfghanistanToday(), maxAgeDays = 14) {
    if (['unconfirmed', 'source_unavailable'].includes(String(job?.lifecycle_status || '').toLowerCase())) {
        return true;
    }
    const lastSeen = getLastSeenDate(job);
    return lastSeen ? calendarDayNumber(now) - calendarDayNumber(lastSeen) > maxAgeDays : true;
}

function compareDates(left, right, direction = 1) {
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return (left.getTime() - right.getTime()) * direction;
}

function searchableText(job) {
    const detailValues = job?.details && typeof job.details === 'object'
        ? Object.values(job.details)
        : [];

    return [
        job?.title,
        job?.company,
        job?.location,
        job?.source,
        job?.category,
        job?.job_type,
        job?.description,
        job?.remote_regions,
        ...(Array.isArray(job?.skills) ? job.skills : []),
        ...(Array.isArray(job?.languages) ? job.languages : []),
        ...detailValues,
    ]
        .filter(value => value !== null && value !== undefined)
        .join(' ')
        .toLocaleLowerCase();
}

function normalizedFacet(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function isAllFacet(value) {
    return !value || normalizedFacet(value) === 'all';
}

function matchesVacancyFilter(job, filter) {
    if (isAllFacet(filter)) return true;
    const count = getVacancyCount(job);
    if (typeof filter === 'number') return count === filter;
    if (filter && typeof filter === 'object') {
        if (count === null) return false;
        const minimum = Number.isFinite(filter.min) ? filter.min : 1;
        const maximum = Number.isFinite(filter.max) ? filter.max : Infinity;
        return count >= minimum && count <= maximum;
    }

    switch (normalizedFacet(filter)) {
        case '1':
        case 'single': return count === 1;
        case 'multiple': return count !== null && count > 1;
        case '2-5': return count !== null && count >= 2 && count <= 5;
        case '6-10': return count !== null && count >= 6 && count <= 10;
        case '11+': return count !== null && count >= 11;
        case 'listed': return count !== null;
        case 'unknown': return count === null;
        default: return true;
    }
}

function matchesSalaryFilter(job, filter) {
    if (isAllFacet(filter)) return true;
    const normalized = normalizedFacet(filter);
    if (normalized === 'listed') return hasSalaryInfo(job);
    if (normalized === 'comparable') return getComparableSalary(job) !== null;
    return getSalaryKind(job) === normalized;
}

function compareTitles(left, right) {
    return String(left?.title || '').localeCompare(String(right?.title || ''), undefined, { sensitivity: 'base' });
}

function compareDeadlines(left, right) {
    return compareDates(getClosingDate(left), getClosingDate(right))
        || compareDates(getPostDate(left), getPostDate(right), -1)
        || compareTitles(left, right);
}

export function isRemoteJob(job) {
    return String(job?.work_mode || '').toLowerCase() === 'remote';
}

/**
 * "afghanistan" covers every job based in or open to Afghanistan, including
 * remote roles posted on Afghan boards; "remote" covers every remote role.
 */
export function matchesScope(job, scope = 'all') {
    if (scope === 'remote') return isRemoteJob(job);
    if (scope === 'afghanistan') return !isRemoteJob(job) || job?.remote_scope === 'afghanistan';
    return true;
}

export function getRemoteEligibility(job) {
    if (!isRemoteJob(job)) return null;
    return REMOTE_SCOPE_LABELS[job?.remote_scope]
        || cleanFacetValue(findDetail(job, ['remote eligibility']))
        || 'Remote';
}

export function getSkills(job) {
    return Array.isArray(job?.skills) ? job.skills.filter(skill => typeof skill === 'string' && skill.trim()) : [];
}

export function getLanguages(job) {
    return Array.isArray(job?.languages) ? job.languages.filter(Boolean) : [];
}

/** Whether the tracker first discovered this job after the given instant. */
export function isNewSince(job, since) {
    if (!since) return false;
    const seen = Date.parse(job?.first_seen_at || '');
    return Number.isFinite(seen) && seen > since;
}

/**
 * Collapse postings that share a group_id (province variants, re-posts) into
 * the first one in the current order. The representative lists every
 * variant, including itself, in `variants`.
 */
export function groupJobs(jobs) {
    const output = [];
    const groups = new Map();
    for (const job of Array.isArray(jobs) ? jobs : []) {
        const groupId = job?.group_id;
        if (!groupId) {
            output.push(job);
            continue;
        }
        const existing = groups.get(groupId);
        if (existing) {
            existing.variants.push(job);
            continue;
        }
        const representative = { ...job, variants: [job] };
        groups.set(groupId, representative);
        output.push(representative);
    }
    return output.map(job => (job.variants?.length > 1 ? withCommonTitle(job) : stripVariants(job)));
}

/** Show a group under the spelling most of its copies use, not a one-off typo. */
function withCommonTitle(group) {
    const counts = new Map();
    for (const variant of group.variants) {
        const key = String(variant.title || '').trim().toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const ownCount = counts.get(String(group.title || '').trim().toLowerCase()) || 0;
    const best = group.variants.reduce((winner, variant) => (
        (counts.get(String(variant.title || '').trim().toLowerCase()) || 0)
            > (counts.get(String(winner.title || '').trim().toLowerCase()) || 0) ? variant : winner
    ), group);
    return ownCount >= (counts.get(String(best.title || '').trim().toLowerCase()) || 0)
        ? group
        : { ...best, variants: group.variants };
}

function stripVariants(job) {
    if (!job?.variants) return job;
    const { variants: _variants, ...rest } = job;
    return rest;
}

/** Total openings across a grouped job's variants, when every count is known. */
export function getGroupVacancyCount(job) {
    const variants = job?.variants?.length ? job.variants : [job];
    const counts = variants.map(getVacancyCount);
    if (counts.some(count => count === null)) return null;
    return counts.reduce((total, count) => total + count, 0);
}

export function getVariantLocations(job) {
    const variants = job?.variants?.length ? job.variants : [job];
    return [...new Set(variants.flatMap(getLocationFacet))];
}

export function selectJobs(jobs, {
    query = '',
    filter = 'all',
    scope = 'all',
    skill = 'all',
    eligibility = 'all',
    savedKeys = null,
    newSince = null,
    now = getAfghanistanToday(),
    company = 'all',
    location = 'all',
    category = 'all',
    salary = 'all',
    vacancy = 'all',
    vacancies,
    sort,
} = {}) {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    let result = (Array.isArray(jobs) ? jobs : [])
        .filter(job => isOpenJob(job, now))
        .filter(job => matchesScope(job, scope));
    if (savedKeys) result = result.filter(job => savedKeys.has(getJobKey(job)));
    if (filter === 'new') result = result.filter(job => isNewSince(job, newSince));
    if (!isAllFacet(skill)) {
        const wanted = normalizedFacet(skill);
        result = result.filter(job => getSkills(job).some(value => normalizedFacet(value) === wanted));
    }
    if (!isAllFacet(eligibility)) {
        result = result.filter(job => job?.remote_scope === eligibility);
    }

    if (normalizedQuery) {
        const terms = normalizedQuery.split(/\s+/).filter(Boolean);
        result = result.filter(job => {
            const text = searchableText(job);
            return terms.every(term => text.includes(term));
        });
    }

    if (filter === 'recent') {
        result = result.filter(job => isRecentJob(job, now));
    } else if (filter === 'expiring') {
        result = result.filter(job => isExpiringSoon(job, now));
    }

    if (!isAllFacet(company)) {
        const wanted = normalizedFacet(company);
        result = result.filter(job => normalizedFacet(getCompanyFacet(job)) === wanted);
    }
    if (!isAllFacet(location)) {
        const wanted = normalizedFacet(location);
        result = result.filter(job => getLocationFacet(job).some(value => normalizedFacet(value) === wanted));
    }
    if (!isAllFacet(category)) {
        const wanted = normalizedFacet(category);
        result = result.filter(job => normalizedFacet(getCategoryFacet(job)) === wanted);
    }
    result = result.filter(job => matchesSalaryFilter(job, salary));
    result = result.filter(job => matchesVacancyFilter(job, vacancy === 'all' && vacancies !== undefined ? vacancies : vacancy));

    // Remote roles rarely publish deadlines, so newest-first is the useful default.
    const sortMode = sort || (filter === 'recent' || filter === 'new' || scope === 'remote' ? 'newest' : 'deadline');
    if (sortMode === 'newest') {
        result.sort((left, right) => (
            compareDates(getPostDate(left), getPostDate(right), -1)
            || compareDeadlines(left, right)
        ));
    } else if (sortMode === 'company') {
        result.sort((left, right) => (
            String(getCompanyFacet(left) || '').localeCompare(String(getCompanyFacet(right) || ''), undefined, { sensitivity: 'base' })
            || compareDeadlines(left, right)
        ));
    } else if (sortMode === 'vacancies') {
        result.sort((left, right) => {
            const leftCount = getVacancyCount(left);
            const rightCount = getVacancyCount(right);
            if (leftCount === null && rightCount !== null) return 1;
            if (leftCount !== null && rightCount === null) return -1;
            return (rightCount || 0) - (leftCount || 0) || compareDeadlines(left, right);
        });
    } else if (sortMode === 'salary') {
        const comparable = result.map(getComparableSalary).filter(Boolean);
        const units = new Set(comparable.map(value => `${value.currency}:${value.period}`));
        if (comparable.length && units.size === 1) {
            result.sort((left, right) => {
                const leftSalary = getComparableSalary(left);
                const rightSalary = getComparableSalary(right);
                if (!leftSalary && rightSalary) return 1;
                if (leftSalary && !rightSalary) return -1;
                return (rightSalary?.maximum || 0) - (leftSalary?.maximum || 0) || compareDeadlines(left, right);
            });
        } else {
            result.sort(compareDeadlines);
        }
    } else {
        result.sort(compareDeadlines);
    }

    return result;
}

export function getJobStats(jobs, now = getAfghanistanToday(), { scope = 'all', newSince = null } = {}) {
    const openJobs = groupJobs((Array.isArray(jobs) ? jobs : [])
        .filter(job => isOpenJob(job, now))
        .filter(job => matchesScope(job, scope)));
    const anyVariant = (job, predicate) => (job.variants || [job]).some(predicate);
    return {
        total: openJobs.length,
        expiring: openJobs.filter(job => anyVariant(job, item => isExpiringSoon(item, now))).length,
        recent: openJobs.filter(job => anyVariant(job, item => isRecentJob(item, now))).length,
        ...(newSince ? { new: openJobs.filter(job => anyVariant(job, item => isNewSince(item, newSince))).length } : {}),
    };
}

export function getScopeCounts(jobs, now = getAfghanistanToday()) {
    const openJobs = (Array.isArray(jobs) ? jobs : []).filter(job => isOpenJob(job, now));
    return {
        afghanistan: groupJobs(openJobs.filter(job => matchesScope(job, 'afghanistan'))).length,
        remote: groupJobs(openJobs.filter(job => matchesScope(job, 'remote'))).length,
    };
}

function cleanEmail(value) {
    const email = String(value || '').trim().replace(/^mailto:/i, '').split(/[?&#]/)[0];
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function isWebUrl(value) {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

export function getApplicationInfo(job) {
    const rawEmails = Array.isArray(job?.apply_emails)
        ? [...job.apply_emails]
        : job?.apply_emails
            ? [job.apply_emails]
            : [];

    if (String(job?.apply_url || '').toLowerCase().startsWith('mailto:')) {
        rawEmails.push(job.apply_url);
    }

    const emails = [...new Set(rawEmails.map(cleanEmail).filter(Boolean))];
    const explicitSubject = job?.application_subject || findDetail(job, SUBJECT_KEYS);
    const subject = explicitSubject === null || explicitSubject === undefined
        ? null
        : String(explicitSubject).trim() || null;
    const rawSubjectType = String(job?.application_subject_type || '').trim().toLowerCase();
    const subjectType = rawSubjectType === 'exact'
        ? 'exact'
        : /reference|title|template/.test(rawSubjectType)
            ? 'reference'
            : subject
                ? 'suggested'
                : null;

    return {
        emails,
        subject,
        subjectType,
        applicationUrl: isWebUrl(job?.apply_url) ? job.apply_url : null,
        sourceUrl: isWebUrl(job?.source_url) ? job.source_url : isWebUrl(job?.url) ? job.url : null,
        instructions: job?.application_instructions
            ? String(job.application_instructions).trim()
            : null,
    };
}

export function getJobKey(job) {
    return String(job?.id || job?.url || '');
}

export function getLastUpdated(jobs) {
    const timestamps = (Array.isArray(jobs) ? jobs : [])
        .map(job => new Date(job?.last_seen_at || job?.scraped_at || job?.first_seen_at || '').getTime())
        .filter(Number.isFinite);
    if (!timestamps.length) return null;
    return new Date(Math.max(...timestamps));
}

export function formatSource(source) {
    const value = String(source || 'Source').trim();
    const known = {
        acbar: 'ACBAR',
        'jobs.af': 'Jobs.af',
        kaarobar: 'Kaarobar',
        wazifaha: 'Wazifaha',
        reliefweb: 'ReliefWeb',
        impactpool: 'Impactpool',
        remoteok: 'Remote OK',
        remotive: 'Remotive',
        weworkremotely: 'We Work Remotely',
        himalayas: 'Himalayas',
        jobicy: 'Jobicy',
        workingnomads: 'Working Nomads',
    };
    return known[value.toLowerCase()] || value;
}

function splitLabels(value) {
    if (Array.isArray(value)) return value.flatMap(splitLabels);
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    return String(value)
        .split(/[,|]/)
        .map(item => item.trim())
        .filter(Boolean);
}

/** Compact, user-facing specialties only; scoring internals stay hidden. */
export function getTechLabels(job) {
    const candidates = [
        job?.tech_tags,
        job?.specialties,
        job?.relevance?.tags,
        job?.category,
        findDetail(job, ['category']),
        findDetail(job, ['functional area']),
    ].flatMap(splitLabels);

    const labels = [];
    const seen = new Set();
    for (const value of candidates) {
        const normalized = value.toLocaleLowerCase();
        if (seen.has(normalized) || value.length > 48) continue;
        seen.add(normalized);
        labels.push(value);
        if (labels.length === 4) break;
    }
    return labels;
}

export function getReadableMatchReasons(job) {
    const reasons = Array.isArray(job?.relevance?.reasons) ? job.relevance.reasons : [];
    return reasons
        .filter(reason => typeof reason === 'string')
        .filter(reason => !/\(\s*-\d/.test(reason))
        .map(reason => reason.trim().replace(/\s*\([+-]?\d+(?:\.\d+)?\s*(?:points?|pts?)?\)\s*$/i, ''))
        .map(reason => {
            const signal = reason.match(/^(title|category|functional area|category\/functional area|description role|description):\s*(.+)$/i);
            if (!signal) return reason;
            const field = signal[1].toLowerCase();
            if (field === 'description role') return `the description identifies ${signal[2]}`;
            if (field === 'description') return `the description mentions ${signal[2]}`;
            return `the ${field} matches ${signal[2]}`;
        })
        .filter(reason => {
            if (reason.length < 5 || reason.length > 140) return false;
            if (/[{}[\]]/.test(reason) || /\b(?:score|threshold|decision|version)\s*[:=]/i.test(reason)) return false;
            if (/^(?:non-technical|no technical)/i.test(reason)) return false;
            return /[A-Za-z\u0600-\u06ff]/.test(reason);
        })
        .slice(0, 3);
}

const AVATAR_STOP_WORDS = new Set(['the', 'of', 'and', 'for', 'in', 'a', 'an', '&', '-', '–', '|']);

/** Two-letter monogram for an employer without a logo. */
export function getCompanyInitials(name) {
    const words = String(name || '')
        .replace(/\([^)]*\)/g, ' ')
        .split(/[\s/,.-]+/)
        .map(word => word.trim())
        .filter(word => word && !AVATAR_STOP_WORDS.has(word.toLowerCase()));
    if (!words.length) return '?';
    const letters = words.length === 1
        ? [...words[0]].slice(0, 2)
        : [[...words[0]][0], [...words[1]][0]];
    return letters.join('').toLocaleUpperCase();
}

/** Stable colour slot (0–7) so an employer always gets the same avatar. */
export function getAvatarTone(name) {
    let hash = 0;
    for (const character of String(name || '')) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    return hash % 8;
}

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", or a short date. */
export function formatRelativeDate(date, now = getAfghanistanToday()) {
    if (!date) return null;
    const days = calendarDayNumber(now) - calendarDayNumber(date);
    if (days < 0) return formatJobDate(date, { short: true });
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 28) return `${Math.floor(days / 7)} ${Math.floor(days / 7) === 1 ? 'week' : 'weeks'} ago`;
    return formatJobDate(date, { short: true });
}

/** Deadline wording plus whether it needs attention (closing within 3 days). */
export function getDeadlineInfo(job, now = getAfghanistanToday()) {
    const days = daysUntilClosing(job, now);
    if (days === null) return null;
    if (days < 0) return { label: 'Closed', urgent: false, days };
    if (days === 0) return { label: 'Closes today', urgent: true, days };
    if (days === 1) return { label: 'Closes tomorrow', urgent: true, days };
    if (days <= 3) return { label: `Closes in ${days} days`, urgent: true, days };
    return { label: `Closes ${formatJobDate(getClosingDate(job), { short: true })}`, urgent: false, days };
}
