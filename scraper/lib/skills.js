const { asciiNormalize } = require("./keywords");

// Display name → phrases, matched on whole normalized tokens. Short or
// ambiguous words (go, rails, spark, ai) are only matched in unambiguous forms.
const SKILLS = [
  ["Python", ["python"]],
  ["JavaScript", ["javascript"]],
  ["TypeScript", ["typescript"]],
  ["React", ["react", "react js", "reactjs"]],
  ["React Native", ["react native"]],
  ["Next.js", ["next js", "nextjs"]],
  ["Vue", ["vue", "vue js", "vuejs"]],
  ["Angular", ["angular"]],
  ["Node.js", ["node js", "nodejs"]],
  ["Java", ["java"]],
  ["Kotlin", ["kotlin"]],
  ["Swift", ["swift", "swiftui"]],
  ["Flutter", ["flutter"]],
  ["Go", ["golang"]],
  ["Rust", ["rust"]],
  ["PHP", ["php"]],
  ["Laravel", ["laravel"]],
  ["Django", ["django"]],
  ["FastAPI", ["fastapi"]],
  ["Ruby on Rails", ["ruby on rails"]],
  ["C#", ["c sharp"]],
  [".NET", ["dotnet", "asp net"]],
  ["C++", ["c plus plus"]],
  ["SQL", ["sql"]],
  ["PostgreSQL", ["postgresql", "postgres"]],
  ["MySQL", ["mysql"]],
  ["MongoDB", ["mongodb"]],
  ["Redis", ["redis"]],
  ["GraphQL", ["graphql"]],
  ["REST APIs", ["rest api", "rest apis", "restful"]],
  ["AWS", ["aws", "amazon web services"]],
  ["Azure", ["azure"]],
  ["Google Cloud", ["gcp", "google cloud"]],
  ["Docker", ["docker"]],
  ["Kubernetes", ["kubernetes", "k8s"]],
  ["Terraform", ["terraform"]],
  ["CI/CD", ["ci cd"]],
  ["Git", ["git", "github", "gitlab"]],
  ["Linux", ["linux"]],
  ["Windows Server", ["windows server"]],
  ["Active Directory", ["active directory"]],
  ["Networking", ["networking", "tcp ip", "routing and switching"]],
  ["Cisco", ["cisco", "ccna", "ccnp"]],
  ["MikroTik", ["mikrotik"]],
  ["Fortinet", ["fortinet", "fortigate"]],
  ["Cybersecurity", ["cybersecurity", "cyber security", "information security"]],
  ["SIEM", ["siem", "splunk"]],
  ["Power BI", ["power bi"]],
  ["Tableau", ["tableau"]],
  ["Machine Learning", ["machine learning", "deep learning"]],
  ["LLMs", ["llm", "llms", "large language model", "large language models", "generative ai"]],
  ["Data Analysis", ["data analysis", "data analytics"]],
  ["ETL", ["etl"]],
  ["Spark", ["apache spark", "pyspark"]],
  ["Databricks", ["databricks"]],
  ["GIS", ["gis", "arcgis", "qgis"]],
  ["KoboToolbox", ["kobo", "kobotoolbox"]],
  ["ODK", ["odk", "open data kit"]],
  ["WordPress", ["wordpress"]],
  ["Shopify", ["shopify"]],
  ["Figma", ["figma"]],
  ["Selenium", ["selenium"]],
  ["Cypress", ["cypress"]],
  ["Salesforce", ["salesforce"]],
  ["SAP", ["sap"]],
  ["Oracle", ["oracle"]],
  ["Odoo", ["odoo"]],
  ["Android", ["android"]],
  ["iOS", ["ios"]],
];
const MAX_SKILLS = 8;

/**
 * Up to eight technologies a listing names, title matches first, then in the
 * order they appear in the description.
 */
function extractSkills(job) {
  const title = ` ${asciiNormalize(job?.title)} `;
  const body = ` ${asciiNormalize(job?.description)} `;
  const found = [];
  for (const [name, phrases] of SKILLS) {
    let position = Infinity;
    for (const phrase of phrases) {
      const needle = ` ${phrase} `;
      const inTitle = title.indexOf(needle);
      if (inTitle !== -1) position = Math.min(position, inTitle - 1_000_000);
      const inBody = body.indexOf(needle);
      if (inBody !== -1) position = Math.min(position, inBody);
    }
    if (position !== Infinity) found.push([position, name]);
  }
  return found.sort((a, b) => a[0] - b[0]).slice(0, MAX_SKILLS).map(([, name]) => name);
}

module.exports = { SKILLS, extractSkills };
