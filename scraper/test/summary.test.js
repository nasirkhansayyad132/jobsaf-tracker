const assert = require("node:assert/strict");
const test = require("node:test");
const { findNewJobs } = require("../generate_summary");

test("logical-ID migration is not reported as new when a source URL already existed", () => {
  const previous = [{
    id: "source-specific-id",
    source: "kaarobar",
    url: "https://www.kaarobar.net/jobs/55/software-developer",
    also_found_on: [
      { source: "acbar", url: "https://www.acbar.org/jobs/44/software-developer.jsp" },
    ],
  }];
  const current = [{
    id: "stable-logical-id",
    source: "acbar",
    url: "https://www.acbar.org/jobs/44/software-developer.jsp",
    also_found_on: [
      { source: "kaarobar", url: "https://www.kaarobar.net/jobs/55/software-developer" },
    ],
  }];

  assert.deepEqual(findNewJobs(current, previous), []);
});

test("a vacancy with no prior ID or source URL is reported as new", () => {
  const previous = [{ id: "old", url: "https://example.com/jobs/old" }];
  const current = [{ id: "new", url: "https://example.com/jobs/new" }];
  assert.deepEqual(findNewJobs(current, previous), current);
});
