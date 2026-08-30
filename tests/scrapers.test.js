const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { _test, getAllInstalledAgentUsage, saveLocalConfig } = require('../electron/scrapers');

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
