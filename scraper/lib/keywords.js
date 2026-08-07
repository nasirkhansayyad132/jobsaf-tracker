const { normSpace } = require("./normalize");

const RELEVANCE_VERSION = 2;
const RELEVANCE_THRESHOLD = 55;

// Strong signals describe technical work, not merely an employer or industry.
const STRONG_TECH_PHRASES = [
  "software architect", "software engineer", "software developer", "software development", "software engineering",
  "software analyst", "software support engineer", "lead software engineer", "lead developer",
  "tech lead", "it technical lead", "ict technical lead", "software technical lead",
  "full stack", "fullstack", "front end developer", "frontend developer", "back end developer",
  "backend developer", "web developer", "web development", "mobile developer", "mobile application developer",
  "android developer", "ios developer", "flutter developer", "application developer", "programmer",
  "php developer", "wordpress developer", "javascript developer", "typescript developer", "python developer",
  "java developer", "node js developer", "react developer", "laravel developer", "django developer",
  "game developer", "firmware engineer", "embedded systems engineer", "iot engineer", "iot developer",
  "software integration engineer", "it integration engineer", "ict integration engineer", "api integration engineer",
  "software integration", "it systems integration", "ict systems integration", "integration developer", "middleware engineer",
  "release engineer", "build engineer", "requirements engineer", "solution engineer",
  "systems analyst", "system analyst", "business systems analyst", "it business analyst",
  "technical business analyst", "application analyst", "application administrator",
  "software application engineer", "it application engineer", "ict application engineer",
  "web application engineer", "mobile application engineer",
  "it application specialist", "ict application specialist", "software application specialist",
  "application support", "system support", "systems support",
  "web designer", "ui developer", "ui engineer", "ux engineer", "ui ux designer",
  "user interface designer", "user experience designer", "ux researcher", "digital product designer",
  "computer programmer", "computer science", "computer engineering", "information technology",
  "it officer", "it technician", "it administrator", "it assistant", "it engineer", "it manager", "it support",
  "it coordinator", "ict coordinator", "it advisor", "ict advisor",
  "it consultant", "ict consultant", "it director", "ict director",
  "director of information technology", "head of it", "head of ict", "head of technology",
  "help desk", "helpdesk", "service desk", "desktop support", "end user support", "computer support",
  "technical support engineer", "it technical support", "ict technical support", "ict support",
  "computer operator", "computer technician", "hardware technician",
  "computer hardware engineer", "computer lab assistant", "it infrastructure", "ict infrastructure",
  "endpoint administrator", "endpoint engineer", "microsoft 365 administrator", "office 365 administrator",
  "system administrator", "systems administrator",
  "it system engineer", "it systems engineer", "ict system engineer", "ict systems engineer",
  "computer systems engineer", "software systems engineer", "network systems engineer", "cloud systems engineer",
  "system engineer it", "systems engineer it", "system engineer ict", "systems engineer ict",
  "network administrator", "network engineer", "network technician", "network manager",
  "network support", "network officer", "network analyst", "wireless engineer", "voip engineer",
  "cloud engineer", "cloud architect", "cloud administrator", "cloud specialist", "cloud operations",
  "devops", "devsecops", "site reliability engineer", "platform engineer", "platform administrator",
  "database administrator", "database developer", "database engineer", "data engineer", "data analyst",
  "database programmer", "database analyst", "data architect", "analytics engineer", "big data engineer",
  "data scientist", "data science", "data visualization specialist", "data quality analyst", "data quality engineer",
  "business intelligence", "bi developer", "power bi developer", "tableau developer", "etl developer",
  "machine learning", "artificial intelligence", "ai engineer", "ai specialist", "ml engineer", "mlops",
  "deep learning", "prompt engineer", "computer vision", "natural language processing", "nlp engineer",
  "generative ai", "llm engineer",
  "cyber security", "cybersecurity", "information security",
  "cyber security engineer", "cybersecurity engineer", "information security engineer", "it security engineer",
  "network security engineer", "application security engineer", "cloud security engineer",
  "cyber security analyst", "cybersecurity analyst", "information security analyst", "it security analyst",
  "network security analyst", "application security analyst", "cloud security analyst",
  "cyber security administrator", "cybersecurity administrator", "information security administrator",
  "it security administrator", "network security administrator",
  "cyber security operations", "cybersecurity operations", "information security operations",
  "it security operations", "network security operations", "security operations center", "soc analyst", "soc engineer",
  "soc officer", "soc specialist", "cybersecurity officer", "cybersecurity specialist", "cybersecurity manager",
  "information security officer", "information security specialist", "information security manager",
  "it security", "network security", "application security", "cloud security", "vulnerability analyst",
  "vulnerability specialist", "cyber incident response", "cyber security incident response",
  "cybersecurity incident response", "information security incident response",
  "computer security incident response", "network security incident response",
  "threat intelligence", "penetration tester",
  "ethical hacker", "digital forensics", "data protection engineer", "it auditor",
  "it audit officer", "information systems auditor", "technology auditor", "cybersecurity auditor",
  "quality assurance engineer", "software tester", "qa engineer", "test automation",
  "software quality engineer", "software quality control engineer",
  "qa analyst", "qa automation", "software qa", "software quality assurance", "software test engineer",
  "test automation engineer", "manual tester", "webmaster", "network specialist", "database specialist", "database officer",
  "chief technology officer", "chief information security officer", "ciso", "cto",
  "it general manager", "general manager it", "ict general manager", "general manager ict",
  "general manager information technology", "general manager technology", "general manager software",
  "general manager isp", "isp general manager", "isp manager",
  "it operations manager", "ict operations manager", "cloud operations manager",
  "it systems operations manager", "ict systems operations manager", "software systems operations manager",
  "data center operations manager", "cybersecurity operations manager",
  "network operations manager", "it technical operations manager", "ict technical operations manager",
  "software technical operations manager", "network technical operations manager",
  "technical operations manager it", "technical operations manager ict",
  "technical operations manager software", "technical operations manager network",
  "mis manager", "mis administrator",
  "mis analyst", "mis consultant", "information systems manager", "information systems officer",
  "digital transformation", "digital systems", "e governance", "e government",
  "solutions architect", "enterprise architect", "erp developer", "sap developer", "oracle developer",
  "blockchain developer", "blockchain engineer", "smart contract developer", "smart contract engineer",
  "smart contract specialist",
  "gis developer", "gis analyst", "gis officer", "gis specialist", "gis technician", "gis manager",
  "geographic information system", "mis officer", "mis specialist",
  "ict officer", "ict and communication officer", "ict communication officer", "ict engineer", "ict technician",
  "ict specialist", "information and communication technology", "telecom engineer", "telecom officer",
  "telecom specialist", "telecommunications engineer", "telecommunications specialist", "telecom technician",
  "microwave technician", "radio network engineer", "rf engineer", "radio frequency engineer",
  "transmission engineer", "fiber optic engineer", "fiber optic technician", "fiber technician", "fiber splicer",
  "core network engineer", "ran engineer", "ip engineer", "noc engineer", "noc analyst", "noc officer",
  "noc specialist", "noc technician", "network operations center", "bss engineer", "oss engineer",
  "back office engineer", "ofc back office engineer", "it product", "it service delivery",
  "it project manager", "software project manager", "cybersecurity project manager", "network project manager",
  "cloud project manager", "it technical project manager", "ict technical project manager",
  "software technical project manager", "technical project manager it", "technical project manager ict",
  "technical project manager software", "it project coordinator", "ict project coordinator", "software project coordinator",
  "it project officer", "ict project officer", "software project officer",
  "technical program manager", "it program manager", "software product manager", "technical product manager",
  "it product manager", "technical product owner", "software product owner", "scrum master",
  "computer science lecturer", "computer science instructor", "computer science teacher",
  "software engineering lecturer", "software engineering instructor", "information technology lecturer",
  "information technology instructor", "information technology teacher", "ict lecturer", "ict instructor",
  "ict teacher", "computer lecturer", "computer instructor", "computer teacher", "computer trainer",
  "programming lecturer", "programming instructor", "programming teacher", "programming trainer",
  "coding instructor", "coding trainer", "networking instructor", "cybersecurity instructor",
  "برنامه نویس", "برنامه نویسی", "انکشاف سیستم", "انکشاف نرم افزار", "مهندس نرم افزار",
  "طراحی و توسعه وبسایت", "طراحی و توسعه وب سایت", "توسعه وبسایت", "توسعه وب سایت",
  "طراحی وبسایت", "طراحی وب سایت", "طراح وب", "توسعه دهنده وب", "انکشاف دهنده وب",
  "مدیر شبکه", "انجینر شبکه", "امنیت سایبری", "امنیت معلومات", "مدیر دیتابیس",
  "کمپیوتر ساینس", "کامپیوتر ساینس", "تکنالوژی معلوماتی", "فناوری اطلاعات",
];

