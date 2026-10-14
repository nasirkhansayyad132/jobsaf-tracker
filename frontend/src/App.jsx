import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Bookmark,
  BriefcaseBusiness,
  Github,
  Globe2,
  MapPin,
  Moon,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sun,
  WifiOff,
  X,
} from 'lucide-react';
import { JobCard } from './components/JobCard';
import { JobDetails } from './components/JobDetails';
import { SourceStatus } from './components/SourceStatus';
import { cn } from './lib/utils';
import { loadFeed, loadJobDetail, loadSummary } from './lib/feed';
import { readSavedJobs, readView, takeLastVisit, writeSavedJobs, writeView } from './lib/storage';
import {
  getAfghanistanToday,
  getJobFacets,
  getJobKey,
  getJobStats,
  getLastUpdated,
  getScopeCounts,
  groupJobs,
  matchesScope,
  selectJobs,
} from './lib/jobs';

const VIEWS = [
  { id: 'afghanistan', label: 'Afghanistan', icon: MapPin },
  { id: 'remote', label: 'Remote', icon: Globe2 },
  { id: 'saved', label: 'Saved', icon: Bookmark },
];

const FILTERS = [
  { id: 'all', label: 'All jobs', statKey: 'total' },
  { id: 'recent', label: 'Posted this week', statKey: 'recent' },
  { id: 'expiring', label: 'Closing soon', statKey: 'expiring' },
  { id: 'new', label: 'New since last visit', statKey: 'new' },
];

const VIEW_HEADINGS = {
  afghanistan: 'Tech jobs in Afghanistan',
  remote: 'Remote tech jobs open to Afghanistan',
  saved: 'Your saved jobs',
};

const VIEW_DESCRIPTIONS = {
  afghanistan: 'Based in Afghanistan, including remote roles posted by Afghan employers.',
  remote: 'Only roles that people living in Afghanistan can apply for.',
  saved: 'Kept on this device only.',
};

const SORT_LABELS = {
  default: 'Recommended',
  newest: 'Newest posted',
  deadline: 'Deadline soonest',
  vacancies: 'Most openings',
  salary: 'Highest comparable salary',
  company: 'Company A–Z',
};

const PAGE_SIZE = 12;

// The daily refresh runs every morning; older data means a delayed run.
const STALE_AFTER_HOURS = 36;

// Read once per page load (not per render) so "new" markers stay stable.
const lastVisit = takeLastVisit();

