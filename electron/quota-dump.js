const DUMP_FIELDS = [
  'id',
  'name',
  'provider',
  'icon',
  'quotaState',
  'authState',
  'status',
  'ringPercent',
  'sessionUsedPercent',
  'weeklyUsedPercent',
  'alertThreshold',
  'sessionLabel',
  'weeklyLabel',
  'sessionResetText',
  'weeklyResetText',
  'observedAt',
  'stale',
  'staleAgeMs',
  'lastError'
];

function pickDumpModel(model) {
  if (!model || typeof model !== 'object') return null;
  const id = typeof model.id === 'string' && model.id ? model.id : null;
  if (!id) return null;
  const row = {};
  for (const field of DUMP_FIELDS) {
    if (model[field] === undefined) continue;
    row[field] = model[field];
  }
  row.id = id;
  return row;
}

function buildQuotaDump(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.models)) {
    return { ok: false, source: 'cache', reason: 'no-cache', models: [] };
  }
  const models = snapshot.models.map(pickDumpModel).filter(Boolean);
  if (!models.length) {
    return { ok: false, source: 'cache', reason: 'empty', models: [] };
  }
  return {
    ok: true,
    source: 'cache',
    savedAt: snapshot.lastUpdated || null,
    models
  };
}

module.exports = { DUMP_FIELDS, buildQuotaDump, pickDumpModel };
