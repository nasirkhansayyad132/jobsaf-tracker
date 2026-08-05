import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowUpRight,
    Banknote,
    BriefcaseBusiness,
    Building2,
    CalendarDays,
    Check,
    Clipboard,
    Clock3,
    Info,
    Link2,
    Mail,
    MapPin,
    Share2,
    Sparkles,
    Tags,
    UsersRound,
    X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { parseDescription } from './description';
import {
    formatJobDate,
    formatSource,
    formatVacancyCount,
    findDetail,
    getApplicationInfo,
    getCategoryFacet,
    getClosingDate,
    getJobCategory,
    getJobReference,
    getLastSeenDate,
    getPostDate,
    getPostDateLabel,
    getReadableMatchReasons,
    getSalaryText,
    getVacancyCount,
    needsFreshnessCheck,
} from '../lib/jobs';

const DETAIL_PRIORITY = [
    'category',
    'functional area',
    'employment type',
    'job type',
    'contract type',
    'contract duration',
    'experience',
    'years of experience',
    'education',
    'minimum education',
    'salary',
    'salary range',
    'gender',
    'nationality',
    'vacancies',
    'number of vacancies',
    'no. of jobs',
];

const REDUNDANT_DETAIL_KEYS = new Set([
    'category',
    'functional area',
    'employment type',
    'job type',
    'salary',
    'salary range',
    'compensation',
    'vacancies',
    'number of vacancies',
    'no. of jobs',
    'number of positions',
    'location',
    'job location',
    'organization',
    'closing date',
    'close date',
    'post date',
    'posted date',
    'source',
    'reference',
    'reference number',
    'vacancy number',
]);

