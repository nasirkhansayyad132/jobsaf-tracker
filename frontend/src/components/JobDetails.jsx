import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowUpRight,
    Bookmark,
    BookmarkCheck,
    Check,
    ChevronDown,
    Clipboard,
    Globe2,
    Languages,
    Layers,
    Link2,
    Mail,
    Share2,
    X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { parseDescription } from './description';
import { CompanyAvatar } from './CompanyAvatar';
import {
    findDetail,
    formatJobDate,
    formatRelativeDate,
    formatSource,
    formatVacancyCount,
    getApplicationInfo,
    getClosingDate,
    getDeadlineInfo,
    getGroupVacancyCount,
    getJobCategory,
    getJobKey,
    getJobReference,
    getLanguages,
    getLastSeenDate,
    getPostDate,
    getPostDateLabel,
    getRemoteEligibility,
    getSalaryText,
    getSkills,
    getVacancyCount,
    isRemoteJob,
    getUnconfirmedDays,
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

// Shown elsewhere in the panel, so not repeated under "More details".
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
    'remote eligibility',
    'location restriction',
    'languages',
    'tags',
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
    if (application.applicationUrl && application.emails.length) return 'Apply online or by email.';
    if (application.applicationUrl) return 'Apply using the online form.';
    if (application.emails.length) return 'Apply by email.';
    return 'Check the original listing for how to apply.';
}

const PLAINTEXT_DIRECTION = { unicodeBidi: 'plaintext' };

function FormattedDescription({ description, loading = false }) {
    const blocks = useMemo(() => parseDescription(description), [description]);

    if (loading) {
        return (
            <div className="space-y-3" role="status" aria-label="Loading the full description">
                <div className="skeleton-line w-3/4" />
                <div className="skeleton-line w-full" />
                <div className="skeleton-line w-5/6" />
                <div className="skeleton-line w-2/3" />
                <span className="sr-only">Loading the full description…</span>
            </div>
        );
    }

    if (!blocks.length) {
        return (
            <p className="text-sm leading-7 tone-muted">
                No description was captured for this listing. Open the original posting for complete requirements.
            </p>
        );
    }

    return (
        <article aria-label="Job description" className="description-text space-y-4">
            {blocks.map((block, blockIndex) => {
                const key = `${block.type}-${blockIndex}`;
                if (block.type === 'heading') {
                    return (
                        <h4
                            key={key}
                            dir="auto"
                            style={PLAINTEXT_DIRECTION}
                            className={cn('text-base font-semibold leading-snug tone-strong', blockIndex > 0 && 'pt-2')}
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
                                'space-y-2 ps-5 text-[15px] leading-7 tone-strong opacity-90',
                                block.type === 'ol'
                                    ? 'list-decimal marker:font-semibold marker:text-blue-400 light:marker:text-blue-700'
                                    : 'list-disc marker:text-blue-400 light:marker:text-blue-700',
                            )}
                        >
                            {block.items.map((item, itemIndex) => (
                                <li key={`${key}-${itemIndex}`} dir="auto" style={PLAINTEXT_DIRECTION} className="ps-1 break-words">
                                    {item}
                                </li>
                            ))}
                        </List>
                    );
                }

                return (
                    <p key={key} dir="auto" style={PLAINTEXT_DIRECTION} className="text-[15px] leading-7 tone-strong opacity-90 break-words">
                        {block.text}
                    </p>
                );
            })}
        </article>
    );
}

function Fact({ label, children, wide = false }) {
    if (!children) return null;
    return (
        <div className={cn('min-w-0', wide && 'col-span-2')}>
            <dt className="fact-label">{label}</dt>
            <dd dir="auto" className="fact-value">{children}</dd>
        </div>
    );
}

