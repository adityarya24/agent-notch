const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PERSISTED_QUOTA_TTL_MS,
  createQuotaSnapshot,
  parseQuotaSnapshot,
  readQuotaCache,
  writeQuotaCache
} = require('../electron/quota-cache');

const now = Date.parse('2026-09-01T13:00:00.000Z');
const known = {
  models: [{
    id: 'claude',
    name: 'Claude Code',
    provider: 'Anthropic · Claude',
    icon: 'claude',
    quotaState: 'known',
    authState: 'signed_in',
    status: 'critical',
    ringPercent: 89,
    sessionUsedPercent: 36,
    weeklyUsedPercent: 89,
    sessionResetText: 'Resets in 1h',
    weeklyResetText: 'Resets in 1d',
    observedAt: new Date(now - 60_000).toISOString(),
    accessToken: 'must-not-persist',
    rawResponse: { secret: true }
  }],
  config: { customAgents: [{ command: 'private-command' }] }
};

test('snapshot persists only whitelisted quota display fields', () => {
  const snapshot = createQuotaSnapshot(known, now);
  assert.equal(snapshot.models.length, 1);
  assert.equal(snapshot.models[0].weeklyUsedPercent, 89);
  assert.equal(snapshot.models[0].accessToken, undefined);
  assert.equal(snapshot.models[0].rawResponse, undefined);
  assert.equal(snapshot.config, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /must-not-persist|private-command|secret/);
});

test('persisted readings load as stale and expire after the bounded TTL', () => {
  const snapshot = createQuotaSnapshot(known, now);
  const loaded = parseQuotaSnapshot(snapshot, now);
  assert.equal(loaded.models[0].ringPercent, 89);
  assert.equal(loaded.models[0].stale, true);
  assert.equal(loaded.models[0].staleAgeMs, 60_000);
  assert.equal(
    parseQuotaSnapshot(snapshot, now + PERSISTED_QUOTA_TTL_MS + 1),
    null
  );
});

test('cache file round-trips atomically and malformed files fail closed', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'quota-cache.json');
  assert.equal(writeQuotaCache(filePath, known, now), true);
  const loaded = readQuotaCache(filePath, now);
  assert.equal(loaded.models[0].sessionUsedPercent, 36);
  assert.equal(fs.existsSync(`${filePath}.${process.pid}.tmp`), false);

  fs.writeFileSync(filePath, '{not-json', 'utf8');
  assert.equal(readQuotaCache(filePath, now), null);
});

test('unknown-only data never overwrites the last successful snapshot', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'quota-cache.json');
  assert.equal(writeQuotaCache(filePath, known, now), true);
  const before = fs.readFileSync(filePath, 'utf8');
  assert.equal(writeQuotaCache(filePath, { models: [{ id: 'claude', quotaState: 'unknown' }] }, now), false);
  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
});
