const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const {
  BUILTIN_FINGERPRINT_RULES,
  fingerprintFromResolvedPath,
  isSafeFingerprint,
  nodeModulesFingerprintFromText,
  normalizeFingerprint,
  resolveActivityFingerprint,
  ringsFromBuiltinFingerprints,
  sanitizeFingerprint
} = require('../electron/fingerprints');

const {
  ProcessActivityTracker,
  classifyProcessSamples,
  customActivityBindings,
  ringsForSample
} = require('../electron/process_activity');

// --- Real Windows laptop fixtures from the brief (home shown as ~) ---
const FIXTURE_CMDS = {
  cursorAgent: {
    pid: 101,
    name: 'node.exe',
    cpuSeconds: 1,
    executablePath: String.raw`C:\Users\x\AppData\Local\cursor-agent\versions\2026.09.28-64d2043\node.exe`,
    commandLine: String.raw`"C:\Users\x\AppData\Local\cursor-agent\versions\2026.09.28-64d2043\node.exe" C:\Users\x\AppData\Local\cursor-agent\versions\2026.09.28-64d2043\index.js`
  },
  codexNpm: {
    pid: 102,
    name: 'node.exe',
    cpuSeconds: 2,
    executablePath: String.raw`C:\Program Files\nodejs\node.exe`,
    commandLine: String.raw`"C:\Program Files\nodejs\node.exe" C:\Users\x\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js`
  },
  codexDaemon: {
    pid: 103,
    name: 'codex.exe',
    cpuSeconds: 3,
    executablePath: String.raw`C:\Users\x\.codex\packages\app-server-daemon\codex.exe`,
    commandLine: String.raw`C:\Users\x\.codex\packages\app-server-daemon\codex.exe app-server --port 1234`
  },
  claudeNative: {
    pid: 104,
    name: 'claude.EXE',
    cpuSeconds: 4,
    executablePath: String.raw`C:\Users\x\.local\bin\claude.EXE`,
    commandLine: String.raw`C:\Users\x\.local\bin\claude.EXE`
  },
  mindsyncDispatch: {
    pid: 105,
    name: 'python.exe',
    cpuSeconds: 5,
    executablePath: String.raw`C:\Python312\python.exe`,
    commandLine: String.raw`python.exe "C:\Users\x\AppData\Local\Programs\Python\Python312\Scripts\mindsync-dispatch.exe" run claude "do stuff"`
  },
  codexNative: {
    pid: 106,
    name: 'codex.exe',
    cpuSeconds: 6,
    executablePath: String.raw`C:\Users\x\AppData\Local\codex\codex.exe`,
    commandLine: String.raw`C:\Users\x\AppData\Local\codex\codex.exe`
  }
};

test('built-in fingerprint table covers required agent path markers', () => {
  const byRing = Object.fromEntries(BUILTIN_FINGERPRINT_RULES.map((r) => [r.ring, r.fingerprints]));
  assert.deepEqual(byRing.claude, ['/@anthropic-ai/claude-code/']);
  assert.deepEqual(byRing.codex, ['/@openai/codex/']);
  assert.deepEqual(byRing.gemini, ['/@google/gemini-cli/']);
  assert.deepEqual(byRing.cursor, ['/cursor-agent/versions/']);
  assert.deepEqual(byRing.opencode, ['/opencode-ai/']);
  assert.deepEqual(byRing.grok, ['/@vibe-kit/grok-cli/']);
});

test('fixture command lines map to the right rings (daemon/dispatch → none)', () => {
  assert.deepEqual(ringsForSample(FIXTURE_CMDS.cursorAgent).sort(), ['cursor']);
  assert.deepEqual(ringsForSample(FIXTURE_CMDS.codexNpm).sort(), ['codex']);
  assert.deepEqual(ringsForSample(FIXTURE_CMDS.codexDaemon).sort(), []);
  assert.deepEqual(ringsForSample(FIXTURE_CMDS.claudeNative).sort(), ['claude']);
  assert.deepEqual(ringsForSample(FIXTURE_CMDS.mindsyncDispatch).sort(), []);
  assert.deepEqual(ringsForSample(FIXTURE_CMDS.codexNative).sort(), ['codex']);
});

