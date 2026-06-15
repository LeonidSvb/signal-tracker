// Reads all raw test files, deduplicates, filters food manufacturers, outputs final signal list
// Usage: node aggregate_signals.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dir, "config.json"), "utf8"));

const RESULTS_DIR = path.join(__dir, "results");
const ALL_TESTS = [
  "smoke_de","eu_sweep","full_14q","broader_food",
  "split_de_werksleiter","split_de_gf","split_de_personalleiter",
  "split_fr_directeur","split_fr_drh","split_nl_be",
  "de_specific_sectors","fr_specific_sectors","en_europe"
];

// --- filters ---
const FOOD_INDUSTRIES = [
  "food and beverage","food & beverage","lebensmittel","nahrungsmittel",
  "agroalimentaire","agri-food","agriculture, food","voedingsmiddelen",
  "food production","food manufacturing","dairy","meat processing",
  "bakery","confectionery","beverage manufacturing","food ingredients",
  "food & beverages","food and beverages"
];

// Companies/types that are NOT food manufacturers
const BLACKLIST_CO = [
  "sodexo","compass group","newrest","elior","aramark","eurest",
  "hotelprofessionals","hotel okura","sofitel","sephora","covestro",
  "essity","astrazeneca","beckman coulter","prothya","cheminées poujoulat",
  "recipharm","wasserburger arzneimittelwerk","encoviva","eternaliteam"
];
// Recruiters/headhunters who post on behalf of anonymous clients (keep but mark)
const RECRUITER_CO = [
  "heberlein","talbot","syben","incharge","morgan philips","hays",
  "adecco","randstad","manpower","michael page","qlm search",
  "van de groep","kenseo","pacific international","grant alexander",
  "cabinet acp","rcv conseil","chaberton","uma catering","martens",
  "schelstraete"
];

const EXEC_KW = [
  "director","directeur","direktor","direkteur",
  "geschäftsführer","geschaftsfuhrer","geschaeftsfuhrer",
  "vp ","vice president","ceo","coo","cfo","chro","cmo","cpo",
  "managing director","general manager","werksleiter","betriebsleiter",
  "plant manager","leiter","drh","head of","responsable","directrice"
];

// Skip titles that are too operational (not headhunter-relevant)
const SKIP_TITLES = [
  "teamleiter","schichtleiter","vorarbeiter","anlagenführer",
  "produktionsmitarbeiter","assistant director of food","head chef",
  "chef de secteur","chef cuisinier"
];

function norm(s) { return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }

function isFood(item) {
  const ind = norm(item.industries ?? "");
  return FOOD_INDUSTRIES.some(k => ind.includes(k));
}

function isBlacklisted(item) {
  const co = norm(item.companyName ?? "");
  return BLACKLIST_CO.some(k => co.includes(k));
}

function isRecruiter(item) {
  const co = norm(item.companyName ?? "");
  const emp = item.companyEmployeesCount ?? 0;
  return RECRUITER_CO.some(k => co.includes(k)) || emp < 10;
}

function isExec(item) {
  const title = norm(item.title ?? "");
  if (SKIP_TITLES.some(k => title.includes(k))) return false;
  return EXEC_KW.some(k => title.includes(k));
}

function daysAgo(item) {
  const raw = item.postedAt ?? item.publishedAt ?? item.postingDate;
  if (!raw) return null;
  if (typeof raw === "number") return raw;
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return Math.round((Date.now() - d.getTime()) / 86400000);
  } catch { return null; }
}

