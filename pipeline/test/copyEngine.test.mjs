// Run: node --test signals/pipeline/test/copyEngine.test.mjs
// lang: 'en' never calls OpenRouter (localizeBody short-circuits), so these run offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fill, variantForRank, langForCountry, marketFocusForCountry, getTemplate } from '../lib/copyEngine.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_PATH = join(__dir, '../config/copy_templates.json');

test('langForCountry matches A6 mapping', () => {
  assert.equal(langForCountry('DE'), 'de');
  assert.equal(langForCountry('AT'), 'de');
  assert.equal(langForCountry('CH'), 'de');
  assert.equal(langForCountry('FR'), 'fr');
  assert.equal(langForCountry('LU'), 'fr');
  assert.equal(langForCountry('NL'), 'nl');
  assert.equal(langForCountry('BE'), 'nl');
  assert.equal(langForCountry('US'), 'en');
});

test('marketFocusForCountry falls back to Europe for LU/CH/AT', () => {
  assert.equal(marketFocusForCountry('DE'), 'Germany');
  assert.equal(marketFocusForCountry('LU'), 'Europe');
  assert.equal(marketFocusForCountry('XX'), 'Europe');
});

test('variantForRank picks A/B/C by score, degrades to available letters', () => {
  assert.equal(variantForRank(8, ['A', 'B', 'C']), 'A');
  assert.equal(variantForRank(6, ['A', 'B', 'C']), 'B');
  assert.equal(variantForRank(2, ['A', 'B', 'C']), 'C');
  // HIRING_SURGE only has A/B — score 2 (would want C) degrades to A (nearest available)
  assert.equal(variantForRank(2, ['A', 'B']), 'A');
});

test('fill() interpolates variables and returns EN subject for HIRING_EXEC', async () => {
  const out = await fill({
    templateKey: 'HIRING_EXEC', rank: 8, lang: 'en',
    vars: { first_name: 'Anna', company: 'Testfood GmbH', exact_job_title: 'Plant Manager', market_focus: 'Germany', job_title: 'Plant Manager' },
  });
  assert.equal(out.variantUsed, 'A');
  assert.equal(out.subject_line, "someone I'd like to introduce");
  assert.ok(out.body_1.includes('Testfood GmbH'));
  assert.ok(out.body_1.includes('Plant Manager'));
  assert.ok(!out.body_1.includes('{company}'));
  assert.equal(out.followups.length, 3);
  assert.equal(out.followups[2].breakup, true);
});

test('fill() flags followup steps with no literal body instead of inventing copy', async () => {
  const out = await fill({
    templateKey: 'HIRING_SURGE', rank: 9, lang: 'en',
    vars: { first_name: 'Bob', company: 'Scale Foods', role_1: 'Plant Director', role_2: 'HR Director', market_focus: 'France' },
  });
  assert.equal(out.followups.length, 0); // all 4 HIRING_SURGE followup steps have body:null
  assert.equal(out.missingFollowups.length, 4);
});

test('fill() resolves CLEVEL li_variant_2 (HR/CEO nearby) distinctly from default appointee variant', async () => {
  const vars = { first_name: 'Chris', company: 'BigFood SA', market_focus: 'France' };
  const appointee = await fill({ templateKey: 'CLEVEL', rank: 8, lang: 'en', vars });
  const hrVariant = await fill({ templateKey: 'CLEVEL', rank: 8, lang: 'en', vars, liVariant: 'li_variant_2_hr_or_ceo_nearby' });
  assert.notEqual(appointee.li_connection_note, hrVariant.li_connection_note);
  assert.ok(/congratulations on the new role/i.test(appointee.li_connection_note));
  assert.ok(hrVariant.li_connection_note.includes('brought in new leadership'));
});

test('getTemplate throws on unknown key', () => {
  assert.throws(() => getTemplate('NOT_A_TEMPLATE'));
});

// ── copy_templates.json shape validation (Stage 3, docs/HANDOFF_2026-07-19_frontend_build.md) ──
//
// TODO.txt's originally planned migration (li_step1_connection/li_step2_qualify PER
// key, li_step3_call/li_followup promoted to TOP-LEVEL universal fields) turned out to
// be stale: it was written against the OLD v1 LinkedIn spec (2026-07-15). The REAL
// playbook was rewritten to v2 on 2026-07-17
// (clients/philippe-bosquillon/copy/copy_signals_linkedin.txt) and explicitly states
// "Follow-up'ов от Philippe НЕТ" — LinkedIn is connection note + first message ONLY,
// no step 3 call, no follow-up sequence, by design (any reply routes to Leo instead).
// copy_templates.json was already re-transcribed to match v2 on 2026-07-17
// (_meta.linkedin_resynced_at) and copyEngine.mjs/build_linkedin_queue.mjs already
// read the real field names (li_connection_note/li_first_message) correctly — nothing
// in the actual pipeline needed a migration. Fabricating li_step3_call/li_followup
// fields with no source content would also have re-introduced the rigid 3-step
// tracker ADR-009's OWN D2 decision explicitly rejected in the same document. These
// tests validate the REAL, current shape instead, so a future silent drift between
// the file and its consumers gets caught.
const TEMPLATES = JSON.parse(readFileSync(TEMPLATES_PATH, 'utf8'));

test('copy_templates.json: every template key has a usable LinkedIn shape', () => {
  for (const [key, t] of Object.entries(TEMPLATES.templates)) {
    const flat = t.li_connection_note !== undefined;
    const variant1 = t.li_variant_1_appointee;
    assert.ok(flat || variant1, `${key} has neither a flat li_connection_note nor li_variant_1_appointee`);
    if (flat) {
      assert.equal(typeof t.li_connection_note, 'string', `${key}.li_connection_note`);
      assert.equal(typeof t.li_first_message, 'string', `${key}.li_first_message`);
    } else {
      assert.equal(typeof variant1.li_connection_note, 'string', `${key}.li_variant_1_appointee.li_connection_note`);
      assert.equal(typeof variant1.li_first_message, 'string', `${key}.li_variant_1_appointee.li_first_message`);
    }
  }
});

test('copy_templates.json: every template key has at least one lettered email variant', () => {
  for (const [key, t] of Object.entries(TEMPLATES.templates)) {
    const letters = Object.keys(t.variants || {});
    assert.ok(letters.length >= 1, `${key} has no email variants`);
  }
});

test('copy_templates.json: no template key defines li_step1_connection/li_step2_qualify/li_step3_call/li_followup — the stale planned field names never landed', () => {
  for (const [key, t] of Object.entries(TEMPLATES.templates)) {
    assert.equal(t.li_step1_connection, undefined, `${key} has stale field li_step1_connection`);
    assert.equal(t.li_step2_qualify, undefined, `${key} has stale field li_step2_qualify`);
    assert.equal(t.li_step3_call, undefined, `${key} has stale field li_step3_call`);
    assert.equal(t.li_followup, undefined, `${key} has stale field li_followup`);
  }
  assert.equal(TEMPLATES.li_step3_call, undefined, 'no top-level li_step3_call');
  assert.equal(TEMPLATES.li_followup, undefined, 'no top-level li_followup');
});