test('rejects short or bare-runtime fingerprints', () => {
  assert.equal(isSafeFingerprint('node'), false);
  assert.equal(isSafeFingerprint('python'), false);
  assert.equal(isSafeFingerprint('/ab/'), false);
  assert.equal(isSafeFingerprint('short'), false);
  assert.equal(sanitizeFingerprint('node'), null);
  assert.equal(sanitizeFingerprint('/@openai/codex/'), '/@openai/codex/');
  assert.equal(normalizeFingerprint(String.raw`C:\Foo\Bar`), 'c:/foo/bar');
});

test('parses npm .cmd, .ps1, and POSIX shims including scoped packages', () => {
  const cmdShim = `@ECHO off\r\nSETNAME=\r\n"%_prog%" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`;
  const ps1Shim = `$basedir = Split-Path $MyInvocation.MyCommand.Definition\r\n& "$basedir/node.exe" "$basedir/node_modules/@google/gemini-cli/dist/index.js" $args\r\n`;
  const posixShim = `#!/bin/sh\nbasedir=$(dirname "$0")\nexec node "$basedir/node_modules/opencode-ai/bin/opencode.js" "$@"\n`;
  const plainPkg = `#!/usr/bin/env node\nrequire('../node_modules/aider-chat/bin.js')\n`;

  assert.equal(nodeModulesFingerprintFromText(cmdShim), '/node_modules/@openai/codex/');
  assert.equal(nodeModulesFingerprintFromText(ps1Shim), '/node_modules/@google/gemini-cli/');
  assert.equal(nodeModulesFingerprintFromText(posixShim), '/node_modules/opencode-ai/');

  const files = new Map([
    [path.resolve('/shim/codex.cmd'), cmdShim],
    [path.resolve('/shim/gemini.ps1'), ps1Shim],
    [path.resolve('/usr/local/bin/opencode'), posixShim],
    [path.resolve('/usr/local/bin/aider'), plainPkg],
    [path.resolve('/usr/bin/claude-native-bin'), ''],
    [path.resolve('/Python/Scripts/mindsync-dispatch.exe'), '']
  ]);
  const reader = (file) => {
    if (!files.has(file)) throw new Error(`missing ${file}`);
    return files.get(file);
  };

  assert.equal(
    fingerprintFromResolvedPath(path.resolve('/shim/codex.cmd'), { readFileSync: reader }),
    '/node_modules/@openai/codex/'
  );
  assert.equal(
    fingerprintFromResolvedPath(path.resolve('/shim/gemini.ps1'), { readFileSync: reader }),
    '/node_modules/@google/gemini-cli/'
  );
  assert.equal(
    fingerprintFromResolvedPath(path.resolve('/usr/local/bin/opencode'), { readFileSync: reader }),
    '/node_modules/opencode-ai/'
  );
  assert.equal(
    fingerprintFromResolvedPath(path.resolve('/usr/local/bin/aider'), { readFileSync: reader }),
    '/node_modules/aider-chat/'
  );

  const scriptsLauncher = path.resolve('/Python/Scripts/mindsync-dispatch.exe');
  assert.equal(
    fingerprintFromResolvedPath(scriptsLauncher, { readFileSync: reader }),
    normalizeFingerprint(scriptsLauncher)
  );

  const native = path.resolve('/usr/bin/claude-native-bin');
  assert.equal(
    fingerprintFromResolvedPath(native, { readFileSync: () => { throw new Error('no'); } }),
    normalizeFingerprint(native)
  );
});

test('resolveActivityFingerprint uses PATH resolution hooks without executing', () => {
  const shimPath = path.resolve('/tmp/fake-npm/aider.cmd');
  const content = '@ECHO off\nnode "%~dp0\\node_modules\\aider\\bin.js" %*\n';
  const fp = resolveActivityFingerprint('aider', {
    resolvePath: () => shimPath,
    readFileSync: (file) => {
      assert.equal(file, shimPath);
      return content;
    }
  });
  assert.equal(fp, '/node_modules/aider/');
});

