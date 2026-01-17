// Jobs.af Tracker PWA - Main Application JavaScript

(function() {
    'use strict';

    // ===== Configuration =====
    const DATA_URL = 'data/jobs.json';
    const SUMMARY_URL = 'data/summary.json';
    const KABUL_TZ = 'Asia/Kabul';
    const GITHUB_OWNER = 'nasirkhansayyad132';
    const GITHUB_REPO = 'jobsaf-tracker';
    const WORKFLOW_FILE = 'daily.yml';

    // ===== State =====
    let allJobs = [];
    let summary = { new_jobs: [], expiring_today: [], expiring_soon: [] };
    let currentFilter = 'all';
    let searchQuery = '';

    // ===== DOM Elements =====
    const jobList = document.getElementById('jobList');
    const searchBox = document.getElementById('searchBox');
    const refreshBtn = document.getElementById('refreshBtn');
    const scrapeBtn = document.getElementById('scrapeBtn');
    const statsText = document.getElementById('statsText');
    const lastUpdated = document.getElementById('lastUpdated');
    const jobModal = document.getElementById('jobModal');
    const modalBack = document.getElementById('modalBack');
    const modalBody = document.getElementById('modalBody');
    const offlineBanner = document.getElementById('offlineBanner');
    const tabButtons = document.querySelectorAll('.tab-btn');

    // ===== Utility Functions =====
    function getKabulDate() {
        return new Date().toLocaleDateString('en-CA', { timeZone: KABUL_TZ });
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        try {
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return dateStr;
        }
    }

    function daysUntil(dateStr) {
        if (!dateStr) return null;
        try {
            const today = new Date(getKabulDate());
            const target = new Date(dateStr);
            const diff = Math.floor((target - today) / (1000 * 60 * 60 * 24));
            return diff;
        } catch {
            return null;
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function truncate(str, len) {
        if (!str) return '';
        return str.length > len ? str.slice(0, len) + '...' : str;
    }

    // ===== Data Loading =====
    async function loadJobs(bustCache = false) {
        const suffix = bustCache ? `?t=${Date.now()}` : '';
        
        try {
            refreshBtn.classList.add('spinning');
            
            const [jobsRes, summaryRes] = await Promise.all([
                fetch(DATA_URL + suffix),
                fetch(SUMMARY_URL + suffix).catch(() => null)
            ]);

            if (!jobsRes.ok) throw new Error('Failed to load jobs');
            
            allJobs = await jobsRes.json();
            
            if (summaryRes && summaryRes.ok) {
                summary = await summaryRes.json();
            }

            // Sort by closing date (soonest first, nulls last)
            allJobs.sort((a, b) => {
                if (!a.closing_date && !b.closing_date) return 0;
                if (!a.closing_date) return 1;
                if (!b.closing_date) return -1;
                return a.closing_date.localeCompare(b.closing_date);
            });

            renderJobs();
            updateStats();
            
            if (allJobs.length > 0 && allJobs[0].scraped_at) {
                const scraped = new Date(allJobs[0].scraped_at);
                lastUpdated.textContent = `Updated: ${scraped.toLocaleString()}`;
            }

            offlineBanner.classList.add('hidden');
            
        } catch (err) {
            console.error('Error loading jobs:', err);
            
            if (allJobs.length === 0) {
                jobList.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">⚠️</div>
                        <p class="empty-state-text">Failed to load jobs.<br>Check your connection and try again.</p>
                    </div>
                `;
            }
            
            if (!navigator.onLine) {
                offlineBanner.classList.remove('hidden');
            }
        } finally {
            refreshBtn.classList.remove('spinning');
        }
    }

    // ===== Filtering =====
    function getFilteredJobs() {
        const today = getKabulDate();
        const newUrls = new Set((summary.new_jobs || []).map(j => j.url));
        
        let filtered = allJobs;

        // Apply tab filter
        switch (currentFilter) {
            case 'new':
                filtered = filtered.filter(j => newUrls.has(j.url));
                break;
            case 'today':
                filtered = filtered.filter(j => j.closing_date === today);
                break;
            case 'soon':
                filtered = filtered.filter(j => {
                    const days = daysUntil(j.closing_date);
                    return days !== null && days >= 0 && days <= 3;
                });
                break;
        }

        // Apply search filter
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(j => {
                const title = (j.title || '').toLowerCase();
                const company = (j.company || '').toLowerCase();
                const location = (j.location || '').toLowerCase();
                return title.includes(q) || company.includes(q) || location.includes(q);
            });
        }

        return filtered;
    }

    // ===== Rendering =====
    function renderJobs() {
        const jobs = getFilteredJobs();
        const today = getKabulDate();
        const newUrls = new Set((summary.new_jobs || []).map(j => j.url));

        if (jobs.length === 0) {
            jobList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📭</div>
                    <p class="empty-state-text">No jobs found${searchQuery ? ' matching your search' : ''}.</p>
                </div>
            `;
            return;
        }

        jobList.innerHTML = jobs.map(job => {
            const days = daysUntil(job.closing_date);
            const isToday = job.closing_date === today;
            const isSoon = days !== null && days > 0 && days <= 3;
            const isNew = newUrls.has(job.url);

            let badgeHtml = '';
            if (isToday) {
                badgeHtml = '<span class="job-badge badge-today">Today</span>';
            } else if (isSoon) {
                badgeHtml = `<span class="job-badge badge-soon">${days}d left</span>`;
            } else if (isNew) {
                badgeHtml = '<span class="job-badge badge-new">New</span>';
            }

            return `
                <article class="job-card" data-url="${escapeHtml(job.url)}">
                    <div class="job-card-header">
                        <h3 class="job-title">${escapeHtml(job.title || 'Untitled Job')}</h3>
                        ${badgeHtml}
                    </div>
                    <div class="job-meta">
                        <span class="job-meta-item">🏢 ${escapeHtml(job.company || 'Unknown')}</span>
                        <span class="job-meta-item">📍 ${escapeHtml(job.location || 'Afghanistan')}</span>
                        <span class="job-meta-item">📅 ${formatDate(job.closing_date)}</span>
                    </div>
                    <div class="job-actions">
                        <button class="btn btn-primary view-job-btn">Open Details</button>
                    </div>
                </article>
            `;
        }).join('');

        // Add click handlers
        jobList.querySelectorAll('.job-card').forEach(card => {
            card.addEventListener('click', () => {
                const url = card.dataset.url;
                const job = allJobs.find(j => j.url === url);
                if (job) showJobDetail(job);
            });
        });
    }

    function updateStats() {
        const filtered = getFilteredJobs();
        const today = getKabulDate();
        
        const expiringToday = allJobs.filter(j => j.closing_date === today).length;
        const newCount = (summary.new_jobs || []).length;

        let statsHtmlParts = [`${filtered.length} jobs`];
        if (currentFilter === 'all' && expiringToday > 0) {
            statsHtmlParts.push(`${expiringToday} expiring today`);
        }
        if (currentFilter === 'all' && newCount > 0) {
            statsHtmlParts.push(`${newCount} new`);
        }
        
        statsText.textContent = statsHtmlParts.join(' • ');
    }

    // ===== Job Detail Modal =====
    function showJobDetail(job) {
        const today = getKabulDate();
        const isToday = job.closing_date === today;
        const days = daysUntil(job.closing_date);

        let dateDisplay = formatDate(job.closing_date);
        if (isToday) {
            dateDisplay += ' <span class="job-badge badge-today" style="margin-left:8px">TODAY</span>';
        } else if (days !== null && days > 0 && days <= 3) {
            dateDisplay += ` <span class="job-badge badge-soon" style="margin-left:8px">${days} days left</span>`;
        }

        // Build apply buttons
        let applyButtons = [];
        
        if (job.apply_url) {
            applyButtons.push(`<a href="${escapeHtml(job.apply_url)}" target="_blank" rel="noopener" class="btn btn-primary">🔗 Apply Online</a>`);
        }
        
        if (job.apply_emails && job.apply_emails.length > 0) {
            job.apply_emails.forEach(email => {
                applyButtons.push(`<a href="mailto:${escapeHtml(email)}" class="btn btn-outline">✉️ ${escapeHtml(email)}</a>`);
            });
        }
        
        applyButtons.push(`<a href="${escapeHtml(job.url)}" target="_blank" rel="noopener" class="btn btn-outline">🌐 View on Jobs.af</a>`);

        // Build details table
        let detailsHtml = '';
        if (job.details && Object.keys(job.details).length > 0) {
            const rows = Object.entries(job.details)
                .filter(([k]) => !['description'].includes(k.toLowerCase()))
                .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
                .join('');
            
            if (rows) {
                detailsHtml = `
                    <div class="collapsible" id="detailsCollapsible">
                        <div class="collapsible-header" onclick="toggleCollapsible('detailsCollapsible')">
                            <span>📋 Additional Details</span>
                            <span class="collapsible-toggle">▼</span>
                        </div>
                        <div class="collapsible-content">
                            <table class="details-table">${rows}</table>
                        </div>
                    </div>
                `;
            }
        }

        // Build description section
        let descriptionHtml = '';
        if (job.description) {
            const preview = truncate(job.description, 300);
            descriptionHtml = `
                <div class="collapsible" id="descCollapsible">
                    <div class="collapsible-header" onclick="toggleCollapsible('descCollapsible')">
                        <span>📄 Description / Requirements</span>
                        <span class="collapsible-toggle">▼</span>
                    </div>
                    <div class="collapsible-content">
                        <div class="description-text">${escapeHtml(job.description)}</div>
                    </div>
                </div>
            `;
        }

        modalBody.innerHTML = `
            <section class="detail-section">
                <h1 class="detail-title">${escapeHtml(job.title || 'Untitled Job')}</h1>
                <div class="detail-meta">
                    <div class="detail-meta-row">
                        <span class="icon">🏢</span>
                        <span>${escapeHtml(job.company || 'Unknown Company')}</span>
                    </div>
                    <div class="detail-meta-row">
                        <span class="icon">📍</span>
                        <span>${escapeHtml(job.location || 'Afghanistan')}</span>
                    </div>
                    <div class="detail-meta-row">
                        <span class="icon">📅</span>
                        <span>Closing: ${dateDisplay}</span>
                    </div>
                    ${job.apply_method ? `
                    <div class="detail-meta-row">
                        <span class="icon">📝</span>
                        <span>Apply via: ${escapeHtml(job.apply_method)}</span>
                    </div>` : ''}
                </div>
                <div class="detail-actions">
                    ${applyButtons.join('')}
                </div>
            </section>

            <section class="detail-section">
                ${descriptionHtml}
                ${detailsHtml}
            </section>
        `;

        jobModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function hideJobDetail() {
        jobModal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    // Global function for collapsible toggle
    window.toggleCollapsible = function(id) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('open');
    };

    // ===== Event Handlers =====
    refreshBtn.addEventListener('click', () => loadJobs(true));

    // Scrape button - triggers GitHub Actions workflow
    scrapeBtn.addEventListener('click', async () => {
        const token = localStorage.getItem('github_pat');
        
        if (!token) {
            // Show modal to enter PAT
            showPatModal();
            return;
        }
        
        await triggerScraper(token);
    });

    // Trigger the GitHub Actions workflow
    async function triggerScraper(token) {
        scrapeBtn.classList.add('spinning');
        scrapeBtn.disabled = true;
        
        const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
        
        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ref: 'main' })
            });
            
            if (res.status === 204) {
                showToast('✅ Scraper started! Jobs will update in ~2-3 minutes. Use 🔄 to refresh.', 'success');
            } else if (res.status === 401) {
                localStorage.removeItem('github_pat');
                const err = await res.json().catch(() => ({}));
                showToast(`❌ Auth failed: ${err.message || 'Bad credentials'}. Check token.`, 'error');
                showPatModal();
            } else if (res.status === 403) {
                localStorage.removeItem('github_pat');
                const err = await res.json().catch(() => ({}));
                showToast(`❌ Forbidden: ${err.message || 'Token lacks workflow scope'}`, 'error');
                showPatModal();
            } else if (res.status === 404) {
                showToast('❌ Workflow not found. Check repo settings.', 'error');
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(`❌ Error ${res.status}: ${err.message || 'Unknown'}`, 'error');
            }
        } catch (e) {
            console.error('Trigger error:', e);
            showToast(`❌ Network error: ${e.message}`, 'error');
        } finally {
            scrapeBtn.classList.remove('spinning');
            scrapeBtn.disabled = false;
        }
    }

    // Show modal to enter GitHub PAT
    function showPatModal() {
        const html = `
            <div class="pat-modal">
                <h2>🔐 GitHub Token Required</h2>
                <p>To trigger the scraper, create a <strong>Classic</strong> Personal Access Token:</p>
                <ol>
                    <li><a href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=Jobs.af%20Tracker" target="_blank" style="color:#007bff;font-weight:bold;">👉 Click here to create token</a></li>
                    <li>Set expiration (e.g., 90 days)</li>
                    <li>Check <strong>repo</strong> ✅ and <strong>workflow</strong> ✅</li>
                    <li>Click "Generate token" and copy it</li>
                    <li>Paste below:</li>
                </ol>
                <input type="text" id="patInput" placeholder="ghp_xxxxxxxxxxxx" style="width: 100%; padding: 12px; font-size: 14px; border: 2px solid #ddd; border-radius: 8px; margin: 12px 0; font-family: monospace;">
                <div style="display: flex; gap: 12px; margin-top: 16px;">
                    <button onclick="savePatAndTrigger()" style="flex: 1; padding: 12px; background: #28a745; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer;">Save & Run</button>
                    <button onclick="hideJobDetail()" style="flex: 1; padding: 12px; background: #6c757d; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer;">Cancel</button>
                </div>
                <p style="margin-top: 12px; font-size: 11px; color: #666; background: #f8f9fa; padding: 8px; border-radius: 4px;">
                    ⚠️ Use <strong>Classic token</strong> (not fine-grained). Must have <strong>repo + workflow</strong> scopes.<br>
                    🔒 Token stored only on your device.
                </p>
            </div>
        `;
        modalBody.innerHTML = html;
        jobModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    // Global function to save PAT and trigger scraper
    window.savePatAndTrigger = async function() {
        const input = document.getElementById('patInput');
        const token = input.value.trim();
        
        // Accept any token that looks reasonable (GitHub tokens vary in format)
        if (!token || token.length < 20) {
            showToast('❌ Token too short. Please paste the full token.', 'error');
            return;
        }
        
        localStorage.setItem('github_pat', token);
        hideJobDetail();
        await triggerScraper(token);
    };

    // Toast notification
    function showToast(message, type = 'info') {
        // Remove existing toast
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8'};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            max-width: 90%;
            text-align: center;
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.remove(), 5000);
    }

    modalBack.addEventListener('click', hideJobDetail);

    searchBox.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderJobs();
        updateStats();
    });

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderJobs();
            updateStats();
        });
    });

    // Handle back button for modal
    window.addEventListener('popstate', () => {
        if (!jobModal.classList.contains('hidden')) {
            hideJobDetail();
        }
    });

    // Online/Offline detection
    window.addEventListener('online', () => {
        offlineBanner.classList.add('hidden');
        loadJobs(true);
    });

    window.addEventListener('offline', () => {
        offlineBanner.classList.remove('hidden');
    });

    // ===== Service Worker Registration =====
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('SW registered:', reg.scope))
            .catch(err => console.warn('SW registration failed:', err));
    }

    // ===== Initialize =====
    loadJobs();

})();
