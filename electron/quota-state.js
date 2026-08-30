const DEFAULT_STALE_TTL_MS = 5 * 60 * 1000;

function activityFingerprint(activity) {
  if (!activity) return '';
  const handoff = activity.handoff;
  return `${activity.jobId || ''}:${activity.jobStatus || ''}:${activity.activeAgent || ''}:${handoff ? `${handoff.at}:${handoff.from}->${handoff.to}` : ''}`;
}

function quotaFingerprint(data) {
  if (!data || !Array.isArray(data.models)) return '';
  const models = data.models
    .map((model) => [
      model.id,
      model.ringPercent,
      model.quotaState,
      model.status,
      model.sessionUsedPercent,
      model.weeklyUsedPercent,
      model.stale ? 'stale' : 'fresh',
      model.lastError || ''
    ].join(':'))
    .join('|');
  return `${models}|${activityFingerprint(data.jobActivity)}`;
}

function keepLastKnown(previous, next, now = Date.now(), staleTtlMs = DEFAULT_STALE_TTL_MS) {
  if (!previous || !Array.isArray(previous.models) || !next || !Array.isArray(next.models)) return next;
  const previousById = Object.fromEntries(previous.models.map((model) => [model.id, model]));
  return {
    ...next,
    models: next.models.map((model) => {
      const old = previousById[model.id];
      if (!old || model.quotaState === 'known') return { ...model, stale: false };
      if (old.quotaState !== 'known' && !old.stale) return model;
      const observedAt = Date.parse(String(old.observedAt || ''));
      const ageMs = Number.isFinite(observedAt) ? Math.max(0, now - observedAt) : Number.POSITIVE_INFINITY;
      if (ageMs > staleTtlMs) return model;
      return {
        ...old,
        stale: true,
        staleAgeMs: ageMs,
        attemptedAt: model.attemptedAt,
        lastError: model.sessionResetText || model.weeklyResetText || 'Usage refresh failed'
      };
    })
  };
}

module.exports = { DEFAULT_STALE_TTL_MS, activityFingerprint, keepLastKnown, quotaFingerprint };
