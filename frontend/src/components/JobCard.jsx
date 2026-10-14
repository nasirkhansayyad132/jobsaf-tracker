import { memo } from 'react';
import {
    Banknote,
    Bookmark,
    BookmarkCheck,
    CalendarClock,
    Clock3,
    Globe2,
    Languages,
    MapPin,
    UsersRound,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { CompanyAvatar } from './CompanyAvatar';
import {
    findDetail,
    formatRelativeDate,
    formatSource,
    getAfghanistanToday,
    getCategoryFacet,
    getDeadlineInfo,
    getGroupVacancyCount,
    getLanguages,
    getPostDate,
    getRemoteEligibility,
    getSalaryText,
    getSkills,
    getVacancyCount,
    getVariantLocations,
    isNewSince,
    isRecentJob,
    isRemoteJob,
    getUnconfirmedDays,
} from '../lib/jobs';

function cleanMetadataValue(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text && !/^(?:n\/?a|none|null|undefined)$/i.test(text) ? text : null;
}

function getJobTypeText(job) {
    const value = [job?.job_type, findDetail(job, ['job type', 'employment type', 'contract type'])]
        .map(cleanMetadataValue)
        .find(Boolean);
    return value ? value.replace(/_/g, ' ') : null;
}

function getLocationText(job, variants) {
    if (variants.length > 1) {
        const places = getVariantLocations(job);
        if (!places.length) return `${variants.length} locations`;
        const shown = places.slice(0, 3).join(', ');
        return `${variants.length} locations · ${places.length > 3 ? `${shown} +${places.length - 3}` : shown}`;
    }
    if (isRemoteJob(job)) return getRemoteEligibility(job);
    return job.location || 'Location not specified';
}

function getOpeningsText(job, variants) {
    const count = variants.length > 1 ? getGroupVacancyCount(job) : getVacancyCount(job);
    if (count === null || count < 2) return null;
    return `${count.toLocaleString()} openings`;
}

function Chip({ tone = 'neutral', icon: Icon, children }) {
    return (
        <span className={cn('chip', `chip-${tone}`)}>
            {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
            <span className="truncate">{children}</span>
        </span>
    );
}

function JobCardComponent({ job, onSelect, onToggleSaved, saved = false, newSince = null, now = getAfghanistanToday() }) {
    const variants = job?.variants?.length ? job.variants : [job];
    const remote = isRemoteJob(job);
    const deadline = getDeadlineInfo(job, now);
    const fresh = variants.some(item => isNewSince(item, newSince));
    const recent = variants.some(item => isRecentJob(item, now));
    const unconfirmedDays = getUnconfirmedDays(job, now);
    const languages = getLanguages(job);
    const skills = getSkills(job).slice(0, 4);
    const salary = getSalaryText(job);
    const jobType = getJobTypeText(job);
    const openings = getOpeningsText(job, variants);
    const posted = formatRelativeDate(getPostDate(job), now);
    const sourceCount = new Set((job.also_found_on || []).map(item => item.source)).size;
    const title = job.title || 'Untitled role';
    const LocationIcon = remote ? Globe2 : MapPin;

    return (
        <article className="job-card group">
            <button
                type="button"
                onClick={() => onSelect(job)}
                className="absolute inset-0 z-10 rounded-[inherit]"
                aria-label={`View ${title} at ${job.company || 'the employer'}`}
            />

            <div className="flex items-start gap-3">
                <CompanyAvatar name={job.company || title} />
                <div className="min-w-0 flex-1">
                    <h3 dir="auto" className="job-card-title">{title}</h3>
                    <p dir="auto" className="mt-0.5 truncate text-sm tone-muted">{job.company || 'Employer not specified'}</p>
                </div>
                {onToggleSaved && (
                    <button
                        type="button"
                        onClick={() => onToggleSaved(job)}
                        className={cn('save-button relative z-20', saved && 'save-button-active')}
                        aria-pressed={saved}
                        aria-label={saved ? `Remove ${title} from saved jobs` : `Save ${title}`}
                        title={saved ? 'Saved' : 'Save job'}
                    >
                        {saved ? <BookmarkCheck className="h-[18px] w-[18px]" aria-hidden="true" /> : <Bookmark className="h-[18px] w-[18px]" aria-hidden="true" />}
                    </button>
                )}
            </div>

            <p className="mt-3 flex min-w-0 items-center gap-x-3 gap-y-1 text-xs tone-muted flex-wrap">
                <span className="flex min-w-0 items-center gap-1.5">
                    <LocationIcon className={cn('h-3.5 w-3.5 shrink-0', remote && 'text-teal-300 light:text-teal-700')} aria-hidden="true" />
                    <span dir="auto" className={cn('truncate', remote && 'font-medium text-teal-200 light:text-teal-800')}>{getLocationText(job, variants)}</span>
                </span>
                {posted && (
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {posted}
                    </span>
                )}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
                {fresh && <Chip tone="violet">New</Chip>}
                {deadline?.urgent && <Chip tone="amber" icon={Clock3}>{deadline.label}</Chip>}
                {!fresh && recent && !deadline?.urgent && <Chip tone="green">Recent</Chip>}
                {unconfirmedDays && <Chip tone="amber-outline">Not seen for {unconfirmedDays} days</Chip>}
                {languages.length > 0 && <Chip tone="amber" icon={Languages}>{languages.join(' · ')}</Chip>}
                {jobType && <Chip><span className="capitalize">{jobType}</span></Chip>}
                {openings && <Chip icon={UsersRound}>{openings}</Chip>}
                {!skills.length && <Chip tone="blue">{getCategoryFacet(job)}</Chip>}
            </div>

            {skills.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Skills mentioned">
                    {skills.map(name => <li key={name} className="skill-chip">{name}</li>)}
                </ul>
            )}

            <div className="mt-auto pt-4">
                <div className="flex items-center justify-between gap-3 border-t line-soft pt-3 text-xs">
                    <span className={cn('flex min-w-0 items-center gap-1.5', salary ? 'font-medium text-emerald-300 light:text-emerald-700' : 'tone-faint')}>
                        <Banknote className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span dir="auto" className="truncate">{salary || 'Salary not listed'}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 tone-muted">
                        {deadline && !deadline.urgent && <span className="whitespace-nowrap">{deadline.label}</span>}
                        {deadline && !deadline.urgent && <span aria-hidden="true">·</span>}
                        <span className="whitespace-nowrap font-medium">
                            {formatSource(job.source)}{sourceCount > 0 ? ` +${sourceCount}` : ''}
                        </span>
                    </span>
                </div>
            </div>
        </article>
    );
}

export const JobCard = memo(JobCardComponent);

