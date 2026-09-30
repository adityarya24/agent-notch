const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { _test, getAllInstalledAgentUsage, probeCli, saveLocalConfig } = require('../electron/scrapers');

test.beforeEach(() => _test.resetReaderCache());

test('alert threshold controls warning and critical status', () => {
  assert.equal(_test.quotaStatus(49, 80), 'normal');
  assert.equal(_test.quotaStatus(50, 80), 'warning');
  assert.equal(_test.quotaStatus(79, 80), 'warning');
  assert.equal(_test.quotaStatus(80, 80), 'critical');
  assert.equal(_test.quotaStatus(69, 70), 'warning');
  assert.equal(_test.quotaStatus(70, 70), 'critical');
});

test('ring uses the highest available quota window', () => {
  const result = _test.attachRing({
    quotaState: 'known',
    sessionUsedPercent: 31,
    weeklyUsedPercent: 67
  }, 90);
  assert.equal(result.ringPercent, 67);
  assert.equal(result.status, 'warning');
});

test('Grok billing parser preserves legacy percentage fields', () => {
  const result = _test.parseGrokBillingConfig({
    creditUsagePercent: 42,
    productUsage: [{ usagePercent: 17 }]
  });
  assert.equal(result.weeklyUsed, 42);
  assert.equal(result.sessionUsed, 17);
});

test('Grok billing parser falls back to legacy included-credit totals', () => {
  const result = _test.parseGrokBillingConfig({
    monthlyLimit: { val: 80 },
    used: { val: 20 }
  });
  assert.equal(result.weeklyUsed, 25);
  assert.equal(result.sessionUsed, null);
});

test('Grok billing parser caps exhausted legacy usage at 100 percent', () => {
  const result = _test.parseGrokBillingConfig({
    monthlyLimit: { val: 80 },
    used: { val: 120 }
  });
  assert.equal(result.weeklyUsed, 100);
});

test('Grok billing parser distinguishes a missing total from an encoded zero', () => {
  const missing = _test.parseGrokBillingConfig({ monthlyLimit: { val: 80 } });
  assert.equal(missing.weeklyUsed, null);

  const zero = _test.parseGrokBillingConfig({ monthlyLimit: { val: 80 }, used: {} });
  assert.equal(zero.weeklyUsed, 0);
});

test('Grok billing parser does not treat on-demand spend as included quota', () => {
  const result = _test.parseGrokBillingConfig({
    onDemandCap: { val: 80 },
    onDemandUsed: { val: 20 }
  });
  assert.equal(result.weeklyUsed, null);
  assert.equal(result.sessionUsed, null);
});

test('signed-in providers can report unavailable quota without becoming expired', () => {
  const result = _test.detectedCard({
    id: 'grok',
    name: 'Grok',
    provider: 'xAI',
    icon: 'grok',
    quotaState: 'unknown',
    authState: 'signed_in'
  });
  assert.equal(result.quotaState, 'unknown');
  assert.equal(result.authState, 'signed_in');
  assert.equal(result.ringPercent, null);
});

test('Grok billing response separates expired auth from provider failures', () => {
  const expired = _test.grokBillingCardFromResponse({ status: 401, json: {} });
  assert.equal(expired.quotaState, 'expired');
  assert.equal(expired.authState, 'expired');

  const unavailable = _test.grokBillingCardFromResponse({ status: 500, json: {} });
  assert.equal(unavailable.quotaState, 'unknown');
  assert.equal(unavailable.authState, 'signed_in');
});

test('Grok accepted response stays signed in when percentage is not exposed', () => {
  const result = _test.grokBillingCardFromResponse({
    status: 200,
    json: { config: { currentPeriod: { end: '2099-01-01T00:00:00Z' } } }
  });
  assert.equal(result.quotaState, 'unknown');
  assert.equal(result.authState, 'signed_in');
  assert.equal(result.ringPercent, null);
});

test('Codex windows are classified by duration instead of response position', () => {
  const result = _test.parseCodexWindows({
    primary_window: {
      used_percent: 50,
      limit_window_seconds: 7 * 24 * 60 * 60,
      reset_at: 1_800_000_000
    },
    secondary_window: null
  });

  assert.equal(result.session, null);
  assert.deepEqual(result.weekly, {
    percent: 50,
    resetAt: 1_800_000_000,
    label: 'Weekly'
  });
});

