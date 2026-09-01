const { execFile } = require('child_process');

const PROCESS_GRACE_MS = 15 * 1000;
const MIN_CPU_DELTA_SECONDS = 0.03;
const MIN_ACTIVE_SAMPLES = 2;
const BUILTIN_PROCESS_NAMES = ['codex', 'claude', 'grok', 'opencode', 'gemini', 'agy', 'antigravity-cli', 'cursor-agent'];
const GENERIC_PROCESS_NAMES = new Set([
  'bash', 'bun', 'cmd', 'deno', 'dotnet', 'fish', 'java', 'javaw', 'perl', 'php',
  'powershell', 'pwsh', 'ruby', 'sh', 'zsh'
]);

function normalizeProcessName(rawName) {
  return String(rawName || '')
    .trim()
    .split(/[\\/]/)
    .pop()
    .replace(/\.exe$/i, '')
    .toLowerCase();
}

function ringForProcess(rawName) {
  const name = normalizeProcessName(rawName);
  if (['codex', 'claude', 'grok', 'opencode'].includes(name)) return name;
  if (['gemini', 'agy', 'antigravity-cli'].includes(name)) return 'gemini';
  if (name === 'cursor-agent') return 'cursor';
  return null;
}

function activityExecutable(rawCommand) {
  const text = String(rawCommand || '').trim();
  if (!text) return null;
  const quoted = text.match(/^"([^"]+)"$/);
  const executable = quoted ? quoted[1] : (/\s/.test(text) ? '' : text);
  if (!executable || /\.(?:bat|cmd|ps1|sh)$/i.test(executable)) return null;
  const name = normalizeProcessName(executable);
  if (GENERIC_PROCESS_NAMES.has(name) || /^node(?:js)?(?:\d+(?:\.\d+)*)?$/.test(name) || /^pythonw?(?:\d+(?:\.\d+)*)?$/.test(name)) return null;
  return /^[a-z0-9._-]{1,80}$/.test(name) ? name : null;
}

function customProcessMappings(customAgents) {
  const mappings = Object.create(null);
  for (const agent of customAgents || []) {
    const id = String(agent?.id || '');
    if (!/^custom_[A-Za-z0-9_-]+$/.test(id)) continue;
    const name = activityExecutable(agent.activityProcess);
    if (!name) continue;
    mappings[name] = [...new Set([...(mappings[name] || []), id])];
  }
  return mappings;
}

function ringsForProcess(rawName, customMappings = {}) {
  const name = normalizeProcessName(rawName);
  const rings = new Set();
  const builtin = ringForProcess(name);
  if (builtin) rings.add(builtin);
  const customRings = Object.prototype.hasOwnProperty.call(customMappings || {}, name)
    && Array.isArray(customMappings[name]) ? customMappings[name] : [];
  for (const id of customRings) rings.add(id);
  return [...rings];
}

function supportsProcessOnlyActivity(ring) {
  // Session-backed providers use their artifact writes as the work signal;
  // their interactive processes can burn CPU indefinitely while idle.
  return ring === 'codex' || /^custom_[A-Za-z0-9_-]+$/.test(String(ring || ''));
}

function cpuTimeSeconds(raw) {
  const text = String(raw || '').trim();
  const daySplit = text.split('-');
  if (daySplit.length > 2) return null;
  const days = daySplit.length === 2 ? Number(daySplit[0]) : 0;
  const parts = daySplit[daySplit.length - 1].split(':').map(Number);
  if (!Number.isFinite(days)) return null;
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  let clockSeconds = 0;
  for (const part of parts) clockSeconds = (clockSeconds * 60) + part;
  return (days * 24 * 60 * 60) + clockSeconds;
}

function parseWindowsSamples(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return [];
  }
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    pid: Number(row.Id),
    name: String(row.ProcessName || ''),
    cpuSeconds: Number(row.CPU)
  })).filter((row) => Number.isFinite(row.pid) && Number.isFinite(row.cpuSeconds));
}

function parseUnixSamples(stdout) {
  const rows = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+([\d:-]+)$/);
    if (!match) continue;
    const cpuSeconds = cpuTimeSeconds(match[3]);
    if (!Number.isFinite(cpuSeconds)) continue;
    rows.push({ pid: Number(match[1]), name: match[2], cpuSeconds });
  }
  return rows;
}

