// Thin native-fetch PlusVibe client for the signals repo (D1,
// docs/HANDOFF_2026-07-15_scoring_two_channel.md — A6). Deliberately separate
// from Desktop/PV-campaign-manager (a different project, CJS, its own .env) —
// endpoint shapes below are verified against that project's src/api/*.js,
// reimplemented here with native fetch + a simple token bucket instead of
// axios/p-queue so this repo doesn't need new npm dependencies.
//
// Env vars (add to nextjs/.env.local, copy values from
// Desktop/PV-campaign-manager/.env): PV_API_KEY, PV_WORKSPACE_ID, PV_BASE_URL
// (optional, defaults to https://api.plusvibe.ai/api/v1).
//
// Rate limit: PlusVibe is 5 req/sec documented — this client uses 4/sec.

const BASE_URL = process.env.PV_BASE_URL || 'https://api.plusvibe.ai/api/v1';
const API_KEY = process.env.PV_API_KEY;
const WORKSPACE_ID = process.env.PV_WORKSPACE_ID;

const RATE_PER_SEC = 4;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Simple token-bucket throttle — one shared queue for every call this module makes,
// same intent as PV-campaign-manager's PQueue({ intervalCap: 4, interval: 1000 }).
let lastCallTimes = [];
async function throttle() {
  const now = Date.now();
  lastCallTimes = lastCallTimes.filter(t => now - t < 1000);
  if (lastCallTimes.length >= RATE_PER_SEC) {
    const waitMs = 1000 - (now - lastCallTimes[0]) + 5;
    await sleep(waitMs);
    return throttle();
  }
  lastCallTimes.push(Date.now());
}

function assertConfigured() {
  if (!API_KEY) throw new Error('[plusvibe] PV_API_KEY not set');
  if (!WORKSPACE_ID) throw new Error('[plusvibe] PV_WORKSPACE_ID not set');
}