test('Codex supports simultaneous and reversed 5h and weekly windows', () => {
  const result = _test.parseCodexWindows({
    primary_window: { used_percent: 61, limit_window_seconds: 7 * 24 * 60 * 60 },
    secondary_window: { used_percent: 24, limit_window_seconds: 5 * 60 * 60 }
  });

  assert.equal(result.session.percent, 24);
  assert.equal(result.session.label, '5h session');
  assert.equal(result.weekly.percent, 61);
  assert.equal(result.weekly.label, 'Weekly');
});

test('Codex keeps positional compatibility when duration metadata is absent', () => {
  const result = _test.parseCodexWindows({
    primary_window: { usage_percent: 12 },
    secondary_window: { usage_percent: 34 }
  });

  assert.equal(result.session.percent, 12);
  assert.equal(result.session.label, '5h session');
  assert.equal(result.weekly.percent, 34);
  assert.equal(result.weekly.label, 'Weekly');
});

test('Codex labels nonstandard multi-day limits as plan windows', () => {
  const result = _test.parseCodexWindows({
    primary_window: { used_percent: 9, limit_window_seconds: 2 * 24 * 60 * 60 }
  });

  assert.equal(result.session, null);
  assert.equal(result.weekly.percent, 9);
  assert.equal(result.weekly.label, '2d window');
});

test('Codex does not call a nonstandard short window 5h', () => {
  const result = _test.parseCodexWindows({
    primary_window: { used_percent: 4, limit_window_seconds: 90 * 60 }
  });

  assert.equal(result.session.label, '90m session');
  assert.equal(result.weekly, null);
});

test('reader polling is single-flight and cached', async () => {
  let calls = 0;
  const entry = {
    id: 'test_single_flight',
    read: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { quotaState: 'known', ringPercent: 20 };
    }
  };
  const [first, second] = await Promise.all([
    _test.readWithCache(entry, { now: 1000 }),
    _test.readWithCache(entry, { now: 1000 })
  ]);
  const cached = await _test.readWithCache(entry, { now: 2000 });
  assert.equal(calls, 1);
  assert.equal(first.observedAt, second.observedAt);
  assert.equal(cached.ringPercent, 20);
});

test('unavailable readers back off instead of polling repeatedly', async () => {
  let calls = 0;
  const entry = { id: 'test_backoff', read: async () => { calls += 1; return null; } };
  await _test.readWithCache(entry, { now: 1000 });
  await _test.readWithCache(entry, { now: 2000 });
  assert.equal(calls, 1);
  await _test.readWithCache(entry, { now: 61_001 });
  assert.equal(calls, 2);
});

