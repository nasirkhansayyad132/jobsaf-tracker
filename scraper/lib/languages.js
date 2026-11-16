// Afghan-language detection and the "language role" track: remote work done
// in Pashto, Dari or Persian (translation, interpreting, transcription, AI
// training...) is published even when the role itself is not technical.

const LANGUAGE_CONTEXT = [
  "speak(?:s|er|ers|ing)?", "language", "languages", "fluent", "fluency", "native", "proficien(?:t|cy)",
  "translat\\w*", "interpret\\w*", "transcri\\w*", "linguist\\w*", "locali[sz]\\w*", "subtitl\\w*",
  "bilingual", "trilingual", "dialects?", "voice", "speech", "audio", "tutor", "teacher",
  "writers?", "reviewers?", "experts?", "specialists?", "raters?", "annotat\\w*", "ai\\s+trainers?",
  "pashto", "pakhto", "pukhto", "persian", "farsi", "hazaragi", "english",
].join("|");

// "dari" is also Indonesian for "from". In Indonesian text only unambiguous
// forms count ("Dari speakers", "Pashto/Dari", "English into Dari").
const INDONESIAN_WORDS = /\b(?:yang|dan|untuk|dengan|kami|anda|sebagai|dalam|adalah|atau|pengalaman|lulusan|kerja|rumah|minimal|tahun|universitas|perusahaan|mampu|memiliki|bisa|tim|lebih|mulai)\b/gi;
const DARI_UNAMBIGUOUS = /\bdari\s*(?:language|speak\w*|translat\w*|interpret\w*|transcri\w*|linguist\w*)\b|\b(?:pashto|persian|farsi)\s*(?:and|or|\/|,|&)\s*dari\b|\bdari\s*(?:and|or|\/|,|&|-)\s*(?:pashto|persian|farsi|english)\b|\benglish\s*(?:-|to|into|and|\/)\s*dari\b|\bhazaragi\b|دری/i;
const DARI_IN_CONTEXT = new RegExp(
  `\\bdari\\b(?=[^.\\n]{0,40}\\b(?:${LANGUAGE_CONTEXT})\\b)|\\b(?:${LANGUAGE_CONTEXT})\\b[^.\\n]{0,40}\\bdari\\b|\\bhazaragi\\b|دری`,
  "i",
);

function looksIndonesian(text) {
  return new Set((String(text).match(INDONESIAN_WORDS) || []).map(word => word.toLowerCase())).size >= 2;
}

const AFGHAN_LANGUAGE_PATTERNS = [
  ["Dari", text => (looksIndonesian(text) ? DARI_UNAMBIGUOUS : DARI_IN_CONTEXT).test(text)],
  ["Pashto", text => /\b(?:pashto|pushto|pakhto|pukhto|pashtu|pushtu|pakhtu|pukhtu)\b|پښتو|پشتو/i.test(text)],
  // "Persian Gulf" and "Persian rugs" are not language requirements.
  ["Persian", text => new RegExp(
    `\\bpersian\\b(?=[^.\\n]{0,40}\\b(?:${LANGUAGE_CONTEXT})\\b)|\\b(?:in|speak|speaks|fluent|native|english)\\s+(?:and\\s+|or\\s+|&\\s+)?persian\\b|\\bfarsi\\b|فارسی`,
    "i",
  ).test(text)],
];

/** Afghan languages a listing asks for (Persian/Farsi is close to Dari). */
function detectAfghanLanguages(...texts) {
  const text = texts.filter(Boolean).join("\n");
  return AFGHAN_LANGUAGE_PATTERNS.filter(([, matches]) => matches(text)).map(([name]) => name);
}

// Titles that describe language work. A title naming Pashto/Dari/Persian
// qualifies on its own; these need the language in the listing text.
const LANGUAGE_WORK_TITLE = /\b(?:translat\w*|interpret\w*|transcri\w*|linguist\w*|locali[sz]\w*|subtitl\w*|caption\w*|proofread\w*|language|voice[\s-]*(?:actor|artist|talent|over)|speech|annotat\w*|data\s+label\w*|label(?:l)?ers?|raters?|evaluators?|ai\s+trainer|content\s+(?:moderat\w*|review\w*)|tutor|teacher|bilingual|trilingual|multilingual)\b/i;

