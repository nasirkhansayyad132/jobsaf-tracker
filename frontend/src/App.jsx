import React, { useState, useEffect } from 'react';
import { Search, Filter, Briefcase, RefreshCw, Bell, Sparkles, Sun, Moon, TrendingUp, Clock, Zap, Lock, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { JobCard } from './components/JobCard';
import { JobDetails } from './components/JobDetails';
import { cn } from './lib/utils';
import { parse, isValid, isAfter, subDays } from 'date-fns';

function App() {
  const [jobs, setJobs] = useState([]);
  const [filteredJobs, setFilteredJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all, new, expiring
  const [selectedJob, setSelectedJob] = useState(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [newJobUrls, setNewJobUrls] = useState(new Set()); // Track newly added jobs
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('jobaf_auth') === 'true';
  });

  const [inputPassword, setInputPassword] = useState('');
  const [passError, setPassError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const MASTER_PASSWORD = 'Jobaf2026';

  const handleLogin = (e) => {
    e.preventDefault();
    if (inputPassword === MASTER_PASSWORD) {
      setIsAuthenticated(true);
      localStorage.setItem('jobaf_auth', 'true');
    } else {
      setPassError(true);
      setTimeout(() => setPassError(false), 500);
      setInputPassword('');
    }
  };

  useEffect(() => {
    if (!isDarkMode) {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    fetchJobs();
    checkNotificationPermission();
  }, []);

  useEffect(() => {
    filterJobs();
  }, [jobs, search, filter]);

  const fetchJobs = async (triggerScrape = false) => {
    setLoading(true);
    try {
      if (triggerScrape) {
        // Remember existing job URLs before scrape
        const existingUrls = new Set(jobs.map(j => j.url));

        // Call the API server to trigger incremental scrape
        const apiRes = await fetch('http://localhost:3001/api/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const apiData = await apiRes.json();

        if (apiData.success && apiData.jobs) {
          // Find NEW jobs (URLs not in existing set)
          const freshUrls = apiData.jobs
            .filter(j => !existingUrls.has(j.url))
            .map(j => j.url);
          setNewJobUrls(new Set(freshUrls));

          // Sort by closing date (soonest first)
          const sorted = apiData.jobs.sort((a, b) => {
            if (!a.closing_date) return 1;
            if (!b.closing_date) return -1;
            return new Date(a.closing_date) - new Date(b.closing_date);
          });
          setJobs(sorted);

          const newCount = freshUrls.length;
          alert(`✅ ${apiData.message}${newCount > 0 ? ` (${newCount} NEW!)` : ''}`);
        } else {
          alert(`⚠️ ${apiData.message || 'Scrape failed'}`);
        }
      } else {
        // Just load from local file (initial load)
        const res = await fetch('data/jobs.json');
        if (!res.ok) throw new Error('Failed to load jobs');
        const data = await res.json();

        // Filter out expired jobs strictly
        const todayStr = new Date().toISOString().split('T')[0];
        const activeJobs = data.filter(j => !j.closing_date || j.closing_date >= todayStr);

        const sorted = activeJobs.sort((a, b) => {
          if (!a.closing_date) return 1;
          if (!b.closing_date) return -1;
          return new Date(a.closing_date) - new Date(b.closing_date);
        });
        setJobs(sorted);
      }
    } catch (err) {
      console.error(err);
      if (triggerScrape && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        alert('❌ Could not connect to scraper API. Make sure server.js is running!');
      }
    } finally {
      setLoading(false);
    }
  };

  const filterJobs = () => {
    let result = [...jobs];

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(j =>
        (j.title && j.title.toLowerCase().includes(q)) ||
        (j.company && j.company.toLowerCase().includes(q)) ||
        (j.location && j.location.toLowerCase().includes(q))
      );
    }

    // Filter expiring
    if (filter === 'expiring') {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(today.getDate() + 3);
      const threeDaysFromNowStr = threeDaysFromNow.toISOString().split('T')[0];

      result = result.filter(j => {
        if (!j.closing_date) return false;
        // Strict string comparison: today <= closing <= threeDaysFromNow
        return j.closing_date >= todayStr && j.closing_date <= threeDaysFromNowStr;
      });
    } else if (filter === 'new') {
      // "Recent Jobs" = "Post Date" within last 7 days
      // Format example: "Jan 15, 2026"
      const limitDate = subDays(new Date(), 7);

      result = result.filter(j => {
        const postDateRaw = j.details?.['Post Date'];
        if (!postDateRaw) return false;

        try {
          // Parse "Jan 15, 2026"
          // We use 'MMM d, yyyy' which handles 'Jan 1, 2026' and 'Jan 15, 2026'
          const d = parse(postDateRaw, 'MMM d, yyyy', new Date());
          if (!isValid(d)) return false;
          return d >= limitDate;
        } catch {
          return false;
        }
      });

      // Sort recent jobs by Post Date (Newest first) instead of Closing Date
      result.sort((a, b) => {
        try {
          const da = parse(a.details['Post Date'], 'MMM d, yyyy', new Date());
          const db = parse(b.details['Post Date'], 'MMM d, yyyy', new Date());
          return db - da;
        } catch { return 0; }
      });
    }

    return result;
  };

  const checkNotificationPermission = () => {
    if ('Notification' in window && Notification.permission === 'granted') {
      setNotificationsEnabled(true);
    }
  };

  // Calculate statistics
  const getJobStats = () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(today.getDate() + 3);
    const threeDaysFromNowStr = threeDaysFromNow.toISOString().split('T')[0];
    const limitDate = subDays(new Date(), 7);

    const expiringCount = jobs.filter(j => {
      if (!j.closing_date) return false;
      return j.closing_date >= todayStr && j.closing_date <= threeDaysFromNowStr;
    }).length;

    const recentCount = jobs.filter(j => {
      if (!j.details || !j.details['Post Date']) return false;
      const parsed = parse(j.details['Post Date'], 'MMM d, yyyy', new Date());
      return isValid(parsed) && isAfter(parsed, limitDate);
    }).length;

    return {
      total: jobs.length,
      expiring: expiringCount,
      recent: recentCount
    };
  };

  const stats = getJobStats();

  const tabs = [
    { id: 'all', label: 'All Jobs' },
    { id: 'new', label: 'Recent Jobs' },
    { id: 'expiring', label: 'Expiring Soon' },
  ];

  useEffect(() => {
    setFilteredJobs(filterJobs());
  }, [jobs, search, filter]);

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setNotificationsEnabled(true);
      }
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 transition-colors duration-300">
        {/* Background Effects */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/10 light:bg-blue-600/[0.03] blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600/10 light:bg-purple-600/[0.03] blur-[120px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            "relative z-10 w-full max-w-md p-8 rounded-3xl border backdrop-blur-2xl transition-all duration-300 animate-in",
            "bg-white/10 border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)]",
            "light:bg-white/80 light:border-slate-200 light:shadow-[0_8px_32px_rgba(0,0,0,0.1)]",
            passError && "animate-shake border-red-500/50"
          )}
        >
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary to-blue-400 flex items-center justify-center shadow-lg shadow-primary/25 mb-6">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white light:text-slate-900 mb-2">Private Access</h1>
            <p className="text-slate-400 light:text-slate-500 text-sm">Please enter the master password to access the tracker.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative group">
              <input
                type={showPassword ? "text" : "password"}
                autoFocus
                value={inputPassword}
                onChange={(e) => setInputPassword(e.target.value)}
                placeholder="Enter password..."
                className={cn(
                  "w-full bg-white/5 light:bg-slate-50 border border-white/10 light:border-slate-200 rounded-xl px-4 py-3 text-white light:text-slate-900 focus:outline-none focus:border-primary transition-all duration-300",
                  passError && "border-red-500/50 focus:border-red-500"
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 light:hover:text-slate-700 transition-colors"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            <button
              type="submit"
              className="w-full bg-primary hover:bg-primary/90 text-white font-semibold py-3 rounded-xl transition-all duration-300 shadow-lg shadow-primary/20 hover:shadow-primary/30 active:scale-[0.98]"
            >
              Unlock Tracker
            </button>

            {passError && (
              <p className="text-center text-red-500 text-sm font-medium animate-in">Incorrect password. Please try again.</p>
            )}
          </form>

          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="mt-8 mx-auto flex items-center gap-2 text-slate-500 hover:text-slate-300 light:hover:text-slate-700 transition-colors text-xs font-medium uppercase tracking-widest"
          >
            {isDarkMode ? <Sun className="w-4 h-4 text-orange-400" /> : <Moon className="w-4 h-4 text-primary" />}
            {isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen transition-colors duration-300 selection:bg-primary/30">

      {/* Background Effects */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/10 light:bg-blue-600/[0.03] blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600/10 light:bg-purple-600/[0.03] blur-[120px]" />
      </div>

      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/5 light:border-slate-200 bg-dark/80 light:bg-white/80 backdrop-blur-xl transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-primary to-blue-400 flex items-center justify-center shadow-lg shadow-primary/25">
              <span className="font-bold text-white">J</span>
            </div>
            {/* Hidden text to move focus higher */}
            <span className="text-lg font-bold bg-gradient-to-r from-white to-slate-400 light:from-slate-900 light:to-slate-600 bg-clip-text text-transparent transition-all duration-300 hidden sm:block">
              Jobs.af Tracker
            </span>
          </div>
          <div className="flex items-center gap-4">
            {/* Refresh Button */}
            <button
              onClick={() => fetchJobs(true)}
              className="p-2 text-slate-400 light:text-slate-500 hover:text-white light:hover:text-slate-900 bg-white/5 light:bg-slate-200/50 hover:bg-white/10 light:hover:bg-slate-300/50 rounded-full transition-all group"
              title="Reload Data (Run scraper in terminal first)"
            >
              <RefreshCw className={cn("w-5 h-5", loading && "animate-spin text-primary")} />
            </button>

            {/* Theme Toggle */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 text-slate-400 light:text-slate-500 hover:text-white light:hover:text-slate-900 bg-white/5 light:bg-slate-200/50 hover:bg-white/10 light:hover:bg-slate-300/50 rounded-full transition-all"
              title={isDarkMode ? "Switch to Day Mode" : "Switch to Night Mode"}
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <a href="https://github.com" target="_blank" className="text-sm font-medium text-slate-400 light:text-slate-500 hover:text-white light:hover:text-slate-900 transition-colors hidden sm:block">GitHub</a>
            {!notificationsEnabled && (
              <button
                onClick={requestNotificationPermission}
                className="bg-white/10 light:bg-slate-200/50 p-2 rounded-full hover:bg-white/20 light:hover:bg-slate-300/50 transition-all text-slate-400 light:text-slate-500 hover:text-white light:hover:text-slate-900"
              >
                <Bell className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative pt-4 pb-2 sm:pt-8 sm:pb-4 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-6">
            <Sparkles className="w-3 h-3" />
            <span>v2.0 Modern UI</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-6 bg-gradient-to-b from-white via-white to-slate-400 light:from-slate-900 light:via-slate-800 light:to-slate-500 bg-clip-text text-transparent transition-all duration-300">
            Find Your Dream Job <br className="hidden sm:block" /> in Afghanistan
          </h1>
          <p className="text-base sm:text-lg text-slate-400 light:text-slate-600 max-w-2xl mx-auto mb-8 sm:mb-10 px-4 transition-all duration-300">
            Real-time tracking of the latest opportunities. Filter by expiring jobs, new listings, and more.
          </p>

          {/* Search Bar - Hero Style */}
          <div className="max-w-2xl mx-auto relative group px-2">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary to-secondary rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
            <div className="relative bg-dark/80 light:bg-white/80 backdrop-blur-xl border border-white/10 light:border-slate-200 rounded-xl p-2 flex items-center shadow-2xl transition-all duration-300">
              <Search className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400 ml-2 sm:ml-3" />
              <input
                type="text"
                placeholder="Search by job title, company..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-transparent border-none text-white light:text-slate-900 px-2 sm:px-4 py-2 sm:py-3 focus:outline-none placeholder:text-slate-600 light:placeholder:text-slate-400 text-base sm:text-lg transition-all duration-300"
              />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Statistics Counter - Now Interactive Filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8">
        <div className="grid grid-cols-3 gap-4 sm:gap-6">
          {/* Total Jobs */}
          <button
            onClick={() => setFilter('all')}
            className={cn(
              "bg-white/5 light:bg-white backdrop-blur-sm border rounded-xl p-3 sm:p-5 transition-all duration-300 cursor-pointer hover:scale-105 active:scale-95",
              filter === 'all'
                ? "border-primary light:border-primary ring-2 ring-primary/50 light:ring-primary/30 shadow-[0_0_20px_rgba(59,130,246,0.3)] light:shadow-[0_0_20px_rgba(59,130,246,0.2)]"
                : "border-white/10 light:border-slate-200 hover:border-primary/30 light:hover:border-primary/20"
            )}
          >
            <div className="flex items-center gap-2 sm:gap-3 mb-2">
              <div className={cn(
                "p-1.5 sm:p-2 rounded-lg transition-all duration-300",
                filter === 'all' ? "bg-primary/20 light:bg-primary/10" : "bg-primary/10 light:bg-primary/5"
              )}>
                <Briefcase className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
              </div>
              <h3 className="text-[10px] sm:text-xs font-semibold text-slate-400 light:text-slate-600 uppercase tracking-wider">Total Jobs</h3>
            </div>
            <p className={cn(
              "text-xl sm:text-3xl font-bold transition-all duration-300",
              filter === 'all' ? "text-primary" : "text-white light:text-slate-900"
            )}>{stats.total}</p>
          </button>

          {/* Expiring Soon */}
          <button
            onClick={() => setFilter('expiring')}
            className={cn(
              "bg-white/5 light:bg-white backdrop-blur-sm border rounded-xl p-3 sm:p-5 transition-all duration-300 cursor-pointer hover:scale-105 active:scale-95",
              filter === 'expiring'
                ? "border-orange-400 light:border-orange-400 ring-2 ring-orange-400/50 light:ring-orange-400/30 shadow-[0_0_20px_rgba(251,146,60,0.3)] light:shadow-[0_0_20px_rgba(251,146,60,0.2)]"
                : "border-white/10 light:border-slate-200 hover:border-orange-400/30 light:hover:border-orange-400/20"
            )}
          >
            <div className="flex items-center gap-2 sm:gap-3 mb-2">
              <div className={cn(
                "p-1.5 sm:p-2 rounded-lg transition-all duration-300",
                filter === 'expiring' ? "bg-orange-500/20 light:bg-orange-500/10" : "bg-orange-500/10 light:bg-orange-500/5"
              )}>
                <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400" />
              </div>
              <h3 className="text-[10px] sm:text-xs font-semibold text-slate-400 light:text-slate-600 uppercase tracking-wider">Expiring Soon</h3>
            </div>
            <p className={cn(
              "text-xl sm:text-3xl font-bold transition-all duration-300",
              filter === 'expiring' ? "text-orange-400" : "text-white light:text-slate-900"
            )}>{stats.expiring}</p>
          </button>

          {/* Recent Jobs */}
          <button
            onClick={() => setFilter('new')}
            className={cn(
              "bg-white/5 light:bg-white backdrop-blur-sm border rounded-xl p-3 sm:p-5 transition-all duration-300 cursor-pointer hover:scale-105 active:scale-95",
              filter === 'new'
                ? "border-emerald-400 light:border-emerald-400 ring-2 ring-emerald-400/50 light:ring-emerald-400/30 shadow-[0_0_20px_rgba(52,211,153,0.3)] light:shadow-[0_0_20px_rgba(52,211,153,0.2)]"
                : "border-white/10 light:border-slate-200 hover:border-emerald-400/30 light:hover:border-emerald-400/20"
            )}
          >
            <div className="flex items-center gap-2 sm:gap-3 mb-2">
              <div className={cn(
                "p-1.5 sm:p-2 rounded-lg transition-all duration-300",
                filter === 'new' ? "bg-emerald-500/20 light:bg-emerald-500/10" : "bg-emerald-500/10 light:bg-emerald-500/5"
              )}>
                <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
              </div>
              <h3 className="text-[10px] sm:text-xs font-semibold text-slate-400 light:text-slate-600 uppercase tracking-wider">Recent Jobs</h3>
            </div>
            <p className={cn(
              "text-xl sm:text-3xl font-bold transition-all duration-300",
              filter === 'new' ? "text-emerald-400" : "text-white light:text-slate-900"
            )}>{stats.recent}</p>
          </button>
        </div>
      </div>


      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <RefreshCw className="w-10 h-10 animate-spin mb-4 text-primary" />
            <p>Loading latest jobs...</p>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 light:bg-slate-100 mb-4 backdrop-blur-sm transition-all duration-300">
              <Search className="w-8 h-8 text-slate-500" />
            </div>
            <h3 className="text-lg font-medium text-white light:text-slate-900 transition-all duration-300">No jobs found</h3>
          </div>
        ) : (
          <motion.div
            layout
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            <AnimatePresence mode='popLayout'>
              {filteredJobs.map((job, idx) => (
                <JobCard
                  key={job.url || idx}
                  job={job}
                  onClick={() => setSelectedJob(job)}
                  isNew={newJobUrls.has(job.url)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </main>

      {/* Details Modal */}
      <AnimatePresence>
        {selectedJob && (
          <JobDetails
            job={selectedJob}
            onClose={() => setSelectedJob(null)}
          />
        )}
      </AnimatePresence>

    </div>
  );
}

export default App;
