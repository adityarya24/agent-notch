const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_ACTIVITY_WINDOW_MS = 25 * 1000;
const MAX_SCAN_ENTRIES = 5000;

function sessionArtifact(relativePath, fileName) {
  const rel = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  const parts = rel.split('/').filter(Boolean);
  return {
    codex: name.startsWith('rollout-') && name.endsWith('.jsonl'),
    claude: parts.length === 2 && name.endsWith('.jsonl'),
    grok: ['events.jsonl', 'updates.jsonl', 'summary.json', 'resources_state.json'].includes(name),
    cursor: (rel.includes('/agent-transcripts/') && name.endsWith('.jsonl')) || name === 'worker.log',
    cursorTranscript: name.endsWith('.jsonl'),
    cursorWorker: name === 'worker.log',
    gemini: ['conversation.db', 'conversation.db-wal', 'conversation.db-shm'].includes(name) ||
      (/\.db(-wal|-shm)?$/.test(name) && parts.length <= 2),
    opencode: ['opencode.db', 'opencode.db-wal', 'opencode.db-shm'].includes(name)
  };
}

function latestArtifactMtime(root, ring, maxDepth, maxEntries = MAX_SCAN_ENTRIES) {
  let latest = 0;
  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > maxDepth || visited >= maxEntries) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (visited >= maxEntries) break;
      visited += 1;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, fullPath);
      if (!sessionArtifact(relative, entry.name)[ring]) continue;
      try {
        latest = Math.max(latest, fs.statSync(fullPath).mtimeMs || 0);
      } catch (e) {}
    }
  };
  walk(root, 0);
  return latest;
}

function sessionDayRoots(sessionsRoot, now) {
  const days = new Set();
  for (const offset of [0, 24 * 60 * 60 * 1000]) {
    const date = new Date(now - offset);
    const local = [date.getFullYear(), date.getMonth() + 1, date.getDate()];
    const utc = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    for (const parts of [local, utc]) {
      days.add(parts.map((part, index) => index ? String(part).padStart(2, '0') : String(part)).join('/'));
    }
  }
  return [...days].map((day) => path.join(sessionsRoot, ...day.split('/')));
}

function childDirectories(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch (e) {
    return [];
  }
}

function providerRoots(homeDir, env = process.env, now = Date.now()) {
  const codexHome = String(env.CODEX_HOME || '').trim() || path.join(homeDir, '.codex');
  const claudeHome = String(env.CLAUDE_CONFIG_DIR || '').trim() || path.join(homeDir, '.claude');
  const grokHome = String(env.GROK_HOME || env.XAI_HOME || '').trim() || path.join(homeDir, '.grok');
  const xdgDataHome = String(env.XDG_DATA_HOME || '').trim();
  const opencodeHome = xdgDataHome ? path.join(xdgDataHome, 'opencode') : path.join(homeDir, '.local', 'share', 'opencode');
  const cursorProjects = childDirectories(path.join(homeDir, '.cursor', 'projects'));
  return [
    ...sessionDayRoots(path.join(codexHome, 'sessions'), now).map((root) => ({ ring: 'codex', root, maxDepth: 0 })),
    { ring: 'claude', root: path.join(claudeHome, 'projects'), maxDepth: 2 },
    { ring: 'grok', root: path.join(grokHome, 'sessions'), maxDepth: 3 },
    ...cursorProjects.map((root) => ({ ring: 'cursor', artifact: 'cursorWorker', root, maxDepth: 0 })),
    ...cursorProjects.map((root) => ({ ring: 'cursor', artifact: 'cursorTranscript', root: path.join(root, 'agent-transcripts'), maxDepth: 2 })),
    { ring: 'gemini', root: path.join(homeDir, '.gemini', 'antigravity-cli', 'conversations'), maxDepth: 2 },
    { ring: 'gemini', root: path.join(homeDir, '.gemini', 'antigravity', 'conversations'), maxDepth: 2 },
    { ring: 'opencode', root: opencodeHome, maxDepth: 0 }
  ];
}

function readDirectAgentActivity({
  homeDir = os.homedir(),
  now = Date.now(),
  freshnessMs = DEFAULT_ACTIVITY_WINDOW_MS,
  roots = providerRoots(homeDir, process.env, now),
  includeRings = null
} = {}) {
  const included = includeRings ? new Set(includeRings) : null;
  const latestByRing = new Map();
  for (const spec of roots) {
    if (included && !included.has(spec.ring)) continue;
    const mtimeMs = latestArtifactMtime(spec.root, spec.artifact || spec.ring, spec.maxDepth);
    if (!mtimeMs || now - mtimeMs > freshnessMs || mtimeMs - now > 5000) continue;
    latestByRing.set(spec.ring, Math.max(latestByRing.get(spec.ring) || 0, mtimeMs));
  }
  return [...latestByRing.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([activeRing, mtimeMs]) => ({
      activeRing,
      source: 'local-session',
      lastActivityAt: new Date(mtimeMs).toISOString()
    }));
}

function mergeActiveRings(jobActivity, directActivities) {
  const rings = new Set();
  if (jobActivity && jobActivity.jobStatus === 'running' && jobActivity.activeRing) {
    rings.add(jobActivity.activeRing);
  }
  for (const activity of directActivities || []) {
    if (activity && activity.activeRing) rings.add(activity.activeRing);
  }
  return [...rings].sort();
}

module.exports = {
  childDirectories,
  DEFAULT_ACTIVITY_WINDOW_MS,
  latestArtifactMtime,
  mergeActiveRings,
  providerRoots,
  readDirectAgentActivity,
  sessionDayRoots
};
