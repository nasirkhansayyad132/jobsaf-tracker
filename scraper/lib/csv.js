const fs = require("fs");

const DEFAULT_FIELDS = [
  "id",
  "source",
  "source_url",
  "url",
  "title",
  "company",
  "location",
  "closing_date",
  "closing_date_raw",
  "category",
  "job_type",
  "gender",
  "vacancies",
  "salary",
  "apply_url",
  "apply_emails",
  "apply_phones",
  "scraped_at",
  "also_found_on",
];

function csvValue(value) {
  let text;
  if (Array.isArray(value)) text = value.map(item => typeof item === "object" ? JSON.stringify(item) : String(item)).join(" | ");
  else if (value && typeof value === "object") text = JSON.stringify(value);
  else text = value === null || value === undefined ? "" : String(value);

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
