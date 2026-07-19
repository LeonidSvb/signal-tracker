// Thin helper over signal_monitoring.channel_actions (migration 005, A7 in
// docs/HANDOFF_2026-07-15_scoring_two_channel.md). Shared by route_email.mjs (D4) and
// build_linkedin_queue.mjs (E1) — both channels use the SAME table so a company's
// email and LinkedIn state are looked up and written the same way.
//
// channel_actions columns (A7):
//   id uuid PK, client_id FK, company_id FK, contact_id FK nullable,
//   event_key text, channel text ('email'|'linkedin'),
//   status text (email: 'validated'|'pushed'|'skipped_no_email'|'skipped_validation';
//                linkedin: 'queued'|'exported'|'done'|'skipped'),
//   detail jsonb, created_at/updated_at
//   UNIQUE (client_id, company_id, contact_id, channel, event_key) — widened
//   2026-07-19 (migration 008) to include contact_id: the OLD 4-column
//   constraint let two different contacts at one company/event collide (only
//   one could have a row), found live via a real query against
//   channel_actions rows from the 2026-07-15 route_email.mjs run.

import { selectAll, insert, patch } from './supabase.mjs';

export async function loadChannelActions(clientId, channel) {
  return selectAll('channel_actions', { client_id: clientId, channel });
}

// key = `${company_id}::${contact_id}::${event_key}` — matches migration 008's
// widened UNIQUE constraint's dedup shape (was `${company_id}::${event_key}`
// pre-008, which collided across contacts at the same company/event).
export function channelActionKey(companyId, contactId, eventKey) {
  return `${companyId}::${contactId}::${eventKey}`;
}

export function indexChannelActions(rows) {
  return new Map(rows.map(r => [channelActionKey(r.company_id, r.contact_id, r.event_key), r]));
}

export async function recordChannelAction({ clientId, companyId, contactId = null, eventKey, channel, status, detail = {} }) {
  return insert('channel_actions', [{
    client_id: clientId, company_id: companyId, contact_id: contactId,
    event_key: eventKey, channel, status, detail,
  }]);
}

export async function updateChannelActionStatus(id, status, detail = null) {
  const data = { status };
  if (detail !== null) data.detail = detail;
  return patch('channel_actions', 'id', [id], data);
}

// Statuses that do NOT permanently retire a (company, channel, event) key — retried
// on the next run instead of skipped forever. 'skipped_no_campaign' is an
// environment/config gap (no PlusVibe campaign wired up yet), not a fact about the
// lead — found live 2026-07-15: 17/20 route_email candidates got stuck this way
// before this existed (campaign_map was empty, D5 not done yet). Everything else
// (pushed, skipped_validation, done, skipped, ...) is a real terminal outcome.
const RETRYABLE_STATUSES = new Set(['skipped_no_campaign']);

export function isRetryable(action) {
  return !action || RETRYABLE_STATUSES.has(action.status);
}

// Insert a fresh row, or update an existing retryable one in place (avoids violating
// the (client_id, company_id, channel, event_key) unique constraint on retry).
export async function upsertChannelAction({ clientId, companyId, contactId = null, eventKey, channel, status, detail = {}, existing = null }) {
  if (existing) return updateChannelActionStatus(existing.id, status, detail);
  return recordChannelAction({ clientId, companyId, contactId, eventKey, channel, status, detail });
}
