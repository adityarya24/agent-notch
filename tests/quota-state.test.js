const assert = require('node:assert/strict');
const test = require('node:test');

const { keepLastKnown, quotaFingerprint } = require('../electron/quota-state');

const start = Date.parse('2026-08-31T10:00:00.000Z');
const known = {
  models: [{
    id: 'codex',
    quotaState: 'known',
    ringPercent: 42,
    sessionUsedPercent: 42,
    weeklyUsedPercent: 30,
    observedAt: new Date(start).toISOString()
  }]
};

test('a failed refresh preserves a clearly marked recent reading', () => {
  const next = { models: [{ id: 'codex', quotaState: 'unknown', attemptedAt: new Date(start + 1000).toISOString(), sessionResetText: 'offline' }] };
  const merged = keepLastKnown(known, next, start + 60_000, 300_000);
  assert.equal(merged.models[0].ringPercent, 42);
  assert.equal(merged.models[0].stale, true);
  assert.equal(merged.models[0].staleAgeMs, 60_000);
  assert.equal(merged.models[0].lastError, 'offline');
});

test('a stale reading expires after its TTL', () => {
  const next = { models: [{ id: 'codex', quotaState: 'unknown', sessionResetText: 'offline' }] };
  const merged = keepLastKnown(known, next, start + 300_001, 300_000);
  assert.equal(merged.models[0].quotaState, 'unknown');
  assert.equal(merged.models[0].ringPercent, undefined);
});

test('fresh known data clears stale state and affects fingerprints', () => {
  const fresh = { models: [{ ...known.models[0], ringPercent: 43, stale: true }] };
  const merged = keepLastKnown(known, fresh, start + 1000, 300_000);
  assert.equal(merged.models[0].stale, false);
  assert.notEqual(quotaFingerprint(known), quotaFingerprint(merged));
});
