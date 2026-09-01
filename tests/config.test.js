const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const config = require('../electron/config');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-config-'));
}

test('sanitizeConfig bounds untrusted values and preserves supported providers', () => {
  const result = config.sanitizeConfig({
    enabledModels: { codex: false, bogus: true, custom_ok: true },
    alertThreshold: 500,
    reduceMotion: 1,
    collapsed: 1,
    customAgents: [{
      id: 'custom_ok',
      name: '  Local Agent  ',
      quotaSource: 'manual',
      icon: 'bogus',
      sessionUsedPercent: -5,
      weeklyUsedPercent: 101
    }]
  });

  assert.equal(result.enabledModels.codex, false);
  assert.equal(result.enabledModels.bogus, undefined);
  assert.equal(result.enabledModels.custom_ok, true);
  assert.equal(result.alertThreshold, 100);
  assert.equal(result.reduceMotion, true);
  assert.equal(result.collapsed, true);
  assert.equal(result.notifyWhenTucked, true);
  assert.equal(result.customAgents[0].name, 'Local Agent');
  assert.equal(result.customAgents[0].icon, 'spark');
  assert.equal(result.customAgents[0].sessionUsedPercent, 0);
  assert.equal(result.customAgents[0].weeklyUsedPercent, 100);
});

test('legacy repo config migrates into the per-user config directory without deletion', () => {
  const root = tempDir();
  const currentDir = path.join(root, 'current');
  const legacyPath = path.join(root, 'notch_config.json');
  fs.writeFileSync(legacyPath, JSON.stringify({ alertThreshold: 72, enabledModels: { claude: false } }));
  process.env.NOTCH_CONFIG_DIR = currentDir;
  process.env.NOTCH_LEGACY_CONFIG_PATH = legacyPath;

  try {
    const result = config.getLocalConfig();
    assert.equal(result.alertThreshold, 72);
    assert.equal(result.enabledModels.claude, false);
    assert.equal(fs.existsSync(legacyPath), true);
    assert.equal(fs.existsSync(path.join(currentDir, 'config.json')), true);
  } finally {
    delete process.env.NOTCH_CONFIG_DIR;
    delete process.env.NOTCH_LEGACY_CONFIG_PATH;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('saveLocalConfig writes sanitized JSON atomically', () => {
  const root = tempDir();
  process.env.NOTCH_CONFIG_DIR = root;
  try {
    const saved = config.saveLocalConfig({ alertThreshold: 40, enabledModels: { grok: false } });
    assert.equal(saved.alertThreshold, 50);
    assert.equal(saved.enabledModels.grok, false);
    const disk = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    assert.deepEqual(disk, saved);
    assert.equal(fs.readdirSync(root).some((name) => name.endsWith('.tmp')), false);
  } finally {
    delete process.env.NOTCH_CONFIG_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('new installs start expanded and a collapsed preference survives sanitization', () => {
  assert.equal(config.sanitizeConfig({}).collapsed, false);
  assert.equal(config.sanitizeConfig({ collapsed: true }).collapsed, true);
});

test('tuck notifications default on and can be switched off', () => {
  assert.equal(config.sanitizeConfig({}).notifyWhenTucked, true);
  assert.equal(config.sanitizeConfig({ notifyWhenTucked: false }).notifyWhenTucked, false);
  assert.equal(config.sanitizeConfig({ notifyWhenTucked: 1 }).notifyWhenTucked, true);
});

test('modelOrder keeps known ids, drops junk, and dedupes', () => {
  const result = config.sanitizeConfig({
    modelOrder: ['grok', 'codex', 'grok', 'nope', 12, 'custom_ok'],
    customAgents: [{ id: 'custom_ok', name: 'Local' }]
  });
  assert.deepEqual(result.modelOrder, ['grok', 'codex', 'custom_ok']);
  assert.deepEqual(config.sanitizeConfig({}).modelOrder, []);
});

test('migrates legacy custom CLI commands without mixing quota and activity commands', () => {
  const result = config.sanitizeConfig({
    customAgents: [
      { id: 'custom_legacy', name: 'Legacy', quotaSource: 'unknown', command: 'aider' },
      {
        id: 'custom_command',
        name: 'Command',
        quotaSource: 'command',
        command: 'node quota.js',
        activityProcess: 'quota-agent.exe'
      },
      { id: 'custom_command_only', name: 'Command only', quotaSource: 'command', command: 'node quota.js' }
    ]
  });

  assert.equal(result.customAgents[0].activityProcess, 'aider');
  assert.equal(result.customAgents[0].command, 'aider');
  assert.equal(result.customAgents[1].activityProcess, 'quota-agent.exe');
  assert.equal(result.customAgents[1].command, 'node quota.js');
  assert.equal(result.customAgents[2].activityProcess, '');
  assert.equal(result.customAgents[2].command, 'node quota.js');
});
