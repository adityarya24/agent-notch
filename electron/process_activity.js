const { execFile } = require('child_process');
const path = require('path');

const PROCESS_GRACE_MS = 15 * 1000;
const MIN_CPU_DELTA_SECONDS = 0.01;

function ringForProcess(rawName) {
  const name = path.basename(String(rawName || '')).replace(/\.exe$/i, '').toLowerCase();
  if (['codex', 'claude', 'grok', 'opencode'].includes(name)) return name;
  if (['gemini', 'agy', 'antigravity-cli'].includes(name)) return 'gemini';
  if (name === 'cursor-agent') return 'cursor';
  return null;
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

function sampleAgentProcesses(platform = process.platform) {
  if (platform === 'win32') {
    const command = "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('codex','claude','grok','opencode','gemini','agy','antigravity-cli','cursor-agent') } | Select-Object ProcessName,Id,CPU | ConvertTo-Json -Compress";
    return execSamples('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], parseWindowsSamples);
  }
  return execSamples('ps', ['-A', '-o', 'pid=,comm=,time='], parseUnixSamples);
}

class ProcessActivityTracker {
  constructor({
    sampler = sampleAgentProcesses,
    now = () => Date.now(),
    graceMs = PROCESS_GRACE_MS,
    minCpuDeltaSeconds = MIN_CPU_DELTA_SECONDS
  } = {}) {
    this.sampler = sampler;
    this.now = now;
    this.graceMs = graceMs;
    this.minCpuDeltaSeconds = minCpuDeltaSeconds;
    this.previousCpu = new Map();
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

  sample() {
    if (this.pending) return this.pending;
    this.pending = Promise.resolve(this.sampler()).then((samples) => {
      const now = this.now();
      const nextCpu = new Map();
      const liveRings = new Set();
      for (const row of samples || []) {
        const ring = ringForProcess(row.name);
        if (!ring || !Number.isFinite(row.pid) || !Number.isFinite(row.cpuSeconds)) continue;
        liveRings.add(ring);
        const key = `${ring}:${row.pid}`;
        const previous = this.previousCpu.get(key);
        if (Number.isFinite(previous) && row.cpuSeconds - previous >= this.minCpuDeltaSeconds) {
          this.activeUntil.set(ring, now + this.graceMs);
        }
        nextCpu.set(key, row.cpuSeconds);
      }
      for (const ring of this.activeUntil.keys()) {
        if (!liveRings.has(ring)) this.activeUntil.delete(ring);
      }
      this.live = liveRings;
      this.previousCpu = nextCpu;
      return this.current();
    }).catch(() => this.current()).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}

module.exports = {
  MIN_CPU_DELTA_SECONDS,
  PROCESS_GRACE_MS,
  ProcessActivityTracker,
  cpuTimeSeconds,
  parseUnixSamples,
  parseWindowsSamples,
  ringForProcess,
  sampleAgentProcesses
};
