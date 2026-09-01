const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  mergeActiveRings,
  providerRoots,
  readDirectAgentActivity
} = require('../electron/direct_activity');

function writeArtifact(filePath, mtimeMs) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '', 'utf8');
  const stamp = new Date(mtimeMs);
  fs.utimesSync(filePath, stamp, stamp);
}

test('detects multiple recent provider sessions from metadata only', (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-activity-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const now = Date.parse('2026-09-01T12:00:00.000Z');
  writeArtifact(path.join(homeDir, '.codex', 'sessions', '2026', '09', '01', 'rollout-a.jsonl'), now - 1000);
  writeArtifact(path.join(homeDir, '.grok', 'sessions', 'workspace', 'session', 'events.jsonl'), now - 2000);
  writeArtifact(path.join(homeDir, '.cursor', 'projects', 'workspace', 'worker.log'), now - 3000);
  writeArtifact(path.join(homeDir, '.claude', 'projects', 'workspace', 'old.jsonl'), now - 60_000);

  const activity = readDirectAgentActivity({ homeDir, now, freshnessMs: 45_000 });
  assert.deepEqual(activity.map((row) => row.activeRing), ['codex', 'cursor', 'grok']);
  assert.ok(activity.every((row) => row.source === 'local-session'));
  assert.ok(activity.every((row) => !Object.hasOwn(row, 'path')));
});

test('ignores unrelated and future-dated files', (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-activity-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const now = Date.parse('2026-09-01T12:00:00.000Z');
  writeArtifact(path.join(homeDir, '.claude', 'projects', 'workspace', 'settings.json'), now - 1000);
  writeArtifact(path.join(homeDir, '.claude', 'projects', 'workspace', 'tool-results', 'nested.jsonl'), now - 1000);
  writeArtifact(path.join(homeDir, '.cursor', 'chats', 'workspace', 'session', 'store.db-wal'), now - 1000);
  writeArtifact(path.join(homeDir, '.cursor', 'projects', 'workspace', 'agent-transcripts', 'session.jsonl'), now + 10_000);

  assert.deepEqual(readDirectAgentActivity({ homeDir, now }), []);
});

test('detects both Gemini layouts and deduplicates the ring', (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-activity-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const now = Date.parse('2026-09-01T12:00:00.000Z');
  writeArtifact(path.join(homeDir, '.gemini', 'antigravity', 'conversations', 'gui.db-wal'), now - 2000);
  writeArtifact(path.join(homeDir, '.gemini', 'antigravity-cli', 'conversations', 'cli.db'), now - 1000);

  const activity = readDirectAgentActivity({ homeDir, now, roots: providerRoots(homeDir) });
  assert.deepEqual(activity.map((row) => row.activeRing), ['gemini']);
});

test('honors Codex and Claude home overrides', (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-activity-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const now = Date.parse('2026-09-01T12:00:00.000Z');
  const codexHome = path.join(homeDir, 'custom-codex');
  const claudeHome = path.join(homeDir, 'custom-claude');
  writeArtifact(path.join(codexHome, 'sessions', '2026', '09', '01', 'rollout-now.jsonl'), now - 1000);
  writeArtifact(path.join(claudeHome, 'projects', 'workspace', 'session.jsonl'), now - 1000);

  const roots = providerRoots(homeDir, { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome }, now);
  assert.deepEqual(readDirectAgentActivity({ homeDir, now, roots }).map((row) => row.activeRing), ['claude', 'codex']);
});

test('honors Grok and OpenCode data overrides', (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-activity-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const now = Date.parse('2026-09-01T12:00:00.000Z');
  const grokHome = path.join(homeDir, 'custom-grok');
  const xdgDataHome = path.join(homeDir, 'custom-data');
  writeArtifact(path.join(grokHome, 'sessions', 'workspace', 'session', 'events.jsonl'), now - 1000);
  writeArtifact(path.join(xdgDataHome, 'opencode', 'opencode.db-wal'), now - 1000);

  const roots = providerRoots(homeDir, { GROK_HOME: grokHome, XDG_DATA_HOME: xdgDataHome }, now);
  assert.deepEqual(readDirectAgentActivity({ homeDir, now, roots }).map((row) => row.activeRing), ['grok', 'opencode']);
});

test('can skip inactive provider trees after the process baseline', (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-activity-'));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const now = Date.parse('2026-09-01T12:00:00.000Z');
  writeArtifact(path.join(homeDir, '.codex', 'sessions', '2026', '09', '01', 'rollout-now.jsonl'), now - 1000);
  writeArtifact(path.join(homeDir, '.grok', 'sessions', 'workspace', 'session', 'events.jsonl'), now - 1000);

  const activity = readDirectAgentActivity({ homeDir, now, includeRings: ['grok'] });
  assert.deepEqual(activity.map((row) => row.activeRing), ['grok']);
});

test('merges direct sessions with the active MindSync ring', () => {
  const rings = mergeActiveRings(
    { jobStatus: 'running', activeRing: 'claude' },
    [{ activeRing: 'codex' }, { activeRing: 'claude' }, { activeRing: 'grok' }]
  );
  assert.deepEqual(rings, ['claude', 'codex', 'grok']);
});
