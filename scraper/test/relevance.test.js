const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assessJobRelevance } = require("../lib/keywords");

const fixturePath = path.join(__dirname, "fixtures", "relevance.json");
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

for (const fixture of fixtures) {
  test(`relevance: ${fixture.name}`, () => {
    const assessment = assessJobRelevance(fixture.job);
    assert.equal(assessment.decision, fixture.expected, assessment.reasons.join("\n"));
    assert.equal(assessment.version, 2);
    assert.ok(Number.isFinite(assessment.score));
    assert.ok(assessment.reasons.length > 0);
    assert.equal(assessment.decision === "include", assessment.score >= assessment.threshold);
    assert.equal(assessment.reasons.some(reason => reason.startsWith("company")), false);
  });
}

test("company names never change a relevance decision or score", () => {
  const base = { title: "Pediatrician", category: "Health Care" };
  const plain = assessJobRelevance({ ...base, company: "Community Clinic" });
  const techNamed = assessJobRelevance({ ...base, company: "AI ICT Software Development Network" });
  assert.deepEqual(techNamed, plain);
});

test("degree evidence reason reports the detected field without inventing listing wording", () => {
  const assessment = assessJobRelevance({
    title: "Technology Officer",
    category: "Private Sector",
    details: { Education: "Bachelor's degree in Data Science" },
  });
  assert.equal(assessment.decision, "include");
  assert.ok(assessment.reasons.includes('education requirement: computing degree “Data Science” (+18)'));
  assert.equal(assessment.reasons.some(reason => reason.includes("or related")), false);
});
