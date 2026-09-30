const { execFile } = require('child_process');
const {
  buildMatchHaystack,
  builtinNameExcluded,
  customFingerprintMappings,
  isRuntimeProcessName,
  ringsFromBuiltinFingerprints,
  ringsFromCustomFingerprints,
  sanitizeFingerprint
} = require('./fingerprints');

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

/**
 * Full activity bindings for name + fingerprint matching.
 * Accepts legacy plain process-name maps for older call sites/tests.
 */
function normalizeActivityBindings(input) {
  if (!input) return { byProcess: Object.create(null), fingerprints: [] };
  if (Array.isArray(input)) {
    return {
      byProcess: customProcessMappings(input),
      fingerprints: customFingerprintMappings(input)
    };
  }
  if (input.byProcess || input.fingerprints || input.customAgents) {
    const byProcess = input.byProcess || customProcessMappings(input.customAgents);
    const fingerprints = input.fingerprints || customFingerprintMappings(input.customAgents);
    return { byProcess: byProcess || Object.create(null), fingerprints: fingerprints || [] };
  }
  // Legacy: { 'fixture-agent': ['custom_a'] }
  return { byProcess: input, fingerprints: [] };
}

function customActivityBindings(customAgents) {
  return {
    byProcess: customProcessMappings(customAgents),
    fingerprints: customFingerprintMappings(customAgents)
  };
}

function ringsForProcess(rawName, customMappings = {}) {
  const bindings = normalizeActivityBindings(customMappings);
  const name = normalizeProcessName(rawName);
  const rings = new Set();
  const builtin = ringForProcess(name);
  if (builtin) rings.add(builtin);
  const customRings = Object.prototype.hasOwnProperty.call(bindings.byProcess || {}, name)
    && Array.isArray(bindings.byProcess[name]) ? bindings.byProcess[name] : [];
  for (const id of customRings) rings.add(id);
  return [...rings];
}

function ringsForSample(sample, customMappings = {}) {
  const bindings = normalizeActivityBindings(customMappings);
  const name = normalizeProcessName(sample?.name || sample?.processName || '');
  const haystack = buildMatchHaystack(
    sample?.executablePath || sample?.path || '',
    sample?.commandLine || sample?.args || '',
    sample?.name || ''
  );
  const rings = new Set();

  const builtin = ringForProcess(name);
  if (builtin && !builtinNameExcluded(builtin, haystack)) rings.add(builtin);

  const customRings = Object.prototype.hasOwnProperty.call(bindings.byProcess || {}, name)
    && Array.isArray(bindings.byProcess[name]) ? bindings.byProcess[name] : [];
  for (const id of customRings) rings.add(id);

  for (const ring of ringsFromBuiltinFingerprints(haystack)) rings.add(ring);
  for (const ring of ringsFromCustomFingerprints(haystack, bindings.fingerprints)) rings.add(ring);

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
    pid: Number(row.Id ?? row.ProcessId ?? row.pid),
    name: String(row.ProcessName || row.Name || ''),
    cpuSeconds: Number(row.CPU ?? row.cpuSeconds),
    ...(row.CommandLine != null || row.commandLine != null
      ? { commandLine: String(row.CommandLine ?? row.commandLine) }
      : {}),
    ...(row.ExecutablePath != null || row.Path != null
      ? { executablePath: String(row.ExecutablePath ?? row.Path) }
      : {})
  })).filter((row) => Number.isFinite(row.pid) && Number.isFinite(row.cpuSeconds));
}

function parseUnixSamples(stdout) {
  const rows = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // pid, comm, cputime [, args...]  — args optional for backward-compatible fixtures
    const match = trimmed.match(/^(\d+)\s+(\S+)\s+([\d:-]+)(?:\s+(.*))?$/);
    if (!match) continue;
    const cpuSeconds = cpuTimeSeconds(match[3]);
    if (!Number.isFinite(cpuSeconds)) continue;
    const row = { pid: Number(match[1]), name: match[2], cpuSeconds };
    if (match[4] != null && match[4] !== '') row.commandLine = match[4];
    rows.push(row);
  }
  return rows;
}

function execSamples(file, args, parser) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 2500, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error ? [] : parser(stdout));
    });
  });
}

/**
 * Classify fixture/live samples into rings. Pure + cache-aware for tests and tracker.
 * cache: Map pid -> string[]|null (null = inspected, no ring)
 */
