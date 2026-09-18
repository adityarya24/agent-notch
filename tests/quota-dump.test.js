const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { writeQuotaCache } = require('../electron/quota-cache');
const { buildQuotaDump } = require('../electron/quota-dump');

const cli = path.join(__dirname, '..', 'bin', 'cli.js');
const now = Date.parse('2026-09-18T04:00:00.000Z');
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
    alertThreshold: 80,
    sessionResetText: 'Resets in 1h',
    weeklyResetText: 'Resets in 1d',
    observedAt: new Date(now - 60_000).toISOString(),
    accessToken: 'must-not-dump',
    rawResponse: { secret: true }
  }]
};

test('dump is false-closed when there is no snapshot', () => {
  assert.deepEqual(buildQuotaDump(null), {
    ok: false,
    source: 'cache',
    reason: 'no-cache',
    models: []
  });
  assert.deepEqual(buildQuotaDump({ models: [] }), {
    ok: false,
    source: 'cache',
    reason: 'empty',
    models: []
  });
});

test('dump keeps display fields and drops secrets', () => {
  const dump = buildQuotaDump({
    lastUpdated: new Date(now).toISOString(),
    models: [{
      ...known.models[0],
      stale: true,
      staleAgeMs: 60_000,
      lastError: 'Waiting for a fresh quota reading'
    }]
  });
  assert.equal(dump.ok, true);
  assert.equal(dump.source, 'cache');
  assert.equal(dump.models.length, 1);
  assert.equal(dump.models[0].id, 'claude');
  assert.equal(dump.models[0].weeklyUsedPercent, 89);
  assert.equal(dump.models[0].stale, true);
  assert.equal(dump.models[0].accessToken, undefined);
  assert.equal(dump.models[0].rawResponse, undefined);
  assert.doesNotMatch(JSON.stringify(dump), /must-not-dump|secret/);
});

function runQuotaCli(stateDir, extraArgs = ['quota']) {
  return spawnSync(process.execPath, [cli, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, NOTCH_STATE_DIR: stateDir },
    timeout: 8000
  });
}

function liveKnown(at = Date.now()) {
  return {
    models: [{
      ...known.models[0],
      observedAt: new Date(at - 60_000).toISOString()
    }]
  };
}

test('notch quota prints cache JSON without starting the HUD', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-quota-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = Date.now();
  assert.equal(writeQuotaCache(path.join(dir, 'quota-cache.json'), liveKnown(at), at), true);

  const result = runQuotaCli(dir, ['quota']);
  assert.equal(result.status, 0, result.stderr);
  const dump = JSON.parse(result.stdout);
  assert.equal(dump.ok, true);
  assert.equal(dump.models[0].id, 'claude');
  assert.equal(dump.models[0].ringPercent, 89);
  assert.doesNotMatch(result.stdout, /must-not-dump|Agent Notch is RUNNING|Building HUD/);
});

test('notch --json is an alias and missing cache exits 1', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-quota-empty-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const missing = runQuotaCli(dir, ['--json']);
  assert.equal(missing.status, 1);
  const empty = JSON.parse(missing.stdout);
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'no-cache');

  const at = Date.now();
  assert.equal(writeQuotaCache(path.join(dir, 'quota-cache.json'), liveKnown(at), at), true);
  const alias = runQuotaCli(dir, ['--json']);
  assert.equal(alias.status, 0, alias.stderr);
  assert.equal(JSON.parse(alias.stdout).ok, true);

  const undocumented = runQuotaCli(dir, ['json']);
  assert.equal(undocumented.status, 1);
  assert.match(undocumented.stderr, /Unknown command: json/);
});
