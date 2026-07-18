// Run: node --test signals/pipeline/test/staleness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stalenessDays, expiresAt, isStale } from '../lib/staleness.mjs';

test('stalenessDays reads per-type windows from icp_filter.json', () => {
  assert.equal(stalenessDays('CLEVEL'), 30);
  assert.equal(stalenessDays('MA'), 90);
  assert.equal(stalenessDays('HIRING'), 90);
  assert.equal(stalenessDays('EXPAND'), 60);
});

test('stalenessDays falls back to 30d for unknown types', () => {
  assert.equal(stalenessDays('SOME_NEW_TYPE'), 30);
});

test('expiresAt adds the right number of days to pub_date', () => {
  const got = expiresAt('CLEVEL', '2026-07-01T00:00:00.000Z');
  assert.equal(got, '2026-07-31T00:00:00.000Z');
});

test('expiresAt defaults to now when pub_date missing', () => {
  const before = Date.now();
  const got = new Date(expiresAt('MA', null)).getTime();
  const expectedMin = before + 90 * 86_400_000 - 5000; // 5s slack for test runtime
  assert.ok(got >= expectedMin, `expected ${got} >= ${expectedMin}`);
});

test('isStale respects per-type window', () => {
  const now = new Date('2026-08-01T00:00:00.000Z').getTime();
  // CLEVEL window is 30d — a signal from 2026-07-01 is 31 days old at 2026-08-01
  assert.equal(isStale('CLEVEL', '2026-07-01T00:00:00.000Z', now), true);
  // MA window is 90d — same date is well within window
  assert.equal(isStale('MA', '2026-07-01T00:00:00.000Z', now), false);
});
