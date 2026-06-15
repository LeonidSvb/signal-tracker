// Usage: node --env-file=../../../../../.env run_test.mjs <testname>
// e.g.:  node --env-file=../../../../../.env run_test.mjs smoke_de
// Runs curious_coder/linkedin-jobs-scraper on Apify and saves raw results

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(__dir, "config.json"), "utf8"));

const testName = process.argv[2];
if (!testName) { console.error("Usage: node run_test.mjs <testname>"); process.exit(1); }

const test = config.tests[testName];
if (!test) {
  console.error(`Unknown test: ${testName}. Available: ${Object.keys(config.tests).join(", ")}`);
  process.exit(1);
}

const API_KEY = process.env[config.apify_key_env];
if (!API_KEY) { console.error(`Env var ${config.apify_key_env} not set`); process.exit(1); }

const BASE = "https://api.apify.com/v2";
const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

async function apify(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Apify ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}

async function main() {
  console.log(`\n=== LinkedIn scraper test: ${testName} ===`);
  console.log(`Desc: ${test.desc}`);
  console.log(`URLs: ${test.urls.length}  count: ${test.count}  scrapeCompany: ${test.scrapeCompany}`);

  const input = {
    urls: test.urls,
    count: test.count,
    scrapeCompany: test.scrapeCompany ?? true,
    ...(test.splitByLocation ? { splitByLocation: true, splitCountry: test.splitCountry } : {}),
  };

  console.log("\nStarting run...");
  const runResp = await apify("POST", `/acts/${config.actor_id}/runs`, input);
  if (!runResp?.data?.id) {
    console.error("Failed to start run:", JSON.stringify(runResp, null, 2));
    process.exit(1);
  }

  const runId = runResp.data.id;
  const datasetId = runResp.data.defaultDatasetId;
  console.log(`Run ID: ${runId}`);
  console.log(`Dataset: ${datasetId}`);

  let status = runResp.data.status;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
    await new Promise(r => setTimeout(r, 8000));
    const poll = await apify("GET", `/actor-runs/${runId}`);
    status = poll.data.status;
    const stats = poll.data.stats ?? {};
    process.stdout.write(`\r  Status: ${status}  items: ${stats.outputItemCount ?? "?"}  elapsed: ${Math.round((stats.runTimeSecs ?? 0))}s   `);
  }
  console.log(`\nFinal status: ${status}`);

  if (status !== "SUCCEEDED") {
    console.error("Run did not succeed. Check Apify console for details.");
    process.exit(1);
  }

  const itemsResp = await apify("GET", `/datasets/${datasetId}/items?limit=1000&clean=true`);
  const items = Array.isArray(itemsResp) ? itemsResp : (itemsResp.items ?? []);
  console.log(`Total items: ${items.length}`);

  fs.mkdirSync(path.join(__dir, "results"), { recursive: true });
  const outPath = path.join(__dir, "results", `${testName}_raw.json`);
  fs.writeFileSync(outPath, JSON.stringify(items, null, 2));
  console.log(`Saved: ${outPath}`);

  const runInfoPath = path.join(__dir, "results", `${testName}_run_info.json`);
  fs.writeFileSync(runInfoPath, JSON.stringify({
    testName,
    runId,
    datasetId,
    status,
    itemCount: items.length,
    cost_usd: (items.length / 1000).toFixed(4),
    timestamp: new Date().toISOString(),
    input
  }, null, 2));

  console.log(`Estimated cost: $${(items.length / 1000).toFixed(4)}`);

  if (items.length > 0) {
    console.log("\n--- Sample item (fields present) ---");
    const sample = items[0];
    console.log("Fields:", Object.keys(sample).join(", "));
    console.log("Title:", sample.title ?? sample.jobTitle ?? "(no title field)");
    console.log("Company:", sample.companyName ?? sample.company ?? "(no company field)");
    console.log("Location:", sample.location ?? "(no location)");
    console.log("Posted:", sample.postedAt ?? sample.publishedAt ?? sample.postingDate ?? "(no date)");
    console.log("Seniority:", sample.seniorityLevel ?? sample.seniority ?? "(no seniority)");
    console.log("Industries:", sample.industries ?? sample.companyIndustries ?? "(no industries)");
    console.log("Employees:", sample.companyEmployeeCount ?? sample.employeeCount ?? "(no employees)");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
