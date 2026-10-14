import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Bookmark,
  Briefcase,
  Clock,
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
  Zap,
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
  { id: 'afghanistan', label: 'In Afghanistan', shortLabel: 'Afghanistan', icon: MapPin },
  { id: 'remote', label: 'Remote', shortLabel: 'Remote', icon: Globe2 },
  { id: 'saved', label: 'Saved', shortLabel: 'Saved', icon: Bookmark },
];

const FILTERS = [
  {
    id: 'all',
    label: 'All open jobs',
    shortLabel: 'All',
    description: 'Every current technology opportunity',
    icon: Briefcase,
    accent: 'primary',
  },
  {
    id: 'recent',
    label: 'Recent',
    shortLabel: 'Recent',
    description: 'Posted or first discovered in the last 7 days',
    icon: Zap,
    accent: 'emerald',
  },
  {
    id: 'expiring',
    label: 'Expiring soon',
    shortLabel: 'Expiring',
    description: 'Closing today or within the next 3 days',
    icon: Clock,
    accent: 'orange',
  },
  {
    id: 'new',
    label: 'New since last visit',
    shortLabel: 'New',
    description: 'Discovered since you last opened this site',
    icon: Bell,
    accent: 'violet',
  },
];

const VIEW_DESCRIPTIONS = {
  afghanistan: 'Jobs based in Afghanistan, including remote roles posted by Afghan employers',
  remote: 'Remote technology roles open to applicants in Afghanistan',
  saved: 'Jobs you saved on this device',
};

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
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400 light:text-slate-600">
        {label}
      </span>
      <select
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="filter-select"
      >
        {children}
      </select>
    </label>
  );
}