function execSamples(file, args, parser) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 2500, maxBuffer: 256 * 1024 }, (error, stdout) => {
      resolve(error ? [] : parser(stdout));
    });
  });
}

function sampleAgentProcesses(extraNames = [], platform = process.platform) {
  if (platform === 'win32') {
    const names = [...new Set([...BUILTIN_PROCESS_NAMES, ...extraNames])]
      .map(normalizeProcessName)
      .filter((name) => /^[a-z0-9._-]{1,80}$/.test(name));
    const literals = names.map((name) => `'${name}'`).join(',');
    const command = `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @(${literals}) } | Select-Object ProcessName,Id,CPU | ConvertTo-Json -Compress`;
    return execSamples('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], parseWindowsSamples);
  }
  return execSamples('ps', ['-A', '-o', 'pid=,comm=,time='], parseUnixSamples);
}

class ProcessActivityTracker {
  constructor({
    sampler = sampleAgentProcesses,
    now = () => Date.now(),
    graceMs = PROCESS_GRACE_MS,
    minCpuDeltaSeconds = MIN_CPU_DELTA_SECONDS,
    minActiveSamples = MIN_ACTIVE_SAMPLES
  } = {}) {
    this.sampler = sampler;
    this.now = now;
    this.graceMs = graceMs;
    this.minCpuDeltaSeconds = minCpuDeltaSeconds;
    this.minActiveSamples = minActiveSamples;
    this.previousCpu = new Map();
    this.busyStreak = new Map();
    this.activeUntil = new Map();
    this.live = new Set();
    this.pending = null;
  }

  current() {
    const now = this.now();
    return [...this.activeUntil.entries()]
      .filter(([, until]) => until >= now)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([activeRing]) => ({ activeRing, source: 'local-process' }));
  }

  liveRings() {
    return [...this.live].sort();
  }

  sample(customMappings = {}) {
    if (this.pending) return this.pending;
    this.pending = Promise.resolve(this.sampler(Object.keys(customMappings))).then((samples) => {
      const now = this.now();
      const nextCpu = new Map();
      const nextBusyStreak = new Map();
      const liveRings = new Set();
      for (const row of samples || []) {
        const rings = ringsForProcess(row.name, customMappings);
        if (!rings.length || !Number.isFinite(row.pid) || !Number.isFinite(row.cpuSeconds)) continue;
        for (const ring of rings) {
          liveRings.add(ring);
          const key = `${ring}:${row.pid}`;
          const previous = this.previousCpu.get(key);
          const meaningfulDelta = Number.isFinite(previous)
            && row.cpuSeconds - previous >= this.minCpuDeltaSeconds;
          const streak = meaningfulDelta ? (this.busyStreak.get(key) || 0) + 1 : 0;
          // Interactive CLIs can perform isolated housekeeping bursts while
          // sitting at a prompt. Only sustained CPU movement represents work.
          if (streak >= this.minActiveSamples && supportsProcessOnlyActivity(ring)) {
            this.activeUntil.set(ring, now + this.graceMs);
          }
          nextCpu.set(key, row.cpuSeconds);
          nextBusyStreak.set(key, streak);
        }
      }
      for (const ring of this.activeUntil.keys()) {
        if (!liveRings.has(ring)) this.activeUntil.delete(ring);
      }
      this.live = liveRings;
      this.previousCpu = nextCpu;
      this.busyStreak = nextBusyStreak;
      return this.current();
    }).catch(() => this.current()).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}

module.exports = {
  BUILTIN_PROCESS_NAMES,
  MIN_ACTIVE_SAMPLES,
  MIN_CPU_DELTA_SECONDS,
  PROCESS_GRACE_MS,
  ProcessActivityTracker,
  activityExecutable,
  cpuTimeSeconds,
  customProcessMappings,
  normalizeProcessName,
  parseUnixSamples,
  parseWindowsSamples,
  ringForProcess,
  ringsForProcess,
  sampleAgentProcesses,
  supportsProcessOnlyActivity
};