function loadTam() {
  const csvPath = config.companies_pass_csv;
  if (!fs.existsSync(csvPath)) return new Set();
  const lines = fs.readFileSync(csvPath, "utf8").split("\n").slice(1);
  const names = new Set();
  for (const line of lines) {
    const col = line.split(",")[0]?.replace(/"/g, "").trim();
    if (col) names.add(norm(col));
  }
  return names;
}

function inTam(company, tamNames) {
  const c = norm(company ?? "");
  if (!c) return false;
  if (tamNames.has(c)) return true;
  for (const name of tamNames) {
    if (c.length > 4 && name.length > 4 && (c.includes(name) || name.includes(c))) return true;
  }
  return false;
}

const tamNames = loadTam();
const seen = new Set();
const allSignals = [];
let totalRaw = 0;

for (const testName of ALL_TESTS) {
  const fp = path.join(RESULTS_DIR, `${testName}_raw.json`);
  if (!fs.existsSync(fp)) continue;

  let items;
  try { items = JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { continue; }
  if (!Array.isArray(items)) continue;

  totalRaw += items.length;

  for (const item of items) {
    if (!item.id && !item.link) continue;
    const key = item.id ?? item.link;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!isFood(item)) continue;
    if (isBlacklisted(item)) continue;
    if (!isExec(item)) continue;

    const days = daysAgo(item);
    const recruiter = isRecruiter(item);
    const tam = inTam(item.companyName, tamNames);
    const emp = item.companyEmployeesCount ?? null;

    // Determine country from location
    const loc = item.location ?? "";
    let country = "EU";
    if (loc.includes("Germany") || loc.includes("Deutschland")) country = "DE";
    else if (loc.includes("France") || loc.includes("Frankreich")) country = "FR";
    else if (loc.includes("Netherlands") || loc.includes("Nederland")) country = "NL";
    else if (loc.includes("Belgium") || loc.includes("Belgique")) country = "BE";

    allSignals.push({
      company: item.companyName ?? "?",
      title: item.title ?? "?",
      location: loc,
      country,
      industries: item.industries ?? "?",
      employees: emp,
      days_ago: days,
      posted_at: item.postedAt ?? null,
      stale: days !== null && days >= 60,
      fresh: days !== null && days <= 14,
      recruiter_posting: recruiter,
      tam_match: tam,
      job_url: item.link ?? null,
      company_website: item.companyWebsite ?? null,
      company_li: item.companyLinkedinUrl ?? null,
      source_test: testName,
    });
  }
}

// Sort: TAM first, then fresh, then by days
const sorted = [...allSignals].sort((a, b) => {
  if (a.tam_match && !b.tam_match) return -1;
  if (!a.tam_match && b.tam_match) return 1;
  if (a.fresh && !b.fresh) return -1;
  if (!a.fresh && b.fresh) return 1;
  return (a.days_ago ?? 999) - (b.days_ago ?? 999);
});

// Only direct (non-recruiter) signals
const direct = sorted.filter(s => !s.recruiter_posting);
const indirect = sorted.filter(s => s.recruiter_posting);

console.log(`\n=== LINKEDIN SIGNALS — FINAL AGGREGATION ===`);
console.log(`Total raw scraped (all tests) : ${totalRaw}`);
console.log(`Total unique items             : ${seen.size}`);
console.log(`Food exec signals (direct)     : ${direct.length}`);
console.log(`Via recruiter postings         : ${indirect.length}`);
console.log(`TAM matches                    : ${sorted.filter(s=>s.tam_match).length}`);
console.log(`Stale (60d+)                   : ${sorted.filter(s=>s.stale).length}`);

console.log("\n=== DIRECT SIGNALS (company posts own role) ===");
for (const s of direct) {
  const d = s.days_ago !== null ? `${s.days_ago}d` : "?d";
  const flags = [s.tam_match?"[TAM]":"", s.stale?"[STALE]":"", s.fresh?"[FRESH]":""].filter(Boolean).join(" ");
  console.log(`  [${d.padEnd(4)}][${s.country}] ${s.company.padEnd(38)} | ${s.title.slice(0,45).padEnd(45)} | emp:${String(s.employees??"?").padEnd(6)} ${flags}`);
}

if (indirect.length > 0) {
  console.log("\n=== VIA RECRUITER (anonymous food client) ===");
  for (const s of indirect.slice(0, 10)) {
    const d = s.days_ago !== null ? `${s.days_ago}d` : "?d";
    console.log(`  [${d.padEnd(4)}][${s.country}] ${s.company.padEnd(30)} | ${s.title.slice(0,45)}`);
  }
}

const outPath = path.join(RESULTS_DIR, "final_signals.json");
fs.writeFileSync(outPath, JSON.stringify({
  generated_at: new Date().toISOString(),
  total_raw_scraped: totalRaw,
  unique_items: seen.size,
  direct_signals: direct.length,
  recruiter_signals: indirect.length,
  signals: sorted
}, null, 2));
console.log(`\nSaved: ${outPath}`);