// These can be technical, but are too broad to decide without corroboration.
const SUPPORTING_TECH_PHRASES = [
  "software", "database", "sql", "mysql", "postgresql", "oracle", "mongodb",
  "redis", "javascript", "typescript", "python", "java", "php", "laravel", "django", "react",
  "angular", "vue", "svelte", "next js", "nuxt", "node js", "ruby", "rails", "rust", "scala",
  "spring boot", "asp net", "dotnet", "c sharp", "c plus plus", "kotlin", "swift", "golang",
  "graphql", "rest api", "restful", "object oriented programming",
  "linux", "windows server", "active directory", "virtualization", "vmware", "docker",
  "kubernetes", "aws", "azure", "cloud", "terraform", "ansible", "jenkins", "api", "microservices",
  "git", "github", "gitlab", "ci cd", "networking", "routing", "switching", "firewall", "cisco",
  "mikrotik", "fortinet", "palo alto", "tcp ip", "dns", "dhcp", "vpn", "vlan", "wan", "lan", "fiber optic",
  "siem", "splunk", "penetration testing", "vulnerability assessment",
  "data warehouse", "data visualization", "power bi", "tableau", "statistics", "analytics",
  "data pipeline", "etl pipeline", "automation", "source code", "coding", "algorithm", "technical architecture",
  "selenium", "cypress", "jira", "solidity", "blockchain", "smart contract",
  "ict", "mis", "gis", "erp", "information system", "information systems",
  "دیتابیس", "پایگاه داده", "شبکه", "سیستم", "کمپیوتر", "کامپیوتر", "کدنویسی",
];

