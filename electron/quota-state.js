const DEFAULT_STALE_TTL_MS = 5 * 60 * 1000;

function activityFingerprint(activity, activeRings = []) {
  const rings = [...new Set(activeRings || [])].sort().join(',');
  if (!activity) return rings;
  const handoff = activity.handoff;
  return `${rings}|${activity.jobId || ''}:${activity.jobStatus || ''}:${activity.activeAgent || ''}:${handoff ? `${handoff.at}:${handoff.from}->${handoff.to}` : ''}`;
}

function quotaFingerprint(data) {
  if (!data || !Array.isArray(data.models)) return '';
  const models = data.models
    .map((model) => [
      model.id,
      model.ringPercent,
      model.quotaState,
      model.authState,
      model.status,
      model.sessionUsedPercent,
      model.weeklyUsedPercent,
      model.stale ? 'stale' : 'fresh',
      model.lastError || ''
    ].join(':'))
    .join('|');
  return `${models}|${activityFingerprint(data.jobActivity, data.activeRings)}`;
}

function keepLastKnown(previous, next, now = Date.now(), staleTtlMs = DEFAULT_STALE_TTL_MS) {
  if (!previous || !Array.isArray(previous.models) || !next || !Array.isArray(next.models)) return next;
  const previousById = Object.fromEntries(previous.models.map((model) => [model.id, model]));
  return {
    ...next,
    models: next.models.map((model) => {
      const old = previousById[model.id];
      if (!old || model.quotaState === 'known') return { ...model, stale: false };
      if (model.quotaState === 'expired' || model.authState === 'expired') return { ...model, stale: false };
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

// Opt-in observability: `NOTCH_DEBUG_PROVIDER=claude,grok` (or `all`) records what a
// reader actually returned next to what the UI was shown. The persisted cache cannot
// tell those apart -- a held-over reading and a fresh one both say "known".
function debugProviderFilter(spec) {
  const raw = String(spec || '').trim();
  if (!raw) return null;
  if (raw === '1' || raw.toLowerCase() === 'all') return () => true;
  const ids = new Set(raw.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean));
  return ids.size ? (id) => ids.has(String(id).toLowerCase()) : null;
}

function formatProviderDebug(live, merged, spec, now = Date.now()) {
  const match = debugProviderFilter(spec);
  if (!match) return [];
  const shownById = Object.fromEntries(((merged && merged.models) || []).map((model) => [model.id, model]));
  const stamp = new Date(now).toISOString();
  return (((live && live.models) || []))
    .filter((model) => match(model.id))
    .map((model) => {
      const shown = shownById[model.id] || {};
      return `[quota] ${stamp} id=${model.id} live=${model.quotaState}`
        + ` rateLimited=${model.rateLimited ? 1 : 0} observedAt=${model.observedAt || '-'}`
        + ` shown=${shown.quotaState || '-'} stale=${shown.stale ? 1 : 0}`
        + ` note="${model.sessionResetText || ''}"`;
    });
}

module.exports = { DEFAULT_STALE_TTL_MS, activityFingerprint, formatProviderDebug, keepLastKnown, quotaFingerprint };

