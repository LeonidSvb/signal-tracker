// Usage: node analyze.mjs <testname>
// Reads results/<testname>_raw.json, applies filters, matches vs TAM, prints report

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dir, "config.json"), "utf8"));

const testName = process.argv[2];
if (!testName) { console.error("Usage: node analyze.mjs <testname>"); process.exit(1); }

const rawPath = path.join(__dir, "results", `${testName}_raw.json`);
if (!fs.existsSync(rawPath)) { console.error(`No results file: ${rawPath}`); process.exit(1); }

const items = JSON.parse(fs.readFileSync(rawPath, "utf8"));

const EXEC_SENIORITY = ["director", "executive", "c-suite", "vice president", "partner", "owner"];
const EXEC_TITLE_KW = [
  "director", "directeur", "direkteur", "direktor",
  "geschäftsführer", "geschaftsfuhrer",
  "vp ", "vice president", "ceo", "coo", "cfo", "cmo", "chro", "cpo",
  "managing director", "general manager", "plant manager", "werksleiter",
  "drh", "head of", "leiter"
];
const FOOD_KW = [
  "food", "beverage", "nahrungsmittel", "lebensmittel", "ernährung", "ernahrung",
  "agroalimentaire", "agri", "voedingsmiddelen", "voeding", "alimentaire", "alimentation",
  "fmcg", "dairy", "meat", "bakery", "confectionery", "frozen", "produce", "ingredients",
  "manufacturing", "processing"
];

function norm(s) { return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }

function isExec(item) {
  const seniority = norm(item.seniorityLevel ?? item.seniority ?? "");
  if (EXEC_SENIORITY.some(k => seniority.includes(k))) return true;
  const title = norm(item.title ?? item.jobTitle ?? "");
  return EXEC_TITLE_KW.some(k => title.includes(k));
}

function isFood(item) {
  const industries = norm(JSON.stringify(item.industries ?? item.companyIndustries ?? ""));
  const company = norm(item.companyName ?? item.company ?? "");
  const title = norm(item.title ?? "");
  const desc = norm((item.description ?? "").slice(0, 500));
  const allText = `${industries} ${company} ${title} ${desc}`;
  return FOOD_KW.some(k => allText.includes(k));
}

function daysAgo(item) {
  const raw = item.postedAt ?? item.publishedAt ?? item.postingDate ?? item.listedAt;
  if (!raw) return null;
  if (typeof raw === "number") return raw;
  try {
    const d = new Date(raw);
    return Math.round((Date.now() - d.getTime()) / 86400000);
  } catch { return null; }
}

function loadTam() {
  const csvPath = config.companies_pass_csv;
  if (!fs.existsSync(csvPath)) { console.warn("companies_pass.csv not found, TAM match skipped"); return new Set(); }
  const lines = fs.readFileSync(csvPath, "utf8").split("\n").slice(1);
  const names = new Set();
  for (const line of lines) {
    const cols = line.split(",");
    if (cols[0]) names.add(norm(cols[0].replace(/"/g, "").trim()));
  }
  return names;
}

function fuzzyMatch(company, tamNames) {
  const c = norm(company ?? "").trim();
  if (!c) return false;
  if (tamNames.has(c)) return true;
  for (const name of tamNames) {
    if (c.includes(name) || name.includes(c)) return true;
    if (c.length > 5 && name.length > 5) {
      const cWords = c.split(/\s+/);
      const nWords = name.split(/\s+/);
      const overlap = cWords.filter(w => w.length > 3 && nWords.includes(w));
      if (overlap.length >= 2) return true;
    }
  }
  return false;
}

const tamNames = loadTam();
console.log(`TAM loaded: ${tamNames.size} companies`);
console.log(`Raw results: ${items.length}`);

const execItems = items.filter(isExec);
const foodItems = items.filter(isFood);
const execAndFood = items.filter(i => isExec(i) && isFood(i));

const withDays = execAndFood.map(i => ({ ...i, _days_ago: daysAgo(i), _employees: i.companyEmployeesCount ?? i.companyEmployeeCount ?? null }));
const fresh14 = withDays.filter(i => i._days_ago !== null && i._days_ago <= 14);
const stale60 = withDays.filter(i => i._days_ago !== null && i._days_ago >= 60);
const tamMatches = withDays.filter(i => fuzzyMatch(i.companyName ?? i.company, tamNames));

console.log(`\n=== ANALYSIS: ${testName} ===`);
console.log(`Total raw          : ${items.length}`);
console.log(`Exec filter pass   : ${execItems.length} (${pct(execItems.length, items.length)})`);
console.log(`Food filter pass   : ${foodItems.length} (${pct(foodItems.length, items.length)})`);
console.log(`Exec + Food        : ${execAndFood.length} (${pct(execAndFood.length, items.length)})`);
console.log(`  → Fresh (<14d)   : ${fresh14.length}`);
console.log(`  → Stale (60d+)   : ${stale60.length}`);
console.log(`  → TAM match      : ${tamMatches.length} (${pct(tamMatches.length, execAndFood.length)} of exec+food)`);

function pct(a, b) { return b ? `${Math.round(100*a/b)}%` : "n/a"; }

if (execAndFood.length > 0) {
  console.log("\n--- Top signals (exec+food) ---");
  const sorted = [...withDays].sort((a, b) => (a._days_ago ?? 999) - (b._days_ago ?? 999));
  for (const item of sorted.slice(0, 20)) {
    const company = item.companyName ?? item.company ?? "?";
    const title = item.title ?? item.jobTitle ?? "?";
    const loc = item.location ?? "?";
    const days = item._days_ago !== null ? `${item._days_ago}d ago` : "?d";
    const employees = item._employees ?? "?";
    const tam = fuzzyMatch(company, tamNames) ? " [TAM]" : "";
    console.log(`  ${days.padEnd(8)} ${company.padEnd(30)} | ${title.slice(0,40).padEnd(40)} | ${loc.slice(0,20)} | emp:${employees}${tam}`);
  }
}

if (tamMatches.length > 0) {
  console.log("\n--- TAM matches ---");
  for (const item of tamMatches) {
    const company = item.companyName ?? item.company ?? "?";
    const title = item.title ?? "?";
    const days = item._days_ago !== null ? `${item._days_ago}d` : "?d";
    console.log(`  [${days}] ${company} — ${title}`);
  }
}

const outPath = path.join(__dir, "results", `${testName}_analysis.json`);
fs.writeFileSync(outPath, JSON.stringify({
  testName,
  raw: items.length,
  exec_pass: execItems.length,
  food_pass: foodItems.length,
  exec_and_food: execAndFood.length,
  fresh_14d: fresh14.length,
  stale_60d: stale60.length,
  tam_matches: tamMatches.length,
  signals: execAndFood.map(i => ({
    company: i.companyName ?? i.company,
    title: i.title ?? i.jobTitle,
    location: i.location,
    days_ago: i._days_ago,
    employees: i.companyEmployeesCount ?? i.companyEmployeeCount ?? null,
    seniority: i.seniorityLevel ?? i.seniority,
    industries: i.industries ?? i.companyIndustries,
    job_url: i.url ?? i.jobUrl,
    company_website: i.companyWebsite,
    tam_match: fuzzyMatch(i.companyName ?? i.company, tamNames)
  }))
}, null, 2));
console.log(`\nAnalysis saved: ${outPath}`);
