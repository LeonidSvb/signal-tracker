// Run: node --test signals/pipeline/test/emailValidationPolicy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsValidation, STALE_DAYS } from '../lib/emailValidationPolicy.mjs';

const NOW = new Date('2026-07-18T00:00:00.000Z').getTime();

test('no email -> never needs validation', () => {
  assert.equal(needsValidation({ email: null, email_status: null, email_validated_at: null }, NOW), false);
});

test('never validated -> needs validation', () => {
  assert.equal(needsValidation({ email: 'a@b.com', email_status: 'inferred', email_validated_at: null }, NOW), true);
});

test('invalid is terminal -> never re-validated, regardless of age', () => {
  assert.equal(needsValidation({ email: 'a@b.com', email_status: 'invalid', email_validated_at: null }, NOW), false);
  const oldDate = new Date(NOW - 500 * 86_400_000).toISOString();
  assert.equal(needsValidation({ email: 'a@b.com', email_status: 'invalid', email_validated_at: oldDate }, NOW), false);
});

test('fresh verified (< 90d) -> trusted, no re-validation', () => {
  const recent = new Date(NOW - 10 * 86_400_000).toISOString();
  assert.equal(needsValidation({ email: 'a@b.com', email_status: 'verified', email_validated_at: recent }, NOW), false);
});

test('stale verified (>= 90d) -> needs re-validation', () => {
  assert.equal(STALE_DAYS, 90);
  const stale = new Date(NOW - 90 * 86_400_000).toISOString();
  assert.equal(needsValidation({ email: 'a@b.com', email_status: 'verified', email_validated_at: stale }, NOW), true);
  const justUnder = new Date(NOW - 89 * 86_400_000).toISOString();
  assert.equal(needsValidation({ email: 'a@b.com', email_status: 'verified', email_validated_at: justUnder }, NOW), false);
});

test('pending (unknown/risky verdict) still re-checked once stale', () => {
  const stale = new Date(NOW - 91 * 86_400_000).toISOString();
  assert.equal(needsValidation({ email: 'a@b.com', email_status: 'pending', email_validated_at: stale }, NOW), true);
});