const BODY_ROLE_PHRASES = [
  "develop and maintain software", "developing software", "software development", "web application development",
  "mobile application development", "write code", "writing code", "source code development", "api development",
  "develop applications", "develop websites", "build software", "maintain applications", "system development",
  "systems development", "software testing", "code review", "database administration", "database development",
  "database management", "administer databases", "network administration", "administer networks",
  "network monitoring", "system administration", "server administration", "administer servers",
  "manage servers", "manage it systems", "maintain it systems", "cloud infrastructure",
  "cybersecurity operations", "cybersecurity monitoring", "information security monitoring",
  "network security monitoring", "siem monitoring", "cyber incident response",
  "cybersecurity incident response", "information security incident response",
  "computer security incident response", "network security incident response", "vulnerability assessment",
  "technical support", "application support", "system support", "systems support",
  "user support", "end user support", "troubleshoot hardware", "troubleshoot software",
  "install and configure", "configure and maintain", "computer programming", "software programming",
  "programming language", "programming languages", "object oriented programming",
  "develop computer programs", "develop software programs", "data engineering", "data analysis",
  "data pipeline", "dashboard development", "business intelligence", "machine learning model",
  "manage information systems", "information systems management", "gis mapping",
  "توسعه نرم افزار", "انکشاف نرم افزار", "توسعه وبسایت", "توسعه وب سایت", "انکشاف وبسایت",
  "انکشاف وب سایت", "برنامه نویسی", "کدنویسی", "مدیریت دیتابیس", "مدیریت پایگاه داده",
  "مدیریت شبکه", "پشتیبانی تخنیکی", "حمایت تخنیکی", "امنیت سایبری",
];

// "Reporting Assistant" is normally outside this feed. A small number of
// boards, however, use this exact MIS title for hands-on database and digital
// data work. Keep the exception title-specific and require both enriched
// technical duties and relevant education so ordinary donor reporting does not
// become a computing vacancy.
const MIS_REPORTING_TITLES = ["mis and reporting assistant", "mis reporting assistant"];
const MIS_REPORTING_DUTY_GROUPS = [
  ["database maintenance", "maintain databases", "database management"],
  ["digital data collection", "digital data tools", "data collection tools"],
  ["dashboard", "dashboards"],
  ["data quality"],
  ["kobo", "kobotoolbox", "odk", "open data kit"],
  ["mis system", "mis systems", "management information system", "management information systems"],
  ["data analysis"],
];

