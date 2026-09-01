const fs = require('fs');
const path = require('path');

const CACHE_VERSION = 1;
const MAX_CACHE_BYTES = 64 * 1024;
const PERSISTED_QUOTA_TTL_MS = 24 * 60 * 60 * 1000;

const STRING_FIELDS = [
  'id',
  'name',
  'provider',
  'icon',
  'authState',
  'status',
  'sessionLabel',
  'weeklyLabel',
  'sessionResetText',
  'weeklyResetText',
  'observedAt'
];
const PERCENT_FIELDS = [
  'ringPercent',
  'sessionUsedPercent',
  'weeklyUsedPercent',
  'alertThreshold'
];

function safeString(value, maxLength = 240) {
  return typeof value === 'string' && value.length <= maxLength ? value : undefined;
}

function safePercent(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

function sanitizeKnownModel(model) {
  if (!model || model.quotaState !== 'known') return null;
  const id = safeString(model.id, 100);
  const observedAt = safeString(model.observedAt, 64);
  if (!id || !observedAt || !Number.isFinite(Date.parse(observedAt))) return null;

  const safe = { id, quotaState: 'known', observedAt };
  for (const field of STRING_FIELDS) {
    if (field === 'id' || field === 'observedAt') continue;
    const value = safeString(model[field]);
    if (value !== undefined) safe[field] = value;
  }
  for (const field of PERCENT_FIELDS) {
    const value = safePercent(model[field]);
    if (value !== undefined) safe[field] = value;
  }
  if (safe.ringPercent === undefined
      && safe.sessionUsedPercent === undefined
      && safe.weeklyUsedPercent === undefined) return null;
  return safe;
}

function createQuotaSnapshot(data, now = Date.now()) {
  if (!data || !Array.isArray(data.models)) return null;
  const models = data.models.map(sanitizeKnownModel).filter(Boolean);
  if (!models.length) return null;
  return {
    version: CACHE_VERSION,
    savedAt: new Date(now).toISOString(),
    models
  };
}

function parseQuotaSnapshot(value, now = Date.now(), ttlMs = PERSISTED_QUOTA_TTL_MS) {
  if (!value || value.version !== CACHE_VERSION || !Array.isArray(value.models)) return null;
  const models = value.models
    .map(sanitizeKnownModel)
    .filter(Boolean)
    .filter((model) => {
      const observedAt = Date.parse(model.observedAt);
      return observedAt <= now + 60_000 && now - observedAt <= ttlMs;
    })
    .map((model) => ({
      ...model,
      stale: true,
      staleAgeMs: Math.max(0, now - Date.parse(model.observedAt)),
      lastError: 'Waiting for a fresh quota reading'
    }));
  if (!models.length) return null;
  return {
    models,
    lastUpdated: safeString(value.savedAt, 64) || null
  };
}

function readQuotaCache(filePath, now = Date.now(), ttlMs = PERSISTED_QUOTA_TTL_MS) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CACHE_BYTES) return null;
    return parseQuotaSnapshot(JSON.parse(fs.readFileSync(filePath, 'utf8')), now, ttlMs);
  } catch (err) {
    return null;
  }
}

function writeQuotaCache(filePath, data, now = Date.now()) {
  const snapshot = createQuotaSnapshot(data, now);
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
  PERSISTED_QUOTA_TTL_MS,
  createQuotaSnapshot,
  parseQuotaSnapshot,
  readQuotaCache,
  writeQuotaCache
};