function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function formatLabel(value) {
    return String(value || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatValue(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value ?? '').trim();
}

function cleanMetadataValue(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text && !/^(?:n\/?a|none|null|undefined)$/i.test(text) ? text : null;
}

function getJobTypeText(job) {
    const candidates = [
        job?.job_type,
        findDetail(job, ['job type', 'employment type', 'contract type']),
    ];
    const value = candidates.map(cleanMetadataValue).find(Boolean);
    return value ? value.replace(/_/g, ' ') : null;
}

function buildDetailEntries(job) {
    const entries = [];
    const seen = new Set();

    const add = (key, value) => {
        const normalized = normalizeKey(key);
        const formatted = formatValue(value);
        if (!normalized || !formatted || seen.has(normalized) || REDUNDANT_DETAIL_KEYS.has(normalized)) return;
        seen.add(normalized);
        entries.push([formatLabel(key), formatted, normalized]);
    };

    add('Category', job.category);
    add('Job Type', job.job_type);
    add('Salary', job.salary);
    add('Gender', job.gender);
    add('Vacancies', job.vacancies);
    Object.entries(job.details || {}).forEach(([key, value]) => add(key, value));

    return entries.sort((left, right) => {
        const leftIndex = DETAIL_PRIORITY.indexOf(left[2]);
        const rightIndex = DETAIL_PRIORITY.indexOf(right[2]);
        if (leftIndex === -1 && rightIndex === -1) return left[0].localeCompare(right[0]);
        if (leftIndex === -1) return 1;
        if (rightIndex === -1) return -1;
        return leftIndex - rightIndex;
    });
}

function applicationMessage(application) {
    if (application.instructions) return application.instructions;
    if (application.applicationUrl && application.emails.length) {
        return 'This listing provides both an online form and email contacts. Review the original instructions before choosing a method.';
    }
    if (application.applicationUrl) {
        return 'Apply through the linked form. Review the original listing first for required documents and eligibility.';
    }
    if (application.emails.length) {
        return 'The listing accepts applications by email. Review the description and original listing for required documents.';
    }
    return 'No direct application method was captured. Use the original listing to confirm how to apply.';
}

const PLAINTEXT_DIRECTION = { unicodeBidi: 'plaintext' };

function FormattedDescription({ description }) {
    const blocks = useMemo(() => parseDescription(description), [description]);

    if (!blocks.length) {
        return (
            <p className="text-sm sm:text-base leading-7 text-slate-400 light:text-slate-600">
                No description was provided in the captured listing. Open the original source for complete requirements.
            </p>
        );
    }

    return (
        <article
            aria-label="Original job description"
            className="description-text rounded-2xl border border-white/10 light:border-slate-200 bg-white/[0.025] light:bg-slate-50/70 px-4 py-5 sm:px-6 sm:py-6"
        >
            <div className="space-y-4">
                {blocks.map((block, blockIndex) => {
                    const key = `${block.type}-${blockIndex}`;
                    if (block.type === 'heading') {
                        return (
                            <h4
                                key={key}
                                dir="auto"
                                style={PLAINTEXT_DIRECTION}
                                className={cn(
                                    'text-base sm:text-lg font-bold leading-snug text-white light:text-slate-950 border-b border-white/10 light:border-slate-200 pb-2.5',
                                    blockIndex > 0 && 'pt-3',
                                )}
                            >
                                {block.text}
                            </h4>
                        );
                    }

                    if (block.type === 'ul' || block.type === 'ol') {
                        const List = block.type;
                        return (
                            <List
                                key={key}
                                className={cn(
                                    'space-y-2.5 ps-6 text-sm sm:text-base leading-7 text-slate-200 light:text-slate-800',
                                    block.type === 'ol'
                                        ? 'list-decimal marker:font-semibold marker:text-blue-300 light:marker:text-blue-700'
                                        : 'list-disc marker:text-blue-300 light:marker:text-blue-700',
                                )}
                            >
                                {block.items.map((item, itemIndex) => (
                                    <li
                                        key={`${key}-${itemIndex}`}
                                        dir="auto"
                                        style={PLAINTEXT_DIRECTION}
                                        className="ps-1 break-words"
                                    >
                                        {item}
                                    </li>
                                ))}
                            </List>
                        );
                    }

                    return (
                        <p
                            key={key}
                            dir="auto"
                            style={PLAINTEXT_DIRECTION}
                            className="text-sm sm:text-base leading-7 text-slate-200 light:text-slate-800 break-words"
                        >
                            {block.text}
                        </p>
                    );
                })}
            </div>
        </article>
    );
}

export function JobDetails({ job, onClose }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const feedbackTimerRef = useRef(null);
    const [feedback, setFeedback] = useState('');
    const application = useMemo(() => getApplicationInfo(job), [job]);
    const details = useMemo(() => buildDetailEntries(job), [job]);
    const reference = getJobReference(job);
    const category = getJobCategory(job);
    const technologyCategory = getCategoryFacet(job);
    const salary = getSalaryText(job);
    const salaryDisplay = salary || 'Not disclosed';
    const vacancies = getVacancyCount(job) === null ? null : formatVacancyCount(job);
    const jobType = getJobTypeText(job);
    const postDate = getPostDate(job);
    const closingDate = getClosingDate(job);
    const matchReasons = getReadableMatchReasons(job);
    const lastSeenDate = getLastSeenDate(job);
    const recheck = needsFreshnessCheck(job);
    const originalListingIsApplication = application.sourceUrl === application.applicationUrl;

    useEffect(() => {
        const previouslyFocused = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        closeButtonRef.current?.focus();

        const handleKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }

            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = [...dialogRef.current.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )].filter(element => !element.hasAttribute('hidden'));
            if (!focusable.length) {
                event.preventDefault();
                dialogRef.current.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
            if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
        };
    }, [onClose]);

    const showFeedback = message => {
        setFeedback(message);
        if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = window.setTimeout(() => setFeedback(''), 2200);
    };

    const copyText = async (value, label) => {
        try {
            await navigator.clipboard.writeText(value);
            showFeedback(`${label} copied`);
        } catch {
            showFeedback(`Could not copy ${label.toLowerCase()}`);
        }
    };

    const shareJob = async () => {
        const shareData = { title: `${job.title} — ${job.company}`, url: window.location.href };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
                return;
            }
            await navigator.clipboard.writeText(shareData.url);
            showFeedback('Job link copied');
        } catch (error) {
            if (error?.name !== 'AbortError') showFeedback('Could not share this job');
        }
    };

    const mailtoUrl = email => {
        const subject = application.subject && application.subjectType === 'exact'
            ? `?subject=${encodeURIComponent(application.subject)}`
            : '';
        return `mailto:${email}${subject}`;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
            <div
                className="absolute inset-0 bg-slate-950/80 light:bg-slate-950/60 backdrop-blur-sm modal-backdrop"
                onMouseDown={onClose}
                aria-hidden="true"
            />

            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="job-dialog-title"
                aria-describedby="job-dialog-context"
                tabIndex="-1"
                className="relative w-full sm:w-[95%] max-w-5xl h-[92dvh] sm:h-auto sm:max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-dark light:bg-white border-t sm:border border-white/15 light:border-slate-200 shadow-2xl scrollbar-hide modal-panel"
            >
                <header className="sticky top-0 z-10 flex items-start justify-between p-5 sm:p-7 bg-dark/95 light:bg-white/95 backdrop-blur-xl border-b border-white/10 light:border-slate-200">
                    <div className="pr-24 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                            <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-blue-500/10 light:bg-blue-50 text-blue-200 light:text-blue-800 border border-blue-400/20 light:border-blue-200">
                                {formatSource(job.source)}
                            </span>
                            {reference && (
                                <span dir="auto" className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white/[0.06] light:bg-slate-100 text-slate-300 light:text-slate-700 border border-white/10 light:border-slate-200">
                                    Vacancy ID: {reference}
                                </span>
                            )}
                        </div>
                        <h2 id="job-dialog-title" dir="auto" className="text-xl sm:text-3xl font-bold text-white light:text-slate-950 mb-2 leading-tight">
                            {job.title || 'Untitled role'}
                        </h2>
                        <p id="job-dialog-context" className="sr-only">
                            Full job details, application options, and original source for {job.title}.
                        </p>
                        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300 light:text-slate-700">
                            <span className="flex items-start gap-1.5">
                                <Building2 className="w-4 h-4 mt-0.5 text-blue-300 light:text-blue-700 shrink-0" aria-hidden="true" />
                                <span dir="auto">{job.company || 'Employer not specified'}</span>
                            </span>
                            <span className="flex items-start gap-1.5">
                                <MapPin className="w-4 h-4 mt-0.5 text-violet-300 light:text-violet-700 shrink-0" aria-hidden="true" />
                                <span dir="auto">{job.location || 'Location not specified'}</span>
                            </span>
                            {closingDate && (
                                <span className="flex items-center gap-1.5">
                                    <Clock3 className="w-4 h-4 text-orange-300 light:text-orange-700 shrink-0" aria-hidden="true" />
                                    Closes {formatJobDate(closingDate)}
                                </span>
                            )}
                            {postDate && (
                                <span className="flex items-center gap-1.5">
                                    <CalendarDays className="w-4 h-4 text-emerald-300 light:text-emerald-700 shrink-0" aria-hidden="true" />
                                    {getPostDateLabel(job)} {formatJobDate(postDate)}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="absolute top-4 right-4 flex items-center gap-1">
                        <button type="button" onClick={shareJob} className="icon-button" aria-label="Share this job" title="Share this job">
                            <Share2 className="w-5 h-5" aria-hidden="true" />
                        </button>
                        <button ref={closeButtonRef} type="button" onClick={onClose} className="icon-button" aria-label="Close job details" title="Close job details">
                            <X className="w-5 h-5" aria-hidden="true" />
                        </button>
                    </div>
                </header>

                <div className="p-5 sm:p-8 space-y-8">
                    <section aria-labelledby="overview-heading">
                        <h3 id="overview-heading" className="section-heading">
                            <BriefcaseBusiness className="w-5 h-5 text-blue-300 light:text-blue-700" aria-hidden="true" />
                            At a glance
                        </h3>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            <div className="rounded-xl border border-white/10 light:border-slate-200 bg-white/[0.04] light:bg-slate-50 p-4">
                                <dt className="flex items-center gap-2 text-[11px] uppercase tracking-wide font-bold text-slate-400 light:text-slate-600">
                                    <Building2 className="w-4 h-4 text-blue-300 light:text-blue-700" aria-hidden="true" /> Employer
                                </dt>
                                <dd dir="auto" className="mt-2 text-sm font-semibold text-slate-100 light:text-slate-900 break-words">
                                    {job.company || 'Not provided by the source'}
                                </dd>
                            </div>
                            <div className={cn(
                                'rounded-xl border p-4',
                                salary
                                    ? 'border-emerald-400/20 light:border-emerald-200 bg-emerald-500/[0.07] light:bg-emerald-50'
                                    : 'border-white/10 light:border-slate-200 bg-white/[0.03] light:bg-slate-50',
                            )}>
                                <dt className="flex items-center gap-2 text-[11px] uppercase tracking-wide font-bold text-slate-400 light:text-slate-600">
                                    <Banknote className={cn(
                                        'w-4 h-4',
                                        salary ? 'text-emerald-300 light:text-emerald-700' : 'text-slate-500 light:text-slate-500',
                                    )} aria-hidden="true" /> Salary
                                </dt>
                                <dd dir="auto" className={cn(
                                    'mt-2 text-sm whitespace-pre-wrap break-words',
                                    salary
                                        ? 'font-semibold text-slate-100 light:text-slate-900'
                                        : 'font-medium text-slate-500 light:text-slate-500',
                                )}>{salaryDisplay}</dd>
                            </div>
                            {vacancies && (
                                <div className="rounded-xl border border-white/10 light:border-slate-200 bg-white/[0.04] light:bg-slate-50 p-4">
                                    <dt className="flex items-center gap-2 text-[11px] uppercase tracking-wide font-bold text-slate-400 light:text-slate-600">
                                        <UsersRound className="w-4 h-4 text-violet-300 light:text-violet-700" aria-hidden="true" /> Vacancies
                                    </dt>
                                    <dd dir="auto" className="mt-2 text-sm font-semibold text-slate-100 light:text-slate-900 break-words">{vacancies}</dd>
                                </div>
                            )}
                            {jobType && (
                                <div className="rounded-xl border border-white/10 light:border-slate-200 bg-white/[0.04] light:bg-slate-50 p-4">
                                    <dt className="flex items-center gap-2 text-[11px] uppercase tracking-wide font-bold text-slate-400 light:text-slate-600">
                                        <BriefcaseBusiness className="w-4 h-4 text-blue-300 light:text-blue-700" aria-hidden="true" /> Job type
                                    </dt>
                                    <dd dir="auto" className="mt-2 text-sm font-semibold text-slate-100 light:text-slate-900 break-words capitalize">{jobType}</dd>
                                </div>
                            )}
                            {category && (
                                <div className="rounded-xl border border-white/10 light:border-slate-200 bg-white/[0.04] light:bg-slate-50 p-4">
                                    <dt className="flex items-center gap-2 text-[11px] uppercase tracking-wide font-bold text-slate-400 light:text-slate-600">
                                        <Tags className="w-4 h-4 text-cyan-300 light:text-cyan-700" aria-hidden="true" /> Source category
                                    </dt>
                                    <dd dir="auto" className="mt-2 text-sm font-semibold text-slate-100 light:text-slate-900 break-words">{category}</dd>
                                </div>
                            )}
                        </dl>
                    </section>

                    {technologyCategory && (
                        <section aria-labelledby="specialties-heading">
                            <h3 id="specialties-heading" className="section-heading">
                                <Sparkles className="w-5 h-5 text-blue-300 light:text-blue-700" aria-hidden="true" />
                                Technology focus
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                <span dir="auto" className="px-3 py-1.5 rounded-lg bg-blue-500/10 light:bg-blue-50 border border-blue-400/20 light:border-blue-200 text-sm font-medium text-blue-100 light:text-blue-900">
                                    {technologyCategory}
                                </span>
                            </div>
                            {matchReasons.length > 0 && (
                                <ul className="mt-3 space-y-1 text-sm text-slate-300 light:text-slate-700" aria-label="Why this role was matched">
                                    {matchReasons.map(reason => <li key={reason} dir="auto">Matched because {reason}</li>)}
                                </ul>
                            )}
                        </section>
                    )}

                    <section className="rounded-2xl p-5 sm:p-6 bg-blue-500/[0.07] light:bg-blue-50/70 border border-blue-400/20 light:border-blue-200" aria-labelledby="apply-heading">
                        <div className="flex items-start gap-3">
                            <Info className="w-5 h-5 text-blue-300 light:text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
                            <div className="flex-1 min-w-0">
                                <h3 id="apply-heading" className="text-base font-bold text-white light:text-slate-950 mb-1">How to apply</h3>
                                <p dir="auto" className="text-sm leading-relaxed text-slate-300 light:text-slate-700">
                                    {applicationMessage(application)}
                                </p>

                                {application.subject ? (
                                    <div className="mt-4 rounded-xl bg-slate-950/35 light:bg-white border border-white/10 light:border-blue-200 p-3.5">
                                        <span className="text-[11px] uppercase tracking-wide font-bold text-slate-400 light:text-slate-600">
                                            {application.subjectType === 'exact'
                                                ? 'Exact subject specified by the listing'
                                                : application.subjectType === 'reference'
                                                    ? 'Reference or title to include'
                                                    : 'Suggested subject — verify before sending'}
                                        </span>
                                        <div className="mt-1.5 flex items-start justify-between gap-3">
                                            <code dir="auto" className="text-sm text-white light:text-slate-950 whitespace-pre-wrap break-words">{application.subject}</code>
                                            <button type="button" onClick={() => copyText(application.subject, 'Subject')} className="copy-button" aria-label="Copy application subject">
                                                <Clipboard className="w-4 h-4" aria-hidden="true" />
                                            </button>
                                        </div>
                                    </div>
                                ) : application.emails.length > 0 && (
                                    <p className="mt-3 text-xs leading-relaxed text-amber-100 light:text-amber-900 bg-amber-500/10 light:bg-amber-50 border border-amber-400/20 light:border-amber-200 rounded-lg px-3 py-2">
                                        No verified email subject was captured. Check the description and original listing—do not rely on an automatically invented subject.
                                    </p>
                                )}

                                {application.emails.length > 0 && (
                                    <div className="mt-4 grid gap-2">
                                        {application.emails.map(email => (
                                            <div key={email} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl bg-slate-950/30 light:bg-white border border-white/10 light:border-blue-200 p-3">
                                                <span dir="auto" className="min-w-0 flex-1 font-mono text-sm text-white light:text-slate-950 break-all">{email}</span>
                                                <span className="flex gap-2">
                                                    <button type="button" onClick={() => copyText(email, 'Email address')} className="copy-button" aria-label={`Copy ${email}`}>
                                                        <Clipboard className="w-4 h-4" aria-hidden="true" /> Copy
                                                    </button>
                                                    <a href={mailtoUrl(email)} className="small-action-button" aria-label={`Start an email to ${email}`}>
                                                        <Mail className="w-4 h-4" aria-hidden="true" /> Email
                                                    </a>
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="mt-5 flex flex-col sm:flex-row flex-wrap gap-3">
                                    {application.applicationUrl && (
                                        <a href={application.applicationUrl} target="_blank" rel="noopener noreferrer" className="primary-button">
                                            Apply online <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                                        </a>
                                    )}
                                    {application.sourceUrl && !originalListingIsApplication && (
                                        <a href={application.sourceUrl} target="_blank" rel="noopener noreferrer" className="secondary-button">
                                            Read original listing <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                                        </a>
                                    )}
                                    {application.sourceUrl && originalListingIsApplication && (
                                        <p className="text-xs text-slate-400 light:text-slate-600 self-center">The application link is the original listing.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>

                    {details.length > 0 && (
                        <section aria-labelledby="facts-heading">
                            <h3 id="facts-heading" className="section-heading">
                                <BriefcaseBusiness className="w-5 h-5 text-blue-300 light:text-blue-700" aria-hidden="true" />
                                Role details
                            </h3>
                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 light:border-slate-200 bg-white/10 light:bg-slate-200">
                                {details.map(([key, value]) => (
                                    <div key={key} className="bg-slate-900/80 light:bg-white p-4 sm:p-5">
                                        <dt className="text-[11px] uppercase tracking-wide text-slate-400 light:text-slate-600 font-semibold mb-1.5">{key}</dt>
                                        <dd dir="auto" className="text-sm sm:text-base text-slate-100 light:text-slate-900 font-medium whitespace-pre-wrap break-words">{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    )}

                    <section className="pb-4" aria-labelledby="description-heading">
                        <h3 id="description-heading" className="section-heading">
                            <BriefcaseBusiness className="w-5 h-5 text-blue-300 light:text-blue-700" aria-hidden="true" />
                            Full description
                        </h3>
                        <FormattedDescription description={job.description} />
                    </section>

                    <footer className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-5 border-t border-white/10 light:border-slate-200 text-xs text-slate-400 light:text-slate-600">
                        <div className="space-y-1">
                            <p>Details are collected automatically. Confirm eligibility, deadline, and instructions with the publisher.</p>
                            {lastSeenDate && (
                                <p className={recheck ? 'text-amber-200 light:text-amber-800 font-semibold' : ''}>
                                    Last captured from this source {formatJobDate(lastSeenDate)}{recheck ? ' — recheck the original listing before applying.' : '.'}
                                </p>
                            )}
                        </div>
                        {application.sourceUrl && (
                            <a href={application.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-blue-300 light:text-blue-700 hover:underline underline-offset-4 shrink-0">
                                <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Source: {formatSource(job.source)}
                            </a>
                        )}
                    </footer>
                </div>

                <div className="sr-only" role="status" aria-live="polite">
                    {feedback}
                </div>
                {feedback && (
                    <div className="fixed left-1/2 bottom-5 z-[60] -translate-x-1/2 inline-flex items-center gap-2 rounded-full bg-slate-950 light:bg-white border border-white/15 light:border-slate-300 px-4 py-2 text-sm font-semibold text-white light:text-slate-950 shadow-xl" aria-hidden="true">
                        <Check className="w-4 h-4 text-emerald-400 light:text-emerald-700" /> {feedback}
                    </div>
                )}
            </section>
        </div>
    );
}
