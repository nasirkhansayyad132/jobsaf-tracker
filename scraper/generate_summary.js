const fs = require('fs');
const path = require('path');

function getKabulDate() {
    // Kabul is UTC+4:30
    const d = new Date();
    d.setMinutes(d.getMinutes() + 270); // 4.5 * 60
    return d.toISOString().split('T')[0];
}

function generateSummary() {
    const jobsFile = process.argv[2] || '../docs/data/jobs.json';
    const summaryFile = process.argv[3] || '../docs/data/summary.json';
    const lastJobsFile = process.argv[4]; // Optional, to calculate "new" jobs

    if (!fs.existsSync(jobsFile)) {
        console.error("Jobs file not found:", jobsFile);
        process.exit(1);
    }

    const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
    const today = getKabulDate();

    // Logic for "New" jobs
    let newJobs = [];
    if (lastJobsFile && fs.existsSync(lastJobsFile)) {
        const lastJobs = JSON.parse(fs.readFileSync(lastJobsFile, 'utf8'));
        const lastUrls = new Set(lastJobs.map(j => j.url));
        newJobs = jobs.filter(j => !lastUrls.has(j.url));
    } else {
        // Fallback: jobs scraped "today" (if scrape_date is present)
        // Or just take top 5 if first run
        const todayStr = new Date().toISOString().split('T')[0];
        newJobs = jobs.filter(j => j.scraped_at && j.scraped_at.startsWith(todayStr));
    }

    // Logic for Expiring
    const expiringToday = [];
    const expiringSoon = []; // Next 3 days

    jobs.forEach(job => {
        if (!job.closing_date) return;
        const closing = job.closing_date; // YYYY-MM-DD

        if (closing < today) {
            // Expired
            return;
        }

        if (closing === today) {
            expiringToday.push(job);
        } else {
            // Calculate difference for "Expiring Soon"
            const closeDate = new Date(closing);
            const todayDate = new Date(today);
            const diffTime = closeDate - todayDate;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays > 0 && diffDays <= 3) {
                expiringSoon.push(job);
            }
        }
    });

    const summary = {
        generated_at: new Date().toISOString(),
        today: today,
        total_jobs: jobs.length,
        new_count: newJobs.length,
        expiring_today_count: expiringToday.length,
        expiring_soon_count: expiringSoon.length,
        new_jobs: newJobs,
        expiring_today: expiringToday,
        expiring_soon: expiringSoon
    };

    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    console.log(`Summary generated at ${summaryFile}`);
    console.log(`Total: ${jobs.length}, New: ${newJobs.length}, Expire Today: ${expiringToday.length}`);
}

generateSummary();
