const { normSpace } = require("./normalize");

const RELEVANCE_VERSION = 2;
const RELEVANCE_THRESHOLD = 55;

// Strong signals describe technical work, not merely an employer or industry.
const STRONG_TECH_PHRASES = [
  "software architect", "software engineer", "software developer", "software development",
  "full stack", "fullstack", "front end developer", "frontend developer", "back end developer",
  "backend developer", "web developer", "web development", "mobile developer", "mobile application developer",
  "android developer", "ios developer", "flutter developer", "application developer", "programmer",
  "php developer", "wordpress developer", "javascript developer", "typescript developer", "python developer",
  "java developer", "node js developer", "react developer", "laravel developer", "django developer",
  "computer programmer", "computer science", "computer engineering", "information technology",
  "it officer", "it technician", "it administrator", "it assistant", "it manager", "it support",
  "help desk", "helpdesk", "desktop support", "technical support engineer", "computer operator",
  "system administrator", "systems administrator", "system engineer", "systems engineer",
  "network administrator", "network engineer", "network technician", "network manager",
  "cloud engineer", "cloud architect", "devops", "site reliability engineer", "platform engineer",
  "database administrator", "database developer", "database engineer", "data engineer", "data analyst",
  "data scientist", "data science", "business intelligence", "bi developer", "etl developer",
  "machine learning", "artificial intelligence", "ai engineer", "ml engineer", "deep learning",
  "cyber security", "cybersecurity", "information security", "security engineer", "security analyst",
  "soc analyst", "penetration tester", "ethical hacker", "digital forensics", "data protection engineer",
  "quality assurance engineer", "software tester", "qa engineer", "test automation",
  "qa analyst", "webmaster", "network specialist", "database specialist", "database officer",
  "chief technology officer", "chief information security officer", "ciso", "cto",
  "it general manager", "general manager it", "ict general manager", "general manager ict",
  "general manager information technology", "it operations manager", "ict operations manager",
  "network operations manager", "technical operations manager", "mis manager", "mis administrator",
  "information systems manager",
  "solutions architect", "enterprise architect", "erp developer", "sap developer", "oracle developer",
  "gis developer", "gis analyst", "geographic information system", "mis officer", "mis specialist",
  "ict officer", "ict and communication officer", "ict communication officer", "ict engineer", "ict technician",
  "ict specialist", "information and communication technology", "telecom engineer",
  "telecommunications engineer", "telecom technician", "microwave technician", "radio network engineer",
  "technical project manager", "it project manager", "software project manager",
  "computer science lecturer", "computer science instructor", "computer science teacher",
  "software engineering lecturer", "software engineering instructor",
  "برنامه نویس", "برنامه نویسی", "انکشاف سیستم", "انکشاف نرم افزار", "مهندس نرم افزار",
  "مدیر شبکه", "انجینر شبکه", "امنیت سایبری", "امنیت معلومات", "مدیر دیتابیس",
  "کمپیوتر ساینس", "کامپیوتر ساینس", "تکنالوژی معلوماتی", "فناوری اطلاعات",
];

// These can be technical, but are too broad to decide without corroboration.
const SUPPORTING_TECH_PHRASES = [
  "software", "database", "sql", "mysql", "postgresql", "oracle", "mongodb",
  "javascript", "typescript", "python", "java", "php", "laravel", "django", "react",
  "angular", "vue", "node js", "asp net", "dotnet", "c sharp", "kotlin", "swift",
  "linux", "windows server", "active directory", "virtualization", "vmware", "docker",
  "kubernetes", "aws", "azure", "cloud", "api", "microservices", "git", "ci cd",
  "networking", "routing", "switching", "firewall", "cisco", "mikrotik", "fiber optic",
  "data warehouse", "data visualization", "power bi", "tableau", "statistics", "analytics",
  "automation", "source code", "coding", "algorithm", "technical architecture",
  "ict", "mis", "gis", "erp", "information system", "information systems",
  "دیتابیس", "پایگاه داده", "شبکه", "سیستم", "کمپیوتر", "کامپیوتر", "کدنویسی",
];