function getInitialTheme() {
  try {
    const saved = localStorage.getItem('jobsaf_theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage can be blocked in private or hardened browser contexts.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getJobKeyFromUrl() {
  return new URLSearchParams(window.location.search).get('job') || '';
}

function getInitialView() {
  const fromUrl = new URLSearchParams(window.location.search).get('view');
  if (VIEWS.some(view => view.id === fromUrl)) return fromUrl;
  return readView() || 'afghanistan';
}

function formatUpdatedAt(value) {
  if (!value || Number.isNaN(value.getTime())) return 'Update time unavailable';
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    timeZone: 'Asia/Kabul',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value)}`;
}

function hoursSince(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / 3_600_000;
}

function RefinementSelect({ id, label, value, onChange, children }) {
  return (
    <label htmlFor={id} className="min-w-0">
      <span className="fact-label mb-1.5 block">{label}</span>
      <select id={id} value={value} onChange={event => onChange(event.target.value)} className="filter-select">
        {children}
      </select>
    </label>
  );
}

function ActiveFilter({ label, onClear }) {
  return (
    <span className="active-filter">
      {label}
      <button type="button" onClick={onClear} aria-label={`Remove filter ${label}`}>
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

function App() {
  const [jobs, setJobs] = useState([]);
  const jobsRef = useRef([]);
  const searchRef = useRef(null);
  const sentinelRef = useRef(null);
  const [loadState, setLoadState] = useState('loading');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [summary, setSummary] = useState(null);
  const [view, setView] = useState(getInitialView);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const [skill, setSkill] = useState('all');
  const [eligibility, setEligibility] = useState('all');
  const [company, setCompany] = useState('all');
  const [location, setLocation] = useState('all');
  const [salary, setSalary] = useState('all');
  const [vacancy, setVacancy] = useState('all');
  const [sort, setSort] = useState('default');
  const [showRefinements, setShowRefinements] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [theme, setTheme] = useState(getInitialTheme);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [selectedJobKey, setSelectedJobKey] = useState(getJobKeyFromUrl);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [savedKeys, setSavedKeys] = useState(readSavedJobs);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [now, setNow] = useState(getAfghanistanToday);
  const openedModalInSessionRef = useRef(false);

  const loadJobs = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoadState('loading');
    else setIsRefreshing(true);
    setLoadError('');

    try {
      const [feed, latestSummary] = await Promise.all([loadFeed(), loadSummary()]);
      jobsRef.current = feed.jobs;
      setJobs(feed.jobs);
      setSummary(latestSummary);
      setLoadState('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The jobs feed could not be loaded.';
      setLoadError(message);
      setLoadState(jobsRef.current.length ? 'ready' : 'error');
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadJobs({ initial: true });
  }, [loadJobs]);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('jobsaf_theme', theme);
    } catch {
      // Theme still works for this session when persistent storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    writeView(view);
  }, [view]);

  useEffect(() => {
    writeSavedJobs(savedKeys);
  }, [savedKeys]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(getAfghanistanToday()), 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      openedModalInSessionRef.current = false;
      setSelectedJobKey(getJobKeyFromUrl());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // "/" jumps to search, as on most job boards.
  useEffect(() => {
    const handleKey = event => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    const handleScroll = () => setShowBackToTop(window.scrollY > 900);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [view, search, filter, category, skill, eligibility, company, location, salary, vacancy, sort]);

  const scope = view === 'saved' ? 'all' : view;
  const scopedSaved = view === 'saved' ? savedKeys : null;
  const scopeCounts = useMemo(() => getScopeCounts(jobs, now), [jobs, now]);
  const stats = useMemo(
    () => getJobStats(
      view === 'saved' ? jobs.filter(job => savedKeys.has(getJobKey(job))) : jobs,
      now,
      { scope, newSince: lastVisit },
    ),
    [jobs, now, scope, view, savedKeys],
  );
  const facets = useMemo(
    () => getJobFacets(jobs.filter(job => matchesScope(job, scope)), now),
    [jobs, now, scope],
  );
  const filteredJobs = useMemo(
    () => groupJobs(selectJobs(jobs, {
      query: search,
      filter,
      scope,
      savedKeys: scopedSaved,
      newSince: lastVisit,
      now,
      category,
      skill,
      eligibility,
      company,
      location,
      salary,
      vacancy,
      sort: sort === 'default' ? undefined : sort,
    })),
    [jobs, search, filter, scope, scopedSaved, now, category, skill, eligibility, company, location, salary, vacancy, sort],
  );
  const hasMore = filteredJobs.length > visibleCount;

  // Load the next page automatically as the end of the list scrolls into view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisibleCount(current => current + PAGE_SIZE);
    }, { rootMargin: '600px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, filteredJobs]);

  const selectedJob = useMemo(
    () => (selectedJobKey ? jobs.find(job => getJobKey(job) === selectedJobKey) || null : null),
    [jobs, selectedJobKey],
  );
  const selectedGroup = useMemo(() => {
    if (!selectedJob?.group_id) return selectedJob;
    const variants = jobs.filter(job => job.group_id === selectedJob.group_id);
    return variants.length > 1 ? { ...selectedJob, variants } : selectedJob;
  }, [jobs, selectedJob]);

  useEffect(() => {
    let cancelled = false;
    setSelectedDetail(selectedGroup);
    if (selectedGroup) {
      loadJobDetail(selectedGroup)
        .then(detail => {
          if (!cancelled) setSelectedDetail(detail);
        })
        .catch(() => {
          // The panel keeps the summary and links to the original listing.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedGroup]);

  const jobBoardCount = useMemo(() => {
    const sources = new Set((summary?.source_health || []).map(item => item.source));
    jobs.forEach(job => {
      if (job.source) sources.add(String(job.source).toLowerCase());
      (job.also_found_on || []).forEach(item => item?.source && sources.add(String(item.source).toLowerCase()));
    });
    return sources.size;
  }, [jobs, summary]);
  const generatedAt = summary?.generated_at ? new Date(summary.generated_at) : null;
  const updatedAt = generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt : getLastUpdated(jobs);
  const dataAgeHours = hoursSince(updatedAt);
  const isStale = dataAgeHours !== null && dataAgeHours > STALE_AFTER_HOURS;
  const visibleFilters = FILTERS.filter(item => item.id !== 'new' || lastVisit);
  const popularSkills = facets.skills.slice(0, 7);

  const openJob = useCallback((job) => {
    const key = getJobKey(job);
    if (!key) return;
    const url = new URL(window.location.href);
    url.searchParams.set('job', key);
    window.history.pushState({ ...window.history.state, jobsafJobModal: true }, '', url);
    openedModalInSessionRef.current = true;
    setSelectedJobKey(key);
  }, []);

  const closeJob = useCallback(() => {
    if (openedModalInSessionRef.current && window.history.state?.jobsafJobModal) {
      openedModalInSessionRef.current = false;
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('job');
    window.history.replaceState(window.history.state, '', url);
    setSelectedJobKey('');
  }, []);

  const toggleSaved = useCallback((job) => {
    const key = getJobKey(job);
    if (!key) return;
    setSavedKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const changeView = useCallback((next) => {
    setView(next);
    setEligibility('all');
    setLocation('all');
    setCompany('all');
    const url = new URL(window.location.href);
    url.searchParams.set('view', next);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setFilter('all');
    setCategory('all');
    setSkill('all');
    setEligibility('all');
    setCompany('all');
    setLocation('all');
    setSalary('all');
    setVacancy('all');
    setSort('default');
  }, []);

  const eligibilityLabel = facets.eligibility.find(item => item.value === eligibility)?.label || eligibility;
  const activeFilters = [
    search.trim() && { key: 'search', label: `“${search.trim()}”`, clear: () => setSearch('') },
    skill !== 'all' && { key: 'skill', label: skill, clear: () => setSkill('all') },
    category !== 'all' && { key: 'category', label: category, clear: () => setCategory('all') },
    eligibility !== 'all' && { key: 'eligibility', label: eligibilityLabel, clear: () => setEligibility('all') },
    location !== 'all' && { key: 'location', label: location, clear: () => setLocation('all') },
    company !== 'all' && { key: 'company', label: company, clear: () => setCompany('all') },
    salary !== 'all' && { key: 'salary', label: `Salary: ${salary}`, clear: () => setSalary('all') },
    vacancy !== 'all' && { key: 'vacancy', label: `Openings: ${vacancy}`, clear: () => setVacancy('all') },
    sort !== 'default' && { key: 'sort', label: `Sort: ${SORT_LABELS[sort]}`, clear: () => setSort('default') },
  ].filter(Boolean);
  const refinementCount = activeFilters.filter(item => item.key !== 'search').length;

  const viewCount = id => (id === 'saved' ? savedKeys.size : scopeCounts[id]);

  return (
    <div className="min-h-screen">
      <a
        href="#jobs"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-slate-950 focus:shadow-xl"
      >
        Skip to jobs
      </a>

      <header className="app-header sticky top-0 z-40">
        <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8" aria-label="Primary navigation">
          <a href={import.meta.env.BASE_URL || './'} className="flex items-center gap-2.5 rounded-lg">
            <span className="brand-mark" aria-hidden="true">
              <BriefcaseBusiness className="h-4 w-4" />
            </span>
            <span className="text-[15px] font-bold tracking-tight tone-strong">
              Afghanistan Tech Jobs
            </span>
          </a>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => loadJobs()}
              disabled={isRefreshing || loadState === 'loading'}
              className="icon-button"
              aria-label="Reload the published jobs feed"
              title="Reload jobs"
            >
              <RefreshCw className={cn('h-[18px] w-[18px]', isRefreshing && 'animate-spin')} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
              className="icon-button"
              aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            >
              {theme === 'dark'
                ? <Sun className="h-[18px] w-[18px]" aria-hidden="true" />
                : <Moon className="h-[18px] w-[18px]" aria-hidden="true" />}
            </button>
            <a
              href="https://github.com/nasirkhansayyad132/jobsaf-tracker"
              target="_blank"
              rel="noopener noreferrer"
              className="icon-button"
              aria-label="View this project on GitHub"
              title="GitHub"
            >
              <Github className="h-[18px] w-[18px]" aria-hidden="true" />
            </a>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-4 pt-10 pb-8 text-center sm:px-6 sm:pt-14 animate-in" aria-labelledby="page-title">
          <h1 id="page-title" className="text-3xl font-extrabold tracking-tight tone-strong sm:text-5xl">
            Find your next tech job
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 tone-muted sm:text-base">
            Software, IT, data, networking and security jobs across Afghanistan, plus remote roles you can apply for from Afghanistan.
          </p>

          <div className="search-box mx-auto mt-6 max-w-2xl">
            <Search className="h-5 w-5 shrink-0 tone-faint" aria-hidden="true" />
            <label htmlFor="job-search" className="sr-only">Search jobs</label>
            <input
              ref={searchRef}
              id="job-search"
              type="search"
              autoComplete="off"
              placeholder="Job title, skill, or company"
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="w-full min-w-0 bg-transparent py-2.5 text-base tone-strong placeholder:text-slate-500 focus:outline-none"
            />
            {search ? (
              <button type="button" onClick={() => setSearch('')} className="icon-button -mr-2" aria-label="Clear search">
                <X className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            ) : (
              <kbd className="hidden rounded-md border line-soft px-2 py-0.5 text-xs tone-faint sm:inline-flex" title="Press / to search">/</kbd>
            )}
          </div>

          {popularSkills.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2" aria-label="Popular skills">
              <span className="text-xs tone-faint">Popular:</span>
              {popularSkills.map(item => (
                <button
                  key={item.name}
                  type="button"
                  className="quick-chip"
                  aria-pressed={skill === item.name}
                  onClick={() => setSkill(current => (current === item.name ? 'all' : item.name))}
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}

          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs tone-faint">
            <span className="inline-flex items-center gap-1.5" title="Shown in Afghanistan time">
              <span className={cn('h-1.5 w-1.5 rounded-full', isStale ? 'bg-amber-400' : 'bg-emerald-400')} aria-hidden="true" />
              {formatUpdatedAt(updatedAt)}
            </span>
            {jobBoardCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <a href="#sources" className="underline-offset-4 hover:underline">{jobBoardCount} job boards checked daily</a>
              </>
            )}
          </p>
        </section>

        <div className="toolbar sticky top-14 z-30">
          <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
            <div className="view-tabs" role="tablist" aria-label="Choose which jobs to show">
              {VIEWS.map(item => {
                const Icon = item.icon;
                const selected = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => changeView(item.id)}
                    className={cn('view-tab', selected && 'view-tab-selected')}
                  >
                    <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
                    {item.label}
                    {loadState === 'ready' && <span className="view-tab-count">{viewCount(item.id)}</span>}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <div className="pill-scroll min-w-0 flex-1" aria-label="Job status filters">
                {visibleFilters.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className="filter-pill"
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                    <span className="filter-pill-count">{stats[item.statKey] ?? 0}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowRefinements(current => !current)}
                className={cn('secondary-button shrink-0 rounded-full px-3 py-1.5', showRefinements && 'ring-2 ring-blue-500/40')}
                aria-expanded={showRefinements}
                aria-controls="refinement-controls"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">Filters</span>
                {refinementCount > 0 && (
                  <span className="rounded-md bg-blue-600 px-1.5 text-[11px] font-bold leading-5 text-white">{refinementCount}</span>
                )}
              </button>
            </div>
          </div>

          <div
            id="refinement-controls"
            className={cn('mx-auto max-w-7xl px-4 pb-4 sm:px-6 lg:px-8', showRefinements ? 'block' : 'hidden')}
          >
            <div className="filter-panel grid max-h-[calc(100dvh-11rem)] grid-cols-1 gap-4 overflow-y-auto rounded-2xl p-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
              <RefinementSelect id="skill-filter" label="Skill" value={skill} onChange={setSkill}>
                <option value="all">Any skill</option>
                {facets.skills.map(item => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
              </RefinementSelect>

              <RefinementSelect id="category-filter" label="Technology area" value={category} onChange={setCategory}>
                <option value="all">All areas</option>
                {facets.categories.map(value => <option key={value} value={value}>{value}</option>)}
              </RefinementSelect>

              {view === 'remote' ? (
                <RefinementSelect id="eligibility-filter" label="Who can apply" value={eligibility} onChange={setEligibility}>
                  <option value="all">Anyone eligible</option>
                  {facets.eligibility.map(item => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}
                </RefinementSelect>
              ) : (
                <RefinementSelect id="location-filter" label="Location" value={location} onChange={setLocation}>
                  <option value="all">All locations</option>
                  {facets.locations.map(value => <option key={value} value={value}>{value}</option>)}
                </RefinementSelect>
              )}

              <RefinementSelect id="sort-jobs" label="Sort by" value={sort} onChange={setSort}>
                {Object.entries(SORT_LABELS)
                  .filter(([value]) => value !== 'salary' || facets.salary.canSort)
                  .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </RefinementSelect>

              <RefinementSelect id="company-filter" label="Company" value={company} onChange={setCompany}>
                <option value="all">All companies</option>
                {facets.companies.map(value => <option key={value} value={value}>{value}</option>)}
              </RefinementSelect>

              <RefinementSelect id="salary-filter" label="Salary details" value={salary} onChange={setSalary}>
                <option value="all">Any salary</option>
                <option value="scale">Scale or standard ({facets.salary.scale})</option>
                <option value="negotiable">Negotiable ({facets.salary.negotiable})</option>
                <option value="undisclosed">Not disclosed ({facets.salary.undisclosed})</option>
              </RefinementSelect>

              <RefinementSelect id="vacancy-filter" label="Number of openings" value={vacancy} onChange={setVacancy}>
                <option value="all">Any openings</option>
                <option value="1">1 opening ({facets.vacancies.one})</option>
                <option value="2-5">2–5 openings ({facets.vacancies.twoToFive})</option>
                <option value="6-10">6–10 openings ({facets.vacancies.sixToTen})</option>
                <option value="11+">11+ openings ({facets.vacancies.elevenPlus})</option>
              </RefinementSelect>

              <div className="col-span-full flex items-end justify-end gap-2 lg:col-span-1">
                <button type="button" onClick={clearFilters} className="filter-clear-button">Reset all</button>
                <button type="button" onClick={() => setShowRefinements(false)} className="primary-button px-4 py-2">Done</button>
              </div>
            </div>
          </div>
        </div>

        <section id="jobs" className="mx-auto max-w-7xl scroll-mt-40 px-4 pt-6 pb-16 sm:px-6 lg:px-8" aria-labelledby="jobs-heading">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="jobs-heading" className="text-xl font-bold tracking-tight tone-strong">{VIEW_HEADINGS[view]}</h2>
              <p className="mt-1 text-sm tone-muted">{VIEW_DESCRIPTIONS[view]}</p>
            </div>
            {loadState === 'ready' && (
              <p className="text-sm font-medium tone-muted" role="status" aria-live="polite">
                {filteredJobs.length} {filteredJobs.length === 1 ? 'job' : 'jobs'}
              </p>
            )}
          </div>

          {activeFilters.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-2" aria-label="Active filters">
              {activeFilters.map(item => <ActiveFilter key={item.key} label={item.label} onClear={item.clear} />)}
              <button type="button" onClick={clearFilters} className="filter-clear-button">Clear all</button>
            </div>
          )}

          {isStale && loadState === 'ready' && (
            <div className="status-banner status-banner-warning mb-5" role="status">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">These jobs were last refreshed {Math.floor(dataAgeHours / 24)} days ago</p>
                <p className="text-sm opacity-90">The daily update is delayed. Confirm deadlines on the original listing before applying.</p>
              </div>
            </div>
          )}

          {!isOnline && (
            <div className="status-banner mb-5" role="status">
              <WifiOff className="h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">You are offline</p>
                <p className="text-sm opacity-90">Showing saved copies of jobs. Application links need a connection.</p>
              </div>
            </div>
          )}

          {loadError && jobs.length > 0 && (
            <div className="status-banner status-banner-warning mb-5" role="status">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <p className="font-semibold">Could not check for newer jobs</p>
                <p className="text-sm opacity-90">The jobs already loaded are still available.</p>
              </div>
              <button type="button" className="text-sm font-semibold underline underline-offset-4" onClick={() => loadJobs()}>Try again</button>
            </div>
          )}

          {loadState === 'loading' ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading the latest jobs">
              {Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton-card" aria-hidden="true" />)}
              <span className="sr-only">Loading the latest jobs…</span>
            </div>
          ) : loadState === 'error' ? (
            <div className="empty-state" role="alert">
              {isOnline
                ? <AlertTriangle className="h-9 w-9 text-amber-400" aria-hidden="true" />
                : <WifiOff className="h-9 w-9 tone-faint" aria-hidden="true" />}
              <h3 className="text-lg font-bold tone-strong">Jobs could not be loaded</h3>
              <p className="max-w-md text-sm tone-muted">
                {isOnline ? loadError : 'Reconnect to the internet, then try again.'}
              </p>
              <button type="button" onClick={() => loadJobs({ initial: true })} className="primary-button">Try again</button>
            </div>
          ) : view === 'saved' && savedKeys.size === 0 ? (
            <div className="empty-state">
              <Bookmark className="h-9 w-9 tone-faint" aria-hidden="true" />
              <h3 className="text-lg font-bold tone-strong">No saved jobs yet</h3>
              <p className="max-w-md text-sm tone-muted">Tap the bookmark on any job to keep it here. Saved jobs stay on this device.</p>
              <button type="button" onClick={() => changeView('afghanistan')} className="secondary-button">Browse jobs</button>
            </div>
          ) : jobs.length === 0 ? (
            <div className="empty-state">
              <BriefcaseBusiness className="h-9 w-9 tone-faint" aria-hidden="true" />
              <h3 className="text-lg font-bold tone-strong">No open jobs are published yet</h3>
              <p className="text-sm tone-muted">The feed loaded correctly, but it currently has no listings.</p>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="empty-state">
              <Search className="h-9 w-9 tone-faint" aria-hidden="true" />
              <h3 className="text-lg font-bold tone-strong">No jobs match</h3>
              <p className="text-sm tone-muted">Try a shorter search, another tab, or fewer filters.</p>
              <button type="button" onClick={clearFilters} className="secondary-button">Clear search and filters</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 animate-in">
              {filteredJobs.slice(0, visibleCount).map(job => (
                <JobCard
                  key={getJobKey(job)}
                  job={job}
                  onSelect={openJob}
                  onToggleSaved={toggleSaved}
                  saved={savedKeys.has(getJobKey(job))}
                  newSince={lastVisit}
                  now={now}
                />
              ))}
            </div>
          )}

          {hasMore && loadState === 'ready' && (
            <div ref={sentinelRef} className="mt-8 flex flex-col items-center gap-2">
              <button type="button" onClick={() => setVisibleCount(current => current + PAGE_SIZE)} className="secondary-button">
                Show more jobs
              </button>
              <p className="text-xs tone-faint">Showing {visibleCount} of {filteredJobs.length}</p>
            </div>
          )}
        </section>

        <SourceStatus health={summary?.source_health} />
      </main>

      <footer className="border-t line-soft">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs tone-faint sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>Listings are collected automatically every day. Always confirm details on the original posting.</p>
          <a href="https://github.com/nasirkhansayyad132/jobsaf-tracker" target="_blank" rel="noopener noreferrer" className="hover:underline underline-offset-4">
            Open source on GitHub
          </a>
        </div>
      </footer>

      {showBackToTop && (
        <button
          type="button"
          className="back-to-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          title="Back to top"
        >
          <ArrowUp className="h-5 w-5" aria-hidden="true" />
        </button>
      )}

      {selectedDetail && (
        <JobDetails
          job={selectedDetail}
          onClose={closeJob}
          onSelectVariant={openJob}
          onToggleSaved={toggleSaved}
          saved={savedKeys.has(getJobKey(selectedDetail))}
        />
      )}
    </div>
  );
}

export default App;
