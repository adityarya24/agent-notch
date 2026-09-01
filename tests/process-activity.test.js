const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ProcessActivityTracker,
  activityExecutable,
  customProcessMappings,
  parseUnixSamples,
  parseWindowsSamples,
  ringForProcess,
  ringsForProcess,
  supportsProcessOnlyActivity
} = require('../electron/process_activity');

test('maps only dedicated CLI process names', () => {
  assert.equal(ringForProcess('codex.exe'), 'codex');
  assert.equal(ringForProcess('/usr/bin/antigravity-cli'), 'gemini');
  assert.equal(ringForProcess('cursor-agent.exe'), 'cursor');
  assert.equal(ringForProcess('Cursor.exe'), null);
  assert.equal(ringForProcess('Antigravity.exe'), null);
  assert.equal(ringForProcess('node.exe'), null);
});

test('accepts only exact native executables for custom activity', () => {
  assert.equal(activityExecutable('fixture-agent.exe'), 'fixture-agent');
  assert.equal(activityExecutable('"C:\\Program Files\\Fixture\\fixture-agent.exe"'), 'fixture-agent');
  assert.equal(activityExecutable('node --flag'), null);
  assert.equal(activityExecutable('node.exe'), null);
  assert.equal(activityExecutable('python3'), null);
  assert.equal(activityExecutable('python3.12'), null);
  assert.equal(activityExecutable('bun'), null);
  assert.equal(activityExecutable('javaw.exe'), null);
  assert.equal(activityExecutable('dotnet'), null);
  assert.equal(activityExecutable('zsh'), null);
  assert.equal(activityExecutable('fixture.ps1'), null);
  assert.equal(activityExecutable(''), null);
});

test('maps one native process to every configured custom ring', () => {
  const mappings = customProcessMappings([
    { id: 'custom_a', activityProcess: 'fixture-agent' },
    { id: 'custom_b', activityProcess: 'fixture-agent.exe' },
    { id: 'custom_bad', activityProcess: 'node --flag' },
    { id: 'not_custom', activityProcess: 'fixture-agent' }
  ]);
  assert.deepEqual({ ...mappings }, { 'fixture-agent': ['custom_a', 'custom_b'] });
  assert.deepEqual(ringsForProcess('fixture-agent.exe', mappings), ['custom_a', 'custom_b']);
  assert.deepEqual(ringsForProcess('codex.exe', { codex: ['custom_codex'] }), ['codex', 'custom_codex']);
});

test('uses CPU-only glow only where no reliable session signal is available', () => {
  assert.equal(supportsProcessOnlyActivity('codex'), true);
  assert.equal(supportsProcessOnlyActivity('custom_fixture'), true);
  assert.equal(supportsProcessOnlyActivity('grok'), false);
  assert.equal(supportsProcessOnlyActivity('claude'), false);
  assert.equal(supportsProcessOnlyActivity('gemini'), false);
  assert.equal(supportsProcessOnlyActivity('cursor'), false);
  assert.equal(supportsProcessOnlyActivity('opencode'), false);
});

test('treats prototype-like process names as inert data', () => {
  const mappings = customProcessMappings([
    { id: 'custom_constructor', activityProcess: 'constructor' },
    { id: 'custom_proto', activityProcess: '__proto__' }
  ]);
  assert.deepEqual(Object.keys(mappings).sort(), ['__proto__', 'constructor']);
  assert.deepEqual(mappings.constructor, ['custom_constructor']);
  assert.deepEqual(mappings.__proto__, ['custom_proto']);
  assert.deepEqual(ringsForProcess('constructor', mappings), ['custom_constructor']);
  assert.deepEqual(ringsForProcess('__proto__', mappings), ['custom_proto']);
  assert.deepEqual(ringsForProcess('constructor', {}), []);
});

