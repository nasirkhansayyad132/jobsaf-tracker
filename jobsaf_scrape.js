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

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

  // Page 1: detect total jobs and max pages
  console.log("[1] Loading page 1...");
  await goto(withPage(urlNoPage, 1));
  await page.screenshot({ path: path.join(debugDir, "01_page1.png"), fullPage: true });

  const totalInfo = await page.evaluate(() => {
    const txts = Array.from(document.querySelectorAll("*"))
      .map(e => (e && e.innerText) ? e.innerText.trim() : "")
      .filter(Boolean);
    const hit = txts.find(t => /\b\d+\s+Available Jobs\b/i.test(t));
    return hit || null;
  });

  let totalJobs = 0;
  if (totalInfo) {
    const m = totalInfo.match(/(\d+)/);
    if (m) totalJobs = parseInt(m[1], 10);
  }
  console.log("[i] Total:", totalJobs || "(not detected)");

  // Try detect max page from pagination UI
  let detectedMax = 1;
  try {
    detectedMax = await page.evaluate(() => {
      let max = 1;
      const els = Array.from(document.querySelectorAll("a,button,span"));
      for (const el of els) {
        const t = (el.textContent || "").trim();
        const n = parseInt(t, 10);
        if (!isNaN(n) && n > max && n < 500) max = n;
      }
      return max;
    });
  } catch {}

  let pages = detectedMax;
  if (totalJobs && totalJobs > 0) {
    const est = Math.ceil(totalJobs / 10);
    pages = Math.max(pages, est);
  }
  pages = Math.min(pages, maxPages);
  // derivedPagesFromTotal: jobs.af often shows TOTAL jobs, not page count.
  // Always derive pages = ceil(total/10) so we don't get "Pages: 39" when total is 39.
  const __t = (typeof total === "number" ? total : (typeof totalJobs === "number" ? totalJobs : null));
  if (__t && __t > 0) {
    pages = Math.max(1, Math.ceil(__t / 10));
  }

  console.log("[i] Pages:", pages, "(detected:", detectedMax + ")");

  // Collect job links
  const links = new Set();

  for (let p = 1; p <= pages; p++) {
    const url = withPage(urlNoPage, p);
    console.log(`[list] page ${p}/${pages}`);
    await goto(url);

    // Scroll a bit (some sites lazy-load)
    for (let i = 0; i < 6; i++) {
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

    for (const href of pageLinks) {
      const abs = href.startsWith("http")
        ? href
        : ("https://jobs.af" + (href.startsWith("/") ? href : "/" + href));
      links.add(abs);
    }

    if (p <= 3 || p === pages) {
      await page.screenshot({ path: path.join(debugDir, `list_${String(p).padStart(2, "0")}.png`), fullPage: true });
    }

    console.log(`    +${pageLinks.length} (total unique: ${links.size})`);
  }

  console.log("[i] collected links:", links.size);

  // Scrape job details
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

  const records = [];
  const nowISO = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  let i = 0;
  for (const url of Array.from(links)) {
    i++;
    try {
      await gotoJob(url);

      const data = await jobPage.evaluate(() => {
        const pickText = (sel) => {
          const el = document.querySelector(sel);
          return el ? el.innerText.trim() : null;
        };

        const title = pickText("h1") || pickText("h2") || null;

        // Grab the whole text (for emails/phones + fallback date)
        const fullText = document.body ? document.body.innerText : "";

        // Try find closing date near label text
        let closingRaw = null;
        const lines = fullText.split("\n").map(s => s.trim()).filter(Boolean);
        for (let k = 0; k < lines.length; k++) {
          const t = lines[k].toLowerCase();
          if (t === "closing date" && lines[k + 1]) {
            closingRaw = lines[k + 1];
            break;
          }
        }
        if (!closingRaw) {
          const m = fullText.match(/Closing\s+Date[:\s]+([A-Za-z]{3,}\s+\d{1,2},?\s*20\d{2})/i);
          if (m) closingRaw = m[1];
        }

        // Apply link
        let applyUrl = null;
        const applyA = Array.from(document.querySelectorAll("a[href]")).find(a => {
          const t = (a.innerText || "").toLowerCase();
          return t.includes("apply");
        });
        if (applyA) applyUrl = applyA.href;

        // Try company/location from common “key/value” blocks
        const kv = {};
        const nodes = Array.from(document.querySelectorAll("div,span,dt,th,td,p"));
        const known = new Set([
          "company","organization","employer",
          "location","duty station","provinces","city",
          "closing date","post date","reference",
        ]);

        for (let n = 0; n < nodes.length; n++) {
          const t = (nodes[n].innerText || "").trim();
          const key = t.toLowerCase();
          if (known.has(key)) {
            const next = nodes[n].nextElementSibling;
            if (next) {
              const val = (next.innerText || "").trim();
              if (val && val.length < 200) kv[t] = val;
            }
          }
        }

        // Description: prefer main/article, else body
        let desc = null;
        const main = document.querySelector("main") || document.querySelector("article");
        if (main) {
          const txt = main.innerText.trim();
          if (txt.length > 200) desc = txt;
        }
        if (!desc && fullText && fullText.length > 200) desc = fullText;

        return {
          title,
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
        company: data.kv.Company || data.kv.company || null,
        location: data.kv.Location || data.kv.location || data.kv.Provinces || null,
        closing_date_raw: data.closingRaw || null,
        closing_date: closingDate,
        apply_url: data.applyUrl || null,
        apply_emails: emails,
        apply_phones: phones,
        description: data.desc || null,
        details: data.kv || {},
        scraped_at: nowISO,
      };

      records.push(rec);

      const shown = rec.title ? rec.title.slice(0, 60) : "No title";
      console.log(`[job] ${i}/${links.size} ${shown} | closing: ${rec.closing_date || rec.closing_date_raw || "?"}`);

      if (i <= 3) {
        await jobPage.screenshot({ path: path.join(debugDir, `job_${i}.png`), fullPage: true });
      }
    } catch (e) {
      console.log(`[!] failed ${url}: ${String(e).slice(0, 120)}`);
      try {
        await jobPage.screenshot({ path: path.join(debugDir, `err_${i}.png`), fullPage: true });
      } catch {}
    }
  }

  // Filter only-open
  let out = records;
  if (onlyOpen) {
    const today = todayISO();
    out = records.filter(r => {
      if (!r.closing_date) return true; // keep unknown
      return r.closing_date >= today;
    });
    console.log(`[i] only-open: kept ${out.length}/${records.length}`);
  }

  // Save JSON
  fs.writeFileSync(outJson, JSON.stringify(out, null, 2), "utf-8");

  // Save CSV
  const fields = [
    "title","company","location","closing_date","apply_url","url","source","scraped_at",
    "closing_date_raw","apply_emails","apply_phones"
  ];
  const rows = out.map(r => ({
    ...r,
    apply_emails: (r.apply_emails || []).join(" | "),
    apply_phones: (r.apply_phones || []).join(" | "),
  }));
  fs.writeFileSync(outCsv, toCSV(rows, fields), "utf-8");

  await browser.close();

  console.log("\nDone.");
  console.log("Saved:", out.length);
  console.log("JSON:", outJson);
  console.log("CSV :", outCsv);
  console.log("Debug:", debugDir);
}

main().catch(e => {
  console.error("[FATAL]", e);
  process.exit(1);
});