function App() {
  const [jobs, setJobs] = useState([]);
  const jobsRef = useRef([]);
  const searchRef = useRef(null);
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
  const [visibleCount, setVisibleCount] = useState(9);
  const [theme, setTheme] = useState(getInitialTheme);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [selectedJobKey, setSelectedJobKey] = useState(getJobKeyFromUrl);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [savedKeys, setSavedKeys] = useState(readSavedJobs);
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
    setVisibleCount(9);
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
          // The dialog keeps the summary and links to the original listing.
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
  const activeFilter = visibleFilters.find(item => item.id === filter) || visibleFilters[0];

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

  const activeRefinementCount = [
    filter !== 'all',
    search.trim(),
    category !== 'all',
    skill !== 'all',
    eligibility !== 'all',
    company !== 'all',
    location !== 'all',
    salary !== 'all',
    vacancy !== 'all',
    sort !== 'default',
  ].filter(Boolean).length;

  const viewCount = id => (id === 'saved' ? savedKeys.size : scopeCounts[id]);

  return (
    <div className="min-h-screen selection:bg-primary/30">
      <a
        href="#jobs"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-slate-950 focus:shadow-xl"
      >
        Skip to jobs
      </a>

      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/10 light:bg-blue-600/[0.03] blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600/10 light:bg-purple-600/[0.03] blur-[120px]" />
      </div>

      <header className="fixed top-0 inset-x-0 z-40 border-b border-white/10 light:border-slate-200 bg-dark/90 light:bg-white/90 backdrop-blur-xl">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between" aria-label="Primary navigation">
          <a href={import.meta.env.BASE_URL || './'} className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-blue-400 flex items-center justify-center shadow-lg shadow-blue-600/25" aria-hidden="true">
              <span className="font-bold text-white">J</span>
            </span>
            <span className="text-base sm:text-lg font-bold text-white light:text-slate-900">
              Afghanistan Tech Jobs
            </span>
          </a>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => loadJobs()}
              disabled={isRefreshing || loadState === 'loading'}
              className="icon-button"
              aria-label="Reload the published jobs feed"
              title="Reload published jobs"
            >
              <RefreshCw className={cn('w-5 h-5', isRefreshing && 'animate-spin')} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
              className="icon-button"
              aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
              title={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            >
              {theme === 'dark'
                ? <Sun className="w-5 h-5" aria-hidden="true" />
                : <Moon className="w-5 h-5" aria-hidden="true" />}
            </button>
            <a
              href="https://github.com/nasirkhansayyad132/jobsaf-tracker"
              target="_blank"
              rel="noopener noreferrer"
              className="icon-button"
              aria-label="View this project on GitHub"
              title="View project on GitHub"
            >
              <Github className="w-5 h-5" aria-hidden="true" />
            </a>
          </div>
        </nav>
      </header>

      <main className="relative z-10">
        <section className="pt-24 pb-7 sm:pb-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center animate-in" aria-labelledby="page-title">
          <h1 id="page-title" className="mx-auto max-w-3xl text-3xl sm:text-5xl lg:text-[3.25rem] leading-[1.05] font-bold tracking-tight text-white light:text-slate-950">
            Find your next tech job
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm sm:text-base leading-6 text-slate-300 light:text-slate-700">
            Software, IT, data, networking, and security jobs across Afghanistan, plus remote roles you can apply for from Afghanistan.
          </p>

          <div className="max-w-2xl mx-auto mt-6 relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-violet-600 rounded-2xl blur opacity-20 group-focus-within:opacity-50 transition-opacity" aria-hidden="true" />
            <div className="relative bg-dark/90 light:bg-white border border-white/15 light:border-slate-300 rounded-xl p-2 flex items-center shadow-2xl">
              <Search className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400 ml-2 sm:ml-3 shrink-0" aria-hidden="true" />
              <label htmlFor="job-search" className="sr-only">Search jobs</label>
              <input
                ref={searchRef}
                id="job-search"
                type="search"
                autoComplete="off"
                placeholder="Search jobs, skills, or companies"
                value={search}
                onChange={event => setSearch(event.target.value)}
                className="w-full bg-transparent border-none text-white light:text-slate-950 px-3 sm:px-4 py-2 sm:py-3 focus:outline-none placeholder:text-slate-500 text-base sm:text-lg"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="p-2 mr-1 rounded-lg text-slate-400 hover:text-white light:hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-blue-400"
                  aria-label="Clear search"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              ) : (
                <kbd className="hidden sm:inline-flex mr-3 rounded-md border border-white/15 light:border-slate-300 px-2 py-0.5 text-xs text-slate-400 light:text-slate-600" title="Press / to search">/</kbd>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-slate-400 light:text-slate-600">
            <span className="inline-flex items-center gap-1.5" aria-live="polite" title="Shown in Afghanistan time">
              <span className={cn('h-1.5 w-1.5 rounded-full', isStale ? 'bg-amber-400 light:bg-amber-600' : 'bg-emerald-400 light:bg-emerald-600')} aria-hidden="true" />
              {formatUpdatedAt(updatedAt)}
            </span>
            {jobBoardCount > 0 && (
              <>
                <span className="text-slate-600 light:text-slate-400" aria-hidden="true">•</span>
                <a href="#sources" className="underline-offset-4 hover:underline">{jobBoardCount} job boards checked</a>
              </>
            )}
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-5" aria-label="Job views">
          <div className="view-tabs" role="tablist" aria-label="Choose which jobs to show">
            {VIEWS.map(item => {
              const Icon = item.icon;
              const selected = view === item.id;
              const count = viewCount(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => changeView(item.id)}
                  className={cn('view-tab', selected && 'view-tab-selected')}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="sm:hidden">{item.shortLabel}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                  {loadState === 'ready' && <span className="view-tab-count">{count}</span>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8" aria-label="Job status filters">
          <div className={cn('grid gap-2 sm:gap-4', visibleFilters.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
            {visibleFilters.map(item => {
              const Icon = item.icon;
              const count = stats[item.id === 'all' ? 'total' : item.id] ?? 0;
              const selected = filter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  aria-pressed={selected}
                  aria-describedby={`filter-${item.id}-description`}
                  className={cn('stat-card', selected && `stat-card-${item.accent}`)}
                >
                  <span className="flex items-center gap-2 sm:gap-3 mb-2">
                    <span className={cn('p-1.5 sm:p-2 rounded-lg', `stat-icon-${item.accent}`)} aria-hidden="true">
                      <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                    </span>
                    <span className="text-[10px] sm:text-xs font-semibold text-slate-300 light:text-slate-700 uppercase tracking-wide text-left">
                      <span className="sm:hidden">{item.shortLabel}</span>
                      <span className="hidden sm:inline">{item.label}</span>
                    </span>
                  </span>
                  <span className="block text-xl sm:text-3xl font-bold text-white light:text-slate-950 text-left">{count}</span>
                  <span id={`filter-${item.id}-description`} className="sr-only">{item.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8" aria-labelledby="refine-heading">
          <div className="rounded-2xl border border-white/10 light:border-slate-200 bg-white/[0.045] light:bg-white p-4 sm:p-5 shadow-lg shadow-slate-950/10">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5 shrink-0 text-blue-300 light:text-blue-700" aria-hidden="true" />
                  <h2 id="refine-heading" className="font-bold text-white light:text-slate-950">Refine jobs</h2>
                  {activeRefinementCount > 0 && (
                    <span className="hidden sm:inline-flex rounded-full bg-blue-500/15 light:bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-200 light:text-blue-800">
                      {activeRefinementCount} active
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs sm:text-sm text-slate-400 light:text-slate-600">
                  Filter by skill, technology, location, and details supplied by each original listing.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {activeRefinementCount > 0 && (
                  <button type="button" onClick={clearFilters} className="filter-clear-button">
                    <span className="sm:hidden">Clear</span>
                    <span className="hidden sm:inline">Clear all</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowRefinements(current => !current)}
                  className="secondary-button px-3 py-2"
                  aria-expanded={showRefinements}
                  aria-controls="refinement-controls"
                >
                  {showRefinements ? 'Hide filters' : `Show filters${activeRefinementCount ? ` (${activeRefinementCount})` : ''}`}
                </button>
              </div>
            </div>

            <div
              id="refinement-controls"
              className={cn(
                'mt-5 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4',
                showRefinements ? 'grid' : 'hidden',
              )}
            >
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
                  <option value="all">Any eligible location</option>
                  {facets.eligibility.map(item => <option key={item.value} value={item.value}>{item.label} ({item.count})</option>)}
                </RefinementSelect>
              ) : (
                <RefinementSelect id="location-filter" label="Location" value={location} onChange={setLocation}>
                  <option value="all">All locations</option>
                  {facets.locations.map(value => <option key={value} value={value}>{value}</option>)}
                </RefinementSelect>
              )}

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

              <RefinementSelect id="sort-jobs" label="Sort by" value={sort} onChange={setSort}>
                <option value="default">Recommended</option>
                <option value="newest">Newest posted</option>
                <option value="deadline">Deadline soonest</option>
                <option value="vacancies">Most openings</option>
                {facets.salary.canSort && <option value="salary">Highest comparable salary</option>}
                <option value="company">Company A–Z</option>
              </RefinementSelect>
            </div>
          </div>
        </section>

        <section id="jobs" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 scroll-mt-20" aria-labelledby="jobs-heading">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-6">
            <div>
              <h2 id="jobs-heading" className="text-2xl font-bold text-white light:text-slate-950">
                {VIEWS.find(item => item.id === view)?.label} · {activeFilter.label}
              </h2>
              <p className="text-sm text-slate-400 light:text-slate-600 mt-1">{VIEW_DESCRIPTIONS[view]}</p>
            </div>
            {loadState === 'ready' && (
              <p className="text-sm text-slate-300 light:text-slate-700" role="status" aria-live="polite">
                {filteredJobs.length} {filteredJobs.length === 1 ? 'match' : 'matches'}
                {search ? ` for “${search}”` : ''}
              </p>
            )}
          </div>

          {isStale && loadState === 'ready' && (
            <div className="status-banner status-banner-warning mb-6" role="status">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold text-white light:text-slate-950">These jobs were last refreshed {Math.floor(dataAgeHours / 24)} days ago</p>
                <p className="text-sm text-slate-300 light:text-slate-700">The daily update is delayed. Confirm deadlines on the original listing before applying.</p>
              </div>
            </div>
          )}

          {!isOnline && (
            <div className="status-banner mb-6" role="status">
              <WifiOff className="w-5 h-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold text-white light:text-slate-950">You are offline</p>
                <p className="text-sm text-slate-300 light:text-slate-700">Showing cached jobs when available. Application links need a connection.</p>
              </div>
            </div>
          )}

          {loadError && jobs.length > 0 && (
            <div className="status-banner status-banner-warning mb-6" role="status">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <div className="flex-1">
                <p className="font-semibold text-white light:text-slate-950">Could not check for newer data</p>
                <p className="text-sm text-slate-300 light:text-slate-700">The last loaded jobs remain available.</p>
              </div>
              <button type="button" className="text-sm font-semibold underline underline-offset-4" onClick={() => loadJobs()}>Try again</button>
            </div>
          )}

          {loadState === 'loading' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" role="status" aria-label="Loading the latest jobs">
              {Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton-card" aria-hidden="true" />)}
              <span className="sr-only">Loading the latest jobs…</span>
            </div>
          ) : loadState === 'error' ? (
            <div className="empty-state" role="alert">
              {isOnline
                ? <AlertTriangle className="w-10 h-10 text-amber-300 light:text-amber-700" aria-hidden="true" />
                : <WifiOff className="w-10 h-10 text-slate-300 light:text-slate-700" aria-hidden="true" />}
              <h3 className="text-xl font-bold text-white light:text-slate-950">Jobs could not be loaded</h3>
              <p className="max-w-md text-slate-300 light:text-slate-700">
                {isOnline ? loadError : 'Reconnect to the internet, then try loading the feed again.'}
              </p>
              <button type="button" onClick={() => loadJobs({ initial: true })} className="primary-button">Try again</button>
            </div>
          ) : view === 'saved' && savedKeys.size === 0 ? (
            <div className="empty-state">
              <Bookmark className="w-10 h-10 text-slate-400" aria-hidden="true" />
              <h3 className="text-xl font-bold text-white light:text-slate-950">No saved jobs yet</h3>
              <p className="max-w-md text-slate-300 light:text-slate-700">Tap the bookmark on any job to keep it here. Saved jobs stay on this device.</p>
            </div>
          ) : jobs.length === 0 ? (
            <div className="empty-state">
              <Briefcase className="w-10 h-10 text-slate-400" aria-hidden="true" />
              <h3 className="text-xl font-bold text-white light:text-slate-950">No open jobs are published yet</h3>
              <p className="text-slate-300 light:text-slate-700">The feed loaded correctly, but it currently contains no listings.</p>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="empty-state">
              <Search className="w-10 h-10 text-slate-400" aria-hidden="true" />
              <h3 className="text-xl font-bold text-white light:text-slate-950">No jobs match these filters</h3>
              <p className="text-slate-300 light:text-slate-700">Try a shorter search, another view, or clear the filters.</p>
              <button type="button" onClick={clearFilters} className="secondary-button">Clear search and filters</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in">
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

          {filteredJobs.length > visibleCount && loadState === 'ready' && (
            <div className="flex flex-col items-center gap-3 mt-12">
              <p className="text-sm text-slate-400 light:text-slate-600">
                Showing {visibleCount} of {filteredJobs.length} matching jobs
              </p>
              <button
                type="button"
                onClick={() => setVisibleCount(current => current + 12)}
                className="secondary-button"
              >
                Show more jobs
              </button>
            </div>
          )}
        </section>

        <SourceStatus health={summary?.source_health} />
      </main>

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
