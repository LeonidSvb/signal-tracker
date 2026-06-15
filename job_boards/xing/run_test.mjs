// Xing test runner — shahidirfan/Xing-Jobs-Scraper
// Usage: node --env-file=../../../../../../.env run_test.mjs <test_name>
// Example: node --env-file=../../../../../../.env run_test.mjs gf_lebensmittel

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dir, "config.json"), "utf8"));

const testName = process.argv[2];
if (!testName || !config.tests[testName]) {
  console.error(`Usage: node run_test.mjs <test_name>`);
  console.error(`Available: ${Object.keys(config.tests).join(", ")}`);
  process.exit(1);
}

const API_KEY = process.env[config.apify_key_env];
if (!API_KEY) { console.error(`Env var ${config.apify_key_env} not set`); process.exit(1); }

const BASE = "https://api.apify.com/v2";
const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

async function apify(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 200)}`); }
}

const test = config.tests[testName];
console.log(`[${testName}] starting: keyword="${test.keyword}" location="${test.location}"`);
console.log(`Note: Xing returns max ~20 results per query`);

const runResp = await apify("POST", `/acts/${config.actor_id.replace("/", "~")}/runs`, {
  keyword: test.keyword,
  location: test.location,
});

if (!runResp?.data?.id) {
  console.error("Failed to start:", JSON.stringify(runResp).slice(0, 300));
  process.exit(1);
}

const runId = runResp.data.id;
const datasetId = runResp.data.defaultDatasetId;
console.log(`Run ID: ${runId} | Dataset: ${datasetId}`);

let status = runResp.data.status;
while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
  await new Promise(r => setTimeout(r, 8000));
  const poll = await apify("GET", `/actor-runs/${runId}`);
  status = poll.data.status;
  process.stdout.write(".");
}
console.log(`\nStatus: ${status}`);

if (status !== "SUCCEEDED") { console.error(`Run ${status}`); process.exit(1); }

const itemsResp = await apify("GET", `/datasets/${datasetId}/items?limit=2000&clean=true`);
const items = Array.isArray(itemsResp) ? itemsResp : (itemsResp.items ?? []);
console.log(`Items: ${items.length}`);

fs.mkdirSync(path.join(__dir, "results"), { recursive: true });
const rawPath = path.join(__dir, "results", `${testName}_raw.json`);
fs.writeFileSync(rawPath, JSON.stringify(items, null, 2));

const runInfoPath = path.join(__dir, "results", `${testName}_run_info.json`);
fs.writeFileSync(runInfoPath, JSON.stringify({ testName, runId, datasetId, status, itemCount: items.length, test, timestamp: new Date().toISOString() }, null, 2));

console.log(`\nSaved: ${rawPath}`);
console.log(`\nSample (first 5) — note company_industry field:`);
for (const item of items.slice(0, 5)) {
  const date = item.date_posted ?? "?";
  const ind = item.company_industry ? ` | ${item.company_industry}` : "";
  const size = item.company_size ? ` [${item.company_size}]` : "";
  console.log(`  [${String(date).slice(0,10)}] ${item.company ?? "?"}${size} — ${item.title ?? "?"} @ ${item.location ?? "?"}${ind}`);
}