function classifyProcessSamples(samples, customMappings = {}, cache = new Map()) {
  const bindings = normalizeActivityBindings(customMappings);
  const liveRings = new Set();
  const pidToRings = new Map();
  const nextCache = new Map();

  for (const row of samples || []) {
    if (!Number.isFinite(row.pid)) continue;
    const name = normalizeProcessName(row.name);
    const hasCmd = row.commandLine != null || row.executablePath != null || row.path != null;
    const isRuntime = isRuntimeProcessName(name);

    let rings;
    // Runtimes without a fresh cmdline reuse pid → ring|null cache (skip re-parse).
    if (isRuntime && !hasCmd && cache.has(row.pid)) {
      const cached = cache.get(row.pid);
      nextCache.set(row.pid, cached);
      rings = cached || [];
    } else {
      rings = ringsForSample(row, bindings);
      if (isRuntime || hasCmd) {
        nextCache.set(row.pid, rings.length ? rings : null);
      }
    }

    if (!rings.length) continue;
    pidToRings.set(row.pid, rings);
    for (const ring of rings) liveRings.add(ring);
  }

  // Dead pids are evicted by omission (nextCache only contains pids seen this sample).

  return {
    liveRings: [...liveRings].sort(),
    pidToRings,
    cache: nextCache,
    pidsForRing(ring) {
      const out = [];
      for (const [pid, rings] of pidToRings.entries()) {
        if (rings.includes(ring)) out.push(pid);
      }
      return out.sort((a, b) => a - b);
    }
  };
}

/**
 * Fixed PowerShell — no user/fingerprint strings interpolated (safety).
 * Named builtins by ProcessName; runtimes via CIM CommandLine for fingerprint match in JS.
 */
function sampleAgentProcesses(extraNames = [], platform = process.platform) {
  if (platform === 'win32') {
    const names = [...new Set([...BUILTIN_PROCESS_NAMES, ...extraNames])]
      .map(normalizeProcessName)
      .filter((name) => /^[a-z0-9._-]{1,80}$/.test(name));
    const literals = names.map((name) => `'${name}'`).join(',');
    // Fingerprints are matched in JS after fetch — never spliced into this script.
    // One CIM query for named agents and runtimes, so every row carries its
    // command line (needed e.g. to skip codex's app-server daemon).
    // Fingerprints are matched in JS after the fetch; never spliced in here.
    const command = [
      `$names = @(${literals})`,
      "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $n = ($_.Name -replace '\\.exe$','').ToLower(); ($names -contains $n) -or ($n -match '^(node|bun|deno|python|pythonw|ruby|java|javaw)$') } | ForEach-Object { [pscustomobject]@{ ProcessName = ($_.Name -replace '\\.exe$',''); Id = $_.ProcessId; CPU = [double](($_.KernelModeTime + $_.UserModeTime) / 10000000.0); CommandLine = $_.CommandLine; ExecutablePath = $_.ExecutablePath } } | ConvertTo-Json -Compress -Depth 3"
    ].join('; ');
    return execSamples('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], parseWindowsSamples);
  }
  return execSamples('ps', ['-A', '-o', 'pid=,comm=,time=,args='], parseUnixSamples);
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
    this.pidToRings = new Map();
    this.pidRingCache = new Map();
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

  pidsForRing(ring) {
    const out = [];
    for (const [pid, rings] of this.pidToRings.entries()) {
      if (rings.includes(ring)) out.push(pid);
    }
    return out.sort((a, b) => a - b);
  }

  sample(customMappings = {}) {
    if (this.pending) return this.pending;
    const bindings = normalizeActivityBindings(customMappings);
    const extraNames = Object.keys(bindings.byProcess || {});
    this.pending = Promise.resolve(this.sampler(extraNames)).then((samples) => {
      const now = this.now();
      const nextCpu = new Map();
      const nextBusyStreak = new Map();
      const classified = classifyProcessSamples(samples, bindings, this.pidRingCache);
      this.pidRingCache = classified.cache;
      this.pidToRings = classified.pidToRings;
      const liveRings = new Set(classified.liveRings);

      for (const row of samples || []) {
        if (!Number.isFinite(row.pid) || !Number.isFinite(row.cpuSeconds)) continue;
        const rings = classified.pidToRings.get(row.pid) || [];
        if (!rings.length) continue;
        for (const ring of rings) {
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
  classifyProcessSamples,
  cpuTimeSeconds,
  customActivityBindings,
  customProcessMappings,
  normalizeActivityBindings,
  normalizeProcessName,
  parseUnixSamples,
  parseWindowsSamples,
  ringForProcess,
  ringsForProcess,
  ringsForSample,
  sampleAgentProcesses,
  supportsProcessOnlyActivity,
  sanitizeFingerprint
};
