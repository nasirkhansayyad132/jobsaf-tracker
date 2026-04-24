const { normSpace } = require("./normalize");

const PRIMARY_KEYWORDS = [
  "information technology",
  "it security",
  "it officer",
  "it technician",
  "it network",
  "software development",
  "web development",
  "web application development",
  "mobile application",
  "mobile app",
  "android",
  "ios",
  "flutter",
  "react",
  "node",
  "php",
  "laravel",
  "python",
  "django",
  "database",
  "data entry",
  "data management",
  "data analysis",
  "data analyst",
  "data science",
  "machine learning",
  "cyber security",
  "cybersecurity",
  "data security",
  "network",
  "networking",
  "system administrator",
  "computer operator",
  "digital",
  "devops",
  "cloud",
  "ui ux",
  "ui/ux",
  "graphic designer",
  "graphics designer",
  "video editor",
  "motion graphic",
  "motion graphics",
  "video production",
  "digital marketing",
  "social media",
  "mis",
  "gis",
  "programmer",
  "developer",
  "frontend",
  "front end",
  "backend",
  "back end",
  "full stack",
  "software",
  "ict",
  "it",
  "ai",
];

const BODY_KEYWORDS = [
  "information technology",
  "it security",
  "software development",
  "web development",
  "mobile application",
  "mobile app",
  "android",
  "ios",
  "flutter",
  "react",
  "node",
  "php",
  "laravel",
  "python",
  "django",
  "database",
  "data entry",
  "data analyst",
  "data analysis",
  "data science",
  "machine learning",
  "cyber security",
  "cybersecurity",
  "data security",
  "network administrator",
  "network engineer",
  "system administrator",
  "computer operator",
  "devops",
  "cloud",
  "ui ux",
  "ui/ux",
  "graphic designer",
  "graphics designer",
  "video editor",
  "video editing",
  "motion graphic",
  "motion graphics",
  "adobe premiere",
  "after effects",
  "digital marketing",
  "software engineer",
  "software developer",
  "frontend",
  "backend",
  "full stack",
];

const NON_LATIN_KEYWORDS = [
  "کمپیوتر",
  "کامپیوتر",
  "دیتا",
  "معلومات",
  "تکنالوژی",
  "تکنالوژي",
  "فناوری",
  "شبکه",
  "سیستم",
  "سیستمها",
  "برنامه نویس",
  "برنامه نویسی",
  "دیتابیس",
  "پایگاه داده",
  "گرافیک",
  "گرافیکی",
  "موشن",
  "پرودکشن",
  "انیمیشن",
  "ویدیو",
  "ویډیو",
  "دیجیتال",
];

function asciiNormalize(value) {
  return normSpace(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\/_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldText(job) {
  return [
    job.title,
    job.category,
    job.company,
    job.description,
    job.job_type,
    ...(job.details ? Object.values(job.details) : []),
  ].filter(Boolean).join(" ");
}

function keywordMatches(text, keywords) {
  const normalized = asciiNormalize(text);
  const matches = [];

  for (const phrase of keywords) {
    const clean = asciiNormalize(phrase);
    if (!clean) continue;
    if (clean.length <= 3 && /^[a-z0-9]+$/.test(clean)) {
      const re = new RegExp(`(^|\\s)${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i");
      if (re.test(normalized)) matches.push(phrase);
    } else if (normalized.includes(clean)) {
      matches.push(phrase);
    }
  }

  return matches;
}

function isRelatedJob(job) {
  const primaryText = [
    job.title,
    job.category,
    job.company,
    job.job_type,
    job.details?.["Functional Area"],
    job.details?.["Job Type"],
  ].filter(Boolean).join(" ");
  const bodyText = fieldText(job);

  if (keywordMatches(primaryText, PRIMARY_KEYWORDS).length > 0) return true;
  if (NON_LATIN_KEYWORDS.some(keyword => primaryText.includes(keyword))) return true;

  const bodyMatches = keywordMatches(bodyText, BODY_KEYWORDS);
  const nonLatinBodyMatches = NON_LATIN_KEYWORDS.filter(keyword => bodyText.includes(keyword));
  return bodyMatches.length + nonLatinBodyMatches.length >= 2;
}

module.exports = {
  RELATED_KEYWORDS: [...PRIMARY_KEYWORDS, ...BODY_KEYWORDS, ...NON_LATIN_KEYWORDS],
  isRelatedJob,
};
