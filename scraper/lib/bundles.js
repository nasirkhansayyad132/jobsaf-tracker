const { normalizeJob, normSpace } = require("./normalize");

const NUMBERED_HEADING = /^(\d{1,2})[.)]\s+(.+?)(?:\s+[\u2013\u2014-]\s*(\d+)\s+(?:openings?|positions?|vacancies))?\s*$/i;
const COUNT_LINE = /^(?:no\.?\s+of\s+jobs?|openings?|positions?|vacancies)\s*:\s*(\d+)\b/i;
const REFERENCE_LINE = /^reference(?:\s+(?:number|no\.?|id))?\s*:\s*(.+)$/im;
const GLOBAL_TAIL_HEADING = /^(?:general\s+)?job\s+requirements?|submission\s+guidelines?$/i;
const DIVISION_HEADING = /^[IVXLCDM]+\.\s+\S.+$/;

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function roleSlug(index, title) {
  const words = normSpace(title)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
  return `${index}-${words || "role"}`;
}

function roleUrl(value, index, title) {
  try {
    const url = new URL(value);
    url.searchParams.set("role", roleSlug(index, title));
    return url.toString();
  } catch {
    return value;
  }
}

function headingCandidate(lines, lineIndex) {
  const match = lines[lineIndex].match(NUMBERED_HEADING);
  if (!match) return null;

  let title = normSpace(match[2]);
  let vacancies = positiveInteger(match[3]);
  if (!vacancies) {
    for (let offset = 1; offset <= 3 && lineIndex + offset < lines.length; offset += 1) {
      const nextLine = lines[lineIndex + offset];
      // Never borrow the count belonging to the next numbered role.
      if (NUMBERED_HEADING.test(nextLine)) break;
      const count = nextLine.match(COUNT_LINE);
      if (count) {
        vacancies = positiveInteger(count[1]);
        break;
      }
    }
  }
  if (!vacancies || title.length < 3) return null;

  title = title.replace(/[\s:;.,]+$/, "").trim();
  return { index: positiveInteger(match[1]), lineIndex, title, vacancies };
}

function splitStructuredRoles(description) {
  const lines = String(description || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(normSpace)
    .filter(Boolean);
  if (!lines.length) return [];

  const headings = lines.map((_, index) => headingCandidate(lines, index)).filter(Boolean);
  // A single numbered position can be part of an ordinary description. Only
  // split when the publisher has clearly supplied a multi-role structure.
  if (headings.length < 2) return [];

  const firstRoleLine = headings[0].lineIndex;
  const lastRoleLine = headings.at(-1).lineIndex;
  const tailLine = lines.findIndex((line, index) => index > lastRoleLine && GLOBAL_TAIL_HEADING.test(line));
  const tail = tailLine === -1 ? [] : lines.slice(tailLine);
  const prefix = lines.slice(0, firstRoleLine);

  return headings.map((heading, position) => {
    const nextLine = headings[position + 1]?.lineIndex ?? (tailLine === -1 ? lines.length : tailLine);
    const roleLines = lines.slice(heading.lineIndex, nextLine);
    while (roleLines.length && DIVISION_HEADING.test(roleLines.at(-1))) roleLines.pop();
    const roleText = roleLines.join("\n");
    const reference = normSpace(roleText.match(REFERENCE_LINE)?.[1]);
    return {
      ...heading,
      reference: reference || null,
      description: [
        prefix.length ? prefix.join("\n") : null,
        `Position-specific details\n${roleText}`,
        tail.length ? tail.join("\n") : null,
      ].filter(Boolean).join("\n\n"),
    };
  });
}

function roleApplicationSubject(job, role) {
  if (!role.reference) {
    return {
      applicationSubject: job.application_subject,
      applicationSubjectType: job.application_subject_type,
    };
  }
  const description = String(job.description || "");
  const subjectLine = description.split(/\n+/).find(line => /subject(?:\s+line)?/i.test(line)) || "";
  const needsTitle = /position\s+title|name\s+of\s+the\s+position|job\s+title/i.test(subjectLine);
  const needsReference = /vacancy\s*(?:id|number|no\.)|reference\s*(?:id|number|no\.)/i.test(subjectLine);
  if (needsTitle && needsReference) {
    return {
      applicationSubject: `${role.title} + ${role.reference}`,
      applicationSubjectType: "title_template",
    };
  }
  if (needsReference || job.application_subject_type === "reference") {
    return { applicationSubject: role.reference, applicationSubjectType: "reference" };
  }
  return {
    applicationSubject: job.application_subject,
    applicationSubjectType: job.application_subject_type,
  };
}

function detailsForRole(job, role) {
  const details = {
    ...(job.details || {}),
    "Parent Listing Title": job.title,
    "Bundled Role": role.title,
    "Role Vacancies": String(role.vacancies),
    "Role Extraction": "Structured numbered position from a multi-vacancy listing",
  };
  if (role.reference) {
    details["Role Reference"] = role.reference;
    if (Object.hasOwn(details, "Vacancy Number")) details["Vacancy Number"] = role.reference;
    else details.Reference = role.reference;
  } else {
    const parentReference = details.Reference || details["Vacancy Number"] || null;
    details.Reference = parentReference
      ? `${parentReference} / role ${role.index}`
      : `${job.title} / role ${role.index}`;
  }
  return details;
}

function expandBundledJob(record, options = {}) {
  const job = normalizeJob(record, options);
  const roles = splitStructuredRoles(job.description);
  if (!roles.length) return [job];

  return roles.map(role => {
    const sourceUrl = roleUrl(job.source_url || job.url, role.index, role.title);
    const url = roleUrl(job.url || job.source_url, role.index, role.title);
    const subject = roleApplicationSubject(job, role);
    return normalizeJob({
      ...job,
      id: null,
      source_url: sourceUrl,
      url,
      title: role.title,
      vacancies: role.vacancies,
      description: role.description,
      details: detailsForRole(job, role),
      application_subject: subject.applicationSubject,
      application_subject_type: subject.applicationSubjectType,
      relevance: null,
      also_found_on: [],
    }, options);
  });
}

module.exports = {
  expandBundledJob,
  splitStructuredRoles,
};