// A generic "Quality Control Engineer" is also a common civil-construction
// title. Require several construction-specific clues before applying this
// guard, and do not apply it when the listing describes actual software-test
// work. This avoids treating a broad QA board category as software QA.
const CONSTRUCTION_QUALITY_CONTEXT_PHRASES = [
  "construction site", "construction sites", "site supervision", "civil engineering",
  "architectural drawings", "structural drawings", "boq", "boqs", "excavation",
  "foundation", "foundations", "masonry", "reinforced concrete",
];
const SOFTWARE_QUALITY_CONTEXT_PHRASES = [
  "software quality", "software testing", "application testing", "test automation",
  "automated software tests", "automated testing", "api testing", "test suite", "test suites",
  "application defects", "source code", "selenium", "cypress",
];

const AMBIGUOUS_PRIMARY_PHRASES = [
  "it", "ict", "mis", "gis", "telecommunication", "telecommunications",
  "software", "systems", "network", "application", "applications", "hardware",
  "database", "cloud", "web", "computer", "data", "digital", "cyber", "qa",
  "data management", "information management", "information systems", "informatics", "technology", "computing",
];

// A required computing degree is useful corroboration for a vague technical
// title/category, but is never strong enough to admit a vacancy by itself.
// Short acronyms are evaluated only inside explicit education/degree context;
// this prevents substrings such as "it" in "profit" or "mis" in
// "administration" from becoming relevance signals.
const COMPUTING_DEGREE_FIELDS = [
  ["computer science", "Computer Science"],
  ["computer software engineering", "Computer Software Engineering"],
  ["software engineering", "Software Engineering"],
  ["software development", "Software Development"],
  ["business information technology", "Business Information Technology"],
  ["information and communication technology", "ICT"],
  ["information communication technology", "ICT"],
  ["information technology", "Information Technology"],
  ["ict engineering", "ICT Engineering"],
  ["electrical and computer engineering", "Electrical and Computer Engineering"],
  ["computer systems engineering", "Computer Systems Engineering"],
  ["computer engineering", "Computer Engineering"],
  ["computer information systems", "Computer Information Systems"],
  ["management information systems", "Management Information Systems"],
  ["geographic information systems", "Geographic Information Systems"],
  ["information systems", "Information Systems"],
  ["information security", "Information Security"],
  ["cyber security", "Cybersecurity"],
  ["cybersecurity", "Cybersecurity"],
  ["data science", "Data Science"],
  ["computer applications", "Computer Applications"],
  ["computer studies", "Computer Studies"],
  ["computer education", "Computer Education"],
  ["computer networks", "Computer Networks"],
  ["network engineering", "Network Engineering"],
  ["telecommunication engineering", "Telecommunication Engineering"],
  ["telecommunications engineering", "Telecommunications Engineering"],
  ["geoinformatics", "Geoinformatics"],
  ["artificial intelligence", "Artificial Intelligence"],
  ["machine learning", "Machine Learning"],
  ["informatics", "Informatics"],
  ["computing", "Computing"],
  ["کمپیوتر ساینس", "Computer Science"],
  ["کامپیوتر ساینس", "Computer Science"],
  ["تکنالوژی معلوماتی", "Information Technology"],
  ["فناوری اطلاعات", "Information Technology"],
  ["مهندسی نرم افزار", "Software Engineering"],
  ["انجنیری نرم افزار", "Software Engineering"],
  ["انجینری نرم افزار", "Software Engineering"],
  ["انجنیری کمپیوتر", "Computer Engineering"],
  ["انجینری کامپیوتر", "Computer Engineering"],
  ["سیستم های معلوماتی", "Information Systems"],
  ["امنیت سایبری", "Cybersecurity"],
  ["علم داده", "Data Science"],
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
  "bsc", "bs", "ba", "msc", "ms", "لیسانس", "ماستر", "کارشناسی", "کارشناسی ارشد",
  "مدرک", "سند تحصیلی", "فارغ", "فارغ التحصیل", "فارغ شده",
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
  ["bscis", "Computer Information Systems"], ["bsis", "Information Systems"],
  ["msis", "Information Systems"], ["bsmis", "Management Information Systems"],
  ["bict", "ICT"], ["bsce", "Computer Engineering"], ["bscse", "Computer Systems Engineering"],
];

