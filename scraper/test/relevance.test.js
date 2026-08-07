const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assessJobRelevance, detectComputingDegreeRequirement } = require("../lib/keywords");

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

test("category and functional-area evidence is capped below the publication threshold", () => {
  const assessment = assessJobRelevance({
    title: "Officer",
    category: "Information Technology",
    details: { "Functional Area": "Software Development" },
  });
  assert.equal(assessment.decision, "exclude");
  assert.equal(assessment.score, 42);
  assert.equal(
    assessment.reasons.filter(reason => /^(?:category|functional area|category\/functional area):/.test(reason)).length,
    1
  );
});

test("hard procurement title remains excluded after category and degree corroboration", () => {
  const assessment = assessJobRelevance({
    title: "Procurement Bidding Specialist",
    category: "Information Technology",
    details: { Education: "Bachelor's degree in Computer Science" },
  });
  assert.equal(assessment.decision, "exclude");
  assert.equal(assessment.score, 0);
  assert.ok(assessment.reasons.some(reason => reason.includes('non-technical title: “procurement”')));
});

test("Persian IT graduation wording is recognized as computing-degree evidence", () => {
  assert.deepEqual(
    detectComputingDegreeRequirement({
      description: "شرایط وظیفه: فارغ شده از تکنالوژی معلوماتی و دارای تجربه توسعه وبسایت.",
    }),
    { matched: true, field: "Information Technology", source: "requirements text" }
  );
});

test("a dot-net domain is not treated as Microsoft .NET evidence", () => {
  const assessment = assessJobRelevance({
    title: "Humanitarian Access & Risk Officer",
    category: "Security",
    description: "Coordinate technical support with the humanitarian networking group at example.net.",
  });
  assert.equal(assessment.decision, "exclude");
  assert.equal(assessment.reasons.some(reason => reason.includes("dotnet")), false);
});

test("humanitarian programming wording is not treated as software work", () => {
  const assessment = assessJobRelevance({
    title: "Quality Officer",
    category: "QA-Quality Control",
    description: "Support research, accountability, and evidence-based programming for community projects.",
  });
  assert.equal(assessment.decision, "exclude");
  assert.equal(assessment.reasons.some(reason => reason.includes('description role: “programming”')), false);
});

test("explicit programming-language wording remains a technical duty signal", () => {
  const assessment = assessJobRelevance({
    title: "Technology Associate",
    category: "Private Sector",
    description: "Use modern programming languages to automate internal workflows.",
  });
  assert.equal(assessment.decision, "include");
  assert.ok(assessment.reasons.some(reason => reason.includes('description role: “programming languages”')));
});
