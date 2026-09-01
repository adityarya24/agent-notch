const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { ICONS, getLocalConfig, sanitizeConfig, saveLocalConfig } = require('./config');
const { activityExecutable, normalizeProcessName } = require('./process_activity');

const DEFAULT_ICON = 'spark';
const WINDOWS = 'win32';

// This catalog is deliberately small and explicit. It is the shared source for
// CLI discovery, Settings suggestions, and --icon auto resolution. Unknown
// providers always use the bundled Spark icon; Notch never reads arbitrary
// executable icons from disk.
const PROVIDER_CATALOG = Object.freeze([
  { id: 'aider', name: 'Aider', provider: 'Custom', command: 'aider', activityProcess: 'aider', icon: 'spark' },
  { id: 'copilot', name: 'GitHub Copilot', provider: 'GitHub', command: 'copilot', activityProcess: 'copilot', icon: 'codex' },
  { id: 'amp', name: 'Amp', provider: 'Sourcegraph', command: 'amp', activityProcess: 'amp', icon: 'spark' },
  { id: 'goose', name: 'Goose', provider: 'Block', command: 'goose', activityProcess: 'goose', icon: 'spark' },
  { id: 'crush', name: 'Crush', provider: 'Charm', command: 'crush', activityProcess: 'crush', icon: 'spark' },
  { id: 'qwen', name: 'Qwen', provider: 'Alibaba', command: 'qwen', activityProcess: 'qwen', icon: 'spark' },
  {
    id: 'zcode',
    name: 'ZCode',
    provider: 'Zhipu AI · ZCode',
    command: 'zcode',
    activityProcess: 'ZCode.exe',
    // ZCode is an IDE-like desktop agent, so Cursor is the deliberate bundled
    // visual. This is a catalog choice, not executable icon extraction.
    icon: 'cursor',
    aliases: ['z-code', 'zhipu', 'zhipuai'],
    windowsPaths: zcodeWindowsPaths,
    nativeAppIds: ['dev.zcode.app'],
    nativeAppNames: ['ZCode']
  }
]);

const BUILTIN_ICON_ALIASES = Object.freeze({
  codex: 'codex',
  openai: 'codex',
  claude: 'claude',
  'claude-code': 'claude',
  anthropic: 'claude',
  gemini: 'gemini',
  antigravity: 'gemini',
  cursor: 'cursor',
  opencode: 'opencode',
  grok: 'grok',
  xai: 'grok'
});

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalizedKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function envValue(env, ...keys) {
  for (const key of keys) {
    const value = text(env && env[key]);
    if (value) return value;
  }
  return '';
}

function zcodeWindowsPaths(env = process.env, homeDir = os.homedir()) {
  const localAppData = envValue(env, 'LOCALAPPDATA', 'LocalAppData')
    || path.join(homeDir, 'AppData', 'Local');
  const programFiles = envValue(env, 'ProgramFiles', 'PROGRAMFILES');
  const programFilesX86 = envValue(env, 'ProgramFiles(x86)', 'PROGRAMFILES(X86)');
  return [
    path.join(localAppData, 'Programs', 'ZCode', 'ZCode.exe'),
    path.join(localAppData, 'Programs', 'ZhipuAI', 'ZCode', 'ZCode.exe'),
    path.join(localAppData, 'ZCode', 'ZCode.exe'),
    programFiles && path.join(programFiles, 'ZCode', 'ZCode.exe'),
    programFiles && path.join(programFiles, 'ZhipuAI', 'ZCode', 'ZCode.exe'),
    programFilesX86 && path.join(programFilesX86, 'ZCode', 'ZCode.exe')
  ].filter(Boolean);
}

function catalogEntries() {
  return PROVIDER_CATALOG.map((entry) => ({ ...entry }));
}

function findCatalogEntry(...values) {
  const keys = values.flatMap((value) => {
    const raw = text(value);
    return raw ? [normalizedKey(raw), raw.toLowerCase()] : [];
  }).filter(Boolean);
  return PROVIDER_CATALOG.find((entry) => {
    const aliases = [entry.id, entry.name, entry.provider, entry.command, entry.activityProcess, ...(entry.aliases || [])];
    return aliases.some((alias) => {
      const raw = text(alias);
      return keys.includes(normalizedKey(raw)) || keys.includes(raw.toLowerCase());
    });
  }) || null;
}

function iconForProvider(...values) {
  const entry = findCatalogEntry(...values);
  if (entry && ICONS.has(entry.icon)) return entry.icon;
  for (const value of values) {
    const raw = text(value).toLowerCase();
    if (BUILTIN_ICON_ALIASES[raw] && ICONS.has(BUILTIN_ICON_ALIASES[raw])) {
      return BUILTIN_ICON_ALIASES[raw];
    }
  }
  return DEFAULT_ICON;
}

