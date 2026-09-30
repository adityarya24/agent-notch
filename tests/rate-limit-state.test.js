const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createRateLimitSnapshot,
  parseRateLimitSnapshot,
  readRateLimitState,
  writeRateLimitState
} = require('../electron/rate-limit-state');

const now = Date.parse('2026-09-01T13:00:00.000Z');

test('snapshot keeps only safe cooldown fields', () => {
  const snapshot = createRateLimitSnapshot({
    claude: { cooldownUntil: now + 60_000, streak: 2, token: 'nope' },
    '': { cooldownUntil: now + 1, streak: 1 },
    bad: { cooldownUntil: 'soon', streak: 1 }
  });
  assert.deepEqual(snapshot.readers, {
    claude: { cooldownUntil: now + 60_000, streak: 2 }
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /nope/);
});

test('parse drops idle expired entries and rejects bad versions', () => {
  const snapshot = createRateLimitSnapshot({
    live: { cooldownUntil: now + 10_000, streak: 1 },
    idle: { cooldownUntil: now - 1, streak: 0 },
    streakOnly: { cooldownUntil: now - 1, streak: 3 }
  });
  const loaded = parseRateLimitSnapshot(snapshot, now);
  assert.deepEqual(Object.keys(loaded.readers).sort(), ['live', 'streakOnly']);
  assert.equal(parseRateLimitSnapshot({ version: 99, readers: {} }, now), null);
});

test('state file round-trips atomically; corrupt and missing files fail closed', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-rl-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'rate-limit-state.json');

  assert.equal(writeRateLimitState(filePath, {
    claude: { cooldownUntil: now + 120_000, streak: 2 }
  }), true);
  const loaded = readRateLimitState(filePath, now);
  assert.equal(loaded.readers.claude.streak, 2);
  assert.equal(fs.existsSync(`${filePath}.${process.pid}.tmp`), false);

  fs.writeFileSync(filePath, '{not-json', 'utf8');
  assert.equal(readRateLimitState(filePath, now), null);
  assert.equal(readRateLimitState(path.join(dir, 'missing.json'), now), null);
});
