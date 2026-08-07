const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ITEMS_PER_PAGE,
  UNFILTERED_RAW_URL,
  collectJobSummaries,
  scrapeJobsAf,
} = require("../jobsaf_scrape");
const jobsaf = require("../sites/jobsaf");

function summaries(start, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: start + index,
    slug: `job-${start + index}`,
    title: `Job ${start + index}`,
  }));
}

test("Jobs.af multi-source crawl is unfiltered and requests large API pages", async () => {
  assert.equal(jobsaf.defaultRawUrl, UNFILTERED_RAW_URL);
  assert.deepEqual(new URL(UNFILTERED_RAW_URL).searchParams.getAll("category"), []);

  const requests = [];
  const result = await collectJobSummaries([], 10, {
    fetchPage: async (endpoint, params) => {
      requests.push({ endpoint, params });
      return params.page === 1
        ? { data: summaries(0, 100), meta: { totalPages: 2 } }
        : { data: summaries(100, 55), meta: { totalPages: 2 } };
    },
  });

  assert.equal(ITEMS_PER_PAGE, 100);
  assert.equal(result.summaries.length, 155);
  assert.equal(result.pagesFetched, 2);
  assert.deepEqual(requests.map(request => request.params.itemsPerPage), [100, 100]);
  assert.equal("filter[functionalAreas.area.id]" in requests[0].params, false);
});

test("unfiltered Jobs.af crawl does not depend on the functional-areas endpoint", async () => {
  let functionalAreasCalled = false;
  const records = await scrapeJobsAf({
    maxPages: 10,
    loadFunctionalAreas: async () => {
      functionalAreasCalled = true;
      throw new Error("functional areas unavailable");
    },
    collectJobSummaries: async areaIds => {
      assert.deepEqual(areaIds, []);
      return { summaries: [], pagesFetched: 1, totalPages: 1 };
    },
  });

  assert.equal(functionalAreasCalled, false);
  assert.equal(records.length, 0);
});

test("Jobs.af refuses to publish a crawl truncated by max-pages", async () => {
  await assert.rejects(
    collectJobSummaries([], 1, {
      fetchPage: async () => ({ data: summaries(0, 100), meta: { totalPages: 2 } }),
    }),
    /requires 2 pages but max-pages is 1/,
  );
});

test("Jobs.af rejects a full API page without pagination metadata", async () => {
  await assert.rejects(
    collectJobSummaries([], 10, {
      fetchPage: async () => ({ data: summaries(0, 100), meta: {} }),
    }),
    /omitted pagination metadata/,
  );
});

test("Jobs.af rejects a repeated API page even when its order changes", async () => {
  const firstPage = summaries(0, 100);
  await assert.rejects(
    collectJobSummaries([], 10, {
      fetchPage: async (endpoint, params) => ({
        data: params.page === 1 ? firstPage : [...firstPage].reverse(),
        meta: { totalPages: 2 },
      }),
    }),
    /pagination stalled at page 2: repeated stable slug\/ID keys from page 1/,
  );
});

test("Jobs.af pagination stall detection falls back to stable IDs", async () => {
  const idOnlyPage = summaries(0, 100).map(({ slug, ...summary }) => summary);
  await assert.rejects(
    collectJobSummaries([], 10, {
      fetchPage: async () => ({ data: idOnlyPage, meta: { totalPages: 2 } }),
    }),
    /pagination stalled at page 2: repeated stable slug\/ID keys from page 1/,
  );
});