function resolveIcon(value, ...providerValues) {
  const requested = text(value).toLowerCase();
  if (!requested || requested === 'auto') return iconForProvider(...providerValues);
  if (!ICONS.has(requested)) {
    throw new Error(`Unknown icon "${requested}". Use auto or a bundled icon.`);
  }
  return requested;
}

function canonicalId(value, name) {
  const supplied = text(value);
  if (supplied) {
    const id = supplied.startsWith('custom_') ? supplied : `custom_${supplied}`;
    if (!/^custom_[A-Za-z0-9_-]{1,80}$/.test(id)) {
      throw new Error('Provider id must contain only letters, numbers, _ and -');
    }
    return id;
  }
  const slug = text(name).toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 72);
  if (!slug) throw new Error('Display name is required');
  return `custom_${slug}`;
}

function canonicalActivityProcess(value) {
  const raw = text(value);
  if (raw.includes('\0')) throw new Error('Activity process contains an invalid character');
  if (!raw) throw new Error('Exact native activity process is required (for example: ZCode.exe)');
  if (raw.length > 80 || /[\s/\\]/.test(raw)) {
    throw new Error('Activity process must be an exact executable name, without spaces or a path');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(raw) || /\.(?:bat|cmd|ps1|sh)$/i.test(raw)) {
    throw new Error('Activity process must be a native executable name, not a shell wrapper');
  }
  if (!activityExecutable(raw)) {
    throw new Error('Activity process must not be a generic runtime such as node, python, or PowerShell');
  }
  return raw;
}

function parsePercent(value, label) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new Error(`${label} must be a number from 0 to 100`);
  }
  return Math.round(number);
}

function quotaSource(value) {
  const source = text(value || 'none').toLowerCase();
  if (source === 'none' || source === 'unknown') return 'unknown';
  if (source === 'manual' || source === 'command') return source;
  throw new Error('Quota mode must be none, manual, or command');
}

function buildProvider(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('Provider details are required');
  const name = text(input.name || input.displayName);
  if (!name) throw new Error('Display name is required');
  if (name.length > 80) throw new Error('Display name must be 80 characters or fewer');
  const activityProcess = canonicalActivityProcess(input.activityProcess || input.process);
  const entry = findCatalogEntry(input.id, input.providerId, name, input.provider, input.command, activityProcess);
  const source = quotaSource(input.quotaSource || input.quota);
  const command = text(input.quotaCommand || input.command);
  const session = parsePercent(input.sessionUsedPercent ?? input.session, 'Session percent');
  const weekly = parsePercent(input.weeklyUsedPercent ?? input.weekly, 'Weekly percent');
  if (source === 'command' && !command) {
    throw new Error('Quota command is required when quota mode is command');
  }
  if (source === 'manual' && session == null && weekly == null) {
    throw new Error('At least one session or weekly percent is required for manual quota');
  }
  return {
    id: canonicalId(input.id || input.providerId, name),
    name,
    modelName: text(input.modelName).slice(0, 80),
    provider: text(input.provider || (entry && entry.provider) || 'Custom').slice(0, 80) || 'Custom',
    icon: resolveIcon(input.icon || 'auto', input.id, input.providerId, name, input.provider, input.command, activityProcess),
    quotaSource: source,
    sessionUsedPercent: session,
    weeklyUsedPercent: weekly,
    sessionResetText: text(input.sessionResetText),
    weeklyResetText: text(input.weeklyResetText),
    activityProcess,
    command: source === 'command' ? command : ''
  };
}

function registerProvider(input, options = {}) {
  const current = sanitizeConfig(options.config || getLocalConfig());
  const agent = buildProvider(input);
  const customAgents = current.customAgents.filter((item) => item.id !== agent.id);
  const enabledModels = { ...current.enabledModels, [agent.id]: true };
  const next = (options.save || saveLocalConfig)({
    ...current,
    enabledModels,
    customAgents: [...customAgents, agent]
  });
  return {
    agent: next.customAgents.find((item) => item.id === agent.id) || agent,
    created: !current.customAgents.some((item) => item.id === agent.id),
    config: next
  };
}

function removeProvider(selector, options = {}) {
  const needle = text(selector).toLowerCase();
  if (!needle) throw new Error('Provider id or display name is required');
  const current = sanitizeConfig(options.config || getLocalConfig());
  const match = current.customAgents.find((item) => (
    item.id.toLowerCase() === needle || item.name.toLowerCase() === needle
  ));
  if (!match) throw new Error(`Custom provider not found: ${selector}`);
  const enabledModels = { ...current.enabledModels };
  delete enabledModels[match.id];
  const next = (options.save || saveLocalConfig)({
    ...current,
    enabledModels,
    customAgents: current.customAgents.filter((item) => item.id !== match.id)
  });
  return { removed: match, config: next };
}

function listProviders(config = getLocalConfig()) {
  return sanitizeConfig(config).customAgents.map((agent) => ({ ...agent }));
}

function exists(fileSystem, filePath) {
  try {
    return Boolean(fileSystem.existsSync(filePath));
  } catch (e) {
    return false;
  }
}

