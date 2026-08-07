/**
 * Optional local control API for the scraper.
 *
 * This server is intentionally loopback-only by default. The production site is
 * static and must never depend on a visitor having this process on their device.
 * To expose it on another interface, set SCRAPER_HOST and SCRAPER_API_TOKEN.
 */

const crypto = require("crypto");
const { spawn } = require("child_process");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const host = process.env.SCRAPER_HOST || "127.0.0.1";
const port = integerSetting("SCRAPER_PORT", 3001, 1, 65535);
const maxPages = integerSetting("SCRAPER_MAX_PAGES", 50, 1, 100);
const timeoutMs = integerSetting("SCRAPER_TIMEOUT_MS", 30 * 60 * 1000, 10_000, 60 * 60 * 1000);
const apiToken = process.env.SCRAPER_API_TOKEN || "";
const repositoryRoot = path.resolve(__dirname, "..");
const jobsFile = path.join(repositoryRoot, "docs", "data", "jobs.json");
const csvFile = path.join(repositoryRoot, "data", "jobs.csv");
const debugDir = path.join(__dirname, "debug");
const allowedOrigins = new Set(
  (process.env.SCRAPER_ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean),
);

if (!isLoopback(host) && !apiToken) {
  throw new Error("SCRAPER_API_TOKEN is required when SCRAPER_HOST is not loopback");
}

let activeChild = null;
let runStatus = {
  state: "idle",
  started_at: null,
  finished_at: null,
  exit_code: null,
  message: "No scrape has run during this server session.",
};

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Authorization", "Content-Type"],
}));
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.post("/api/refresh", requireRefreshAuthorization, (_req, res) => {
  if (activeChild) {
    return res.status(409).json({
      success: false,
      message: "A scrape is already running.",
      status: publicStatus(),
    });
  }

  startScrape();
  return res.status(202).json({
    success: true,
    message: "Scrape started. Poll /api/status for completion.",
    status: publicStatus(),
  });
});

app.get("/api/status", (_req, res) => {
  res.json({ success: true, status: publicStatus() });
});

app.get("/api/jobs", (_req, res) => {
  try {
    const jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
    if (!Array.isArray(jobs)) throw new Error("jobs data is not an array");
    res.json({ success: true, count: jobs.length, jobs });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: "Validated jobs data is not available.",
    });
  }
});

app.use((error, _req, res, _next) => {
  const status = error.message === "Origin is not allowed" ? 403 : 500;
  res.status(status).json({ success: false, message: error.message });
});

app.listen(port, host, () => {
  console.log(`[api] scraper control server: http://${host}:${port}`);
  console.log(`[api] canonical jobs file: ${jobsFile}`);
});

function startScrape() {
  const scraperPath = path.join(__dirname, "scrape_all.js");
  const args = [
    scraperPath,
    "--json", jobsFile,
    "--csv", csvFile,
    "--debug-dir", debugDir,
    "--max-pages", String(maxPages),
  ];
  const startedAt = new Date().toISOString();
  let stdout = "";
  let stderr = "";
  let settled = false;
  let timedOut = false;
  let forcedKillTimer = null;

  runStatus = {
    state: "running",
    started_at: startedAt,
    finished_at: null,
    exit_code: null,
    message: "Scrape is running.",
  };

  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  activeChild = child;

  child.stdout.on("data", chunk => {
    const text = String(chunk);
    process.stdout.write(text);
    stdout = appendBounded(stdout, text);
  });
  child.stderr.on("data", chunk => {
    const text = String(chunk);
    process.stderr.write(text);
    stderr = appendBounded(stderr, text);
  });

  const timeout = setTimeout(() => {
    if (settled) return;
    timedOut = true;
    stderr = appendBounded(stderr, `\nScrape exceeded ${timeoutMs}ms and was terminated.`);
    child.kill("SIGTERM");
    forcedKillTimer = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, 5_000);
  }, timeoutMs);

  child.once("error", error => finish(null, error));
  child.once("close", code => finish(code, null));

  function finish(code, startError) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (forcedKillTimer) clearTimeout(forcedKillTimer);
    activeChild = null;

    const success = !timedOut && !startError && code === 0;
    runStatus = {
      state: success ? "succeeded" : "failed",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: code,
      message: success
        ? lastUsefulLine(stdout) || "Scrape completed successfully."
        : lastUsefulLine(stderr) || startError?.message || `Scrape exited with code ${code}.`,
    };
  }
}

function requireRefreshAuthorization(req, res, next) {
  if (!apiToken) return next();
  const provided = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (safeEqual(provided, apiToken)) return next();
  return res.status(401).json({ success: false, message: "A valid bearer token is required." });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicStatus() {
  return { ...runStatus };
}

function appendBounded(current, addition, limit = 64 * 1024) {
  const combined = `${current}${addition}`;
  return combined.length <= limit ? combined : combined.slice(-limit);
}

function lastUsefulLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 500);
}

function integerSetting(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function isLoopback(value) {
  return value === "127.0.0.1" || value === "::1" || value === "localhost";
}
