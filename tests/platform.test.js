'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const platform = require('../electron/platform');

const HOME = path.join(os.tmpdir(), 'agent-notch-fake-home');

test('appDataRoot: env override wins on every platform', () => {
  const override = path.join(os.tmpdir(), 'notch-cfg-override');
  for (const osName of ['win32', 'darwin', 'linux']) {
    assert.equal(
      platform.appDataRoot(osName, { NOTCH_CONFIG_DIR: override }, HOME),
      path.resolve(override)
    );
  }
});

test('appDataRoot: win32 uses APPDATA\\Agent Notch', () => {
  const appData = path.join(HOME, 'AppData', 'Roaming');
  assert.equal(
    platform.appDataRoot('win32', { APPDATA: appData }, HOME),
    path.join(appData, 'Agent Notch')
  );
  assert.equal(
    platform.appDataRoot('win32', {}, HOME),
    path.join(HOME, '.agent-notch')
  );
});

test('appDataRoot: darwin uses Application Support', () => {
  assert.equal(
    platform.appDataRoot('darwin', {}, HOME),
    path.join(HOME, 'Library', 'Application Support', 'Agent Notch')
  );
  // APPDATA must not hijack mac paths
  assert.equal(
    platform.appDataRoot('darwin', { APPDATA: path.join(HOME, 'Roaming') }, HOME),
    path.join(HOME, 'Library', 'Application Support', 'Agent Notch')
  );
});

test('appDataRoot: other platforms use ~/.agent-notch', () => {
  assert.equal(
    platform.appDataRoot('linux', { APPDATA: path.join(HOME, 'Roaming') }, HOME),
    path.join(HOME, '.agent-notch')
  );
});

test('runtimeDir: env override wins; win32 LOCALAPPDATA then APPDATA', () => {
  const override = path.join(os.tmpdir(), 'notch-state-override');
  assert.equal(
    platform.runtimeDir('win32', { NOTCH_STATE_DIR: override }, HOME),
    path.resolve(override)
  );
  const local = path.join(HOME, 'AppData', 'Local');
  assert.equal(
    platform.runtimeDir('win32', { LOCALAPPDATA: local }, HOME),
    path.join(local, 'Agent Notch')
  );
  const roaming = path.join(HOME, 'AppData', 'Roaming');
  assert.equal(
    platform.runtimeDir('win32', { APPDATA: roaming }, HOME),
    path.join(roaming, 'Agent Notch')
  );
  assert.equal(
    platform.runtimeDir('win32', {}, HOME),
    path.join(HOME, '.agent-notch')
  );
});

test('runtimeDir: darwin Application Support; linux ~/.agent-notch', () => {
  assert.equal(
    platform.runtimeDir('darwin', { LOCALAPPDATA: 'x' }, HOME),
    path.join(HOME, 'Library', 'Application Support', 'Agent Notch')
  );
  assert.equal(
    platform.runtimeDir('linux', { LOCALAPPDATA: 'x' }, HOME),
    path.join(HOME, '.agent-notch')
  );
});

