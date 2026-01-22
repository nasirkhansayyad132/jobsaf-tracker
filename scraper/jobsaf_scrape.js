#!/usr/bin/env node

// compat helper: Puppeteer removed page.waitForTimeout in newer versions
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


/**
 * Jobs.af scraper for Termux using puppeteer-core + system chromium.
 * STEALTH MODE ADDED
 */

const fs = require("fs");
const path = require("path");

// --- MODIFIED: Imports for Stealth ---
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
// -------------------------------------

function arg(name, def = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const val = process.argv[idx + 1];
  if (!val || val.startsWith("--")) return def;
  return val;
}
function hasFlag(name) {
  return process.argv.includes(name);
}

function ensureDir(p) {
  if (!p) return;
  fs.mkdirSync(p, { recursive: true });
}

function stripPageParam(url) {
  // patched: DO NOT remove page= (we control pagination externally)
  return url;
}

function withPage(urlNoPage, pageNum) {
  const u = new URL(urlNoPage);
  u.searchParams.set("page", String(pageNum));
  return u.toString();
}

function normSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function extractEmails(text) {
  const t = text || "";
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  return Array.from(new Set(t.match(re) || [])).slice(0, 10);
}

function extractPhones(text) {
  const t = text || "";
  // loose phone matcher: +93..., 07..., (0)7..., etc.
  const re = /(\+?\d[\d\s().-]{7,}\d)/g;
  const found = (t.match(re) || [])
    .map(x => normSpace(x))
    .filter(x => x.length >= 9 && x.length <= 25);
  return Array.from(new Set(found)).slice(0, 10);
}

function parseClosingDate(raw) {
  // Try to pull YYYY-MM-DD from common formats; fallback null
  const r = (raw || "").trim();
  if (!r) return null;

  // If already ISO-like:
  const iso = r.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  // Match: "Jan 24, 2026" / "January 24, 2026"
  const m = r.match(/\b([A-Za-z]{3,})\s+(\d{1,2}),?\s*(20\d{2})\b/);
  if (m) {
    const monthName = m[1].toLowerCase();
    const day = String(parseInt(m[2], 10)).padStart(2, "0");
    const year = m[3];
    const months = {
      jan: "01", january: "01",
      feb: "02", february: "02",
      mar: "03", march: "03",
      apr: "04", april: "04",
      may: "05",
      jun: "06", june: "06",
      jul: "07", july: "07",
      aug: "08", august: "08",
      sep: "09", sept: "09", september: "09",
      oct: "10", october: "10",
      nov: "11", november: "11",
      dec: "12", december: "12",
    };
    const mm = months[monthName] || months[monthName.slice(0, 3)];
    if (mm) return `${year}-${mm}-${day}`;
  }

  return null;
}

// Technical keywords to filter jobs from broad categories (Banking, Finance, etc.)
const TECHNICAL_KEYWORDS = [
  "software", "developer", "engineer", "data", "security", "it officer",
  "compute", "database", "network", "system", "programming", "analyst",
  "web", "devops", "cloud", "information technology", "programmer", "information security",
  "technology", "ict", "tech", "digit"
];

function isTechnical(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  return TECHNICAL_KEYWORDS.some(kw => t.includes(kw));
}

function todayISO() {
  // Kabul is UTC+4:30
  const d = new Date();
  d.setMinutes(d.getMinutes() + 270);
  return d.toISOString().split('T')[0];
}

