// Run: node --test signals/pipeline/test/plusvibe.test.mjs
// Only exercises the pure builder functions — no network, no PV_API_KEY needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignSettings, buildCampaignSequences } from '../lib/plusvibe.mjs';

test('buildCampaignSettings applies A6 defaults (esp match, bounce guard, stop on reply)', () => {
  const s = buildCampaignSettings({ schedule: { dailyLimit: 50 } });
  assert.equal(s.is_esp_match, 'yes');
  assert.equal(s.stop_on_lead_replied, 'yes');
  assert.equal(s.is_pause_on_bouncerate, 'yes');
  assert.equal(s.bounce_rate_limit, 8);
  assert.equal(s.is_emailopened_tracking, 'no');
  assert.equal(s.is_unsubscribed_link, 'no');
  assert.equal(s.schedules.daily_limit, 50);
  assert.equal(s.schedules.tz, 'Europe/Berlin');
});

test('buildCampaignSettings omits schedules block when no schedule passed', () => {
  const s = buildCampaignSettings({});
  assert.equal(s.schedules, undefined);
});

test('buildCampaignSequences converts day offsets to minutes and wraps single-variant steps', () => {
  const seq = buildCampaignSequences([
    { subject: 'S1', body: 'B1', waitDays: 0 },
    { subject: 'S2', body: 'B2', waitDays: 3 },
  ]);
  assert.equal(seq.length, 2);
  assert.equal(seq[0].step, 1);
  assert.equal(seq[0].wait_time, 0);
  assert.equal(seq[1].wait_time, 3 * 24 * 60);
  assert.equal(seq[1].variations[0].subject, 'S2');
  assert.equal(seq[1].variations[0].name, 'Step 2A');
});
