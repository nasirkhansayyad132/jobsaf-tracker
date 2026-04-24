/**
 * Simple API server that triggers the incremental scraper
 * Run with: node server.js
 * The frontend can call POST /api/refresh to trigger a scrape
 */

const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;

// Enable CORS for frontend
app.use(cors());
app.use(express.json());

// Track if a scrape is in progress
let isScrapingInProgress = false;

/**
 * POST /api/refresh
 * Triggers the incremental scraper
 */
app.post('/api/refresh', async (req, res) => {
    if (isScrapingInProgress) {
        return res.status(429).json({
            success: false,
            message: 'A scrape is already in progress. Please wait.'
        });
    }

    isScrapingInProgress = true;
    console.log('[API] Starting incremental scrape...');

    const scraperPath = path.join(__dirname, 'scrape_all.js');
    const outputJson = path.join(__dirname, '..', 'frontend', 'public', 'data', 'jobs.json');
    const outputCsv = path.join(__dirname, '..', 'data', 'jobs.csv');

    const command = `node "${scraperPath}" --json "${outputJson}" --csv "${outputCsv}" --max-pages 5`;

    exec(command, { cwd: __dirname, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        isScrapingInProgress = false;

        if (error) {
            console.error('[API] Scraper error:', error.message);
            console.error('[API] Stderr:', stderr);
            return res.status(500).json({
                success: false,
                message: 'Scraper failed',
                error: error.message
            });
        }

        console.log('[API] Scrape completed successfully');
        console.log('[API] Output:', stdout);

        // Read the updated jobs.json and return it
        try {
            const jobsData = JSON.parse(fs.readFileSync(outputJson, 'utf-8'));
            res.json({
                success: true,
                message: `Scrape complete! Found ${jobsData.length} jobs.`,
                jobCount: jobsData.length,
                jobs: jobsData
            });
        } catch (readError) {
            res.json({
                success: true,
                message: 'Scrape complete but could not read output file.',
            });
        }
    });
});

/**
 * GET /api/status
 * Check if scraper is running
 */
app.get('/api/status', (req, res) => {
    res.json({
        isScrapingInProgress,
        message: isScrapingInProgress ? 'Scraping in progress...' : 'Idle'
    });
});

/**
 * GET /api/jobs
 * Return current jobs without scraping
 */
app.get('/api/jobs', (req, res) => {
    const outputJson = path.join(__dirname, '..', 'frontend', 'public', 'data', 'jobs.json');
    try {
        const jobsData = JSON.parse(fs.readFileSync(outputJson, 'utf-8'));
        res.json({ success: true, jobs: jobsData, count: jobsData.length });
    } catch (error) {
        res.status(404).json({ success: false, message: 'jobs.json not found' });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Scraper API Server running at http://localhost:${PORT}`);
    console.log(`   POST /api/refresh  - Trigger incremental scrape`);
    console.log(`   GET  /api/status   - Check scrape status`);
    console.log(`   GET  /api/jobs     - Get current jobs\n`);
});