// A title naming another language ("English - Thai Interpreter") is for that
// language, even when the agency's boilerplate lists Farsi among many others.
// Tajik and Uzbek stay out of this list: Tajik is a Persian variety.
const OTHER_LANGUAGE_TITLE = /\b(?:arabic|arabisch|cantonese|mandarin|chinese|thai|vietnamese|spanish|french|german|russian|turkish|urdu|hindi|bengali|punjabi|korean|japanese|portuguese|italian|dutch|polish|ukrainian|kurdish|sorani|kurmanji|somali|swahili|tigrinya|amharic|burmese|nepali|tagalog|indonesian|malay|hebrew|greek|romanian|haitian|creole)\b/i;

// Requirement phrasing ("native Pashto speaker", "fluency in Dari", "Farsi
// required") marks a role open to Afghan-language speakers whatever its title.
const AFGHAN_LANGUAGE_NAMES = "pashto|pushto|pakhto|pukhto|pashtu|dari|farsi|persian|hazaragi";
const REQUIREMENT_BEFORE = "native|fluent|fluency|proficien(?:t|cy)|speak(?:s|ing|ers?)?|bilingual|mother\\s+tongue|command\\s+of|knowledge\\s+of|written\\s+and\\s+spoken|spoken\\s+and\\s+written";
const REQUIREMENT_AFTER = "speak(?:ers?|ing)|native|fluency|fluent|proficiency|required|is\\s+a\\s+must|language\\s+skills?|mother\\s+tongue";
const LANGUAGE_REQUIREMENT = new RegExp(
  `\\b(?:${REQUIREMENT_BEFORE})\\b[^.\\n]{0,40}\\b(?:${AFGHAN_LANGUAGE_NAMES})\\b`
  + `|\\b(?:${AFGHAN_LANGUAGE_NAMES})\\b[^.\\n]{0,25}\\b(?:${REQUIREMENT_AFTER})\\b`,
  "i",
);

// Nearly every listing on Afghan boards requires Dari and Pashto, so there a
// requirement alone does not make a role language work.
const AFGHAN_BOARDS = new Set(["jobs.af", "acbar", "kaarobar", "wazifaha", "reliefweb", "impactpool"]);

/** Afghan languages the text explicitly requires, not merely mentions. */
function requiredAfghanLanguages(text) {
  const value = String(text || "");
  if (!LANGUAGE_REQUIREMENT.test(value)) return [];
  const sentences = value.split(/(?<=[.!?])\s+|\n+/).filter(sentence => LANGUAGE_REQUIREMENT.test(sentence));
  const found = detectAfghanLanguages(...sentences);
  // Judge "dari" against the whole listing's language, not one sentence.
  return looksIndonesian(value) && !DARI_UNAMBIGUOUS.test(sentences.join("\n")) ? found.filter(name => name !== "Dari") : found;
}

/**
 * Whether a remote listing is language work someone fluent in an Afghan
 * language can do. Onsite roles stay on the technical track only.
 */
function assessLanguageRole(job) {
  if (String(job?.work_mode || "").toLowerCase() !== "remote") return { matched: false, languages: [], reasons: [] };
  const title = job.title || "";
  const titleLanguages = detectAfghanLanguages(title);
  if (titleLanguages.length) {
    return {
      matched: true,
      languages: titleLanguages,
      reasons: [`language role: title names ${titleLanguages.join(", ")}`],
    };
  }
  if (OTHER_LANGUAGE_TITLE.test(title)) return { matched: false, languages: [], reasons: [] };
  const workTitle = title.match(LANGUAGE_WORK_TITLE);
  const bodyLanguages = workTitle
    ? detectAfghanLanguages(job.description, job.details?.Languages, job.remote_regions)
    : [];
  if (bodyLanguages.length) {
    return {
      matched: true,
      languages: bodyLanguages,
      reasons: [`language role: “${workTitle[0].toLowerCase()}” work that asks for ${bodyLanguages.join(", ")}`],
    };
  }
  // Any other remote role that requires an Afghan language ("Customer
  // Support Agent ... native Dari speaker required").
  const required = AFGHAN_BOARDS.has(job.source) ? [] : requiredAfghanLanguages(job.description);
  if (required.length) {
    return {
      matched: true,
      languages: required,
      reasons: [`language role: requires ${required.join(", ")}`],
    };
  }
  return { matched: false, languages: [], reasons: [] };
}

module.exports = {
  LANGUAGE_WORK_TITLE,
  assessLanguageRole,
  detectAfghanLanguages,
  requiredAfghanLanguages,
};