function Section({ id, title, icon: Icon, children, className }) {
    return (
        <section aria-labelledby={id} className={cn('border-t line-soft pt-6', className)}>
            <h3 id={id} className="section-heading">
                {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
                {title}
            </h3>
            {children}
        </section>
    );
}

export function JobDetails({ job, onClose, onSelectVariant, onToggleSaved, saved = false }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const feedbackTimerRef = useRef(null);
    const [feedback, setFeedback] = useState('');
    const application = useMemo(() => getApplicationInfo(job), [job]);
    const details = useMemo(() => buildDetailEntries(job), [job]);
    const reference = getJobReference(job);
    const sourceCategory = getJobCategory(job);
    const salary = getSalaryText(job);
    const jobType = getJobTypeText(job);
    const postDate = getPostDate(job);
    const closingDate = getClosingDate(job);
    const deadline = getDeadlineInfo(job);
    const lastSeenDate = getLastSeenDate(job);
    const unconfirmedDays = getUnconfirmedDays(job);
    const remote = isRemoteJob(job);
    const eligibility = getRemoteEligibility(job);
    const languages = getLanguages(job);
    const skills = getSkills(job);
    const variants = job.variants?.length > 1 ? job.variants : [];
    const descriptionLoading = job.description === undefined && Boolean(job.has_description);
    const alsoFoundOn = (job.also_found_on || []).filter(item => item?.url);
    const openings = variants.length > 1
        ? (() => {
            const total = getGroupVacancyCount(job);
            return total === null ? null : `${total.toLocaleString()} across ${variants.length} locations`;
        })()
        : getVacancyCount(job) === null ? null : formatVacancyCount(job);

    // One clear primary action: the application form, else email, else the listing.
    const primaryAction = application.applicationUrl
        ? { href: application.applicationUrl, label: 'Apply online', external: true }
        : application.emails.length
            ? { href: null, label: 'Apply by email', scrollTo: 'apply-heading' }
            : application.sourceUrl
                ? { href: application.sourceUrl, label: 'Open original listing', external: true }
                : null;
    const showListingLink = application.sourceUrl && application.sourceUrl !== primaryAction?.href;

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
                'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
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

    const scrollToApply = () => {
        dialogRef.current?.querySelector('#apply-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div
                className="absolute inset-0 bg-slate-950/70 light:bg-slate-900/40 backdrop-blur-[2px] modal-backdrop"
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
                className="drawer-panel modal-panel relative flex h-[100dvh] w-full flex-col overflow-y-auto border-l line-soft shadow-2xl sm:max-w-2xl"
            >
                <header className="app-header sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
                    <span className="truncate text-xs font-medium tone-muted">
                        {formatSource(job.source)}
                        {/[\p{L}\p{N}]/u.test(reference || '') ? ` · Ref ${reference}` : ''}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                        {onToggleSaved && (
                            <button
                                type="button"
                                onClick={() => onToggleSaved(job)}
                                className={cn('icon-button', saved && 'text-amber-400 hover:text-amber-400')}
                                aria-pressed={saved}
                                aria-label={saved ? 'Remove from saved jobs' : 'Save this job'}
                                title={saved ? 'Saved' : 'Save'}
                            >
                                {saved ? <BookmarkCheck className="h-[18px] w-[18px]" aria-hidden="true" /> : <Bookmark className="h-[18px] w-[18px]" aria-hidden="true" />}
                            </button>
                        )}
                        <button type="button" onClick={shareJob} className="icon-button" aria-label="Share this job" title="Share">
                            <Share2 className="h-[18px] w-[18px]" aria-hidden="true" />
                        </button>
                        <button ref={closeButtonRef} type="button" onClick={onClose} className="icon-button" aria-label="Close job details" title="Close">
                            <X className="h-5 w-5" aria-hidden="true" />
                        </button>
                    </div>
                </header>

                <div className="flex-1 space-y-6 px-4 pb-10 pt-5 sm:px-6">
                    <div className="flex items-start gap-4">
                        <CompanyAvatar name={job.company || job.title} size="lg" />
                        <div className="min-w-0">
                            <h2 id="job-dialog-title" dir="auto" className="text-xl font-bold leading-snug tracking-tight tone-strong sm:text-2xl">
                                {job.title || 'Untitled role'}
                            </h2>
                            <p dir="auto" className="mt-1 text-sm font-medium tone-muted">{job.company || 'Employer not specified'}</p>
                            <p id="job-dialog-context" className="sr-only">
                                Job details, how to apply, and the original source for {job.title}.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {deadline && (
                                    <span className={cn('chip', deadline.urgent ? 'chip-amber' : '')}>{deadline.label}</span>
                                )}
                                {remote && (
                                    <span className="chip chip-teal"><Globe2 className="h-3 w-3" aria-hidden="true" /> {eligibility}</span>
                                )}
                                {languages.length > 0 && (
                                    <span className="chip chip-amber"><Languages className="h-3 w-3" aria-hidden="true" /> {languages.join(' · ')}</span>
                                )}
                                {jobType && <span className="chip capitalize">{jobType}</span>}
                            </div>
                        </div>
                    </div>

                    {primaryAction && (
                        <div className="flex flex-col gap-2 sm:flex-row">
                            {primaryAction.href ? (
                                <a href={primaryAction.href} target="_blank" rel="noopener noreferrer" className="primary-button flex-1 sm:flex-none">
                                    {primaryAction.label} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                                </a>
                            ) : (
                                <button type="button" onClick={scrollToApply} className="primary-button flex-1 sm:flex-none">
                                    <Mail className="h-4 w-4" aria-hidden="true" /> {primaryAction.label}
                                </button>
                            )}
                            {showListingLink && (
                                <a href={application.sourceUrl} target="_blank" rel="noopener noreferrer" className="secondary-button flex-1 sm:flex-none">
                                    Original listing <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                                </a>
                            )}
                        </div>
                    )}

                    <dl className="surface grid grid-cols-2 gap-x-4 gap-y-4 rounded-2xl p-4 sm:grid-cols-3">
                        <Fact label="Location" wide={variants.length > 1}>
                            {variants.length > 1 ? `${variants.length} locations (see below)` : remote ? 'Remote' : job.location}
                        </Fact>
                        <Fact label="Deadline">{closingDate ? formatJobDate(closingDate) : 'Not listed'}</Fact>
                        <Fact label={getPostDateLabel(job)}>
                            {postDate ? `${formatJobDate(postDate, { short: true })} · ${formatRelativeDate(postDate)}` : null}
                        </Fact>
                        <Fact label="Openings">{openings}</Fact>
                        <Fact label="Salary">{salary || 'Not disclosed'}</Fact>
                    </dl>

                    {unconfirmedDays && (
                        <p className="status-banner status-banner-warning text-sm">
                            Not seen on the source for {unconfirmedDays} days. It may have closed early, so check the original listing.
                        </p>
                    )}

                    {remote && job.remote_regions && (
                        <p dir="auto" className="flex items-start gap-2 text-sm tone-muted">
                            <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-400 light:text-teal-700" aria-hidden="true" />
                            <span>Location requirement in the listing: {job.remote_regions}</span>
                        </p>
                    )}

                    {variants.length > 1 && (
                        <Section id="variants-heading" title={`Posted for ${variants.length} locations`} icon={Layers}>
                            <p className="-mt-1 mb-3 text-sm tone-muted">
                                One listing per location. Each has its own openings, deadline and application.
                            </p>
                            <ul className="grid gap-2 sm:grid-cols-2">
                                {variants.map(variant => {
                                    const current = getJobKey(variant) === getJobKey(job);
                                    const closes = getClosingDate(variant);
                                    const count = getVacancyCount(variant);
                                    return (
                                        <li key={getJobKey(variant)}>
                                            <button
                                                type="button"
                                                onClick={() => onSelectVariant?.(variant)}
                                                disabled={current}
                                                aria-current={current ? 'true' : undefined}
                                                className={cn(
                                                    'w-full rounded-xl border p-3 text-left text-sm transition-colors',
                                                    current
                                                        ? 'cursor-default border-blue-500/50 bg-blue-500/10'
                                                        : 'line-soft hover:border-blue-500/40',
                                                )}
                                            >
                                                <span dir="auto" className="block font-semibold tone-strong">{variant.location || 'Location not specified'}</span>
                                                <span className="mt-0.5 block text-xs tone-muted">
                                                    {count !== null ? `${count} ${count === 1 ? 'opening' : 'openings'} · ` : ''}
                                                    {closes ? `closes ${formatJobDate(closes, { short: true })}` : 'no deadline listed'}
                                                    {current ? ' · viewing' : ''}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </Section>
                    )}

                    {skills.length > 0 && (
                        <Section id="skills-heading" title="Skills">
                            <ul className="flex flex-wrap gap-2" aria-label="Skills mentioned">
                                {skills.map(name => (
                                    <li key={name} className="skill-chip px-2.5 py-1 text-xs">{name}</li>
                                ))}
                            </ul>
                        </Section>
                    )}

                    <Section id="apply-heading" title="How to apply" className="scroll-mt-16">
                        <p dir="auto" className="text-sm leading-6 tone-muted">{applicationMessage(application)}</p>

                        {application.subject ? (
                            <div className="surface mt-4 rounded-xl p-3.5">
                                <span className="fact-label">
                                    {application.subjectType === 'exact'
                                        ? 'Exact email subject from the listing'
                                        : application.subjectType === 'reference'
                                            ? 'Reference or title to include'
                                            : 'Suggested subject — verify before sending'}
                                </span>
                                <div className="mt-1.5 flex items-start justify-between gap-3">
                                    <code dir="auto" className="whitespace-pre-wrap break-words text-sm tone-strong">{application.subject}</code>
                                    <button type="button" onClick={() => copyText(application.subject, 'Subject')} className="copy-button" aria-label="Copy application subject">
                                        <Clipboard className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        {application.emails.length > 0 && (
                            <div className="mt-4 grid gap-2">
                                {application.emails.map(email => (
                                    <div key={email} className="surface flex flex-col gap-2 rounded-xl p-3 sm:flex-row sm:items-center">
                                        <span dir="auto" className="min-w-0 flex-1 break-all font-mono text-sm tone-strong">{email}</span>
                                        <span className="flex gap-2">
                                            <button type="button" onClick={() => copyText(email, 'Email address')} className="copy-button" aria-label={`Copy ${email}`}>
                                                <Clipboard className="h-4 w-4" aria-hidden="true" /> Copy
                                            </button>
                                            <a href={mailtoUrl(email)} className="small-action-button" aria-label={`Start an email to ${email}`}>
                                                <Mail className="h-4 w-4" aria-hidden="true" /> Email
                                            </a>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Section>

                    <Section id="description-heading" title="Description">
                        <FormattedDescription description={job.description} loading={descriptionLoading} />
                    </Section>

                    {(details.length > 0 || sourceCategory) && (
                        <details className="group border-t line-soft pt-6">
                            <summary className="section-heading mb-0 cursor-pointer list-none justify-between rounded-lg">
                                More details
                                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                            </summary>
                            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                                {sourceCategory && (
                                    <div className="min-w-0 sm:col-span-2">
                                        <dt className="fact-label">Category on the source</dt>
                                        <dd dir="auto" className="fact-value">{sourceCategory}</dd>
                                    </div>
                                )}
                                {details.map(([key, value]) => (
                                    <div key={key} className="min-w-0">
                                        <dt className="fact-label">{key}</dt>
                                        <dd dir="auto" className="fact-value whitespace-pre-wrap">{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </details>
                    )}

                    <footer className="space-y-1.5 border-t line-soft pt-5 text-xs tone-faint">
                        <p>Collected automatically. Confirm eligibility, deadline and instructions with the publisher.</p>
                        {lastSeenDate && <p>Last seen on the source {formatJobDate(lastSeenDate)}.</p>}
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {application.sourceUrl && (
                                <a href={application.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-400 light:text-blue-700 hover:underline underline-offset-4">
                                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> {formatSource(job.source)}
                                </a>
                            )}
                            {alsoFoundOn.map(item => (
                                <a key={`${item.source}-${item.url}`} href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-400 light:text-blue-700 hover:underline underline-offset-4">
                                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> {formatSource(item.source)}
                                </a>
                            ))}
                        </p>
                    </footer>
                </div>

                <div className="sr-only" role="status" aria-live="polite">{feedback}</div>
                {feedback && (
                    <div className="surface fixed bottom-5 left-1/2 z-[60] inline-flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold tone-strong" aria-hidden="true">
                        <Check className="h-4 w-4 text-emerald-500" /> {feedback}
                    </div>
                )}
            </section>
        </div>
    );
}