function processToken(value) {
  return normalizeProcessName(text(value));
}

function matchingProcess(entry, runningProcesses) {
  const expected = processToken(entry.activityProcess);
  for (const item of runningProcesses || []) {
    const value = item && typeof item === 'object'
      ? (item.name || item.ProcessName || item.path || item.ImageName)
      : item;
    if (processToken(value) === expected) return text(value) || entry.activityProcess;
  }
  return null;
}

function matchingNativeApp(entry, nativeApps) {
  const ids = new Set((entry.nativeAppIds || []).map(normalizedKey));
  const names = new Set((entry.nativeAppNames || []).map(normalizedKey));
  for (const item of nativeApps || []) {
    const value = item && typeof item === 'object'
      ? [item.id, item.appId, item.name, item.displayName, item.packageName]
      : [item];
    if (value.some((part) => ids.has(normalizedKey(part)) || names.has(normalizedKey(part)))) {
      return text(value.find((part) => part));
    }
  }
  return null;
}

function readRunningProcesses() {
  return new Promise((resolve) => {
    if (process.platform !== WINDOWS) {
      resolve([]);
      return;
    }
    const command = 'Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      timeout: 3000,
      windowsHide: true,
      maxBuffer: 128 * 1024
    }, (error, stdout) => {
      if (error || !stdout) {
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(String(stdout).trim());
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch (e) {
        resolve([]);
      }
    });
  });
}

function probeCli(bin) {
  return new Promise((resolve) => {
    const name = text(bin);
    if (!name || !/^[A-Za-z0-9._\\/:?-]+$/.test(name)) {
      resolve({ found: false, path: null });
      return;
    }
    const tool = process.platform === WINDOWS ? 'where.exe' : 'which';
    execFile(tool, [name], {
      timeout: 3000,
      windowsHide: true,
      maxBuffer: 16 * 1024
    }, (error, stdout) => {
      if (error) {
        resolve({ found: false, path: null });
        return;
      }
      const first = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
      resolve({ found: Boolean(first), path: first });
    });
  });
}

async function detectEntry(entry, options = {}) {
  const platform = options.platform || process.platform;
  const fileSystem = options.fs || fs;
  const env = options.env || process.env;
  const homeDir = options.homeDir || os.homedir();
  const knownPaths = platform === WINDOWS && typeof entry.windowsPaths === 'function'
    ? entry.windowsPaths(env, homeDir)
    : [];

  for (const candidate of knownPaths) {
    if (exists(fileSystem, candidate)) {
      return { found: true, path: candidate, evidence: 'known-path' };
    }
  }

  let runningProcesses = options.runningProcesses;
  if (runningProcesses === undefined && knownPaths.length) runningProcesses = await readRunningProcesses();
  const running = matchingProcess(entry, runningProcesses);
  if (running) return { found: true, path: null, evidence: 'running', process: running };

  const nativeApps = options.nativeApps || options.installedApps || [];
  const app = matchingNativeApp(entry, nativeApps);
  if (app) return { found: true, path: null, evidence: 'native-app', app };

  const probe = options.probe || probeCli;
  const result = await probe(entry.command);
  if (result && result.found) return { found: true, path: result.path, evidence: 'path' };
  return { found: false, path: null, evidence: null };
}

async function discoverProviders(options = {}) {
  const results = [];
  for (const entry of PROVIDER_CATALOG) {
    const detected = await detectEntry(entry, options);
    if (!detected.found) continue;
    results.push({
      id: entry.id,
      name: entry.name,
      provider: entry.provider,
      command: entry.command,
      activityProcess: entry.activityProcess,
      icon: resolveIcon('auto', entry.id),
      path: detected.path,
      evidence: detected.evidence,
      process: detected.process || null,
      app: detected.app || null
    });
  }
  return results;
}

async function suggestCustomClis(config, options = {}) {
  const custom = Array.isArray(config?.customAgents) ? config.customAgents : [];
  const taken = new Set(custom.flatMap((agent) => [
    text(agent.id).toLowerCase(),
    text(agent.activityProcess).toLowerCase(),
    text(agent.command).toLowerCase(),
    text(agent.name).toLowerCase()
  ]).filter(Boolean));
  const discovered = await discoverProviders(options);
  return discovered.filter((item) => ![
    item.id,
    `custom_${item.id}`,
    item.name,
    item.command,
    item.activityProcess
  ].some((value) => taken.has(text(value).toLowerCase())));
}

module.exports = {
  DEFAULT_ICON,
  PROVIDER_CATALOG,
  buildProvider,
  canonicalActivityProcess,
  discoverProviders,
  findCatalogEntry,
  iconForProvider,
  listProviders,
  probeCli,
  registerProvider,
  removeProvider,
  resolveIcon,
  suggestCustomClis,
  zcodeWindowsPaths,
  _test: {
    detectEntry,
    matchingNativeApp,
    matchingProcess,
    normalizedKey,
    readRunningProcesses
  }
};
