import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Briefcase,
  Clock,
  Github,
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
import { cn } from './lib/utils';
import {
  getJobKey,
  getJobFacets,
  getJobStats,
  getAfghanistanToday,
  getLastUpdated,
  selectJobs,
} from './lib/jobs';

const FILTERS = [
  {
    id: 'all',
    label: 'All open jobs',
    shortLabel: 'All jobs',
    description: 'Every current technology opportunity',
    icon: Briefcase,
    accent: 'primary',
  },
  {
    id: 'recent',
    label: 'Recent jobs',
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
];

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

function formatUpdatedAt(value) {
  if (!value || Number.isNaN(value.getTime())) return 'Feed generation time unavailable';
  return `Feed generated ${new Intl.DateTimeFormat(undefined, {
    timeZone: 'Asia/Kabul',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(value)}`;
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
  const [loadState, setLoadState] = useState('loading');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [generatedAt, setGeneratedAt] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
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
  const [now, setNow] = useState(getAfghanistanToday);
  const openedModalInSessionRef = useRef(false);

  const loadJobs = useCallback(async ({ initial = false } = {}) => {
    if (initial) setLoadState('loading');
    else setIsRefreshing(true);
    setLoadError('');

    try {
      const base = import.meta.env.BASE_URL || './';
      const jobsResponse = await fetch(`${base}data/jobs.json`, { cache: 'no-cache' });
      if (!jobsResponse.ok) throw new Error(`The jobs feed returned ${jobsResponse.status}.`);

      const data = await jobsResponse.json();
      if (!Array.isArray(data)) throw new Error('The jobs feed has an unexpected format.');

      const usableJobs = data.filter(job => job && typeof job === 'object' && job.title);
      jobsRef.current = usableJobs;
      setJobs(usableJobs);
      setLoadState('ready');
      setGeneratedAt(null);

      try {
        const summaryResponse = await fetch(`${base}data/summary.json`, { cache: 'no-cache' });
        if (summaryResponse.ok) {
          const summary = await summaryResponse.json();
          const summaryDate = new Date(summary?.generated_at || '');
          if (!Number.isNaN(summaryDate.getTime())) setGeneratedAt(summaryDate);
        }
      } catch {
        // Summary metadata is helpful but must never prevent the jobs from rendering.
      }
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

  useEffect(() => {
    setVisibleCount(9);
  }, [search, filter, category, company, location, salary, vacancy, sort]);

  const stats = useMemo(() => getJobStats(jobs, now), [jobs, now]);
  const facets = useMemo(() => getJobFacets(jobs, now), [jobs, now]);
  const filteredJobs = useMemo(
    () => selectJobs(jobs, {
      query: search,
      filter,
      now,
      category,
      company,
      location,
      salary,
      vacancy,
      sort: sort === 'default' ? undefined : sort,
    }),
    [jobs, search, filter, now, category, company, location, salary, vacancy, sort],
  );
  const selectedJob = useMemo(
    () => jobs.find(job => getJobKey(job) === selectedJobKey) || null,
    [jobs, selectedJobKey],
  );
  const sourceCount = useMemo(
    () => new Set(jobs.map(job => job.source).filter(Boolean)).size,
    [jobs],
  );
  const updatedAt = generatedAt || getLastUpdated(jobs);
  const activeFilter = FILTERS.find(item => item.id === filter) || FILTERS[0];

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

  const clearFilters = useCallback(() => {
    setSearch('');
    setFilter('all');
    setCategory('all');
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
    company !== 'all',
    location !== 'all',
    salary !== 'all',
    vacancy !== 'all',
    sort !== 'default',
  ].filter(Boolean).length;

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
        <section className="pt-24 pb-8 sm:pt-32 sm:pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center animate-in" aria-labelledby="page-title">
          <p className="mb-3 text-sm font-semibold tracking-[0.18em] uppercase text-blue-300 light:text-blue-700">
            Technology opportunities across Afghanistan
          </p>
          <h1 id="page-title" className="text-4xl sm:text-6xl font-bold tracking-tight mb-4 text-white light:text-slate-950">
            Find work that moves your career forward
          </h1>
          <p className="text-base sm:text-lg text-slate-300 light:text-slate-700 max-w-2xl mx-auto mb-5">
            Browse software, IT, data, networking, security, and other technology roles collected from trusted job boards.
          </p>
          <p className="text-xs sm:text-sm text-slate-400 light:text-slate-600 mb-8" aria-live="polite">
            {formatUpdatedAt(updatedAt)}{sourceCount ? ` · ${sourceCount} sources` : ''} · Always confirm details on the original listing
          </p>

          <div className="max-w-2xl mx-auto relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-violet-600 rounded-2xl blur opacity-20 group-focus-within:opacity-50 transition-opacity" aria-hidden="true" />
            <div className="relative bg-dark/90 light:bg-white border border-white/15 light:border-slate-300 rounded-xl p-2 flex items-center shadow-2xl">
              <Search className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400 ml-2 sm:ml-3 shrink-0" aria-hidden="true" />
              <label htmlFor="job-search" className="sr-only">Search jobs</label>
              <input
                id="job-search"
                type="search"
                autoComplete="off"
                placeholder="Search title, company, skill, or location"
                value={search}
                onChange={event => setSearch(event.target.value)}
                className="w-full bg-transparent border-none text-white light:text-slate-950 px-3 sm:px-4 py-2 sm:py-3 focus:outline-none placeholder:text-slate-500 text-base sm:text-lg"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="p-2 mr-1 rounded-lg text-slate-400 hover:text-white light:hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-blue-400"
                  aria-label="Clear search"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8" aria-label="Job status filters">
          <div className="grid grid-cols-3 gap-2 sm:gap-6">
            {FILTERS.map(item => {
              const Icon = item.icon;
              const count = item.id === 'all' ? stats.total : item.id === 'recent' ? stats.recent : stats.expiring;
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
                  Filter using details supplied by each original listing.
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
                'mt-5 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
                showRefinements ? 'grid' : 'hidden',
              )}
            >
              <RefinementSelect id="category-filter" label="Technology category" value={category} onChange={setCategory}>
                <option value="all">All categories</option>
                {facets.categories.map(value => <option key={value} value={value}>{value}</option>)}
              </RefinementSelect>

              <RefinementSelect id="location-filter" label="Location" value={location} onChange={setLocation}>
                <option value="all">All locations</option>
                {facets.locations.map(value => <option key={value} value={value}>{value}</option>)}
              </RefinementSelect>

              <RefinementSelect id="company-filter" label="Company" value={company} onChange={setCompany}>
                <option value="all">All companies</option>
                {facets.companies.map(value => <option key={value} value={value}>{value}</option>)}
              </RefinementSelect>

              <RefinementSelect id="salary-filter" label="Salary details" value={salary} onChange={setSalary}>
                <option value="all">Any salary ({stats.total})</option>
                <option value="scale">Scale or standard ({facets.salary.scale})</option>
                <option value="negotiable">Negotiable ({facets.salary.negotiable})</option>
                <option value="undisclosed">Not disclosed ({facets.salary.undisclosed})</option>
              </RefinementSelect>

              <RefinementSelect id="vacancy-filter" label="Number of openings" value={vacancy} onChange={setVacancy}>
                <option value="all">Any openings ({stats.total})</option>
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

        <section id="jobs" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 scroll-mt-20" aria-labelledby="jobs-heading">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-6">
            <div>
              <h2 id="jobs-heading" className="text-2xl font-bold text-white light:text-slate-950">{activeFilter.label}</h2>
              <p className="text-sm text-slate-400 light:text-slate-600 mt-1">{activeFilter.description}</p>
            </div>
            {loadState === 'ready' && (
              <p className="text-sm text-slate-300 light:text-slate-700" role="status" aria-live="polite">
                {filteredJobs.length} {filteredJobs.length === 1 ? 'match' : 'matches'}
                {search ? ` for “${search}”` : ''}
              </p>
            )}
          </div>

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
            <div className="flex flex-col items-center justify-center py-24 text-slate-300 light:text-slate-700" role="status">
              <RefreshCw className="w-9 h-9 animate-spin mb-4 text-blue-400 light:text-blue-700" aria-hidden="true" />
              <p className="font-medium">Loading the latest jobs…</p>
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
              <p className="text-slate-300 light:text-slate-700">Try a shorter search or view all open technology jobs.</p>
              <button type="button" onClick={clearFilters} className="secondary-button">Clear search and filters</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in">
              {filteredJobs.slice(0, visibleCount).map(job => (
                <JobCard key={getJobKey(job)} job={job} onSelect={openJob} now={now} />
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
      </main>

      {selectedJob && <JobDetails job={selectedJob} onClose={closeJob} />}
    </div>
  );
}

export default App;