const NON_TECH_TITLE_PHRASES = [
  "accountant", "accounting", "admin assistant", "administrative assistant", "administration officer",
  "audit officer", "auditor", "cashier", "customer service", "finance assistant", "finance officer",
  "financial officer", "field investigator", "field officer", "hr officer", "human resources",
  "logistics officer", "facilities manager", "facility manager", "facilities officer", "facility officer",
  "facilities engineer", "facility engineer", "medical doctor", "midwife", "nurse", "nutrition", "pediatrician",
  "guard force", "physical security", "humanitarian emergencies", "dairy factory",
  "electrical systems", "hvac", "medical devices",
  "pharmacist", "physician", "psychologist", "counselor", "vaccinator", "warehouse officer",
  "procurement", "bidding", "bid coordinator", "bid manager", "bid officer", "bid specialist", "bid writer",
  "tender", "tendering", "purchasing", "sourcing", "supply chain", "supply and logistics",
  "supply assistant", "supply coordinator", "supply manager", "supply officer", "supply specialist",
  "contract specialist", "contracts specialist", "contracting specialist", "vendor management",
  "call for cv", "call for cvs", "third country national positions",
  "project coordinator", "project officer", "project manager",
  // Exact non-computing role families observed on live boards. "Base MEAL
  // Officer" is humanitarian monitoring/evaluation work even when its duties
  // mention MIS software and dashboards. The strong-title exception still
  // protects explicit roles such as "Data Engineer - MEAL Platform".
  "monitoring and evaluation", "m and e officer", "base meal officer",
  // This Dari title is a university quality-enhancement administration post,
  // not software quality assurance. Keep the guard title-specific so ordinary
  // software QA titles and QA categories remain eligible.
  "آمریت ارتقای کیفیت",
  // This exact live role is household/building field enumeration. Employer
  // boilerplate about GIS, statistics, and technical support must not turn it
  // into a data-engineering vacancy.
  "inventory enumerator",
  "data entry", "data collector", "surveyor",
  "graphic designer", "motion graphic", "video editor", "videographer", "content creator",
  "digital marketing", "digital media", "social media", "content officer", "content specialist", "web content",
  "communications officer", "communication officer",
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
    .replace(/\basp\.net\b/gi, " asp net ")
    // Require a token boundary before standalone .NET so domains such as
    // example.net do not become programming-framework evidence.
    .replace(/(^|[\s(/])\.net(?=$|[\s),/])/gi, "$1 dotnet ")
    .toLowerCase()
    .replace(/\bc\+\+(?=$|[^\p{L}\p{N}])/gu, " c plus plus ")
    .replace(/\bc#(?=$|[^\p{L}\p{N}])/gu, " c sharp ")
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
  const normalizedText = asciiNormalize(text);
  if (!normalizedText) return [];
  const framedText = ` ${normalizedText} `;
  return phrases.filter(phrase => {
    const normalizedPhrase = asciiNormalize(phrase);
    return normalizedPhrase && framedText.includes(` ${normalizedPhrase} `);
  });
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

function detectInformationManagementDegreeRequirement(job) {
  const details = job.details && typeof job.details === "object" ? job.details : {};
  const structuredEducation = [
    job.education,
    ...Object.entries(details)
      .filter(([key]) => /education|academic\s+(?:qualification|background)/i.test(key))
      .map(([, value]) => value),
  ].filter(value => typeof value === "string" || typeof value === "number");

  if (structuredEducation.some(value => containsPhrase(value, "information management"))) {
    return { matched: true, field: "Information Management", source: "education requirement" };
  }

  const narrativeRequirements = [
    job.requirements,
    job.qualifications,
    ...Object.entries(details)
      .filter(([key]) => /qualification|requirement/i.test(key))
      .map(([, value]) => value),
  ].filter(value => typeof value === "string" || typeof value === "number");

  for (const value of narrativeRequirements) {
    const qualifyingClause = splitRequirementClauses(value).find(clause => (
      containsPhrase(clause.normalized, "information management")
      && matches(clause.normalized, DEGREE_MARKERS).length > 0
    ));
    if (qualifyingClause) {
      return { matched: true, field: "Information Management", source: "requirements text" };
    }
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
  const computingDegree = detectComputingDegreeRequirement(job);
  const informationManagementDegree = detectInformationManagementDegreeRequirement(job);
  const misReportingTitle = MIS_REPORTING_TITLES.find(candidate => normalizedTitle === candidate);
  // Count distinct kinds of technical work, not synonymous phrases from one
  // database sentence, before allowing the title exception.
  const misReportingDuties = MIS_REPORTING_DUTY_GROUPS.flatMap(group => (
    matches(description, group).slice(0, 1)
  ));
  const misReportingEducation = computingDegree.matched ? computingDegree : informationManagementDegree;
  const gatedMisReportingRole = Boolean(
    misReportingTitle
    && misReportingDuties.length >= 2
    && misReportingEducation.matched
  );
  if (gatedMisReportingRole && !strongTitle.includes(misReportingTitle)) {
    strongTitle.push(misReportingTitle);
  }
  const guardedDeveloperTitle = containsPhrase(normalizedTitle, "developer")
    && !/(?:^| )(?:business|community|capacity|career) developer(?: |$)/.test(normalizedTitle);
  if (guardedDeveloperTitle && strongTitle.length === 0) strongTitle.push("developer role");
  const strongCategory = matches(category, STRONG_TECH_PHRASES);
  const strongFunctional = matches(functionalArea, STRONG_TECH_PHRASES);
  const ambiguousTitle = matches(title, AMBIGUOUS_PRIMARY_PHRASES);
  const ambiguousCategory = matches(`${category} ${functionalArea}`, AMBIGUOUS_PRIMARY_PHRASES);
  const negativeTitle = matches(title, NON_TECH_TITLE_PHRASES);
  const details = job.details && typeof job.details === "object" ? job.details : {};
  const educationContext = [
    job.education,
    ...Object.entries(details)
      .filter(([key]) => /education|academic\s+(?:qualification|background)/i.test(key))
      .map(([, value]) => value),
  ].filter(Boolean).join(" ");
  const constructionQualitySignals = matches(
    `${category} ${functionalArea} ${educationContext} ${description}`,
    CONSTRUCTION_QUALITY_CONTEXT_PHRASES
  );
  const softwareQualitySignals = matches(
    `${title} ${description}`,
    SOFTWARE_QUALITY_CONTEXT_PHRASES
  );
  const constructionQualityControlRole = containsPhrase(title, "quality control engineer")
    && constructionQualitySignals.length >= 2
    && softwareQualitySignals.length === 0;
  if (constructionQualityControlRole) negativeTitle.push("construction quality control engineer");
  const negativeCategory = matches(`${category} ${functionalArea}`, NON_TECH_CATEGORY_PHRASES);
  const mixedListing = detectMixedMultiVacancy(job);

  const hasStrongPrimary = strongTitle.length + strongCategory.length + strongFunctional.length > 0;
  // An explicit non-tech title is authoritative unless the title itself also says
  // what the technical role is (for example "IT Project Manager").
  const hardExcluded = negativeTitle.length > 0 && strongTitle.length === 0;

  let score = 0;
  score += pushReasons(reasons, "title", strongTitle.slice(0, 2), 80, 100);
  score += pushReasons(reasons, "title", ambiguousTitle.slice(0, 1), 38, 38);
  if (gatedMisReportingRole) {
    reasons.push(
      `MIS reporting evidence gate: enriched duties “${misReportingDuties.slice(0, 2).join("”, “")}`
      + `” and ${misReportingEducation.source} “${misReportingEducation.field}”`
    );
  }

  // A board's category/functional-area label is useful context, but is not
  // authoritative enough to publish a generic role by itself. Award one
  // contextual signal at most, avoiding double-counting broad labels such as
  // "Information Technology" as both a strong phrase and "technology".
  if (strongCategory.length) {
    score += pushReasons(reasons, "category", strongCategory.slice(0, 1), 42, 42);
  } else if (strongFunctional.length) {
    score += pushReasons(reasons, "functional area", strongFunctional.slice(0, 1), 42, 42);
  } else {
    score += pushReasons(reasons, "category/functional area", ambiguousCategory.slice(0, 1), 42, 42);
  }

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
