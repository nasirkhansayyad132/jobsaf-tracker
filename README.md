# Jobs.af Tracker 💼

A fully free, fully-online job tracker for IT/Tech jobs in Afghanistan.

- **PWA Mobile App** - Hosted on GitHub Pages, installable on Android
- **Daily Email Notifications** - New jobs & expiring jobs via Gmail
- **Automated Scraping** - GitHub Actions runs daily at 9:00 AM Kabul time

## Features

✅ Tracks IT, Software, Data, and Computer Science jobs from jobs.af  
✅ Mobile-first Progressive Web App (works offline)  
✅ Search by title, company, location  
✅ Filter: All, New, Expiring Today, Expiring Soon  
✅ Shows apply links and emails extracted from job descriptions  
✅ Daily email digest with new and expiring jobs  
✅ 100% free using GitHub Actions + GitHub Pages  

---

## 📱 Setup Instructions (Android-Friendly)

### Step 1: Fork or Clone This Repository

Click **"Use this template"** or fork this repo to your GitHub account.

### Step 2: Enable GitHub Pages

1. Go to **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: **main**
4. Folder: **/docs**
5. Click **Save**

Your site will be available at: `https://YOUR-USERNAME.github.io/REPO-NAME/`

### Step 3: Add GitHub Secrets for Email Notifications

Go to **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | Your Gmail address (e.g., `you@gmail.com`) |
| `SMTP_PASS` | Your Gmail App Password (see below) |
| `EMAIL_TO` | Recipient email address |

### Step 4: Create Gmail App Password

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** if not already enabled
3. Go to [App Passwords](https://myaccount.google.com/apppasswords)
4. Select app: **Mail**, Select device: **Other** (type "Jobs.af")
5. Click **Generate**
6. Copy the 16-character password (e.g., `abcd efgh ijkl mnop`)
7. Use this as your `SMTP_PASS` secret (without spaces)

### Step 5: Run the Workflow Manually

1. Go to **Actions** tab
2. Click **Daily Jobs.af Scrape & Notify**
3. Click **Run workflow** → **Run workflow**
4. Wait for it to complete (5-10 minutes)

### Step 6: Install on Android

1. Open your GitHub Pages URL in Chrome on Android
2. Tap the **⋮** menu → **Add to Home screen**
3. Name it "Jobs.af" and tap **Add**
4. Now you have a native app-like experience!

---

## 📁 Repository Structure

```
/
├── docs/                    # GitHub Pages PWA
│   ├── index.html           # Main app HTML
│   ├── app.js               # JavaScript (search, filter, UI)
│   ├── styles.css           # Mobile-first CSS
│   ├── manifest.json        # PWA manifest
│   ├── sw.js                # Service worker (offline support)
│   └── data/
│       ├── jobs.json        # Processed job listings
│       └── summary.json     # New/expiring jobs summary
│
├── scraper/
│   ├── scraper.py           # Playwright scraper for jobs.af
│   └── requirements.txt     # Python dependencies
│
├── scripts/
│   ├── postprocess.py       # Clean jobs, extract emails
│   └── notify_email.py      # Send email notifications
│
├── data/
│   ├── raw_jobs.json        # Raw scraper output
│   ├── raw_jobs.csv         # CSV export
│   └── last_jobs.json       # Previous snapshot for diff
│
└── .github/workflows/
    └── daily.yml            # GitHub Actions workflow
```

---

## ⚙️ Customization

### Change Job Categories

Edit `scraper/scraper.py` and modify `DEFAULT_TECH_CATEGORIES` list:

```python
DEFAULT_TECH_CATEGORIES = [
    "IT - Hardware",
    "IT - Software",
    "Computer Science",
    # Add or remove categories here
]
```

### Change Schedule

Edit `.github/workflows/daily.yml`:

```yaml
schedule:
  # Cron format: minute hour day month weekday
  - cron: '30 4 * * *'  # 4:30 AM UTC = 9:00 AM Kabul
```

### Change Email Frequency

The workflow runs once daily. To run more frequently, add more cron schedules:

```yaml
schedule:
  - cron: '30 4 * * *'   # 9:00 AM Kabul
  - cron: '30 10 * * *'  # 3:00 PM Kabul
```

---

## 🔧 Local Development

```bash
# Clone the repo
git clone https://github.com/YOUR-USERNAME/REPO-NAME.git
cd REPO-NAME

# Install Python dependencies
pip install -r scraper/requirements.txt
python -m playwright install chromium

# Run scraper
cd scraper
python scraper.py --categories all --only-open --json ../data/raw_jobs.json

# Post-process
cd ..
python scripts/postprocess.py data/raw_jobs.json docs/data/jobs.json docs/data/summary.json

# Serve PWA locally
cd docs
python -m http.server 8000
# Open http://localhost:8000
```

---

## 📊 Data Format

### jobs.json

```json
[
  {
    "url": "https://jobs.af/jobs/example-job",
    "title": "Software Engineer",
    "company": "Tech Company",
    "location": "Kabul",
    "closing_date": "2026-01-25",
    "closing_date_raw": "Jan 25, 2026",
    "apply_url": "https://example.com/apply",
    "apply_emails": ["hr@example.com"],
    "apply_method": "both",
    "description": "Job description...",
    "details": {
      "Salary Range": "Negotiable",
      "Experience": "3+ years"
    },
    "scraped_at": "2026-01-17T12:00:00Z"
  }
]
```

### summary.json

```json
{
  "generated_at": "2026-01-17T13:30:00",
  "today": "2026-01-17",
  "total_jobs": 45,
  "new_count": 5,
  "expiring_today_count": 2,
  "expiring_soon_count": 8,
  "new_jobs": [...],
  "expiring_today": [...],
  "expiring_soon": [...]
}
```

---

## 🐛 Troubleshooting

### Workflow fails with "No jobs found"

- jobs.af might be temporarily down
- The scraper might need updating if the site changed
- Check the debug screenshots in the workflow artifacts

### Email not sending

- Verify all SMTP secrets are set correctly
- Make sure you're using an App Password, not your regular password
- Check that 2-Step Verification is enabled on your Google account

### PWA not installing

- Make sure you're using HTTPS (GitHub Pages provides this)
- Clear browser cache and try again
- Check that manifest.json is loading correctly

---

## 📄 License

MIT License - feel free to use, modify, and share!

---

## 🙏 Credits

- Data source: [jobs.af](https://jobs.af)
- Hosting: GitHub Pages (free)
- Automation: GitHub Actions (free)
- Icons: Emoji 😊