function toCSV(rows, fields) {
  const esc = (v) => {
    const s = (v === null || v === undefined) ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [
    fields.join(","),
    ...rows.map(r => fields.map(f => esc(r[f])).join(","))
  ].join("\n");
}

async function main() {
  const RAW_URL = arg("--raw-url");
  if (!RAW_URL) {
    console.log("Usage:");
    console.log("  node jobsaf_scrape.js --raw-url \"https://jobs.af/jobs?...\" --max-pages 80 --only-open --json out.json --csv out.csv");
    process.exit(1);
  }

  const maxPages = parseInt(arg("--max-pages", "80"), 10);
  const onlyOpen = hasFlag("--only-open");
  const outJson = arg("--json", path.join(process.cwd(), "jobs.json"));
  const outCsv = arg("--csv", path.join(process.cwd(), "jobs.csv"));
  const debugDir = arg("--debug-dir", path.join(process.cwd(), "debug"));
  const headful = hasFlag("--headful");

  ensureDir(path.dirname(outJson));
  ensureDir(path.dirname(outCsv));
  ensureDir(debugDir);

  // --- MODIFIED: Logic to detect Termux vs GitHub Actions ---
  // If we are on GitHub Actions, this path won't exist, so we switch to 'undefined' 
  // (which tells Puppeteer to use the bundled Chrome it downloads)
  let CHROME = process.env.CHROME_PATH || "/data/data/com.termux/files/usr/bin/chromium";

  if (!fs.existsSync(CHROME) && !process.env.CHROME_PATH) {
    // Fallback for GitHub Actions (Use Puppeteer Bundled Chrome)
    CHROME = undefined;
  }
  // ----------------------------------------------------------

  const urlNoPage = stripPageParam(RAW_URL);

  console.log("[i] Chrome:", CHROME || "Puppeteer Bundled");
  console.log("[i] Base URL:", urlNoPage);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: headful ? false : "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled", // ADDED: Critical for Stealth
    ],
  });

  const page = await browser.newPage();

  // ADDED: Randomize viewport slightly for stealth
  await page.setViewport({ width: 1920, height: 1080 });

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  async function goto(url) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch {
      await page.goto(url, { waitUntil: "load", timeout: 60000 });
    }
    await sleep(1200);
  }

  // --- MODIFIED: Load existing jobs for incremental check ---
  let existingJobs = [];
  const existingUrls = new Set();
  if (fs.existsSync(outJson)) {
    try {
      existingJobs = JSON.parse(fs.readFileSync(outJson, 'utf-8'));
      existingJobs.forEach(j => existingUrls.add(j.url));
      console.log(`[i] Loaded ${existingJobs.length} existing jobs.`);
    } catch (e) {
      console.log(`[!] Failed to load existing jobs: ${e.message}`);
    }
  }
  // ----------------------------------------------------------

  // Page 1: detect total jobs and max pages
  console.log("[1] Loading page 1...");
  await goto(withPage(urlNoPage, 1));
  await page.screenshot({ path: path.join(debugDir, "01_page1.png"), fullPage: true });

  const totalJobs = await page.evaluate(() => {
    const text = document.body ? document.body.innerText : "";
    const m1 = text.match(/(\d+)\s+Available\s+Jobs?\b/i);
    if (m1) return parseInt(m1[1], 10);
    const m2 = text.match(/Available\s+Jobs?\s*[:(]?\s*(\d+)/i);
    if (m2) return parseInt(m2[1], 10);
    return null;
  });

  console.log("[i] Total:", (typeof totalJobs === "number" && totalJobs > 0) ? totalJobs : "(not detected)");

  let pages = Math.max(1, Math.ceil((totalJobs || 0) / 10));
  pages = Math.min(pages, maxPages);
  if (pages === 0) pages = 1;

  console.log("[i] Pages to scan:", pages);

  // Collect job links
  const linksToScrape = new Set();
  let stopEarly = false;

  for (let p = 1; p <= pages; p++) {
    if (stopEarly) break;

    // Skip navigating to page 1 again if we are already there
    if (p > 1) {
      console.log(`[list] page ${p}/${pages}`);
      const url = withPage(urlNoPage, p);
      await goto(url);
    }

    // Scroll a bit
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(250);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);

    const pageLinks = await page.evaluate(() => {
      const out = [];
      for (const a of document.querySelectorAll("a[href]")) {
        const href = a.getAttribute("href") || "";
        if (href.includes("/jobs/") && !href.includes("/jobs?")) out.push(href);
      }
      return out;
    });

    let newOnPage = 0;
    for (const href of pageLinks) {
      const abs = href.startsWith("http")
        ? href
        : ("https://jobs.af" + (href.startsWith("/") ? href : "/" + href));

      // NEW: Check if we already know this job
      if (!existingUrls.has(abs)) {
        // ALWAYS keep if it's new
        linksToScrape.add(abs);
        newOnPage++;
      }
    }

    console.log(`    Page ${p}: Found ${pageLinks.length} links. (${newOnPage} new)`);

    // INCERENTAL LOGIC: If we found links on this page, but NONE are new,
    // we assume we have reached the "known" territory and can stop.
    if (pageLinks.length > 0 && newOnPage === 0) {
      console.log(`[i] Increment Stop: All jobs on page ${p} are already known.`);
      stopEarly = true;
    }
  }

  console.log("[i] New links to scrape:", linksToScrape.size);

  // Scrape job details for NEW links only
  const jobPage = await browser.newPage();
  await jobPage.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  async function gotoJob(url) {
    try {
      await jobPage.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch {
      await jobPage.goto(url, { waitUntil: "load", timeout: 60000 });
    }
    await sleep(900);
  }

  const newRecords = [];
  const nowISO = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  let i = 0;
  for (const url of Array.from(linksToScrape)) {
    i++;
    try {
      await gotoJob(url);

      const data = await jobPage.evaluate(() => {
        const text = (el) => {
          if (!el || !el.innerText) return null;
          const t = el.innerText.trim();
          return t || null;
        };

        const root =
          document.querySelector("div.md\\:grid.grid-cols-12.px-4.md\\:px-0") ||
          document.querySelector("div.md\\:grid.grid-cols-12") ||
          null;

        const rootText = root ? root.innerText : "";

        const header = root ? root.querySelector(".header") : null;
        const title =
          text(header && header.querySelector("h1")) ||
          text(root && root.querySelector("h1")) ||
          text(root && root.querySelector("h2")) ||
          null;

        const headerMeta = text(header && header.querySelector("p"));
        let company = null;
        let location = null;
        if (headerMeta) {
          const parts = headerMeta.split(",").map(s => s.trim()).filter(Boolean);
          if (parts.length) {
            company = parts[0];
            if (parts.length > 1) location = parts.slice(1).join(", ");
          }
        }

        if (!company && root) {
          const about = Array.from(root.querySelectorAll("h3")).find(h => {
            const t = text(h);
            return t && t.toLowerCase().startsWith("about ");
          });
          if (about) {
            const t = text(about);
            if (t) company = t.replace(/^about\\s+/i, "").trim() || null;
          }
        }

        if (!location && root) {
          const jobTopItems = Array.from(
            root.querySelectorAll(".job-top .text-sm.text-gray-400")
          ).map(text).filter(Boolean);
          for (const item of jobTopItems) {
            if (/afghanistan/i.test(item)) {
              location = item;
              break;
            }
          }
          if (!location) {
            const loc = jobTopItems.find(
              item => /[A-Za-z]/.test(item) && /,/.test(item) && !/^\\d+$/.test(item)
            );
            if (loc) location = loc;
          }
        }

        const kv = {};
        let closingRaw = null;
        if (root) {
          const right = root.querySelector(".right-section");
          if (right) {
            const rows = Array.from(right.querySelectorAll("div.flex.justify-between"));
            for (const row of rows) {
              const parts = Array.from(row.querySelectorAll("p")).map(text).filter(Boolean);
              if (parts.length >= 2) {
                const key = parts[0];
                const value = parts.slice(1).join(" ").trim();
                if (key && value) {
                  kv[key] = value;
                  if (!closingRaw && key.toLowerCase() === "closing date") closingRaw = value;
                }
              }
            }
          }
        }
        if (!closingRaw && rootText) {
          const lines = rootText.split("\n").map(s => s.trim()).filter(Boolean);
          for (let k = 0; k < lines.length; k++) {
            const t = lines[k].toLowerCase();
            if (t === "closing date" && lines[k + 1]) {
              closingRaw = lines[k + 1];
              break;
            }
          }
          if (!closingRaw) {
            const m = rootText.match(/Closing\\s+Date[:\\s]+([A-Za-z]{3,}\\s+\\d{1,2},?\\s*20\\d{2})/i);
            if (m) closingRaw = m[1];
          }
        }

        const pickPills = (label) => {
          if (!root) return [];
          const heads = Array.from(root.querySelectorAll("h3"));
          const head = heads.find(h => {
            const t = text(h);
            return t && t.toLowerCase() === label.toLowerCase();
          });
          if (!head || !head.nextElementSibling) return [];
          return Array.from(head.nextElementSibling.querySelectorAll(".text-xs"))
            .map(text)
            .filter(Boolean);
        };

        const functional = pickPills("Functional Area");
        if (functional.length) kv["Functional Area"] = functional.join(", ");
        const countries = pickPills("Countries");
        if (countries.length) kv["Countries"] = countries.join(", ");
        const provinces = pickPills("Provinces");
        if (provinces.length) kv["Provinces"] = provinces.join(", ");

        let applyUrl = null;
        if (root) {
          const mailto = root.querySelector('a[href^="mailto:"]');
          if (mailto) applyUrl = mailto.href;
          if (!applyUrl) {
            const applyA = Array.from(root.querySelectorAll("a[href]")).find(a => {
              const t = (a.innerText || "").toLowerCase();
              return t.includes("apply");
            });
            if (applyA) applyUrl = applyA.href;
          }
        }

        let desc = null;
        let descEl = null;
        if (root) {
          const grid = root.querySelector(".grid.grid-cols-1.md\\:grid-cols-10");
          if (grid) {
            descEl = grid.querySelector(".col-span-5.md\\:col-span-7") || grid.querySelector("div");
          }
        }
        if (!descEl && root) descEl = root;
        if (descEl) {
          const txt = (descEl.innerText || "").trim();
          if (txt) desc = txt;
        }

        const fullText = rootText;

        return {
          title,
          company,
          location,
          closingRaw,
          applyUrl,
          kv,
          desc,
          fullText,
        };
      });

      const fullText = data.fullText || "";
      const emails = extractEmails(fullText);
      const phones = extractPhones(fullText);

      const closingDate = parseClosingDate(data.closingRaw);

      const rec = {
        url,
        source: "jobs.af",
        title: data.title || null,
        company: data.company || data.kv.Company || data.kv.company || null,
        location: data.location || data.kv.Location || data.kv.location || data.kv.Provinces || null,
        closing_date_raw: data.closingRaw || data.kv["Closing Date"] || data.kv["closing date"] || null,
        closing_date: closingDate,
        apply_url: data.applyUrl || null,
        apply_emails: emails,
        apply_phones: phones,
        description: data.desc || null,
        details: data.kv || {},
        scraped_at: nowISO,
      };

      // SELECTIVE FILTERING
      const categories = (rec.details['Functional Area'] || "").toLowerCase();
      const isRestricted = categories.includes("banking") || categories.includes("finance");

      if (isRestricted) {
        // Only keep if title is technical 
        if (isTechnical(rec.title)) {
          newRecords.push(rec);
          const shown = rec.title ? rec.title.slice(0, 60) : "No title";
          console.log(`[job] ${i}/${linksToScrape.size} ${shown} (Technical Banking)`);
        } else {
          console.log(`[i] Skipped non-technical banking job: ${rec.title}`);
        }
      } else {
        // Normal IT category - keep everything
        newRecords.push(rec);
        const shown = rec.title ? rec.title.slice(0, 60) : "No title";
        console.log(`[job] ${i}/${linksToScrape.size} ${shown} (IT Category)`);
      }

    } catch (e) {
      console.log(`[!] failed ${url}: ${String(e).slice(0, 120)}`);
    }
  }

  // MERGE: New + Existing
  let merged = [...newRecords, ...existingJobs];

  // Filter only-open logic (applied to EVERYTHING now)
  let out = merged;
  if (onlyOpen) {
    const today = todayISO();
    out = merged.filter(r => {
      // Keep if no date, or date is in future
      if (!r.closing_date) return true;
      return r.closing_date >= today;
    });
    console.log(`[i] only-open: kept ${out.length}/${merged.length} (removed expired)`);
  }

  // Deduplicate just in case (prefer new)
  const dedupMap = new Map();
  // Reverse: data at end overwrites data at start. 
  // We want NEW to overwrite OLD. 
  // 'existingJobs' is OLD. 'newRecords' is NEW.
  // merged = new + old. 
  // Wait, if I do `new + old`, and map iterates:
  // 1. new (written to map)
  // 2. old (if dup, overwrites new?? NO. We want NEW to stay.)
  // Better: `[...existingJobs, ...newRecords]` -> Old then New.
  // Last write wins.

  const finalSequence = [...existingJobs, ...newRecords];
  finalSequence.forEach(r => dedupMap.set(r.url, r));
  out = Array.from(dedupMap.values());

  // Re-apply filter if needed on the set? No, verify correctness.
  if (onlyOpen) {
    const today = todayISO();
    out = out.filter(r => !r.closing_date || r.closing_date >= today);
  }

  // Sort by scrape date descending (newest first)
  out.sort((a, b) => (b.scraped_at || "").localeCompare(a.scraped_at || ""));

  // Save JSON
  fs.writeFileSync(outJson, JSON.stringify(out, null, 2), "utf-8");

  // Save CSV
  const fields = [
    "title", "company", "location", "closing_date", "apply_url", "url", "source", "scraped_at",
    "closing_date_raw", "apply_emails", "apply_phones"
  ];
  const rows = out.map(r => ({
    ...r,
    apply_emails: (r.apply_emails || []).join(" | "),
    apply_phones: (r.apply_phones || []).join(" | "),
  }));
  fs.writeFileSync(outCsv, toCSV(rows, fields), "utf-8");

  await browser.close();

  console.log("\nDone.");
  console.log(`Scraped New: ${newRecords.length}, Total Saved: ${out.length}`);
  console.log("JSON:", outJson);
  console.log("CSV :", outCsv);
  console.log("Debug:", debugDir);
}

main().catch(e => {
  console.error("[FATAL]", e);
  process.exit(1);
});