async function request(method, path, { params = {}, body = null } = {}) {
  assertConfigured();
  await throttle();

  const url = new URL(BASE_URL + path);
  const qs = { workspace_id: WORKSPACE_ID, ...params };
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const opts = { method, headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' } };
  if (method !== 'GET' && body) {
    opts.body = JSON.stringify({ workspace_id: WORKSPACE_ID, ...body });
  }

  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText;
    const err = new Error(`[plusvibe] ${method} ${path} -> ${res.status}: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

export async function listCampaigns({ status, type, limit = 100, skip = 0, campaignId, parentId } = {}) {
  const params = { limit, skip };
  if (status) params.status = status;
  if (type) params.campaign_type = type;
  if (campaignId) params.campaign_id = campaignId;
  if (parentId) params.parent_camp_id = parentId;
  return request('GET', '/campaign/list-all', { params });
}

export async function createCampaign(name) {
  return request('POST', '/campaign/add/campaign', { body: { camp_name: name } });
}

export async function updateCampaign(campaignId, settings) {
  return request('PATCH', '/campaign/update/campaign', { body: { campaign_id: campaignId, ...settings } });
}

export async function activateCampaign(campaignId) {
  return request('POST', '/campaign/launch', { body: { campaign_id: campaignId } });
}

export async function pauseCampaign(campaignId) {
  return request('POST', '/campaign/pause', { body: { campaign_id: campaignId } });
}

export async function createSubsequence(name, parentCampId, events) {
  return request('POST', '/campaign/add/subsequence', { body: { name, parent_camp_id: parentCampId, events } });
}

export async function getCampaignStatus(campaignId) {
  return request('GET', '/campaign/status', { params: { campaign_id: campaignId } });
}

export async function getCampaignEmailAccounts(campaignId) {
  return request('GET', '/campaign/email-accounts', { params: { campaign_id: campaignId } });
}

// Build a full settings object for updateCampaign() — per A6: stop_on_lead_replied yes,
// is_pause_on_bouncerate yes @ 8%, ESP match yes, open tracking no, unsub link no.
export function buildCampaignSettings({
  sequences,
  emailAccounts,
  schedule,
  espMatch = true,
  bounceRateLimit = 8,
  stopOnReply = true,
  trackOpens = false,
  unsubLink = false,
  sendPriority = 1,
  firstWaitTime,
  firstWaitTimeUnit = 'days',
} = {}) {
  const s = {};
  if (sequences) s.sequences = sequences;
  if (emailAccounts) s.email_accounts = emailAccounts;
  if (firstWaitTime !== undefined) {
    s.first_wait_time = firstWaitTime;
    s.first_wait_time_unit = firstWaitTimeUnit;
  }
  if (schedule) {
    s.schedules = {
      daily_limit: schedule.dailyLimit ?? 50,
      daily_limit_new_lead: schedule.dailyLimitNewLead ?? schedule.dailyLimit ?? 50,
      camp_st_date: schedule.startDate || new Date().toISOString().slice(0, 10),
      camp_end_date: schedule.endDate || '',
      from_time: schedule.fromTime || '08:00',
      to_time: schedule.toTime || '18:00',
      tz: schedule.timezone || 'Europe/Berlin',
      days: schedule.days || [1, 2, 3, 4, 5],
    };
  }
  s.is_esp_match = espMatch ? 'yes' : 'no';
  s.stop_on_lead_replied = stopOnReply ? 'yes' : 'no';
  s.is_emailopened_tracking = trackOpens ? 'yes' : 'no';
  s.is_unsubscribed_link = unsubLink ? 'yes' : 'no';
  s.send_priority = sendPriority;
  if (bounceRateLimit !== undefined) {
    s.is_pause_on_bouncerate = 'yes';
    s.bounce_rate_limit = bounceRateLimit;
  }
  return s;
}

// Build a sequence step array from {subject, body, waitDays} steps — one step per
// PlusVibe "step", body/subject expected to already be {{variable}} interpolation
// strings (per-lead custom variables fill them at send time, see copyEngine.mjs).
export function buildCampaignSequences(steps) {
  return steps.map((step, i) => ({
    step: i + 1,
    wait_time: (step.waitDays || 0) * 24 * 60,
    variations: [{
      variation: 'A',
      subject: step.subject || '',
      name: `Step ${i + 1}A`,
      body: step.body || '',
    }],
  }));
}

// ── Leads ────────────────────────────────────────────────────────────────────

const LEAD_BATCH_SIZE = 100;

export async function addLeadsToCampaign(campaignId, leads, options = {}) {
  const results = { total: leads.length, uploaded: 0, duplicates: 0, invalid: 0, skipped: 0, remaining_in_plan: null, batches: [] };

  for (let i = 0; i < leads.length; i += LEAD_BATCH_SIZE) {
    const batch = leads.slice(i, i + LEAD_BATCH_SIZE);
    const res = await request('POST', '/lead/add', {
      body: {
        campaign_id: campaignId,
        leads: batch,
        skip_if_in_workspace: options.skipIfInWorkspace ?? true,
        skip_lead_in_active_pause_camp: options.skipIfInActiveCamp ?? false,
        skip_lead_for_active_only_camp: options.skipIfInActiveCampOnly ?? false,
        is_overwrite: options.overwrite ?? false,
      },
    });
    results.uploaded += res.leads_uploaded || 0;
    results.duplicates += res.duplicate_email_count || 0;
    results.invalid += res.invalid_email_count || 0;
    results.skipped += res.skipped || 0;
    if (res.remaining_in_plan !== undefined) results.remaining_in_plan = res.remaining_in_plan;
    results.batches.push(res);
  }
  return results;
}

export async function searchLeads({ email, campaignId, status, label, page = 1, limit = 100 } = {}) {
  const params = { page, limit };
  if (email) params.email = email;
  if (campaignId) params.campaign_id = campaignId;
  if (status) params.status = status;
  if (label) params.label = label;
  return request('GET', '/lead/workspace-leads', { params });
}

// ── Email accounts ───────────────────────────────────────────────────────────

export async function listAccounts({ tags, email, skip = 0, limit = 100 } = {}) {
  const params = { skip, limit };
  if (tags) params.tags = Array.isArray(tags) ? tags.join(',') : tags;
  if (email) params.email = email;
  const res = await request('GET', '/account/list', { params });
  return res.accounts || res;
}
