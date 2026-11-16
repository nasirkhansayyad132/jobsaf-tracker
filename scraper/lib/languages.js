// Afghan-language detection and the "language role" track: remote work done
// in Pashto, Dari or Persian (translation, interpreting, transcription, AI
// training...) is published even when the role itself is not technical.

const LANGUAGE_CONTEXT = [
  "speak(?:s|er|ers|ing)?", "language", "languages", "fluent", "fluency", "native", "proficien(?:t|cy)",
  "translat\\w*", "interpret\\w*", "transcri\\w*", "linguist\\w*", "locali[sz]\\w*", "subtitl\\w*",
  "bilingual", "trilingual", "dialects?", "voice", "speech", "audio", "tutor", "teacher",
  "pashto", "persian", "farsi", "english",
].join("|");

const AFGHAN_LANGUAGE_PATTERNS = [
  // "dari" is also Indonesian for "from", so require nearby language context.
  ["Dari", new RegExp(
    `\\bdari\\b(?=[^.\\n]{0,40}\\b(?:${LANGUAGE_CONTEXT})\\b)|\\b(?:${LANGUAGE_CONTEXT})\\b[^.\\n]{0,40}\\bdari\\b|دری`,
    "i",
  )],
  ["Pashto", /\b(?:pashto|pushto|pakhto|pashtu|pushtu)\b|پښتو|پشتو/i],
  // "Persian Gulf" and "Persian rugs" are not language requirements.
  ["Persian", new RegExp(
    `\\bpersian\\b(?=[^.\\n]{0,40}\\b(?:${LANGUAGE_CONTEXT})\\b)|\\b(?:in|speak|speaks|fluent|native|english)\\s+(?:and\\s+|or\\s+|&\\s+)?persian\\b|\\bfarsi\\b|فارسی`,
    "i",
  )],
];

/** Afghan languages a listing asks for (Persian/Farsi is close to Dari). */
function detectAfghanLanguages(...texts) {
  const text = texts.filter(Boolean).join("\n");
  return AFGHAN_LANGUAGE_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

// Titles that describe language work. A title naming Pashto/Dari/Persian
// qualifies on its own; these need the language in the listing text.
const LANGUAGE_WORK_TITLE = /\b(?:translat\w*|interpret\w*|transcri\w*|linguist\w*|locali[sz]\w*|subtitl\w*|caption\w*|proofread\w*|language|voice[\s-]*(?:actor|artist|talent|over)|speech|annotat\w*|data\s+label\w*|label(?:l)?ers?|raters?|evaluators?|ai\s+trainer|content\s+(?:moderat\w*|review\w*)|tutor|teacher|bilingual|trilingual|multilingual)\b/i;

// A title naming another language ("English - Thai Interpreter") is for that
// language, even when the agency's boilerplate lists Farsi among many others.
// Tajik and Uzbek stay out of this list: Tajik is a Persian variety.
const OTHER_LANGUAGE_TITLE = /\b(?:arabic|arabisch|cantonese|mandarin|chinese|thai|vietnamese|spanish|french|german|russian|turkish|urdu|hindi|bengali|punjabi|korean|japanese|portuguese|italian|dutch|polish|ukrainian|kurdish|sorani|kurmanji|somali|swahili|tigrinya|amharic|burmese|nepali|tagalog|indonesian|malay|hebrew|greek|romanian|haitian|creole)\b/i;

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
  const workTitle = OTHER_LANGUAGE_TITLE.test(title) ? null : title.match(LANGUAGE_WORK_TITLE);
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
  return { matched: false, languages: [], reasons: [] };
}

module.exports = {
  LANGUAGE_WORK_TITLE,
  assessLanguageRole,
  detectAfghanLanguages,
};
