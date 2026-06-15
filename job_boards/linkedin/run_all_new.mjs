// Runs all new bypass tests sequentially, aggregates results, finds food signals
// Usage: node --env-file=../../../../../.env run_all_new.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dir, "config.json"), "utf8"));

const NEW_TESTS = [
  "split_de_werksleiter",
  "split_de_gf",
  "split_de_personalleiter",
  "split_fr_directeur",
  "split_fr_drh",
  "split_nl_be",
  "de_specific_sectors",
  "fr_specific_sectors",
  "en_europe",
];

const API_KEY = process.env[config.apify_key_env];
if (!API_KEY) { console.error(`Env var ${config.apify_key_env} not set`); process.exit(1); }

const BASE = "https://api.apify.com/v2";
const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

async function apify(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Apify ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`); }
}

// --- food signal filters ---
const FOOD_INDUSTRIES = [
  "food and beverage", "food & beverage", "lebensmittel", "nahrungsmittel",
  "agroalimentaire", "agri-food", "agriculture, food", "voedingsmiddelen",
  "food production", "food manufacturing", "dairy", "meat processing",
  "bakery", "confectionery", "beverage manufacturing", "food ingredients"
];

const CATERING_BLACKLIST = [
  "sodexo", "compass group", "newrest", "elior", "aramark", "eurest",
  "restauration collective", "collective catering", "contract catering",
  "hotelprofessionals", "staffmark", "randstad", "adecco", "manpower",
  "executive search", "recrutement", "headhunter", "beratung"
];

const EXEC_KW = [
  "director", "directeur", "direktor", "direkteur",
  "geschäftsführer", "geschaftsfuhrer",
  "vp ", "vice president", "ceo", "coo", "cfo", "chro", "cmo",
  "managing director", "general manager", "werksleiter", "betriebsleiter",
  "plant manager", "leiter", "drh", "head of"
];

function norm(s) { return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }

function isFood(item) {
  const ind = norm(item.industries ?? "");
  if (!ind) return false;
  return FOOD_INDUSTRIES.some(k => ind.includes(k));
}

function isCatering(item) {
  const co = norm(item.companyName ?? "");
  const ind = norm(item.industries ?? "");
  return CATERING_BLACKLIST.some(k => co.includes(k) || ind.includes(k));
}

function isExec(item) {
  const title = norm(item.title ?? "");
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

fs.mkdirSync(path.join(__dir, "results"), { recursive: true });

const allSignals = [];
const seen = new Set();
let totalRaw = 0;
let totalCost = 0;

async function runTest(testName) {
  const test = config.tests[testName];
  if (!test) { console.log(`  [SKIP] ${testName} — not in config`); return; }

  const input = {
    urls: test.urls,
    count: test.count,
    scrapeCompany: test.scrapeCompany ?? true,
    ...(test.splitByLocation ? { splitByLocation: true, splitCountry: test.splitCountry } : {}),
  };

  process.stdout.write(`\n[${testName}] starting...`);
  let runResp;
  try {
    runResp = await apify("POST", `/acts/${config.actor_id}/runs`, input);
  } catch (e) {
    console.log(` FAILED to start: ${e.message}`);
    return;
  }

  if (!runResp?.data?.id) {
    console.log(` FAILED: ${JSON.stringify(runResp).slice(0, 200)}`);
    return;
  }

  const runId = runResp.data.id;
  const datasetId = runResp.data.defaultDatasetId;
  let status = runResp.data.status;

  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    await new Promise(r => setTimeout(r, 8000));
    const poll = await apify("GET", `/actor-runs/${runId}`);
    status = poll.data.status;
    process.stdout.write(".");
  }

  if (status !== "SUCCEEDED") {
    console.log(` ${status}`);
    return;
  }

  const itemsResp = await apify("GET", `/datasets/${datasetId}/items?limit=2000&clean=true`);
  const items = Array.isArray(itemsResp) ? itemsResp : (itemsResp.items ?? []);

  totalRaw += items.length;
  totalCost += items.length / 1000;

  const rawPath = path.join(__dir, "results", `${testName}_raw.json`);
  fs.writeFileSync(rawPath, JSON.stringify(items, null, 2));

  let found = 0;
  for (const item of items) {
    const id = item.id ?? item.link;
    if (seen.has(id)) continue;
    seen.add(id);

    if (!isFood(item)) continue;
    if (isCatering(item)) continue;
    if (!isExec(item)) continue;

    const days = daysAgo(item);
    allSignals.push({
      source_test: testName,
      company: item.companyName ?? "?",
      title: item.title ?? "?",
      location: item.location ?? "?",
      industries: item.industries ?? "?",
      employees: item.companyEmployeesCount ?? null,
      days_ago: days,
      posted_at: item.postedAt ?? null,
      job_url: item.link ?? item.link,
      company_website: item.companyWebsite ?? null,
      company_li: item.companyLinkedinUrl ?? null,
    });
    found++;
  }

  console.log(` raw=${items.length} food_exec=${found} total_signals=${allSignals.length}`);
}

async function main() {
  console.log("=== LinkedIn bypass tests — hunting 5+ food signals ===");
  console.log(`Account: ${config.apify_key_env}`);
  console.log(`Tests: ${NEW_TESTS.join(", ")}\n`);

  for (const testName of NEW_TESTS) {
    await runTest(testName);
    if (allSignals.length >= 5) {
      console.log(`\nTarget of 5 signals reached after ${testName} — continuing for more coverage...`);
    }
  }

  console.log(`\n=== FINAL RESULTS ===`);
  console.log(`Total raw scraped : ${totalRaw}`);
  console.log(`Estimated cost    : $${totalCost.toFixed(3)}`);
  console.log(`Food exec signals : ${allSignals.length}`);

  // dedupe by company
  const byCompany = {};
  for (const s of allSignals) {
    const key = norm(s.company);
    if (!byCompany[key]) byCompany[key] = [];
    byCompany[key].push(s);
  }

  const companies = Object.keys(byCompany);
  console.log(`Unique companies  : ${companies.length}`);

  console.log("\n--- Signals (sorted by recency) ---");
  const sorted = [...allSignals].sort((a, b) => (a.days_ago ?? 999) - (b.days_ago ?? 999));
  for (const s of sorted) {
    const d = s.days_ago !== null ? `${s.days_ago}d` : "?d";
    const emp = s.employees ? `${s.employees} emp` : "";
    console.log(`  [${d.padEnd(4)}] ${s.company.padEnd(35)} | ${s.title.slice(0,45).padEnd(45)} | ${s.location.slice(0,25)} ${emp}`);
  }

  const outPath = path.join(__dir, "results", "all_signals_combined.json");
  fs.writeFileSync(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    total_raw: totalRaw,
    cost_usd: totalCost.toFixed(3),
    signal_count: allSignals.length,
    unique_companies: companies.length,
    signals: sorted
  }, null, 2));
  console.log(`\nSaved: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