test('disabled providers are filtered before any reader runs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-disabled-'));
  process.env.NOTCH_CONFIG_DIR = root;
  process.env.NOTCH_LEGACY_CONFIG_PATH = path.join(root, 'missing-legacy.json');
  try {
    saveLocalConfig({
      enabledModels: {
        codex: false,
        claude: false,
        gemini: false,
        cursor: false,
        opencode: false,
        grok: false
      }
    });
    const result = await getAllInstalledAgentUsage({ force: true, now: 1000 });
    assert.deepEqual(result.models, []);
    assert.equal(result.allDetectedIds.length, 6);
  } finally {
    delete process.env.NOTCH_CONFIG_DIR;
    delete process.env.NOTCH_LEGACY_CONFIG_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('custom providers persist and render manual, command, and failure states', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-custom-'));
  const goodScript = path.join(root, 'quota-ok.js');
  const badScript = path.join(root, 'quota-fail.js');
  fs.writeFileSync(goodScript, "process.stdout.write(JSON.stringify({name:'Fixture Agent',sessionUsedPercent:74,weeklyUsedPercent:33,sessionResetText:'Session fixture',weeklyResetText:'Weekly fixture'}));\n", 'utf8');
  fs.writeFileSync(badScript, 'process.exit(7);\n', 'utf8');
  process.env.NOTCH_CONFIG_DIR = root;
  process.env.NOTCH_LEGACY_CONFIG_PATH = path.join(root, 'missing-legacy.json');
  try {
    const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
    const saved = saveLocalConfig({
      enabledModels: {
        codex: false,
        claude: false,
        gemini: false,
        cursor: false,
        opencode: false,
        grok: false,
        custom_manual: true,
        custom_command: true,
        custom_failure: true,
        custom_disabled: false
      },
      alertThreshold: 80,
      modelOrder: ['custom_command', 'custom_manual', 'custom_failure', 'custom_disabled'],
      customAgents: [
        {
          id: 'custom_manual',
          name: 'Manual Agent',
          provider: 'Local',
          quotaSource: 'manual',
          activityProcess: 'fixture-agent',
          sessionUsedPercent: 28,
          weeklyUsedPercent: 61,
          icon: 'spark'
        },
        {
          id: 'custom_command',
          name: 'Command Agent',
          provider: 'Fixture',
          quotaSource: 'command',
          command: `${quote(process.execPath)} ${quote(goodScript)}`,
          icon: 'codex'
        },
        {
          id: 'custom_failure',
          name: 'Broken Agent',
          quotaSource: 'command',
          command: `${quote(process.execPath)} ${quote(badScript)}`
        },
        {
          id: 'custom_disabled',
          name: 'Disabled Agent',
          quotaSource: 'manual',
          sessionUsedPercent: 99
        }
      ]
    });
    assert.equal(saved.customAgents.length, 4);
    assert.equal(saved.customAgents.find((agent) => agent.id === 'custom_manual').activityProcess, 'fixture-agent');

    const result = await getAllInstalledAgentUsage({ force: true, now: 10_000 });
    assert.deepEqual(result.models.map((model) => model.id), ['custom_command', 'custom_manual', 'custom_failure']);
    assert.equal(result.allDetectedIds.length, 10);

    const command = result.models.find((model) => model.id === 'custom_command');
    assert.equal(command.name, 'Fixture Agent');
    assert.equal(command.ringPercent, 74);
    assert.equal(command.quotaState, 'known');
    assert.equal(command.sessionResetText, 'Session fixture');
    assert.equal(command.weeklyResetText, 'Weekly fixture');

    const manual = result.models.find((model) => model.id === 'custom_manual');
    assert.equal(manual.ringPercent, 61);
    assert.equal(manual.quotaState, 'known');

    const failure = result.models.find((model) => model.id === 'custom_failure');
    assert.equal(failure.quotaState, 'unknown');
    assert.equal(failure.ringPercent, null);
    assert.equal(failure.sessionResetText, 'Custom command failed');
    assert.ok(fs.existsSync(path.join(root, 'config.json')));
  } finally {
    delete process.env.NOTCH_CONFIG_DIR;
    delete process.env.NOTCH_LEGACY_CONFIG_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI probe accepts an executable name but rejects shell expressions', async () => {
  const executable = process.platform === 'win32' ? 'node.exe' : 'node';
  const found = await probeCli(executable);
  assert.equal(found.found, true);
  assert.ok(found.path);
  assert.deepEqual(await probeCli('node --version'), { found: false, path: null });
});

test('per-reader poll interval overrides the default cadence', async () => {
  let calls = 0;
  const entry = {
    id: 'test_slow_poll',
    pollMs: 300_000,
    read: async () => { calls += 1; return { quotaState: 'known', ringPercent: 10 }; }
  };
  await _test.readWithCache(entry, { now: 1000 });
  await _test.readWithCache(entry, { now: 61_001 });
  assert.equal(calls, 1);
  await _test.readWithCache(entry, { now: 301_001 });
  assert.equal(calls, 2);
});

test('a rate limited reader keeps serving the last known reading', async () => {
  let calls = 0;
  const entry = {
    id: 'test_rate_limit_hold',
    read: async () => {
      calls += 1;
      return calls === 1
        ? { quotaState: 'known', ringPercent: 42 }
        : { quotaState: 'unknown', rateLimited: true, retryAfterMs: 300_000 };
    }
  };
  await _test.readWithCache(entry, { now: 1000 });
  const limited = await _test.readWithCache(entry, { now: 61_001 });
  assert.equal(calls, 2);
  assert.equal(limited.quotaState, 'known');
  assert.equal(limited.ringPercent, 42);
  assert.equal(limited.rateLimited, true);
});

test('a rate-limit cooldown cannot be bypassed by a forced refresh', async () => {
  let calls = 0;
  const entry = {
    id: 'test_rate_limit_force',
    read: async () => {
      calls += 1;
      return { quotaState: 'unknown', rateLimited: true, retryAfterMs: 300_000 };
    }
  };
  await _test.readWithCache(entry, { now: 1000 });
  assert.equal(calls, 1);
  await _test.readWithCache(entry, { now: 2000, force: true });
  await _test.readWithCache(entry, { now: 200_000, force: true });
  assert.equal(calls, 1, 'force must not punch through a rate-limit cooldown');
  await _test.readWithCache(entry, { now: 301_002, force: true });
  assert.equal(calls, 2);
});

test('rate limits escalate their own ladder without touching failure backoff', async () => {
  let mode = 'limited';
  let calls = 0;
  const waits = [];
  const entry = {
    id: 'test_rate_limit_ladder_escalation',
    read: async () => {
      calls += 1;
      return mode === 'limited'
        ? { quotaState: 'unknown', rateLimited: true, retryAfterMs: 60_000 }
        : { quotaState: 'known', ringPercent: 7 };
    }
  };
  const t0 = 1000;
  const first = await _test.readWithCache(entry, { now: t0 });
  waits.push(first.retryAfterMs);
  assert.equal(first.retryAfterMs, 60_000);
  assert.match(first.sessionResetText, /retrying in 1m/);

  const second = await _test.readWithCache(entry, { now: t0 + first.retryAfterMs + 1 });
  waits.push(second.retryAfterMs);
  assert.equal(second.retryAfterMs, 120_000);

  const third = await _test.readWithCache(entry, {
    now: t0 + first.retryAfterMs + second.retryAfterMs + 2
  });
  waits.push(third.retryAfterMs);
  assert.equal(third.retryAfterMs, 240_000);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [60_000, 120_000, 240_000]);

  mode = 'ok';
  const recovered = await _test.readWithCache(entry, {
    now: t0 + first.retryAfterMs + second.retryAfterMs + third.retryAfterMs + 3
  });
  assert.equal(recovered.quotaState, 'known');
  assert.equal(recovered.ringPercent, 7);
});