test('parses process samples without command lines', () => {
  assert.deepEqual(parseWindowsSamples('[{"ProcessName":"codex","Id":42,"CPU":1.25}]'), [
    { pid: 42, name: 'codex', cpuSeconds: 1.25 }
  ]);
  assert.deepEqual(parseUnixSamples(' 42 codex 01:02\n 43 grok 1:02:03\n 44 claude 1-02:03:04\n'), [
    { pid: 42, name: 'codex', cpuSeconds: 62 },
    { pid: 43, name: 'grok', cpuSeconds: 3723 },
    { pid: 44, name: 'claude', cpuSeconds: 93784 }
  ]);
});

test('lights CPU-backed rings but leaves session-backed providers to artifact activity', async () => {
  let now = 1000;
  const samples = [
    [{ pid: 1, name: 'codex', cpuSeconds: 10 }, { pid: 2, name: 'grok', cpuSeconds: 20 }],
    [{ pid: 1, name: 'codex', cpuSeconds: 10.08 }, { pid: 2, name: 'grok', cpuSeconds: 20.08 }],
    [{ pid: 1, name: 'codex', cpuSeconds: 10.16 }, { pid: 2, name: 'grok', cpuSeconds: 20.16 }],
    [{ pid: 1, name: 'codex', cpuSeconds: 10.16 }]
  ];
  const tracker = new ProcessActivityTracker({ sampler: async () => samples.shift(), now: () => now, graceMs: 15_000 });

  assert.deepEqual(await tracker.sample(), []);
  assert.deepEqual(tracker.liveRings(), ['codex', 'grok']);
  now += 3000;
  assert.deepEqual(await tracker.sample(), []);
  now += 3000;
  assert.deepEqual((await tracker.sample()).map((row) => row.activeRing), ['codex']);
  now += 3000;
  assert.deepEqual((await tracker.sample()).map((row) => row.activeRing), ['codex']);
});

test('does not light an open Grok prompt from sustained background CPU', async () => {
  let now = 1000;
  let cpu = 10;
  const tracker = new ProcessActivityTracker({
    sampler: async () => [{ pid: 7, name: 'grok', cpuSeconds: cpu }],
    now: () => now
  });

  assert.deepEqual(await tracker.sample(), []);
  for (const delta of [0.12, 0.12, 0.12, 0.12]) {
    cpu += delta;
    now += 3000;
    assert.deepEqual(await tracker.sample(), []);
  }
  assert.deepEqual(tracker.liveRings(), ['grok']);
});

test('keeps an idle live CLI glowing only for the grace window', async () => {
  let now = 1000;
  let cpu = 1;
  const tracker = new ProcessActivityTracker({
    sampler: async () => [{ pid: 7, name: 'codex', cpuSeconds: cpu }],
    now: () => now,
    graceMs: 10_000
  });
  await tracker.sample();
  cpu += 0.08;
  now += 1000;
  await tracker.sample();
  assert.deepEqual(tracker.current(), []);
  cpu += 0.08;
  now += 1000;
  await tracker.sample();
  now += 9999;
  assert.deepEqual(tracker.current().map((row) => row.activeRing), ['codex']);
  now += 2;
  assert.deepEqual(tracker.current(), []);
});

test('lights a custom ring from its configured native process', async () => {
  const requestedNames = [];
  const samples = [
    [{ pid: 9, name: 'fixture-agent.exe', cpuSeconds: 4 }],
    [{ pid: 9, name: 'fixture-agent.exe', cpuSeconds: 4.08 }],
    [{ pid: 9, name: 'fixture-agent.exe', cpuSeconds: 4.16 }]
  ];
  const tracker = new ProcessActivityTracker({
    sampler: async (names) => {
      requestedNames.push(names);
      return samples.shift();
    }
  });
  const mappings = { 'fixture-agent': ['custom_fixture'] };

  assert.deepEqual(await tracker.sample(mappings), []);
  assert.deepEqual(await tracker.sample(mappings), []);
  assert.deepEqual((await tracker.sample(mappings)).map((row) => row.activeRing), ['custom_fixture']);
  assert.deepEqual(requestedNames, [['fixture-agent'], ['fixture-agent'], ['fixture-agent']]);
});
