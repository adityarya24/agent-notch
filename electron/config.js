const fs = require('fs');
const os = require('os');
const path = require('path');

const BUILTIN_IDS = ['codex', 'claude', 'gemini', 'cursor', 'opencode', 'grok'];
const DEFAULT_CONFIG = Object.freeze({
  enabledModels: Object.freeze(Object.fromEntries(BUILTIN_IDS.map((id) => [id, true]))),
  customAgents: Object.freeze([]),
  alertThreshold: 80,
  reduceMotion: false
});
const QUOTA_SOURCES = new Set(['unknown', 'manual', 'command']);
const ICONS = new Set(['spark', 'claude', 'codex', 'gemini', 'cursor', 'grok', 'opencode']);

function appDataRoot() {
  const override = String(process.env.NOTCH_CONFIG_DIR || '').trim();
  if (override) return path.resolve(override);
  const appData = String(process.env.APPDATA || '').trim();
  return appData ? path.join(appData, 'Agent Notch') : path.join(os.homedir(), '.agent-notch');
}

function configPath() {
  return path.join(appDataRoot(), 'config.json');
}

function legacyConfigPath() {
  const override = String(process.env.NOTCH_LEGACY_CONFIG_PATH || '').trim();
  return override ? path.resolve(override) : path.join(__dirname, '..', 'notch_config.json');
}

function boundedString(value, fallback = '', max = 512) {
  const text = String(value == null ? fallback : value).replace(/\0/g, '').trim();
  return text.slice(0, max);
}

function boundedPercent(value) {
  if (value === '' || value == null || typeof value === 'boolean') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function sanitizeCustomAgent(value, index) {
  if (!value || typeof value !== 'object') return null;
  const name = boundedString(value.name, '', 80);
  if (!name) return null;
  const rawId = boundedString(value.id, `custom_${index}`, 100);
  const id = /^custom_[A-Za-z0-9_-]+$/.test(rawId) ? rawId : `custom_${index}`;
  const quotaSource = QUOTA_SOURCES.has(value.quotaSource) ? value.quotaSource : 'unknown';
  const icon = ICONS.has(value.icon) ? value.icon : 'spark';
  return {
    id,
    name,
    modelName: boundedString(value.modelName, '', 80),
    provider: boundedString(value.provider, 'Custom', 80) || 'Custom',
    icon,
    quotaSource,
    sessionUsedPercent: boundedPercent(value.sessionUsedPercent),
    weeklyUsedPercent: boundedPercent(value.weeklyUsedPercent),
    sessionResetText: boundedString(value.sessionResetText, '', 120),
    weeklyResetText: boundedString(value.weeklyResetText, '', 120),
    command: boundedString(value.command, '', 1024)
  };
}

function sanitizeConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const customAgents = (Array.isArray(source.customAgents) ? source.customAgents : [])
    .slice(0, 50)
    .map(sanitizeCustomAgent)
    .filter(Boolean);
  const enabledModels = { ...DEFAULT_CONFIG.enabledModels };
  if (source.enabledModels && typeof source.enabledModels === 'object') {
    const allowedIds = new Set([...BUILTIN_IDS, ...customAgents.map((agent) => agent.id)]);
    for (const [id, enabled] of Object.entries(source.enabledModels)) {
      if (allowedIds.has(id) && typeof enabled === 'boolean') enabledModels[id] = enabled;
    }
  }
  const rawThreshold = Number(source.alertThreshold);
  const alertThreshold = Number.isFinite(rawThreshold)
    ? Math.max(50, Math.min(100, Math.round(rawThreshold)))
    : DEFAULT_CONFIG.alertThreshold;
  return {
    enabledModels,
    customAgents,
    alertThreshold,
    reduceMotion: Boolean(source.reduceMotion)
  };
}

function readConfig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return sanitizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (e) {
    return null;
  }
}

function writeConfig(filePath, config) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    fs.copyFileSync(tmp, filePath);
    fs.unlinkSync(tmp);
  }
}

function getLocalConfig() {
  const current = readConfig(configPath());
  if (current) return current;
  const legacy = readConfig(legacyConfigPath());
  if (legacy) {
    try {
      writeConfig(configPath(), legacy);
    } catch (e) {}
    return legacy;
  }
  return sanitizeConfig(DEFAULT_CONFIG);
}

function saveLocalConfig(value) {
  const config = sanitizeConfig(value);
  writeConfig(configPath(), config);
  return config;
}

module.exports = {
  BUILTIN_IDS,
  DEFAULT_CONFIG,
  appDataRoot,
  configPath,
  getLocalConfig,
  legacyConfigPath,
  sanitizeConfig,
  saveLocalConfig
};
