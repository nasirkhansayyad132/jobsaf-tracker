const axios = require("axios");

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 30_000;

class HttpRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "HttpRequestError";
    this.status = options.status || null;
    this.url = options.url || null;
    this.retryable = Boolean(options.retryable);
    this.cause = options.cause;
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(headers, now = Date.now()) {
  const raw = headers?.get?.("retry-after") ?? headers?.["retry-after"];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function backoffMs(attempt, retryAfter, random = Math.random) {
  if (retryAfter !== null && retryAfter !== undefined) {
    return Math.min(MAX_RETRY_DELAY_MS, retryAfter);
  }
  const base = 500 * (2 ** Math.max(0, attempt - 1));
  const jitter = base * 0.25 * random();
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(base + jitter));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(url, options = {}) {
  const attempts = Math.max(1, Number.parseInt(options.attempts || DEFAULT_ATTEMPTS, 10));
  const timeout = Math.max(1000, Number.parseInt(options.timeout || DEFAULT_TIMEOUT_MS, 10));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await axios.get(url, {
        timeout,
        responseType: options.responseType,
        signal: options.signal,
        headers: {
          Accept: options.responseType === "text" ? "text/html,application/xhtml+xml" : "application/json",
          "User-Agent": "jobsaf-tracker/2.0 (+https://github.com/nasirkhansayyad132/jobsaf-tracker)",
          ...(options.headers || {}),
        },
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) return response.data;

      const retryable = isRetryableStatus(response.status);
      const error = new HttpRequestError(`HTTP ${response.status} for ${url}`, {
        status: response.status,
        url,
        retryable,
      });
      if (!retryable || attempt === attempts) throw error;
      lastError = error;
      const delay = backoffMs(attempt, retryAfterMs(response.headers), options.random);
      options.onRetry?.({ attempt, delay, error, url });
      await (options.sleep || sleep)(delay);
    } catch (error) {
      if (error instanceof HttpRequestError) {
        if (!error.retryable || attempt === attempts) throw error;
        // A retryable HTTP response was already delayed above.
        continue;
      }
      if (error.code === "ERR_CANCELED" || options.signal?.aborted) throw error;

      lastError = new HttpRequestError(`Network request failed for ${url}: ${error.message}`, {
        url,
        retryable: true,
        cause: error,
      });
      if (attempt === attempts) throw lastError;
      const delay = backoffMs(attempt, null, options.random);
      options.onRetry?.({ attempt, delay, error: lastError, url });
      await (options.sleep || sleep)(delay);
    }
  }
  throw lastError || new HttpRequestError(`Request failed for ${url}`, { url });
}

async function requestJson(url, options = {}) {
  const data = await request(url, { ...options, responseType: "json" });
  if (data === null || data === undefined || typeof data !== "object") {
    throw new HttpRequestError(`Expected JSON object/array from ${url}`, { url });
  }
  return data;
}

function requestText(url, options = {}) {
  return request(url, { ...options, responseType: "text" });
}

module.exports = {
  HttpRequestError,
  backoffMs,
  isRetryableStatus,
  request,
  requestJson,
  requestText,
  retryAfterMs,
};
