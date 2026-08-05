const fs = require("fs");

const DEFAULT_FIELDS = [
  "id",
  "source",
  "source_url",
  "url",
  "title",
  "company",
  "location",
  "post_date",
  "post_date_raw",
  "closing_date",
  "closing_date_raw",
  "category",
  "job_type",
  "gender",
  "vacancies",
  "salary",
  "application_method",
  "application_subject",
  "application_subject_type",
  "apply_url",
  "apply_emails",
  "apply_phones",
  "scraped_at",
  "first_seen_at",
  "last_seen_at",
  "lifecycle_status",
  "missed_runs",
  "relevance",
  "also_found_on",
];

function csvValue(value) {
  let text;
  if (Array.isArray(value)) text = value.map(item => typeof item === "object" ? JSON.stringify(item) : String(item)).join(" | ");
  else if (value && typeof value === "object") text = JSON.stringify(value);
  else text = value === null || value === undefined ? "" : String(value);

  // Spreadsheet programs interpret these leading characters as formulas even
  // in downloaded CSV files. Prefix user-controlled values with an apostrophe.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCSV(rows, fields = DEFAULT_FIELDS) {
  return [
    fields.join(","),
    ...rows.map(row => fields.map(field => csvValue(row[field])).join(",")),
  ].join("\n");
}

function writeCSV(filePath, rows, fields = DEFAULT_FIELDS) {
  fs.writeFileSync(filePath, toCSV(rows, fields), "utf-8");
}

module.exports = {
  DEFAULT_FIELDS,
  toCSV,
  writeCSV,
};
