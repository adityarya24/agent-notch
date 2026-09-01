const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ProcessActivityTracker,
  parseUnixSamples,
  parseWindowsSamples,
  ringForProcess
} = require('../electron/process_activity');

test('maps only dedicated CLI process names', () => {
  assert.equal(ringForProcess('codex.exe'), 'codex');
  assert.equal(ringForProcess('/usr/bin/antigravity-cli'), 'gemini');
  assert.equal(ringForProcess('cursor-agent.exe'), 'cursor');
  assert.equal(ringForProcess('Cursor.exe'), null);
  assert.equal(ringForProcess('Antigravity.exe'), null);
  assert.equal(ringForProcess('node.exe'), null);
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

test('lights every CPU-active CLI and clears exited processes', async () => {
  let now = 1000;
  const samples = [
    [{ pid: 1, name: 'codex', cpuSeconds: 10 }, { pid: 2, name: 'grok', cpuSeconds: 20 }],
    [{ pid: 1, name: 'codex', cpuSeconds: 10.02 }, { pid: 2, name: 'grok', cpuSeconds: 20.2 }],
    [{ pid: 1, name: 'codex', cpuSeconds: 10.02 }]
  ];
  const tracker = new ProcessActivityTracker({ sampler: async () => samples.shift(), now: () => now, graceMs: 15_000 });

  assert.deepEqual(await tracker.sample(), []);
  assert.deepEqual(tracker.liveRings(), ['codex', 'grok']);
  now += 3000;
  assert.deepEqual((await tracker.sample()).map((row) => row.activeRing), ['codex', 'grok']);
  now += 3000;
  assert.deepEqual((await tracker.sample()).map((row) => row.activeRing), ['codex']);
});

test('keeps an idle live CLI glowing only for the grace window', async () => {
  let now = 1000;
  let cpu = 1;
  const tracker = new ProcessActivityTracker({
    sampler: async () => [{ pid: 7, name: 'claude', cpuSeconds: cpu }],
    now: () => now,
    graceMs: 10_000
  });
  await tracker.sample();
  cpu += 0.02;
  now += 1000;
  await tracker.sample();
  now += 9999;
  assert.deepEqual(tracker.current().map((row) => row.activeRing), ['claude']);
  now += 2;
  assert.deepEqual(tracker.current(), []);
});
