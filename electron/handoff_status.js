const fs = require('fs');
const path = require('path');
const os = require('os');

const RING_IDS = new Set(['codex', 'claude', 'gemini', 'cursor', 'opencode', 'grok']);

function dispatchRoot() {
  const override = (process.env.AGENT_DISPATCH_HOME || '').trim();
  if (override) return override;
  const home = (process.env.MINDSYNC_HOME || '').trim() || path.join(os.homedir(), '.mindsync');
  return path.join(home, 'dispatch');
}

function ringIdForAgent(name) {
  const id = String(name || '').trim().toLowerCase();
  if (!id) return null;
  if (id === 'agy') return 'gemini';
  if (RING_IDS.has(id)) return id;
  return null;
}

function humanReason(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text === 'quota_exhausted') return 'quota exhausted';
  return text.replace(/_/g, ' ');
}

function jobStamp(meta, dirName) {
  return String(
    meta.updatedAt ||
      meta.endedAt ||
      meta.startedAt ||
      (Array.isArray(meta.handoffs) && meta.handoffs.length ? meta.handoffs[meta.handoffs.length - 1].at : '') ||
      dirName
  );
}

const RUNNING_FRESH_MS = 6 * 60 * 60 * 1000;

function isFreshRunning(meta) {
  if (String(meta.status || '') !== 'running') return false;
  const raw = meta.updatedAt || meta.startedAt;
  const t = Date.parse(String(raw || ''));
  if (Number.isNaN(t)) return false;
  return Date.now() - t < RUNNING_FRESH_MS;
}

function pickJob(jobsDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(jobsDir, { withFileTypes: true });
  } catch (e) {
    return null;
  }
  const jobs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(jobsDir, entry.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {
      continue;
    }
    if (!meta || typeof meta !== 'object') continue;
    jobs.push({
      dirName: entry.name,
      meta,
      stamp: jobStamp(meta, entry.name),
      running: isFreshRunning(meta)
    });
  }
  if (!jobs.length) return null;
  const running = jobs.filter((row) => row.running);
  const pool = running.length ? running : [];
  if (!pool.length) return null;
  pool.sort((a, b) => String(b.stamp).localeCompare(String(a.stamp)));
  return pool[0];
}

function routingHint(meta) {
  const block = meta.handoffRouting || meta.routing;
  if (!block || typeof block !== 'object') return '';
  const reason = String(block.reason || '').trim();
  return reason;
}

function lastHandoff(meta) {
  const handoffs = Array.isArray(meta.handoffs) ? meta.handoffs : [];
  const last = handoffs[handoffs.length - 1];
  if (!last || typeof last !== 'object') return null;
  const from = last.from ? String(last.from) : '';
  const to = last.to ? String(last.to) : '';
  if (!from || !to) return null;
  const why = humanReason(last.reason);
  const line = why ? `${from} → ${to} (${why})` : `${from} → ${to}`;
  return {
    from,
    to,
    fromRing: ringIdForAgent(from),
    toRing: ringIdForAgent(to),
    reason: why,
    at: String(last.at || ''),
    line,
    routingHint: routingHint(meta)
  };
}

function readJobActivity() {
  const jobsDir = path.join(dispatchRoot(), 'jobs');
  if (!fs.existsSync(jobsDir)) return null;
  const picked = pickJob(jobsDir);
  if (!picked) return null;
  const meta = picked.meta;
  const agent = meta.agent ? String(meta.agent) : '';
  return {
    jobId: meta.id || picked.dirName,
    jobStatus: String(meta.status || ''),
    activeAgent: agent || null,
    activeRing: ringIdForAgent(agent),
    handoff: lastHandoff(meta),
    routingReason: routingHint(meta)
  };
}

function readHandoffStatus() {
  const activity = readJobActivity();
  return activity && activity.handoff ? {
    ...activity.handoff,
    jobId: activity.jobId,
    jobStatus: activity.jobStatus,
    currentAgent: activity.activeAgent
  } : null;
}

module.exports = { readHandoffStatus, readJobActivity, ringIdForAgent };
