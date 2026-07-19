#!/usr/bin/env node
// LinkedIn priority queue builder (E1, docs/HANDOFF_2026-07-15_scoring_two_channel.md)
// — runs DAILY after rank_leads.mjs (A3/A4). Produces a single rolling, self-cleaning
// list for Philippe: T1 first, then T2 companies that have a LinkedIn-able contact.
// No daily quota, no cap — items leave the list when their event window expires or
// get marked done/skipped (mark_linkedin_done.mjs), so the list can never pile up.
//
// STATUS: migration 005 is live (verified 2026-07-19 via a real REST query —
// companies.tier/rank/event_key all populated). Migration 008 (2026-07-19) widened
// channel_actions' unique constraint to include contact_id — see channelActions.mjs.
// Read-only against signals/companies/contacts either way (no external API calls
// except the LLM hook localization inside copyEngine.fill, and even that is skipped
// when lang==='en' or the item was already snapshotted in channel_actions.detail on
// an earlier day).
//
// Run: node --env-file=nextjs/.env.local pipeline/stages/build_linkedin_queue.mjs [--out=path] [--live]
//   --live: actually write channel_actions status='queued' rows for first-seen items
//           and generate NEW copy (LLM calls) for items not yet snapshotted.
//           Without --live: read-only preview, reuses whatever's already snapshotted,
//           shows [NEEDS COPY] for anything that would need a fresh LLM call.

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { selectAll } from '../lib/supabase.mjs';
import { getClientId } from '../lib/log.mjs';
import { loadChannelActions, indexChannelActions, channelActionKey, recordChannelAction } from '../lib/channelActions.mjs';
import { fill as fillCopy, langForCountry, marketFocusForCountry } from '../lib/copyEngine.mjs';
import { isStale } from '../lib/staleness.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';
const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const outArg = args.find(a => a.startsWith('--out='));
// Cross-platform default: was hardcoded to Leo's Windows Downloads folder, which
// doesn't exist on the VPS cron target — found live 2026-07-18 during the Phase 3
// deploy smoke test. Repo-relative pipeline/runs/ works on any OS; --out= still
// overrides for a manual local run that wants it in Downloads directly.
const DEFAULT_OUT_DIR = join(__dir, '../runs/linkedin_queue');
const OUT_PATH = outArg ? outArg.split('=')[1] : join(DEFAULT_OUT_DIR, `philippe_linkedin_queue_${new Date().toISOString().slice(0, 10)}.html`);

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function run() {
  console.log(`\n=== build_linkedin_queue.mjs === mode=${LIVE ? 'LIVE (writes channel_actions, may spend LLM calls)' : 'PREVIEW (read-only)'}`);

  const clientId = await getClientId(CLIENT_SLUG);

  const [companies, signals, contacts, channelActionRows] = await Promise.all([
    selectAll('companies', { client_id: clientId }),
    selectAll('signals', { client_id: clientId }),
    selectAll('contacts', { client_id: clientId }),
    loadChannelActions(clientId, 'linkedin').catch(e => { console.log(`[warn] channel_actions query failed: ${e.message}`); return []; }),
  ]);

  const existingActions = indexChannelActions(channelActionRows);

  const signalsByCompany = new Map();
  for (const s of signals) {
    if (!s.company_id) continue;
    if (!signalsByCompany.has(s.company_id)) signalsByCompany.set(s.company_id, []);
    signalsByCompany.get(s.company_id).push(s);
  }
  const contactsByCompany = new Map();
  for (const c of contacts) {
    if (!c.company_id) continue;
    if (!contactsByCompany.has(c.company_id)) contactsByCompany.set(c.company_id, []);
    contactsByCompany.get(c.company_id).push(c);
  }

  // E1.1 — T1 always eligible; T2 only if it has a LinkedIn-able contact.
  const eligible = companies.filter(c => c.tier === 'T1' || c.tier === 'T2');
  console.log(`T1/T2 companies: ${eligible.length} (of ${companies.length} total — 0 expected until rank_leads.mjs has run)`);

  const rows = [];
  for (const company of eligible) {
    const companySignals = (signalsByCompany.get(company.id) || []).filter(s => s.status === 'active');
    if (!companySignals.length) continue;
    const primarySignal = [...companySignals].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (!primarySignal.event_key) continue; // rank_leads hasn't grouped this company yet

    if (isStale(primarySignal.signal_type, primarySignal.pub_date)) continue; // E1.1 — expired events self-clean

    const companyContacts = contactsByCompany.get(company.id) || [];
    // E1.2 — prefer contacts WITH linkedin_url; T1 with none falls back to email-only
    // (excluded from this queue — it's covered by the email channel independently).
    // Picked BEFORE the existingActions lookup (migration 008): the dedup key is now
    // per-contact, not just per-company/event, so contact_id must be known first.
    const liContact = companyContacts.find(c => c.linkedin_url) || null;
    if (!liContact) {
      if (company.tier === 'T1') console.log(`  [T1 no-linkedin-contact, email-only] ${company.name}`);
      continue;
    }

    const key = channelActionKey(company.id, liContact.id, primarySignal.event_key);
    const existing = existingActions.get(key);
    if (existing && ['done', 'skipped'].includes(existing.status)) continue; // E1.1 — dropped once actioned

    rows.push({ company, signal: primarySignal, contact: liContact, existingAction: existing });
  }
  console.log(`queue rows: ${rows.length}`);

  // E1.3 — copy, snapshotted into channel_actions.detail so a daily rebuild never
  // re-spends LLM on items already in the list.
  for (const row of rows) {
    const snapshot = row.existingAction?.detail?.copy;
    if (snapshot) { row.copy = snapshot; row.copySource = 'snapshot'; continue; }

    if (!LIVE) { row.copy = null; row.copySource = 'needs_generation'; continue; }

    const lang = langForCountry(row.company.hq_country);
    const marketFocus = marketFocusForCountry(row.company.hq_country);
    try {
      const filled = await fillCopy({
        templateKey: row.signal.signal_type, rank: row.company.rank, lang,
        vars: {
          first_name: row.contact.first_name || row.contact.full_name || '',
          company: row.company.name, market_focus: marketFocus,
          exact_job_title: row.signal.title || '', job_title: row.signal.title || '',
        },
      });
      row.copy = { li_connection_note: filled.li_connection_note, li_first_message: filled.li_first_message, lang, usedFallbackCase: filled.usedFallbackCase };
      row.copySource = 'generated';
    } catch (e) {
      row.copy = null; row.copySource = `error: ${e.message}`;
    }
  }

  // E1.6 — first appearance writes channel_actions status='queued'.
  if (LIVE) {
    for (const row of rows) {
      if (row.existingAction) continue;
      await recordChannelAction({
        clientId, companyId: row.company.id, contactId: row.contact.id, eventKey: row.signal.event_key,
        channel: 'linkedin', status: 'queued', detail: { copy: row.copy },
      });
    }
  }

  // E1.4 — order: tier ASC, remaining-window ASC, rank DESC (closing windows float to top).
  const staleWindowDays = { HIRING: 90, MA: 90, CLEVEL: 30, EXPAND: 60, INVEST: 60, CONTRACT: 60, NICHE: 30, SECTOR: 30 };
  function remainingDays(signalType, pubDate) {
    const windowDays = staleWindowDays[signalType] ?? staleWindowDays[signalType?.replace(/^HIRING_.*/, 'HIRING')] ?? 30;
    const ageMs = Date.now() - new Date(pubDate || Date.now()).getTime();
    return Math.max(0, Math.round(windowDays - ageMs / 86_400_000));
  }
  rows.sort((a, b) => {
    if (a.company.tier !== b.company.tier) return a.company.tier.localeCompare(b.company.tier); // T1 < T2
    const remA = remainingDays(a.signal.signal_type, a.signal.pub_date);
    const remB = remainingDays(b.signal.signal_type, b.signal.pub_date);
    if (remA !== remB) return remA - remB;
    return (b.company.rank || 0) - (a.company.rank || 0);
  });

  // E1.5 — HTML export, skeleton borrowed from build_signal_report.mjs.
  const rowsHtml = rows.map((row, i) => {
    const { company, signal, contact, copy, copySource } = row;
    const remaining = remainingDays(signal.signal_type, signal.pub_date);
    const isNewToday = !row.existingAction;
    const inmailEligible = company.tier === 'T1' && remaining < 14 && !!row.existingAction && row.existingAction.status === 'queued';
    return `
    <div class="queue-row">
      <div class="priority">#${i + 1}</div>
      <div class="body">
        <div class="row-header">
          <span class="tier-badge tier-${esc(company.tier)}">${esc(company.tier)}</span>
          <h3>${esc(company.name)}</h3>
          ${isNewToday ? '<span class="badge badge-new">new</span>' : ''}
          ${inmailEligible ? '<span class="badge badge-inmail">InMail eligible</span>' : ''}
          ${copy?.usedFallbackCase ? '<span class="badge badge-fallback">generic case — worth personalizing</span>' : ''}
          <span class="window">${remaining}d left in window</span>
        </div>
        <div class="event">${esc(signal.signal_type)} — ${esc(signal.title || '(no title)')} ${signal.source_url ? `· <a href="${esc(signal.source_url)}" target="_blank">source</a>` : ''}</div>
        <div class="contact">${esc(contact.full_name || `${contact.first_name || ''} ${contact.last_name || ''}`)} — ${esc(contact.title || '?')} · <a href="${esc(contact.linkedin_url)}" target="_blank">LinkedIn</a></div>
        ${copy ? `
        <div class="copy-block">
          <div class="copy-label">Connection note</div>
          <pre class="copy-text">${esc(copy.li_connection_note)}</pre>
          <div class="copy-label">First message (after accept)</div>
          <pre class="copy-text">${esc(copy.li_first_message)}</pre>
        </div>` : `<div class="copy-missing">[${esc(copySource)}] — rerun with --live to generate</div>`}
      </div>
    </div>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Philippe — LinkedIn Priority Queue — ${new Date().toISOString().slice(0, 10)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; background: #f6f6f4; color: #1a1a1a; margin: 0; padding: 24px; }
  .wrap { max-width: 820px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }
  .queue-row { display: flex; gap: 12px; background: #fff; border: 1px solid #e0e0dc; border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; }
  .priority { font-size: 13px; color: #999; font-weight: 700; min-width: 32px; }
  .row-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .row-header h3 { margin: 0; font-size: 15px; }
  .tier-badge { font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 6px; }
  .tier-T1 { background: #fee2e2; color: #991b1b; }
  .tier-T2 { background: #fef3c7; color: #92400e; }
  .badge { font-size: 10px; padding: 2px 7px; border-radius: 10px; }
  .badge-new { background: #dbeafe; color: #1e40af; }
  .badge-inmail { background: #ede9fe; color: #5b21b6; }
  .badge-fallback { background: #fef9c3; color: #854d0e; }
  .window { margin-left: auto; font-size: 11px; color: #888; }
  .event { font-size: 12px; color: #444; margin-top: 4px; }
  .event a { color: #2563eb; }
  .contact { font-size: 12px; color: #666; margin-top: 2px; }
  .contact a { color: #2563eb; text-decoration: none; }
  .copy-block { margin-top: 10px; }
  .copy-label { font-size: 10px; text-transform: uppercase; color: #999; margin-top: 8px; }
  .copy-text { background: #f9fafb; border: 1px solid #eee; border-radius: 6px; padding: 8px 10px; font-size: 12px; white-space: pre-wrap; font-family: inherit; margin: 4px 0 0; }
  .copy-missing { font-size: 11px; color: #b45309; margin-top: 8px; }
</style></head>
<body><div class="wrap">
  <h1>LinkedIn Priority Queue — Philippe Bosquillon</h1>
  <div class="subtitle">Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${rows.length} rows · work strictly top-down, stop when out of time — tomorrow's list re-sorts what's left plus new arrivals</div>
  ${rowsHtml || '<p>No rows — depends on migration 005 + rank_leads.mjs, see console output.</p>'}
</div></body></html>`;

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, html, 'utf8');
  console.log(`\nwritten: ${OUT_PATH}`);
  console.log('=== DONE ===');
  return { rows: rows.length, outPath: OUT_PATH };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