test('the Claude reader reports a 429 as a rate limit, not an outage', () => {
  const card = _test.claudeCardFromResponse({ status: 429, headers: { 'retry-after': '0' } });
  assert.equal(card.rateLimited, true);
  assert.equal(card.quotaState, 'unknown');
  assert.match(card.sessionResetText, /[Rr]ate limited/);
  assert.ok(card.retryAfterMs >= 60_000, 'a bogus retry-after: 0 must not mean retry immediately');
});

test('the Claude reader honours a sane retry-after header', () => {
  const card = _test.claudeCardFromResponse({ status: 429, headers: { 'retry-after': '120' } });
  assert.equal(card.retryAfterMs, 120_000);
});

test('the rate limit label reads as a wait, not a reset', () => {
  const card = _test.claudeCardFromResponse({ status: 429, headers: { 'retry-after': '120' } });
  assert.equal(card.sessionResetText, 'Rate limited · retrying in 2m');
});

test('rate-limit ladder doubles from 60s and caps at 15 minutes', () => {
  assert.equal(_test.rateLimitLadderMs(1), 60_000);
  assert.equal(_test.rateLimitLadderMs(2), 120_000);
  assert.equal(_test.rateLimitLadderMs(3), 240_000);
  assert.equal(_test.rateLimitLadderMs(4), 480_000);
  assert.equal(_test.rateLimitLadderMs(5), 900_000);
  assert.equal(_test.rateLimitLadderMs(6), 900_000);
  assert.equal(_test.rateLimitLadderMs(20), _test.RATE_LIMIT_MAX_HOLD_MS);
});

test('resolveRateLimitWaitMs lets a longer retry-after win and still caps', () => {
  // First 429 keeps the historical 5-minute default when the server is silent.
  assert.equal(_test.resolveRateLimitWaitMs(1, undefined), _test.RATE_LIMIT_COOLDOWN_MS);
  assert.equal(_test.resolveRateLimitWaitMs(1, 60_000), 60_000);
  assert.equal(_test.resolveRateLimitWaitMs(1, 180_000), 180_000);
  assert.equal(_test.resolveRateLimitWaitMs(2, 60_000), 120_000);
  assert.equal(_test.resolveRateLimitWaitMs(3, 60_000), 240_000);
  // Server value longer than the ladder wins.
  assert.equal(_test.resolveRateLimitWaitMs(1, 600_000), 600_000);
  // Hard cap at 15 minutes.
  assert.equal(_test.resolveRateLimitWaitMs(1, 3_600_000), _test.RATE_LIMIT_MAX_HOLD_MS);
  assert.equal(_test.resolveRateLimitWaitMs(10, 60_000), _test.RATE_LIMIT_MAX_HOLD_MS);
});

