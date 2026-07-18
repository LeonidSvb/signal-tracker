#!/usr/bin/env node
// Email autopilot stage (D4, docs/HANDOFF_2026-07-15_scoring_two_channel.md) — runs
// weekly after rank_leads.mjs. For every tiered company (T1/T2/T3 alike — email is
// the baseline channel per A3, independent of LinkedIn) with a contact that has an
// email, validates it via the MV+BounceBan cascade, generates per-lead copy from the
// playbook, and pushes to the matching PlusVibe evergreen campaign.
//
// STATUS: coded to the migration-005 schema (companies.tier/rank, signals.event_key,
// channel_actions) exactly as specced in B1/A7 — UNRUNNABLE until Fable applies that
// migration and lands rank_leads.mjs (which populates tier/rank/event_key). This is
// expected per SONNET-FIRST MODE ("safe to BUILD but NOT RUN"). Do not remove this
// note until migration 005 is live and a real dry run has been verified against it.
//
// Safety: DRY RUN by default — prints the would-push list (company, tier, contact,
// validation verdict path, template key, lang), zero external calls beyond the free
// cache. --live requires Leo's "запускай" AND is capped --limit=20 for the first
// supervised push (D4 spec) — campaigns are created PAUSED and stay paused until Leo
// inspects the leads inside the PlusVibe UI.
//
// Run: node --env-file=nextjs/.env.local pipeline/stages/route_email.mjs [--live] [--limit=20]

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { readFileSync } from 'fs';

import { selectAll, patch } from '../lib/supabase.mjs';
import { getClientId, startRun, finishRun } from '../lib/log.mjs';
import { loadChannelActions, indexChannelActions, channelActionKey, upsertChannelAction, isRetryable } from '../lib/channelActions.mjs';
import { eventClass } from '../lib/eventClass.mjs';
import { validateBatch } from '../lib/validateEmail.mjs';
import { fill as fillCopy, langForCountry, marketFocusForCountry } from '../lib/copyEngine.mjs';
import { addLeadsToCampaign } from '../lib/plusvibe.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_SLUG = process.env.NEXT_PUBLIC_CLIENT_SLUG || 'philippe-bosquillon';
const CLIENT_CONFIG_PATH = join(__dir, '../clients/philippe-bosquillon.json');

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : (LIVE ? 20 : Infinity); // D4: first live run capped at 20

const RUN_DIR = join(__dir, `../runs/route_email_${new Date().toISOString().slice(0, 10)}`);

// D4.2 — contact choice per playbook БЛОК 5 Шаг 3. Title-keyword scored pick among a
// company's <=3 contacts, is_primary as tiebreak. Keyword lists are Leo/Philippe's
// routing intent from the playbook section, not literal text from it (БЛОК 5 names
// roles, not exact title strings) — flag to Leo if these miss real titles in practice.
const TITLE_KEYWORDS_BY_CLASS_OR_TYPE = {
  CLEVEL:  ['hr director', 'head of hr', 'human resources director', 'drh', 'ceo', 'managing director', 'geschäftsführer', 'directeur général', 'directeur des ressources humaines'],
  MA:      ['cfo', 'coo', 'chief financial', 'chief operating', 'directeur financier', 'directeur des opérations'],
  EXPAND:  ['plant director', 'plant manager', 'werksleiter', 'directeur usine', 'ceo', 'general manager'],
  DEFAULT: ['hr director', 'head of hr', 'human resources director', 'drh', 'ceo', 'managing director'], // HIRING_* fallback
};

function pickContact(signalType, contacts) {
  if (!contacts.length) return null;
  const keywords = TITLE_KEYWORDS_BY_CLASS_OR_TYPE[signalType] || TITLE_KEYWORDS_BY_CLASS_OR_TYPE.DEFAULT;
  const scored = contacts.map(c => {
    const title = (c.title || '').toLowerCase();
    const score = keywords.some(kw => title.includes(kw)) ? 1 : 0;
    return { c, score };
  });
  scored.sort((a, b) => (b.score - a.score) || ((b.c.is_primary ? 1 : 0) - (a.c.is_primary ? 1 : 0)));
  return scored[0].c;
}