const BODY_ROLE_PHRASES = [
  "develop and maintain software", "developing software", "software development", "web application development",
  "mobile application development", "write code", "writing code", "source code development", "api development",
  "database administration", "database development", "network administration", "system administration",
  "server administration", "cybersecurity operations", "security monitoring", "technical support",
  "troubleshoot hardware", "troubleshoot software", "programming", "data engineering", "machine learning model",
];

const AMBIGUOUS_PRIMARY_PHRASES = [
  "it", "ict", "mis", "gis", "telecommunication", "telecommunications",
  "data management", "information systems", "technology", "computing",
];

// A required computing degree is useful corroboration for a vague technical
// title/category, but is never strong enough to admit a vacancy by itself.
// Short acronyms are evaluated only inside explicit education/degree context;
// this prevents substrings such as "it" in "profit" or "mis" in
// "administration" from becoming relevance signals.
const COMPUTING_DEGREE_FIELDS = [
  ["computer science", "Computer Science"],
  ["software engineering", "Software Engineering"],
  ["information technology", "Information Technology"],
  ["computer engineering", "Computer Engineering"],
  ["computer information systems", "Computer Information Systems"],
  ["management information systems", "Management Information Systems"],
  ["information systems", "Information Systems"],
  ["information security", "Information Security"],
  ["cyber security", "Cybersecurity"],
  ["cybersecurity", "Cybersecurity"],
  ["data science", "Data Science"],
  ["computer applications", "Computer Applications"],
  ["computer studies", "Computer Studies"],
  ["network engineering", "Network Engineering"],
  ["artificial intelligence", "Artificial Intelligence"],
  ["machine learning", "Machine Learning"],
  ["informatics", "Informatics"],
  ["computing", "Computing"],
  ["ict", "ICT"],
  ["cis", "CIS"],
  ["mis", "MIS"],
  ["cse", "CSE"],
  ["swe", "Software Engineering"],
  ["cs", "Computer Science"],
  ["se", "Software Engineering"],
  ["sw", "Software"],
  ["it", "Information Technology"],
];

const DEGREE_MARKERS = [
  "degree", "bachelor", "bachelors", "bachelor s", "baccalaureate",
  "master", "masters", "master s",
  "bsc", "bs", "ba", "msc", "ms",
];

const ACRONYM_DEGREE_FIELDS = new Set(["ict", "cis", "mis", "cse", "swe", "cs", "se", "sw", "it"]);
const DEGREE_CONTEXT_BREAKERS = [
  "experience", "knowledge", "skill", "skills", "proficiency", "using", "use",
  "working", "worked", "supporting", "support", "familiarity",
];

const COMPACT_COMPUTING_DEGREES = [
  ["bscs", "Computer Science"], ["bcs", "Computer Science"],
  ["mscs", "Computer Science"], ["mcs", "Computer Science"],
  ["bsit", "Information Technology"], ["bscit", "Information Technology"],
  ["bit", "Information Technology"], ["msit", "Information Technology"],
  ["bsse", "Software Engineering"], ["bse", "Software Engineering"],
  ["msse", "Software Engineering"], ["bcis", "Computer Information Systems"],
];

const NON_TECH_TITLE_PHRASES = [
  "accountant", "accounting", "admin assistant", "administrative assistant", "administration officer",
  "audit officer", "auditor", "cashier", "customer service", "finance assistant", "finance officer",
  "financial officer", "field investigator", "field officer", "hr officer", "human resources",
  "logistics officer", "medical doctor", "midwife", "nurse", "nutrition", "pediatrician",
  "pharmacist", "physician", "psychologist", "counselor", "vaccinator", "warehouse officer",
  "procurement officer", "project coordinator", "project officer", "project manager",
  "monitoring and evaluation", "m and e officer", "data entry", "data collector", "surveyor",
  "graphic designer", "motion graphic", "video editor", "videographer", "content creator",
  "digital marketing", "social media", "communications officer", "communication officer",
  "google ads", "paid media", "ppc", "lead generation", "seo specialist",
  "search engine optimization", "advertising specialist", "media buyer",
  "sales officer", "marketing officer", "marketing specialist", "marketing manager", "business development officer",
  "reporting assistant", "reporting officer", "m and e assistant",
  "general manager", "operations manager", "business manager", "business operations manager",
];