test('a non-429 answer resets the rate-limit streak', async () => {
  let calls = 0;
  const entry = {
    id: 'test_rate_limit_streak_reset',
    read: async () => {
      calls += 1;
      if (calls <= 2) {
        return { quotaState: 'unknown', rateLimited: true, retryAfterMs: 60_000 };
      }
      if (calls === 3) return { quotaState: 'known', ringPercent: 11 };
      return { quotaState: 'unknown', rateLimited: true, retryAfterMs: 60_000 };
    }
  };
  const first = await _test.readWithCache(entry, { now: 1000 });
  assert.equal(first.retryAfterMs, 60_000);
  const second = await _test.readWithCache(entry, { now: 61_001 });
  assert.equal(second.retryAfterMs, 120_000);
  await _test.readWithCache(entry, { now: 181_002 });
  const afterReset = await _test.readWithCache(entry, { now: 241_003 });
  assert.equal(afterReset.rateLimited, true);
  assert.equal(afterReset.retryAfterMs, 60_000, 'streak must restart after a successful read');
  assert.equal(afterReset.sessionResetText, 'Rate limited · retrying in 1m');
});

test('persisted cooldown is honoured after a simulated restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-rl-'));
  const stateFile = path.join(dir, 'rate-limit-state.json');
  try {
    _test.setRateLimitStateFile(stateFile);
    let calls = 0;
    const entry = {
      id: 'test_rate_limit_persist',
      read: async () => {
        calls += 1;
        return { quotaState: 'unknown', rateLimited: true, retryAfterMs: 300_000 };
      }
    };
    const limited = await _test.readWithCache(entry, { now: 5_000 });
    assert.equal(calls, 1);
    assert.equal(limited.retryAfterMs, 300_000);
    assert.ok(fs.existsSync(stateFile));

    // Simulate process restart: empty memory, same on-disk state.
    _test.resetReaderCache();
    _test.setRateLimitStateFile(stateFile);

    await _test.readWithCache(entry, { now: 10_000, force: true });
    await _test.readWithCache(entry, { now: 100_000, force: true });
    assert.equal(calls, 1, 'restart must not spend a request during the persisted cooldown');

    await _test.readWithCache(entry, { now: 5_000 + 300_000 + 1, force: true });
    assert.equal(calls, 2);
  } finally {
    _test.setRateLimitStateFile(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('persisted streak escalates across a simulated restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-rl-streak-'));
  const stateFile = path.join(dir, 'rate-limit-state.json');
  try {
    _test.setRateLimitStateFile(stateFile);
    let calls = 0;
    const entry = {
      id: 'test_rate_limit_persist_streak',
      read: async () => {
        calls += 1;
        return { quotaState: 'unknown', rateLimited: true, retryAfterMs: 60_000 };
      }
    };
    const first = await _test.readWithCache(entry, { now: 1_000 });
    assert.equal(first.retryAfterMs, 60_000);

    _test.resetReaderCache();
    _test.setRateLimitStateFile(stateFile);

    const second = await _test.readWithCache(entry, { now: 61_001 });
    assert.equal(calls, 2);
    assert.equal(second.retryAfterMs, 120_000);
    assert.equal(second.sessionResetText, 'Rate limited · retrying in 2m');
  } finally {
    _test.setRateLimitStateFile(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt or missing rate-limit state files are ignored', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-rl-bad-'));
  const missing = path.join(dir, 'nope.json');
  const corrupt = path.join(dir, 'corrupt.json');
  fs.writeFileSync(corrupt, '{not-json', 'utf8');
  try {
    _test.setRateLimitStateFile(missing);
    let calls = 0;
    const entry = {
      id: 'test_rate_limit_missing_state',
      read: async () => {
        calls += 1;
        return { quotaState: 'known', ringPercent: 3 };
      }
    };
    const ok = await _test.readWithCache(entry, { now: 1000 });
    assert.equal(ok.ringPercent, 3);
    assert.equal(calls, 1);

    _test.resetReaderCache();
    _test.setRateLimitStateFile(corrupt);
    const ok2 = await _test.readWithCache(entry, { now: 2000 });
    assert.equal(ok2.ringPercent, 3);
    assert.equal(calls, 2);
  } finally {
    _test.setRateLimitStateFile(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
