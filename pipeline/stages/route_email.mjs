#!/usr/bin/env node
// Email autopilot stage (D4, docs/HANDOFF_2026-07-15_scoring_two_channel.md) — runs
// weekly after rank_leads.mjs. For every tiered company (T1/T2/T3 alike — email is
// the baseline channel per A3, independent of LinkedIn) with a contact that has an
// email, validates it via the MV+BounceBan cascade, generates per-lead copy from the
// playbook, and pushes to the matching PlusVibe evergreen campaign.
//
// STATUS: migration 005 is live (verified 2026-07-19 via a real REST query —
// companies.tier/rank/event_key all populated). Migration 008 (2026-07-19) widened
// channel_actions' unique constraint to include contact_id — see channelActions.mjs.
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
import { needsValidation } from '../lib/emailValidationPolicy.mjs';
import { fill as fillCopy, langForCountry, marketFocusForCountry, casualCompanyName } from '../lib/copyEngine.mjs';
import { addLeadsToCampaign } from '../lib/plusvibe.mjs';
import { classifyEvent } from '../lib/eventGrouping.mjs';

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

  mkdirSync(RUN_DIR, { recursive: true });
  const config = { mode: LIVE ? 'live' : 'dry_run', limit: LIMIT, date: new Date().toISOString() };
  writeFileSync(join(RUN_DIR, 'config.json'), JSON.stringify(config, null, 2));

  const clientId = await getClientId(CLIENT_SLUG);
  const clientConfig = loadClientConfig();
  const campaignMap = clientConfig.sequencer?.campaign_map || {};

  // sequencer.auto_push used to be pure config-as-documentation — never actually checked
  // anywhere. Found live 2026-08-02: campaign_map got populated (real campaign created,
  // still DRAFT/0 leads) WHILE copy_templates.json was still pending Leo's review — without
  // this gate, the very next --live run (weekly cron, or its daily retry) would have
  // started pushing real un-reviewed copy the moment campaign_map stopped being empty.
  if (LIVE && clientConfig.sequencer?.auto_push !== true) {
    console.log(`\n*** sequencer.auto_push is not true in pipeline/clients/${CLIENT_SLUG}.json — refusing to push live. Set it to true once the copy/campaign are approved. ***`);
    return { candidates: 0, pushed: 0, blockedByAutoPush: true };
  }

  const runId = LIVE ? await startRun({ clientId, script: 'route_email', source: 'plusvibe_autopilot' }) : null;

  const [companies, signals, contacts, channelActionRows] = await Promise.all([
    selectAll('companies', { client_id: clientId }),
    selectAll('signals', { client_id: clientId }),
    selectAll('contacts', { client_id: clientId }),
    loadChannelActions(clientId, 'email').catch(e => { console.log(`[warn] channel_actions query failed: ${e.message}`); return []; }),
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

    // Contact picked BEFORE the existingActions lookup (migration 008): the dedup
    // key is now per-contact, not just per-company/event, so contact_id must be
    // known first.
    const contact = pickContact(primarySignal.signal_type, companyContacts.slice(0, 3));
    if (!contact) continue;

    const key = channelActionKey(company.id, contact.id, primarySignal.event_key);
    const existingAction = existingActions.get(key);
    if (existingAction && !isRetryable(existingAction)) continue; // terminal outcome, don't re-touch (e.g. already pushed or validated dead)

    candidates.push({ company, signal: primarySignal, contact, existingAction });
    if (candidates.length >= LIMIT) break;
  }
  console.log(`candidates (tiered, has contact+email, no prior channel_action for this event): ${candidates.length}`);

  if (!candidates.length) {
    console.log('\nNothing to route. Likely reasons: rank_leads.mjs has not run recently, or every eligible event is already actioned.');
    if (LIVE) await finishRun(runId, { status: 'success', stats: { scraped: 0, pushed: 0 } });
    return { candidates: 0, pushed: 0 };
  }

  // D2 validation cascade (LIVE only — per A5, exception granted for this flow specifically).
  // B-D3 (PLAN_2026-07-18_backend_hardening.md): validate_contacts.mjs is now the
  // primary weekly validator — trust its recent verdict instead of re-spending here.
  // This inline path is a safety net for contacts it hasn't reached yet (created
  // mid-week, or the weekly stage hasn't run since migration 006 landed).
  let verdicts = new Map();
  let freshlyValidatedIds = new Set();
  if (LIVE) {
    const trusted = candidates.filter(c => c.contact.email_status === 'verified' && !needsValidation(c.contact));
    const toCheck = candidates.filter(c => !trusted.includes(c));
    for (const c of trusted) verdicts.set(c.contact.email.toLowerCase().trim(), 'sendable');

    if (toCheck.length) {
      const emails = toCheck.map(c => c.contact.email.toLowerCase().trim());
      console.log(`\n[validation] ${trusted.length} trusted from validate_contacts.mjs, running MV+BounceBan cascade on ${emails.length} fresh/stale emails...`);
      const { verdicts: v } = await validateBatch(emails, join(RUN_DIR, 'validation'));
      for (const [email] of v) freshlyValidatedIds.add(email);
      verdicts = new Map([...verdicts, ...v]);
    } else {
      console.log(`\n[validation] all ${trusted.length} candidates already trusted from validate_contacts.mjs — no spend.`);
    }
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

    // Only stamp email_validated_at when THIS run actually called the cascade —
    // a trusted (already-recent) verdict shouldn't get its timestamp bumped for
    // free, that would defeat validate_contacts.mjs's 90-day re-check window.
    const validatedHere = freshlyValidatedIds.has(email);
    const validationPatch = validatedHere
      ? { email_validated_at: new Date().toISOString(), email_validation_detail: { verdict, cascade: 'mv+bounceban', run_id: runId } }
      : {};

    if (verdict !== 'sendable') {
      await upsertChannelAction({
        clientId, companyId: company.id, contactId: contact.id, eventKey: signal.event_key,
        channel: 'email', status: 'skipped_validation', detail: { verdict, email }, existing: existingAction,
      });
      await patch('contacts', 'id', [contact.id], { email_status: verdict === 'dead' ? 'invalid' : 'pending', ...validationPatch });
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

    // BUG FOUND LIVE 2026-08-02: signals.signal_type is only ever the coarse DB value
    // ('HIRING', never 'HIRING_EXEC'/'HIRING_MID'/'HIRING_STALE') — the granular split
    // is computed by rank_leads.mjs's eventGrouping.mjs purely in-memory for tier/rank
    // scoring and never written back. Using signal.signal_type directly as templateKey
    // meant every HIRING signal (536/1000 = 54% of all real signal volume) failed
    // copyEngine.mjs's getTemplate() with "unknown template key: HIRING", silently
    // logged as copy_failed. Reuses classifyEvent() — the exact same logic rank_leads.mjs
    // already uses — on a synthetic single-member event instead of duplicating the
    // EXEC/MID/STALE title-band + age logic here. HIRING_SURGE (2+ simultaneous open
    // postings at one company) is a company-level aggregate computed elsewhere in
    // eventGrouping.mjs and NOT reproduced here — a surge still correctly lands on
    // HIRING_EXEC/HIRING_MID, just without the surge-specific copy variant.
    // HIRING_SURGE detection (2026-08-02): classifyEvent() alone never returns SURGE —
    // that's a company-level aggregate (2+ simultaneous open roles), not a single-signal
    // property, computed separately in eventGrouping.mjs's own rank_leads-only pass and
    // never reused here before now. Reusing signalsByCompany (already built above for
    // pickPrimarySignal) to detect it here too, now that the AI hook can actually make
    // use of a real role count via hookContext instead of needing hardcoded {role_1}/
    // {role_2} slots.
    const companyActiveHiring = (signalsByCompany.get(company.id) || []).filter(s => s.signal_type === 'HIRING' && s.status === 'active');
    let templateKey, hookContext = '';
    if (signal.signal_type === 'HIRING') {
      if (companyActiveHiring.length >= 2) {
        templateKey = 'HIRING_SURGE';
        hookContext = `there are ${companyActiveHiring.length} distinct senior roles open at this company right now`;
      } else {
        templateKey = classifyEvent({ baseType: 'HIRING', pubDate: signal.pub_date, members: [{ title: signal.title }] }).type;
        if (templateKey === 'HIRING_STALE' && signal.pub_date) {
          const daysOpen = Math.floor((Date.now() - new Date(signal.pub_date).getTime()) / 86_400_000);
          hookContext = `this exact posting has been open for about ${daysOpen} days`;
        }
      }
    } else {
      templateKey = signal.signal_type;
    }

    const casualName = casualCompanyName(company.name);
    // event_summary (multi-source-confirmed events, rank_leads.mjs's summarizeEvent())
    // is richer/more reliable than a single raw headline when it exists — falls back to
    // the raw title otherwise. Same real fact either way, just better-condensed when available.
    const fact = signal.event_summary || signal.title || '';

    let copy;
    try {
      copy = await fillCopy({
        templateKey, rank: company.rank, lang,
        vars: {
          first_name: contact.first_name || contact.full_name || '',
          company: casualName, market_focus: marketFocus,
          exact_job_title: signal.title || '', job_title: signal.title || '',
        },
        fact, hookContext,
      });
    } catch (e) {
      manifestRows.push({ ...row, action: 'copy_failed', error: e.message });
      continue;
    }

    // event_class/signal_type as plain PlusVibe custom fields (2026-08-02, Leo's call) —
    // one shared campaign for all three classes instead of three separate campaigns,
    // these make the class/type filterable/reportable inside PlusVibe's own UI.
    const pvVars = { subject_line: copy.subject_line, body_1: copy.body_1, event_class: cls, signal_type: signal.signal_type };
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
    await patch('contacts', 'id', [contact.id], { email_status: 'verified', ...validationPatch });
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
