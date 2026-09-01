const REARM_OFFSET = 3;

function isUsable(model) {
  if (!model || model.quotaState !== 'known' || model.stale) return false;
  return Number.isFinite(Number(model.ringPercent));
}

function thresholdOf(model, fallback = 80) {
  const raw = Number(model && model.alertThreshold);
  if (Number.isFinite(raw)) return Math.max(50, Math.min(100, raw));
  const base = Number(fallback);
  return Number.isFinite(base) ? Math.max(50, Math.min(100, base)) : 80;
}

function dominantWindow(model) {
  const session = Number(model && model.sessionUsedPercent);
  const weekly = Number(model && model.weeklyUsedPercent);
  const sessionOk = Number.isFinite(session);
  const weeklyOk = Number.isFinite(weekly);
  if (sessionOk && weeklyOk) {
    return session >= weekly
      ? { percent: session, label: 'session' }
      : { percent: weekly, label: 'weekly' };
  }
  if (sessionOk) return { percent: session, label: 'session' };
  if (weeklyOk) return { percent: weekly, label: 'weekly' };
  return { percent: Number(model && model.ringPercent), label: 'quota' };
}

function formatAlertBody(event) {
  const name = String((event && event.name) || (event && event.id) || 'Agent');
  const percent = Math.round(Number(event && event.percent));
  const label = String((event && event.window) || 'quota');
  return `${name} hit ${percent}% (${label})`;
}

function evaluateQuotaAlerts({
  previousModels = [],
  nextModels = [],
  visible = true,
  notifyEnabled = true,
  firedIds = [],
  defaultThreshold = 80
} = {}) {
  const fired = new Set(Array.isArray(firedIds) ? firedIds : []);
  const events = [];
  const prevById = Object.fromEntries(
    (Array.isArray(previousModels) ? previousModels : [])
      .filter((model) => model && model.id)
      .map((model) => [model.id, model])
  );

  for (const next of Array.isArray(nextModels) ? nextModels : []) {
    if (!next || !next.id) continue;
    const threshold = thresholdOf(next, defaultThreshold);
    const rearmAt = threshold - REARM_OFFSET;
    const usable = isUsable(next);
    const percent = usable ? Number(next.ringPercent) : null;

    if (usable && percent <= rearmAt) fired.delete(next.id);

    if (!usable) continue;

    if (percent < threshold) continue;

    if (!notifyEnabled || visible) {
      fired.add(next.id);
      continue;
    }

    if (fired.has(next.id)) continue;

    const prev = prevById[next.id];
    if (!isUsable(prev) || Number(prev.ringPercent) >= threshold) {
      fired.add(next.id);
      continue;
    }

    const windowInfo = dominantWindow(next);
    events.push({
      id: next.id,
      name: next.name || next.id,
      percent: Math.round(percent),
      window: windowInfo.label
    });
    fired.add(next.id);
  }

  return { events, firedIds: [...fired] };
}

module.exports = {
  REARM_OFFSET,
  dominantWindow,
  evaluateQuotaAlerts,
  formatAlertBody
};