const NON_TECH_CATEGORY_PHRASES = [
  "health care", "healthcare", "medical", "finance", "banking", "accounting", "audit",
  "administration", "human resources", "logistics", "procurement", "sales and marketing",
  "media and communications", "social services", "agriculture", "security guard",
];

// Some sources publish one page for several unrelated vacancies. Keeping that
// page as a single "IT" job leaks its finance/admin/faculty subroles into the
// feed. We only split when an adapter can produce complete role-level records;
// title-only bundles are conservatively excluded here.
const MIXED_BUNDLE_MARKERS = [
  "career", "careers", "career opportunities", "job opportunities",
  "multiple positions", "multiple vacancies", "multiple roles",
  "various positions", "various vacancies", "various roles",
  "positions available", "vacancies available", "roles available",
];

const MIXED_NON_TECH_ROLE_PHRASES = [
  "administrative", "administration", "revenue", "finance", "accounting",
  "sales", "marketing", "human resources", "hr", "procurement", "logistics",
  "operations", "customer service", "economics", "sharia", "mathematics", "physics",
  "اقتصاد", "شرعیات", "شریعت", "ریاضیات", "فزیک", "فیزیک", "حقوق", "مدیریت",
];

function asciiNormalize(value) {
  return normSpace(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\/_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(text, phrase) {
  const normalizedText = asciiNormalize(text);
  const normalizedPhrase = asciiNormalize(phrase);
  if (!normalizedText || !normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function matches(text, phrases) {
  return phrases.filter(phrase => containsPhrase(text, phrase));
}

function splitRequirementClauses(value) {
  return String(value || "")
    // Protect common punctuated degree abbreviations before splitting sentences.
    .replace(/\b([bm])\s*\.\s*(s|sc)\s*\./gi, "$1$2")
    .split(/[\r\n;!?•]+|\.(?:\s+|$)/u)
    .map(raw => ({ raw: raw.normalize("NFKC"), normalized: asciiNormalize(raw) }))
    .filter(clause => clause.normalized);
}

function phraseTokenIndexes(tokens, phrase) {
  const needle = asciiNormalize(phrase).split(" ").filter(Boolean);
  const indexes = [];
  if (!needle.length) return indexes;
  for (let index = 0; index <= tokens.length - needle.length; index += 1) {
    if (needle.every((token, offset) => tokens[index + offset] === token)) indexes.push(index);
  }
  return indexes;
}

function casePreservingTokens(value) {
  return normSpace(value)
    .normalize("NFKC")
    .replace(/&/g, " and ")
    .replace(/[\/_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function computingFieldInDegreeContext(value, structuredEducation = false) {
  for (const clause of splitRequirementClauses(value)) {
    for (const [compact, label] of COMPACT_COMPUTING_DEGREES) {
      const compactPattern = new RegExp(`(?:^|[^A-Za-z0-9])(${compact})(?=$|[^A-Za-z0-9])`, "i");
      const compactMatch = clause.raw.match(compactPattern)?.[1];
      // BIT is also a common English word; accept that one only as an actual
      // uppercase acronym. Longer forms such as BScIT remain case-flexible.
      if (compactMatch && (compact !== "bit" || compactMatch === "BIT")) return label;
    }

    const normalizedTokens = clause.normalized.split(" ");
    const originalTokens = casePreservingTokens(clause.raw);
    const degreeIndexes = DEGREE_MARKERS.flatMap(marker => phraseTokenIndexes(normalizedTokens, marker));
    for (const [field, label] of COMPUTING_DEGREE_FIELDS) {
      // Short forms must actually be written as uppercase acronyms. Requiring
      // token boundaries alone is not sufficient for "IT", because lowercase
      // "it" is also an English pronoun.
      const fieldIndexes = ACRONYM_DEGREE_FIELDS.has(field)
        ? originalTokens.flatMap((token, index) => token === field.toUpperCase() ? [index] : [])
        : phraseTokenIndexes(normalizedTokens, field);
      if (!fieldIndexes.length) continue;
      if (structuredEducation) return label;
      if (degreeIndexes.some(degreeIndex => fieldIndexes.some(fieldIndex => {
        if (Math.abs(fieldIndex - degreeIndex) > 20) return false;
        const between = normalizedTokens.slice(
          Math.min(fieldIndex, degreeIndex),
          Math.max(fieldIndex, degreeIndex)
        ).join(" ");
        return matches(between, DEGREE_CONTEXT_BREAKERS).length === 0;
      }))) return label;
    }
  }
  return null;
}

function detectComputingDegreeRequirement(job) {
  const details = job.details && typeof job.details === "object" ? job.details : {};
  const structuredEducation = [
    job.education,
    ...Object.entries(details)
      .filter(([key]) => /education|academic\s+(?:qualification|background)/i.test(key))
      .map(([, value]) => value),
  ].filter(value => typeof value === "string" || typeof value === "number");

  for (const value of structuredEducation) {
    const field = computingFieldInDegreeContext(value, true);
    if (field) return { matched: true, field, source: "education requirement" };
  }

  const narrativeRequirements = [
    job.description,
    job.requirements,
    job.qualifications,
    ...Object.entries(details)
      .filter(([key]) => /qualification|requirement/i.test(key))
      .map(([, value]) => value),
  ].filter(value => typeof value === "string" || typeof value === "number");

  for (const value of narrativeRequirements) {
    const field = computingFieldInDegreeContext(value, false);
    if (field) return { matched: true, field, source: "requirements text" };
  }
  return { matched: false, field: null, source: null };
}

function detectMixedMultiVacancy(job) {
  const title = job.title || "";
  const normalizedTitle = asciiNormalize(title);
  const bundleSignals = matches(title, MIXED_BUNDLE_MARKERS);
  if (/استاد\s+در\s+رشته(?:\s+های)?/u.test(normalizedTitle)) {
    bundleSignals.push("استاد در رشته های");
  }

  const techSignals = [
    ...matches(title, STRONG_TECH_PHRASES),
    ...matches(title, AMBIGUOUS_PRIMARY_PHRASES),
    ...matches(title, ["technical"]),
  ];
  const nonTechSignals = matches(title, MIXED_NON_TECH_ROLE_PHRASES);
  return {
    mixed: bundleSignals.length > 0 && techSignals.length > 0 && nonTechSignals.length > 0,
    bundleSignals: [...new Set(bundleSignals)],
    techSignals: [...new Set(techSignals)],
    nonTechSignals: [...new Set(nonTechSignals)],
  };
}

function functionalAreaText(job) {
  const details = job.details || {};
  return [
    details["Functional Area"],
    details["Category"],
    details["Department"],
    details["Job Family"],
  ].filter(Boolean).join(" ");
}

function pushReasons(reasons, field, phrases, points, cap = Infinity) {
  let awarded = 0;
  for (const phrase of phrases) {
    if (awarded + points > cap) break;
    awarded += points;
    reasons.push(`${field}: “${phrase}” (+${points})`);
  }
  return awarded;
}

/**
 * Return an explainable assessment. Company is intentionally never inspected:
 * an ICT employer can hire a cashier and a "Network" NGO can hire a doctor.
 */
function assessJobRelevance(job) {
  const title = job.title || "";
  const category = job.category || "";
  const functionalArea = functionalAreaText(job);
  const description = job.description || "";
  const reasons = [];

  const strongTitle = matches(title, STRONG_TECH_PHRASES);
  const normalizedTitle = asciiNormalize(title);
  const guardedDeveloperTitle = containsPhrase(normalizedTitle, "developer")
    && !/(?:^| )(?:business|community|capacity|career) developer(?: |$)/.test(normalizedTitle);
  if (guardedDeveloperTitle && strongTitle.length === 0) strongTitle.push("developer role");
  const strongCategory = matches(category, STRONG_TECH_PHRASES);
  const strongFunctional = matches(functionalArea, STRONG_TECH_PHRASES);
  const ambiguousTitle = matches(title, AMBIGUOUS_PRIMARY_PHRASES);
  const ambiguousCategory = matches(`${category} ${functionalArea}`, AMBIGUOUS_PRIMARY_PHRASES);
  const negativeTitle = matches(title, NON_TECH_TITLE_PHRASES);
  const negativeCategory = matches(`${category} ${functionalArea}`, NON_TECH_CATEGORY_PHRASES);
  const mixedListing = detectMixedMultiVacancy(job);
  const computingDegree = detectComputingDegreeRequirement(job);

  const hasStrongPrimary = strongTitle.length + strongCategory.length + strongFunctional.length > 0;
  // An explicit non-tech title is authoritative unless the title itself also says
  // what the technical role is (for example "IT Project Manager").
  const hardExcluded = negativeTitle.length > 0 && strongTitle.length === 0;

  let score = 0;
  score += pushReasons(reasons, "title", strongTitle.slice(0, 2), 80, 100);
  score += pushReasons(reasons, "category", strongCategory.slice(0, 1), 60, 60);
  score += pushReasons(reasons, "functional area", strongFunctional.slice(0, 1), 60, 60);
  score += pushReasons(reasons, "title", ambiguousTitle.slice(0, 1), 38, 38);
  score += pushReasons(reasons, "category/functional area", ambiguousCategory.slice(0, 1), 42, 42);

  // Detail text can rescue a generic enriched title only when it describes
  // actual technical work. Incidental tool/degree mentions remain capped below
  // the inclusion threshold.
  const bodyRoleSignals = matches(description, BODY_ROLE_PHRASES).slice(0, 2);
  score += pushReasons(reasons, "description role", bodyRoleSignals, 20, 40);
  const bodySignals = matches(description, SUPPORTING_TECH_PHRASES).slice(0, 3);
  score += pushReasons(reasons, "description", bodySignals, 10, 30);
  if (computingDegree.matched) {
    score += 18;
    reasons.push(`${computingDegree.source}: computing degree “${computingDegree.field}” (+18)`);
  }

  if (negativeTitle.length) {
    const penalty = hardExcluded ? 120 : 25;
    score -= penalty;
    reasons.push(`non-technical title: “${negativeTitle[0]}” (-${penalty})`);
  }
  if (negativeCategory.length && !hasStrongPrimary) {
    score -= 35;
    reasons.push(`non-technical category: “${negativeCategory[0]}” (-35)`);
  }
  if (hardExcluded) {
    // A clearly non-technical title is authoritative even when a job board has
    // placed the vacancy in a broad IT/telecom category. Keep the published
    // score consistent with that exclusion instead of leaving a misleading
    // above-threshold number behind.
    score = 0;
  }
  if (mixedListing.mixed) {
    score = 0;
    reasons.push(
      `mixed multi-vacancy bundle combines technical “${mixedListing.techSignals[0]}” `
      + `and non-technical “${mixedListing.nonTechSignals[0]}” roles; cannot safely split (-all)`
    );
  }

  score = Math.max(0, Math.min(100, score));
  const decision = !hardExcluded && !mixedListing.mixed && score >= RELEVANCE_THRESHOLD ? "include" : "exclude";
  if (!reasons.length) reasons.push("no technical title, category, functional-area, or supporting signals");

  return {
    version: RELEVANCE_VERSION,
    score,
    threshold: RELEVANCE_THRESHOLD,
    decision,
    reasons,
  };
}

function isRelatedJob(job) {
  return assessJobRelevance(job).decision === "include";
}

module.exports = {
  AMBIGUOUS_PRIMARY_PHRASES,
  BODY_ROLE_PHRASES,
  COMPUTING_DEGREE_FIELDS,
  MIXED_BUNDLE_MARKERS,
  MIXED_NON_TECH_ROLE_PHRASES,
  NON_TECH_TITLE_PHRASES,
  RELATED_KEYWORDS: [...STRONG_TECH_PHRASES, ...SUPPORTING_TECH_PHRASES],
  RELEVANCE_THRESHOLD,
  STRONG_TECH_PHRASES,
  SUPPORTING_TECH_PHRASES,
  assessJobRelevance,
  asciiNormalize,
  detectComputingDegreeRequirement,
  detectMixedMultiVacancy,
  isRelatedJob,
};
