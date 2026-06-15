// Run all Indeed tests in parallel
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dir, "config.json"), "utf8"));

const API_KEY = process.env[config.apify_key_env];
if (!API_KEY) { console.error(`Env var ${config.apify_key_env} not set`); process.exit(1); }

const BASE = "https://api.apify.com/v2";
const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

async function apify(method, p, body) {
  const r = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`${method} ${p} → ${r.status}: ${text.slice(0, 200)}`); }
}

async function runTest(testName) {
  const test = config.tests[testName];
  const outPath = path.join(__dir, "results", `${testName}_raw.json`);

  if (fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    const count = Array.isArray(existing) ? existing.filter(i => !i.error).length : 0;
    console.log(`[${testName}] SKIP — already saved (${count} items)`);
    return { testName, items: existing, skipped: true };
  }

  console.log(`[${testName}] starting: "${test.position}" / ${test.location}`);
  const runResp = await apify("POST", `/acts/${config.actor_id.replace("/", "~")}/runs`, {
    position: test.position,
    location: test.location,
    country: test.country,
    maxItems: test.maxItems,
  });

  if (!runResp?.data?.id) {
    console.error(`[${testName}] FAILED to start:`, JSON.stringify(runResp).slice(0, 200));
    return { testName, items: [], error: true };
  }

  const runId = runResp.data.id;
  const datasetId = runResp.data.defaultDatasetId;

  let status = runResp.data.status;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    await new Promise(r => setTimeout(r, 8000));
    const poll = await apify("GET", `/actor-runs/${runId}`);
    status = poll.data.status;
    process.stdout.write(`[${testName}:${status}] `);
  }

  if (status !== "SUCCEEDED") {
    console.error(`\n[${testName}] Run ${status}`);
    return { testName, items: [], error: true };
  }

  const itemsResp = await apify("GET", `/datasets/${datasetId}/items?limit=2000&clean=true`);
  const items = Array.isArray(itemsResp) ? itemsResp : (itemsResp.items ?? []);
  const realItems = items.filter(i => !i.error);

  fs.mkdirSync(path.join(__dir, "results"), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(items, null, 2));
  fs.writeFileSync(path.join(__dir, "results", `${testName}_run_info.json`), JSON.stringify({
    testName, runId, datasetId, status,
    itemCount: realItems.length,
    estCostUsd: realItems.length * config.price_per_result_usd,
    test, timestamp: new Date().toISOString()
  }, null, 2));

  console.log(`\n[${testName}] DONE — ${realItems.length} items ($${(realItems.length * config.price_per_result_usd).toFixed(3)})`);
  return { testName, items: realItems };
}

const tests = Object.keys(config.tests);
console.log(`Running ${tests.length} tests in parallel...\n`);

const results = await Promise.all(tests.map(runTest));

console.log("\n========== SUMMARY ==========");
let totalItems = 0;
let totalCost = 0;
for (const r of results) {
  const count = r.items?.filter(i => !i.error).length ?? 0;
  const cost = r.skipped ? 0 : count * config.price_per_result_usd;
  totalItems += count;
  totalCost += cost;
  console.log(`  ${r.testName}: ${count} items${r.skipped ? " (cached)" : ` ($${cost.toFixed(3)})`}`);
}
console.log(`  TOTAL: ${totalItems} items | Est. cost: $${totalCost.toFixed(3)}`);

// Quick ICP preview
const EXEC = ["geschäftsführer","werksleiter","betriebsleiter","personalleiter","direktor","directeur","drh","managing director","general manager","plant director","head of","chief"];
const FOOD = ["food","lebensmittel","nahrung","molkerei","bäckerei","backwaren","fleisch","getränke","agroalimentaire","alimentaire","voeding"];
const CATERING = ["restaurant","catering","gastronom","hotel","mensa","aramark"];

let icpCount = 0;
for (const r of results) {
  for (const item of (r.items ?? [])) {
    if (item.error) continue;
    const title = (item.positionName || "").toLowerCase();
    const company = (item.company || "").toLowerCase();
    const desc = (item.description || "").toLowerCase().slice(0, 100);
    const combined = `${title} ${company} ${desc}`;
    const isExec = EXEC.some(e => title.includes(e));
    const isFood = FOOD.some(f => combined.includes(f));
    const isCatering = CATERING.some(c => combined.includes(c));
    if (isExec && isFood && !isCatering) {
      icpCount++;
      console.log(`  ICP: ${item.positionName} @ ${item.company} [${item.location}] ${(item.postingDateParsed||"?").toString().slice(0,10)}`);
    }
  }
}
console.log(`\nICP matches: ${icpCount}`);