test('electronBinary: platform-specific fallbacks, never .exe off Windows', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-electron-'));
  try {
    const dist = path.join(root, 'node_modules', 'electron', 'dist');
    fs.mkdirSync(dist, { recursive: true });

    const winPath = platform.electronBinary('win32', root);
    assert.equal(winPath, path.join(dist, 'electron.exe'));
    assert.match(winPath, /electron\.exe$/);

    const macPath = platform.electronBinary('darwin', root);
    assert.equal(macPath, path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron'));
    assert.ok(!macPath.endsWith('.exe'));

    const linuxPath = platform.electronBinary('linux', root);
    assert.equal(linuxPath, path.join(dist, 'electron'));
    assert.ok(!linuxPath.endsWith('.exe'));

    // Prefer existing bare electron on darwin when app bundle missing
    fs.writeFileSync(path.join(dist, 'electron'), '');
    assert.equal(platform.electronBinary('darwin', root), path.join(dist, 'electron'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isOwnedPid: win32 uses PowerShell command line containing main.js', () => {
  const calls = [];
  const spawn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    return { stdout: 'C:\\\\electron.exe C:\\\\repo\\\\electron\\\\main.js\n', status: 0 };
  };
  assert.equal(
    platform.isOwnedPid(4242, 'win32', {
      alive: () => true,
      spawn,
      mainNeedle: 'main.js'
    }),
    true
  );
  assert.equal(calls[0].bin, 'powershell.exe');
  assert.equal(calls[0].opts.env.NOTCH_PID, '4242');

  const spawnOther = () => ({ stdout: 'C:\\\\other.exe --foo\n', status: 0 });
  assert.equal(
    platform.isOwnedPid(1, 'win32', { alive: () => true, spawn: spawnOther, mainNeedle: 'main.js' }),
    false
  );
  assert.equal(
    platform.isOwnedPid(1, 'win32', { alive: () => false, spawn: spawnOther }),
    false
  );
});

test('isOwnedPid: darwin/linux use ps -ww and main.js needle', () => {
  const calls = [];
  const spawn = (bin, args) => {
    calls.push({ bin, args });
    return { stdout: '/usr/bin/Electron /app/electron/main.js\n', status: 0 };
  };
  assert.equal(
    platform.isOwnedPid(99, 'darwin', { alive: () => true, spawn, mainNeedle: 'main.js' }),
    true
  );
  assert.deepEqual(calls[0].bin, 'ps');
  assert.deepEqual(calls[0].args, ['-ww', '-p', '99', '-o', 'command=']);

  assert.equal(
    platform.isOwnedPid(99, 'linux', {
      alive: () => true,
      spawn: () => ({ stdout: 'node server.js', status: 0 }),
      mainNeedle: 'main.js'
    }),
    false
  );
});

test('killPid: win32 plans taskkill /T /F without real processes', () => {
  const calls = [];
  const result = platform.killPid(555, 'win32', {
    spawn: (bin, args) => {
      calls.push({ bin, args });
      return { status: 0 };
    },
    alive: () => false,
    sleep: () => {}
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].bin, 'taskkill.exe');
  assert.deepEqual(calls[0].args, ['/PID', '555', '/T', '/F']);
});

test('killPid: darwin/linux SIGTERM then SIGKILL after wait', () => {
  const signals = [];
  let living = true;
  const result = platform.killPid(777, 'darwin', {
    kill: (pid, signal) => {
      signals.push({ pid, signal });
      if (signal === 'SIGKILL') living = false;
    },
    alive: () => living,
    sleep: () => {},
    waitMs: 10
  });
  assert.equal(result.ok, true);
  assert.deepEqual(signals, [
    { pid: 777, signal: 'SIGTERM' },
    { pid: 777, signal: 'SIGKILL' }
  ]);

  // Dies on SIGTERM — no SIGKILL
  const signals2 = [];
  let living2 = true;
  platform.killPid(778, 'linux', {
    kill: (pid, signal) => {
      signals2.push({ pid, signal });
      if (signal === 'SIGTERM') living2 = false;
    },
    alive: () => living2,
    sleep: () => {},
    waitMs: 10
  });
  assert.deepEqual(signals2, [{ pid: 778, signal: 'SIGTERM' }]);
});

test('openTerminal: win32 wt.exe with cmd fallback', () => {
  const plan = platform.openTerminal({ cwd: '/work/agent' }, 'win32');
  assert.equal(plan.primary.bin, 'wt.exe');
  assert.deepEqual(plan.primary.args.slice(0, 2), ['-d', path.resolve('/work/agent')]);
  assert.equal(plan.fallback.bin, 'cmd.exe');
  assert.equal(plan.argv[0], 'wt.exe');
});

test('openTerminal: darwin Terminal by default, iTerm when TERM_PROGRAM or config says so', () => {
  const term = platform.openTerminal({ cwd: '/Users/me/proj' }, 'darwin', {});
  assert.equal(term.primary.bin, 'open');
  assert.deepEqual(term.primary.args, ['-a', 'Terminal', path.resolve('/Users/me/proj')]);
  assert.equal(term.terminal, 'Terminal');

  const itermEnv = platform.openTerminal({ cwd: '/Users/me/proj' }, 'darwin', { TERM_PROGRAM: 'iTerm.app' });
  assert.deepEqual(itermEnv.primary.args, ['-a', 'iTerm', path.resolve('/Users/me/proj')]);

  const itermCfg = platform.openTerminal({ cwd: '/Users/me/proj', terminal: 'iTerm2' }, 'darwin', {});
  assert.deepEqual(itermCfg.primary.args, ['-a', 'iTerm', path.resolve('/Users/me/proj')]);
});

test('openAtLoginLabel and CLI autostart gating', () => {
  assert.equal(platform.openAtLoginLabel('win32'), 'Start with Windows');
  assert.equal(platform.openAtLoginLabel('darwin'), 'Open at Login');
  assert.equal(platform.openAtLoginLabel('linux'), 'Open at Login');
  assert.equal(platform.supportsCliAutostart('win32'), true);
  assert.equal(platform.supportsCliAutostart('darwin'), false);
  assert.match(platform.cliAutostartUnsupportedMessage('darwin'), /not yet supported on macOS/i);
  assert.match(platform.cliAutostartUnsupportedMessage('darwin'), /Open at Login/);
});

test('appDataRoot/runtimeDir: darwin keeps a pre-port ~/.agent-notch when Application Support is absent', () => {
  const legacy = path.join(HOME, '.agent-notch');
  const onlyLegacy = (p) => p === legacy;
  assert.equal(platform.appDataRoot('darwin', {}, HOME, onlyLegacy), legacy);
  assert.equal(platform.runtimeDir('darwin', {}, HOME, onlyLegacy), legacy);
  const both = () => true;
  assert.equal(
    platform.appDataRoot('darwin', {}, HOME, both),
    path.join(HOME, 'Library', 'Application Support', 'Agent Notch')
  );
});
