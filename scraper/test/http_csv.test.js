const assert = require("node:assert/strict");
const test = require("node:test");
const { toCSV } = require("../lib/csv");
const { backoffMs, isRetryableStatus, retryAfterMs } = require("../lib/http");

test("HTTP retry policy is status-aware and honors Retry-After", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(retryAfterMs({ "retry-after": "3" }), 3000);
  assert.equal(backoffMs(2, null, () => 0), 1000);
  assert.equal(backoffMs(2, 5000, () => 0), 5000);
});

test("CSV serialization neutralizes spreadsheet formulas", () => {
  const csv = toCSV([{ title: "=HYPERLINK(\"bad\")", salary: "+1", id: "1" }], ["id", "title", "salary"]);
  assert.match(csv, /'\=HYPERLINK/);
  assert.match(csv, /'\+1/);
});
