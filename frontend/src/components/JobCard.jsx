import { memo } from 'react';
import {
    ArrowRight,
    Banknote,
    Bell,
    Bookmark,
    BookmarkCheck,
    BriefcaseBusiness,
    Building2,
    CalendarDays,
    Clock3,
    Globe2,
    Languages,
    MapPin,
    Sparkles,
    UsersRound,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
    daysUntilClosing,
    formatJobDate,
    formatSource,
    formatVacancyCount,
    findDetail,
    getAfghanistanToday,
    getCategoryFacet,
    getClosingDate,
    getGroupVacancyCount,
    getJobKey,
    getLanguages,
    getLastSeenDate,
    getPostDate,
    getPostDateLabel,
    getRemoteEligibility,
    getSalaryText,
    getSkills,
    getVariantLocations,
    getVacancyCount,
    isNewSince,
    isRecentJob,
    isRemoteJob,
    needsFreshnessCheck,
} from '../lib/jobs';

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

function getDeadlineText(job, now) {
    const days = daysUntilClosing(job, now);
    if (days === null) return 'No deadline listed';
    if (days === 0) return 'Closes today';
    if (days === 1) return 'Closes tomorrow';
    if (days <= 3) return `Closes in ${days} days`;
    return `Closes ${formatJobDate(getClosingDate(job), { short: true })}`;
}

function getLocationText(job) {
    const variants = job?.variants?.length || 1;
    if (variants < 2) return job.location || 'Location not specified';
    const places = getVariantLocations(job);
    if (!places.length) return `${variants} postings`;
    const shown = places.slice(0, 3).join(', ');
    return places.length > 3 ? `${shown} +${places.length - 3} more` : shown;
}

function getVacancyText(job) {
    if (job?.variants?.length > 1) {
        const total = getGroupVacancyCount(job);
        return total === null ? null : `${total.toLocaleString()} ${total === 1 ? 'opening' : 'openings'}`;
    }
    return getVacancyCount(job) === null ? null : formatVacancyCount(job);
}

