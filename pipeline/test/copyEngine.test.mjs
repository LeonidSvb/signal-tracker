// Run: node --test signals/pipeline/test/copyEngine.test.mjs
// lang: 'en' never calls OpenRouter (localizeBody short-circuits), so these run offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fill, variantForRank, langForCountry, marketFocusForCountry, getTemplate } from '../lib/copyEngine.mjs';

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