test('cache hits skip reclassification; dead pids are evicted', () => {
  const samples1 = [
    { pid: 1, name: 'node', cpuSeconds: 1, commandLine: '/x/node_modules/@openai/codex/bin.js' },
    { pid: 2, name: 'python', cpuSeconds: 1, commandLine: 'python tool.py' }
  ];
  const first = classifyProcessSamples(samples1, {});
  assert.deepEqual(first.liveRings, ['codex']);
  assert.deepEqual(first.pidsForRing('codex'), [1]);
  assert.equal(first.cache.get(1) != null || first.cache.has(1), true);

  // Same pids, no cmdline — runtime uses cache
  const samples2 = [
    { pid: 1, name: 'node', cpuSeconds: 1.1 },
    { pid: 2, name: 'python', cpuSeconds: 1.1 }
  ];
  const second = classifyProcessSamples(samples2, {}, first.cache);
  assert.deepEqual(second.liveRings, ['codex']);
  assert.deepEqual(second.pidsForRing('codex'), [1]);
  assert.ok(second.cache.has(1));
  assert.ok(second.cache.has(2));

  // pid 1 gone → evicted
  const third = classifyProcessSamples([{ pid: 2, name: 'python', cpuSeconds: 1.2 }], {}, second.cache);
  assert.equal(third.cache.has(1), false);
  assert.deepEqual(third.liveRings, []);
});

test('custom agent activityFingerprint appears in pidsForRing and liveRings', async () => {
  const agents = [
    { id: 'custom_aider', activityProcess: 'aider', activityFingerprint: '/node_modules/aider/' }
  ];
  const bindings = customActivityBindings(agents);
  assert.equal(bindings.fingerprints.length, 1);

  const samples = [
    [
      {
        pid: 9,
        name: 'node',
        cpuSeconds: 4,
        commandLine: '/usr/bin/node /home/u/npm/node_modules/aider/bin.js'
      }
    ],
    [
      {
        pid: 9,
        name: 'node',
        cpuSeconds: 4.08,
        commandLine: '/usr/bin/node /home/u/npm/node_modules/aider/bin.js'
      }
    ],
    [
      {
        pid: 9,
        name: 'node',
        cpuSeconds: 4.16,
        commandLine: '/usr/bin/node /home/u/npm/node_modules/aider/bin.js'
      }
    ]
  ];
  const tracker = new ProcessActivityTracker({
    sampler: async () => samples.shift()
  });

  assert.deepEqual(await tracker.sample(bindings), []);
  assert.deepEqual(tracker.liveRings(), ['custom_aider']);
  assert.deepEqual(tracker.pidsForRing('custom_aider'), [9]);
  await tracker.sample(bindings);
  assert.deepEqual((await tracker.sample(bindings)).map((row) => row.activeRing), ['custom_aider']);
});

test('classifyProcessSamples cost stays low over 20 fixture samples', () => {
  const table = [
    FIXTURE_CMDS.cursorAgent,
    FIXTURE_CMDS.codexNpm,
    FIXTURE_CMDS.codexDaemon,
    FIXTURE_CMDS.claudeNative,
    FIXTURE_CMDS.mindsyncDispatch,
    FIXTURE_CMDS.codexNative,
    { pid: 200, name: 'node', cpuSeconds: 1, commandLine: '/app/node_modules/@google/gemini-cli/run.js' },
    { pid: 201, name: 'node', cpuSeconds: 1, commandLine: '/app/node_modules/opencode-ai/bin.js' },
    { pid: 202, name: 'node', cpuSeconds: 1, commandLine: '/app/node_modules/@vibe-kit/grok-cli/index.js' },
    { pid: 203, name: 'python', cpuSeconds: 1, commandLine: 'python unrelated.py' }
  ];
  let cache = new Map();
  const started = process.hrtime.bigint();
  for (let i = 0; i < 20; i += 1) {
    const classified = classifyProcessSamples(table, {}, cache);
    cache = classified.cache;
    assert.ok(classified.liveRings.includes('cursor'));
    assert.ok(classified.liveRings.includes('codex'));
    assert.ok(classified.liveRings.includes('claude'));
    assert.ok(!classified.pidsForRing('codex').includes(FIXTURE_CMDS.codexDaemon.pid));
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  // Fixture-only; should be well under a few ms on any reasonable machine.
  assert.ok(ms < 500, `20 fixture samples took ${ms}ms`);
  // Expose for the brief report via global (test runner prints assertion messages on fail only).
  if (!globalThis.__fingerprintSampleCostMs) globalThis.__fingerprintSampleCostMs = ms;
  console.log(`fingerprint_sample_cost_ms=${ms.toFixed(3)}`);
});

test('builtin fingerprint ringsFromBuiltinFingerprints respects codex exclude', () => {
  const npm = normalizeFingerprint('node /x/node_modules/@openai/codex/bin/codex.js');
  const daemon = normalizeFingerprint('codex.exe app-server --listen');
  assert.deepEqual(ringsFromBuiltinFingerprints(npm), ['codex']);
  assert.deepEqual(ringsFromBuiltinFingerprints(daemon), []);
});