function JobCardComponent({ job, onSelect, onToggleSaved, saved = false, newSince = null, now = getAfghanistanToday() }) {
    const variants = job?.variants?.length ? job.variants : [job];
    const daysLeft = daysUntilClosing(job, now);
    const expiring = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;
    const recent = variants.some(item => isRecentJob(item, now));
    const fresh = variants.some(item => isNewSince(item, newSince));
    const recheck = needsFreshnessCheck(job, now);
    const postDate = getPostDate(job);
    const category = getCategoryFacet(job);
    const remote = isRemoteJob(job);
    const eligibility = getRemoteEligibility(job);
    const languages = getLanguages(job);
    const skills = getSkills(job).slice(0, 4);
    const salary = getSalaryText(job);
    const salaryDisplay = salary || 'Not disclosed';
    const vacancies = getVacancyText(job);
    const jobType = getJobTypeText(job);
    const titleId = `job-title-${getJobKey(job).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const HeaderIcon = remote ? Globe2 : Building2;

    return (
        <article
            className={cn(
                'job-card group w-full h-full text-left relative overflow-hidden rounded-2xl border p-5 backdrop-blur-md',
                'bg-white/[0.06] border-white/10 hover:bg-white/10 hover:border-blue-400/50 hover:shadow-[0_16px_40px_rgba(15,23,42,0.35)]',
                'light:bg-white light:border-slate-200 light:hover:bg-slate-50 light:hover:border-blue-600/40 light:hover:shadow-[0_16px_36px_rgba(15,23,42,0.10)]',
            )}
        >
            <button
                type="button"
                onClick={() => onSelect(job)}
                className="absolute inset-0 z-10 rounded-2xl bg-transparent"
                aria-label={`View full details for ${job.title || 'this job'} at ${job.company || 'the employer'}`}
            />

            <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none bg-gradient-to-tr from-white/5 via-transparent to-blue-500/10" aria-hidden="true" />

                <span className="relative flex h-full flex-col pointer-events-none">
                    <span className="flex justify-between items-start gap-3 mb-4">
                        <span className="p-3 bg-white/[0.06] light:bg-slate-100 rounded-xl border border-white/10 light:border-slate-200 group-hover:border-blue-400/30 transition-colors" aria-hidden="true">
                            <HeaderIcon className="w-6 h-6 text-blue-300 light:text-blue-700" />
                        </span>
                        <span className="flex flex-wrap items-center justify-end gap-2">
                            {fresh && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-violet-100 light:text-violet-800 bg-violet-500/20 light:bg-violet-100 border border-violet-400/30 light:border-violet-300 rounded-full">
                                    <Bell className="w-3 h-3" aria-hidden="true" /> New
                                </span>
                            )}
                            {recent && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-emerald-100 light:text-emerald-800 bg-emerald-500/15 light:bg-emerald-100 border border-emerald-400/25 light:border-emerald-300 rounded-full">
                                    <Sparkles className="w-3 h-3" aria-hidden="true" /> Recent
                                </span>
                            )}
                            {expiring && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-orange-100 light:text-orange-800 bg-orange-500/15 light:bg-orange-100 border border-orange-400/25 light:border-orange-300 rounded-full">
                                    <Clock3 className="w-3 h-3" aria-hidden="true" /> Urgent
                                </span>
                            )}
                            {recheck && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-amber-100 light:text-amber-900 bg-amber-500/15 light:bg-amber-100 border border-amber-400/25 light:border-amber-300 rounded-full">
                                    <Clock3 className="w-3 h-3" aria-hidden="true" /> Recheck
                                </span>
                            )}
                        </span>
                    </span>

                    <h3 id={titleId} dir="auto" className="text-lg font-bold text-white light:text-slate-950 mb-1.5 line-clamp-2 group-hover:text-blue-300 light:group-hover:text-blue-700 transition-colors">
                        {job.title || 'Untitled role'}
                    </h3>
                    <p dir="auto" className="text-sm text-slate-300 light:text-slate-700 font-medium mb-4 line-clamp-2">
                        {job.company || 'Employer not specified'}
                    </p>

                    {(category || remote || languages.length > 0) && (
                        <span className="flex flex-wrap gap-1.5 mb-3" aria-label="Technology area and eligibility">
                            {remote && (
                                <span className="inline-flex max-w-full items-center gap-1 truncate px-2 py-1 rounded-md bg-teal-500/10 light:bg-teal-50 border border-teal-400/20 light:border-teal-200 text-[11px] font-semibold text-teal-200 light:text-teal-800">
                                    <Globe2 className="w-3 h-3 shrink-0" aria-hidden="true" /> {eligibility}
                                </span>
                            )}
                            {languages.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 light:bg-amber-50 border border-amber-400/20 light:border-amber-200 text-[11px] font-semibold text-amber-200 light:text-amber-900">
                                    <Languages className="w-3 h-3 shrink-0" aria-hidden="true" /> {languages.join(' · ')}
                                </span>
                            )}
                            {category && (
                                <span dir="auto" className="max-w-full truncate px-2 py-1 rounded-md bg-blue-500/10 light:bg-blue-50 border border-blue-400/15 light:border-blue-200 text-[11px] font-medium text-blue-200 light:text-blue-800">
                                    {category}
                                </span>
                            )}
                        </span>
                    )}

                    {skills.length > 0 && (
                        <span className="flex flex-wrap gap-1.5 mb-4" aria-label="Skills mentioned">
                            {skills.map(name => (
                                <span key={name} className="px-2 py-0.5 rounded-full border border-white/10 light:border-slate-200 bg-white/[0.04] light:bg-slate-50 text-[11px] font-medium text-slate-300 light:text-slate-700">
                                    {name}
                                </span>
                            ))}
                        </span>
                    )}

                    <span className="grid grid-cols-2 gap-2 mb-4" aria-label="Employment summary">
                        <span className={cn(
                            'col-span-2 flex items-start gap-2 rounded-lg border px-3 py-2.5',
                            salary
                                ? 'border-emerald-400/15 light:border-emerald-200 bg-emerald-500/[0.07] light:bg-emerald-50'
                                : 'border-white/10 light:border-slate-200 bg-white/[0.03] light:bg-slate-50',
                        )}>
                            <Banknote className={cn(
                                'w-4 h-4 mt-0.5 shrink-0',
                                salary ? 'text-emerald-300 light:text-emerald-700' : 'text-slate-500 light:text-slate-500',
                            )} aria-hidden="true" />
                            <span className="min-w-0">
                                <span className="block text-[10px] uppercase tracking-wide font-bold text-slate-400 light:text-slate-600">Salary</span>
                                <span dir="auto" className={cn(
                                    'block text-xs line-clamp-2',
                                    salary
                                        ? 'font-semibold text-slate-200 light:text-slate-800'
                                        : 'font-medium text-slate-500 light:text-slate-500',
                                )}>{salaryDisplay}</span>
                            </span>
                        </span>
                        {vacancies && (
                            <span className="flex items-start gap-2 rounded-lg border border-white/10 light:border-slate-200 bg-white/[0.04] light:bg-slate-50 px-3 py-2.5">
                                <UsersRound className="w-4 h-4 mt-0.5 shrink-0 text-violet-300 light:text-violet-700" aria-hidden="true" />
                                <span className="min-w-0">
                                    <span className="block text-[10px] uppercase tracking-wide font-bold text-slate-400 light:text-slate-600">Vacancies</span>
                                    <span dir="auto" className="block text-xs font-semibold text-slate-200 light:text-slate-800 break-words">{vacancies}</span>
                                </span>
                            </span>
                        )}
                        {jobType && (
                            <span className="flex items-start gap-2 rounded-lg border border-white/10 light:border-slate-200 bg-white/[0.04] light:bg-slate-50 px-3 py-2.5">
                                <BriefcaseBusiness className="w-4 h-4 mt-0.5 shrink-0 text-blue-300 light:text-blue-700" aria-hidden="true" />
                                <span className="min-w-0">
                                    <span className="block text-[10px] uppercase tracking-wide font-bold text-slate-400 light:text-slate-600">Job type</span>
                                    <span dir="auto" className="block text-xs font-semibold text-slate-200 light:text-slate-800 break-words capitalize">{jobType}</span>
                                </span>
                            </span>
                        )}
                    </span>

                    <span className="flex flex-col gap-2.5 text-sm text-slate-400 light:text-slate-600 mb-6">
                        <span className="flex items-start gap-2">
                            <MapPin className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                            <span dir="auto">
                                {variants.length > 1 && <strong className="font-semibold text-slate-200 light:text-slate-800">{variants.length} locations: </strong>}
                                {getLocationText(job)}
                            </span>
                        </span>
                        {postDate && (
                            <span className="flex items-start gap-2">
                                <CalendarDays className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                                <span>{getPostDateLabel(job)} {formatJobDate(postDate, { short: true })}</span>
                            </span>
                        )}
                        {recheck && getLastSeenDate(job) && (
                            <span className="flex items-start gap-2 text-amber-200 light:text-amber-800">
                                <Clock3 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                                <span>Last captured {formatJobDate(getLastSeenDate(job), { short: true })}</span>
                            </span>
                        )}
                        <span className={cn('flex items-start gap-2', expiring && 'font-semibold text-orange-200 light:text-orange-800')}>
                            <Clock3 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                            <span>{getDeadlineText(job, now)}</span>
                        </span>
                    </span>

                    <span className="flex items-center justify-between gap-3 mt-auto pt-4 border-t border-white/10 light:border-slate-200">
                        <span className="min-w-0 truncate text-xs font-semibold text-slate-300 light:text-slate-700 bg-black/20 light:bg-slate-100 border border-white/5 light:border-slate-200 px-2.5 py-1 rounded-md">
                            {formatSource(job.source)}
                            {job.also_found_on?.length > 0 && ` +${new Set(job.also_found_on.map(item => item.source)).size}`}
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                            {onToggleSaved && (
                                <button
                                    type="button"
                                    onClick={() => onToggleSaved(job)}
                                    className={cn(
                                        'pointer-events-auto relative z-20 rounded-lg p-1.5 transition-colors',
                                        saved
                                            ? 'text-amber-300 light:text-amber-700 bg-amber-500/15 light:bg-amber-100'
                                            : 'text-slate-400 hover:text-white light:hover:text-slate-950 hover:bg-white/10 light:hover:bg-slate-100',
                                    )}
                                    aria-pressed={saved}
                                    aria-label={saved ? `Remove ${job.title || 'this job'} from saved jobs` : `Save ${job.title || 'this job'}`}
                                    title={saved ? 'Saved' : 'Save job'}
                                >
                                    {saved
                                        ? <BookmarkCheck className="w-4 h-4" aria-hidden="true" />
                                        : <Bookmark className="w-4 h-4" aria-hidden="true" />}
                                </button>
                            )}
                            <span className="text-xs font-semibold text-blue-300 light:text-blue-700 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                                Full details <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                            </span>
                        </span>
                    </span>
                </span>
        </article>
    );
}

export const JobCard = memo(JobCardComponent);
