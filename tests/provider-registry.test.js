const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const config = require('../electron/config');
const registry = require('../electron/provider-registry');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-provider-'));
}

function withConfigDir(callback) {
  const root = tempDir();
  const previous = {
    dir: process.env.NOTCH_CONFIG_DIR,
    legacy: process.env.NOTCH_LEGACY_CONFIG_PATH
  };
  process.env.NOTCH_CONFIG_DIR = root;
  process.env.NOTCH_LEGACY_CONFIG_PATH = path.join(root, 'missing-legacy.json');
  try {
    return callback(root);
  } finally {
    if (previous.dir === undefined) delete process.env.NOTCH_CONFIG_DIR;
    else process.env.NOTCH_CONFIG_DIR = previous.dir;
    if (previous.legacy === undefined) delete process.env.NOTCH_LEGACY_CONFIG_PATH;
    else process.env.NOTCH_LEGACY_CONFIG_PATH = previous.legacy;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runCli(root, args) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), ...args], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NOTCH_CONFIG_DIR: root,
      NOTCH_LEGACY_CONFIG_PATH: path.join(root, 'missing-legacy.json')
    }
  });
}

test('provider CLI registers, lists, and removes without losing unrelated config', () => {
  withConfigDir((root) => {
    config.saveLocalConfig({
      alertThreshold: 71,
      reduceMotion: true,
      enabledModels: { codex: false, grok: true },
      customAgents: [{ id: 'custom_existing', name: 'Existing', activityProcess: 'existing-agent' }],
      modelOrder: ['custom_existing']
    });

    const add = runCli(root, [
      'provider', 'add', 'zcode', '--name', 'ZCode', '--process', 'ZCode.exe',
      '--quota', 'none', '--icon', 'auto', '--json'
    ]);
    assert.equal(add.status, 0, add.stderr);
    const added = JSON.parse(add.stdout);
    assert.equal(added.agent.id, 'custom_zcode');
    assert.equal(added.agent.icon, 'cursor');
    assert.equal(added.agent.quotaSource, 'unknown');
    assert.equal(added.agent.activityProcess, 'ZCode.exe');

    const disk = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.equal(disk.alertThreshold, 71);
    assert.equal(disk.reduceMotion, true);
    assert.equal(disk.enabledModels.codex, false);
    assert.equal(disk.customAgents.some((agent) => agent.id === 'custom_existing'), true);
    assert.equal(fs.readdirSync(root).some((name) => name.endsWith('.tmp')), false);

    const list = runCli(root, ['provider', 'list', '--json']);
    assert.equal(list.status, 0, list.stderr);
    assert.deepEqual(JSON.parse(list.stdout).map((agent) => agent.id), ['custom_existing', 'custom_zcode']);

    const remove = runCli(root, ['provider', 'remove', 'custom_zcode', '--json']);
    assert.equal(remove.status, 0, remove.stderr);
    assert.equal(JSON.parse(remove.stdout).id, 'custom_zcode');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).customAgents.map((agent) => agent.id), ['custom_existing']);
  });
});

test('provider register alias supports manual quota and is idempotent', () => {
  withConfigDir((root) => {
    const first = runCli(root, [
      'provider', 'register', '--name', 'Local Agent', '--process', 'local-agent.exe',
      '--quota', 'manual', '--session', '12', '--weekly', '40', '--icon', 'auto', '--json'
    ]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).agent.id, 'custom_local_agent');

    const second = runCli(root, [
      'provider', 'register', '--name', 'Local Agent', '--process', 'local-agent.exe',
      '--quota', 'manual', '--session', '20', '--weekly', '40', '--icon', 'auto', '--json'
    ]);
    assert.equal(second.status, 0, second.stderr);
    const result = JSON.parse(second.stdout);
    assert.equal(result.created, false);
    assert.equal(result.config.customAgents.length, 1);
    assert.equal(result.agent.sessionUsedPercent, 20);
  });
});

test('provider registration rejects generic runtimes and unsafe quota modes', () => {
  withConfigDir((root) => {
    const generic = runCli(root, ['provider', 'add', 'bad', '--name', 'Bad', '--process', 'node']);
    assert.notEqual(generic.status, 0);
    assert.match(generic.stderr, /generic runtime|native executable/i);

    const commandWithoutSource = runCli(root, [
      'provider', 'add', 'bad-command', '--name', 'Bad Command', '--process', 'bad-agent.exe', '--quota', 'command'
    ]);
    assert.notEqual(commandWithoutSource.status, 0);
    assert.match(commandWithoutSource.stderr, /Quota command is required/i);
    assert.equal(fs.existsSync(path.join(root, 'config.json')), false);
  });
});

test('known-app discovery finds ZCode from a cataloged Windows install path without PATH', async () => {
  const homeDir = path.join(os.tmpdir(), 'provider-home');
  const env = { LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local') };
  const expectedPath = registry.zcodeWindowsPaths(env, homeDir)[0];
  const suggestions = await registry.discoverProviders({
    platform: 'win32',
    env,
    homeDir,
    fs: { existsSync: (candidate) => candidate === expectedPath },
    runningProcesses: [],
    nativeApps: [],
    probe: async () => ({ found: false, path: null })
  });
  const zcode = suggestions.find((item) => item.id === 'zcode');
  assert.ok(zcode);
  assert.equal(zcode.path, expectedPath);
  assert.equal(zcode.evidence, 'known-path');
  assert.equal(zcode.activityProcess, 'ZCode.exe');
  assert.equal(zcode.icon, 'cursor');
});

test('provider discover CLI emits suggestion JSON without changing config', () => {
  withConfigDir((root) => {
    const result = runCli(root, ['provider', 'discover', '--json']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(Array.isArray(JSON.parse(result.stdout)), true);
    assert.equal(fs.existsSync(path.join(root, 'config.json')), false);
  });
});

test('known-app discovery can use injected native process/app evidence and never writes config', async () => {
  const options = {
    platform: 'win32',
    env: { LOCALAPPDATA: path.join(os.tmpdir(), 'not-installed') },
    homeDir: os.tmpdir(),
    fs: { existsSync: () => false },
    runningProcesses: ['ZCode'],
    nativeApps: [{ appId: 'dev.zcode.app' }],
    probe: async () => ({ found: false, path: null })
  };
  const suggestions = await registry.discoverProviders(options);
  const zcode = suggestions.find((item) => item.id === 'zcode');
  assert.ok(zcode);
  assert.equal(zcode.evidence, 'running');
  assert.equal(zcode.path, null);
  assert.deepEqual(await registry.suggestCustomClis({
    customAgents: [{ id: 'custom_zcode', name: 'Renamed', activityProcess: 'renamed.exe' }]
  }, options), []);
});

test('icon auto maps known providers and falls back safely for unknown ones', () => {
  assert.equal(registry.resolveIcon('auto', 'zcode'), 'cursor');
  assert.equal(registry.resolveIcon('auto', 'claude-code'), 'claude');
  assert.equal(registry.resolveIcon('auto', 'brand-new-agent'), 'spark');
  assert.equal(registry.resolveIcon('spark', 'zcode'), 'spark');
  assert.throws(() => registry.resolveIcon('not-a-bundled-icon', 'zcode'), /Unknown icon/);
});
