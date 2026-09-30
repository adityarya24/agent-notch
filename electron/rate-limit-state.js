const fs = require('fs');
const path = require('path');

const CACHE_VERSION = 1;
const MAX_STATE_BYTES = 64 * 1024;

function safeReaderId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 ? value : null;
}

function safeStreak(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1000 ? value : null;
}

function safeCooldownUntil(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function sanitizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const cooldownUntil = safeCooldownUntil(entry.cooldownUntil);
  const streak = safeStreak(entry.streak);
  if (cooldownUntil == null || streak == null) return null;
  return { cooldownUntil, streak };
}

function createRateLimitSnapshot(readers) {
  if (!readers || typeof readers !== 'object' || Array.isArray(readers)) return null;
  const clean = {};
  for (const [id, entry] of Object.entries(readers)) {
    const key = safeReaderId(id);
    const safe = sanitizeEntry(entry);
    if (!key || !safe) continue;
    // Drop fully idle entries so a clean restart stays empty.
    if (safe.cooldownUntil <= 0 && safe.streak <= 0) continue;
    clean[key] = safe;
  }
  return {
    version: CACHE_VERSION,
    readers: clean
  };
}

function parseRateLimitSnapshot(value, now = Date.now()) {
  if (!value || value.version !== CACHE_VERSION || !value.readers || typeof value.readers !== 'object') {
    return null;
  }
  const readers = {};
  for (const [id, entry] of Object.entries(value.readers)) {
    const key = safeReaderId(id);
    const safe = sanitizeEntry(entry);
    if (!key || !safe) continue;
    // Expired cooldown with zero streak is noise.
    if (safe.cooldownUntil <= now && safe.streak <= 0) continue;
    readers[key] = safe;
  }
  return { readers };
}

function readRateLimitState(filePath, now = Date.now()) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_STATE_BYTES) return null;
    return parseRateLimitSnapshot(JSON.parse(fs.readFileSync(filePath, 'utf8')), now);
  } catch (err) {
    return null;
  }
}

function writeRateLimitState(filePath, readers) {
  const snapshot = createRateLimitSnapshot(readers);
  if (!snapshot) return false;
  const dir = path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tempPath, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      fs.copyFileSync(tempPath, filePath);
      fs.unlinkSync(tempPath);
    }
    return true;
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (cleanupErr) {}
    return false;
  }
}

module.exports = {
  CACHE_VERSION,
  createRateLimitSnapshot,
  parseRateLimitSnapshot,
  readRateLimitState,
  writeRateLimitState
};