// Company's best ACTIVE signal — the one whose event_key/signal_type drives template +
// PlusVibe campaign choice. "Best" = highest signals.score (existing per-signal field,
// unaffected by rank_leads); rank_leads.mjs's own event grouping determines event_key.
function pickPrimarySignal(signalsForCompany) {
  const active = signalsForCompany.filter(s => s.status === 'active');
  if (!active.length) return null;
  return [...active].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
}

function loadClientConfig() {
  return JSON.parse(readFileSync(CLIENT_CONFIG_PATH, 'utf8'));
}

export async function run() {
  console.log(`\n=== route_email.mjs === mode=${LIVE ? `LIVE (limit=${LIMIT})` : 'DRY RUN'}`);
  console.log('NOTE: this stage depends on migration 005 (companies.tier/rank, signals.event_key,');
  console.log('channel_actions) — will error until Fable applies it and rank_leads.mjs has run.\n');

  mkdirSync(RUN_DIR, { recursive: true });
  const config = { mode: LIVE ? 'live' : 'dry_run', limit: LIMIT, date: new Date().toISOString() };
  writeFileSync(join(RUN_DIR, 'config.json'), JSON.stringify(config, null, 2));

  const clientId = await getClientId(CLIENT_SLUG);
  const clientConfig = loadClientConfig();
  const campaignMap = clientConfig.sequencer?.campaign_map || {};

  const runId = LIVE ? await startRun({ clientId, script: 'route_email', source: 'plusvibe_autopilot' }) : null;

  const [companies, signals, contacts, channelActionRows] = await Promise.all([
    selectAll('companies', { client_id: clientId }),
    selectAll('signals', { client_id: clientId }),
    selectAll('contacts', { client_id: clientId }),
    loadChannelActions(clientId, 'email').catch(e => { console.log(`[warn] channel_actions not queryable yet (expected pre-migration-005): ${e.message}`); return []; }),
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
    if (!c.company_id || !c.email) continue;
    if (!contactsByCompany.has(c.company_id)) contactsByCompany.set(c.company_id, []);
    contactsByCompany.get(c.company_id).push(c);
  }

  const tiered = companies.filter(c => ['T1', 'T2', 'T3'].includes(c.tier));
  console.log(`companies with a tier: ${tiered.length} (of ${companies.length} total — 0 expected until rank_leads.mjs has run)`);

  const candidates = [];
  for (const company of tiered) {
    const companyContacts = contactsByCompany.get(company.id) || [];
    if (!companyContacts.length) continue;

    const primarySignal = pickPrimarySignal(signalsByCompany.get(company.id) || []);
    if (!primarySignal || !primarySignal.event_key) continue; // no event_key yet = rank_leads hasn't grouped this company

    const key = channelActionKey(company.id, primarySignal.event_key);
    const existingAction = existingActions.get(key);
    if (existingAction && !isRetryable(existingAction)) continue; // terminal outcome, don't re-touch (e.g. already pushed or validated dead)

    const contact = pickContact(primarySignal.signal_type, companyContacts.slice(0, 3));
    if (!contact) continue;

    candidates.push({ company, signal: primarySignal, contact, existingAction });
    if (candidates.length >= LIMIT) break;
  }
  console.log(`candidates (tiered, has contact+email, no prior channel_action for this event): ${candidates.length}`);

  if (!candidates.length) {
    console.log('\nNothing to route. Likely reasons: migration 005 not applied yet, rank_leads.mjs has not run, or every eligible event is already actioned.');
    if (LIVE) await finishRun(runId, { status: 'success', stats: { scraped: 0, pushed: 0 } });
    return { candidates: 0, pushed: 0 };
  }

  // D2 validation cascade (LIVE only — per A5, exception granted for this flow specifically).
  let verdicts = new Map();
  if (LIVE) {
    const emails = candidates.map(c => c.contact.email.toLowerCase().trim());
    console.log(`\n[validation] running MV+BounceBan cascade on ${emails.length} emails...`);
    const { verdicts: v } = await validateBatch(emails, join(RUN_DIR, 'validation'));
    verdicts = v;
  }

  const plan = [];
  const manifestRows = [];

  for (const { company, signal, contact, existingAction } of candidates) {
    const cls = eventClass(signal.signal_type);
    const campaignId = campaignMap[cls] || null;
    const lang = langForCountry(company.hq_country);
    const marketFocus = marketFocusForCountry(company.hq_country);
    const email = contact.email.toLowerCase().trim();
    const verdict = LIVE ? (verdicts.get(email) || 'unknown') : 'not_checked_dry_run';

    const row = {
      company: company.name, tier: company.tier, rank: company.rank,
      signal_type: signal.signal_type, event_key: signal.event_key, eventClass: cls,
      campaignId, contact: contact.full_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
      contactTitle: contact.title, email, verdict, lang,
    };
    plan.push(row);

    if (!LIVE) continue;

    if (verdict !== 'sendable') {
      await upsertChannelAction({
        clientId, companyId: company.id, contactId: contact.id, eventKey: signal.event_key,
        channel: 'email', status: 'skipped_validation', detail: { verdict, email }, existing: existingAction,
      });
      await patch('contacts', 'id', [contact.id], { email_status: verdict === 'dead' ? 'invalid' : 'pending' });
      manifestRows.push({ ...row, action: 'skipped_validation' });
      continue;
    }

    if (!campaignId) {
      await upsertChannelAction({
        clientId, companyId: company.id, contactId: contact.id, eventKey: signal.event_key,
        channel: 'email', status: 'skipped_no_campaign', detail: { reason: `no campaign_map[${cls}] configured` }, existing: existingAction,
      });
      manifestRows.push({ ...row, action: 'skipped_no_campaign' });
      continue;
    }

    const templateKey = signal.signal_type; // rank_leads.mjs's signal_type values map 1:1 to copy_templates.json keys
    let copy;
    try {
      copy = await fillCopy({
        templateKey, rank: company.rank, lang,
        vars: {
          first_name: contact.first_name || contact.full_name || '',
          company: company.name, market_focus: marketFocus,
          exact_job_title: signal.title || '', job_title: signal.title || '',
        },
      });
    } catch (e) {
      manifestRows.push({ ...row, action: 'copy_failed', error: e.message });
      continue;
    }

    const pvVars = { subject_line: copy.subject_line, body_1: copy.body_1 };
    copy.followups.forEach((f, i) => { pvVars[`body_${i + 2}`] = f.body; });

    const pushResult = await addLeadsToCampaign(campaignId, [{
      email, first_name: contact.first_name || '', last_name: contact.last_name || '',
      company_name: company.name, custom_variables: pvVars,
    }], { skipIfInWorkspace: true });

    await upsertChannelAction({
      clientId, companyId: company.id, contactId: contact.id, eventKey: signal.event_key,
      channel: 'email', status: 'pushed',
      detail: { campaignId, templateKey, variant: copy.variantUsed, lang, pv: pushResult }, existing: existingAction,
    });
    await patch('contacts', 'id', [contact.id], { email_status: 'verified' });
    manifestRows.push({ ...row, action: 'pushed', pvUploaded: pushResult.uploaded });
  }

  console.log('\n=== WOULD-PUSH PLAN ===');
  console.table(plan.map(({ company, tier, signal_type, contact, email, verdict, eventClass: c }) => ({ company, tier, signal_type, contact, email, verdict, class: c })));

  writeFileSync(join(RUN_DIR, 'manifest.json'), JSON.stringify({ mode: LIVE ? 'live' : 'dry_run', candidates: candidates.length, rows: LIVE ? manifestRows : plan }, null, 2));

  if (LIVE) {
    const pushed = manifestRows.filter(r => r.action === 'pushed').length;
    await finishRun(runId, { status: 'success', stats: { scraped: candidates.length, pushed } });
    console.log(`\npushed: ${pushed} / ${candidates.length}`);
  } else {
    console.log(`\n${plan.length} leads would be routed. Rerun with --live after Leo says "запускай" (capped at --limit=20 for the first supervised push).`);
  }
  console.log('=== DONE ===');
  return { candidates: candidates.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e); process.exit(1); });
}
