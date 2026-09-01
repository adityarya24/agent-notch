const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateQuotaAlerts, formatAlertBody } = require('../electron/alert-notify');

function model(id, percent, extra = {}) {
  return {
    id,
    name: extra.name || id,
    quotaState: extra.quotaState || 'known',
    stale: Boolean(extra.stale),
    ringPercent: percent,
    sessionUsedPercent: extra.sessionUsedPercent ?? percent,
    weeklyUsedPercent: extra.weeklyUsedPercent ?? 10,
    alertThreshold: extra.alertThreshold,
    ...extra
  };
}

function evalAlerts(partial) {
  return evaluateQuotaAlerts({
    visible: false,
    notifyEnabled: true,
    defaultThreshold: 80,
    firedIds: [],
    ...partial
  });
}

test('first known reading arms but does not notify', () => {
  const result = evalAlerts({
    previousModels: [],
    nextModels: [model('grok', 91)]
  });
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.firedIds, ['grok']);
});

test('crossing the threshold while tucked notifies once', () => {
  const first = evalAlerts({
    previousModels: [model('grok', 72)],
    nextModels: [model('grok', 84, { sessionUsedPercent: 84, weeklyUsedPercent: 40 })]
  });
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].id, 'grok');
  assert.equal(first.events[0].percent, 84);
  assert.equal(first.events[0].window, 'session');
  assert.equal(formatAlertBody(first.events[0]), 'grok hit 84% (session)');

  const second = evalAlerts({
    previousModels: [model('grok', 84)],
    nextModels: [model('grok', 88)],
    firedIds: first.firedIds
  });
  assert.deepEqual(second.events, []);
});

test('expanded rings arm silently so a later tuck does not replay', () => {
  const open = evalAlerts({
    visible: true,
    previousModels: [model('claude', 70)],
    nextModels: [model('claude', 90)]
  });
  assert.deepEqual(open.events, []);
  assert.ok(open.firedIds.includes('claude'));

  const tucked = evalAlerts({
    previousModels: [model('claude', 90)],
    nextModels: [model('claude', 91)],
    firedIds: open.firedIds
  });
  assert.deepEqual(tucked.events, []);
});

test('disabled notify still arms so turning it on is not a dump', () => {
  const result = evalAlerts({
    notifyEnabled: false,
    previousModels: [model('codex', 60)],
    nextModels: [model('codex', 95)]
  });
  assert.deepEqual(result.events, []);
  assert.ok(result.firedIds.includes('codex'));
});

test('stale and unknown readings never notify', () => {
  const stale = evalAlerts({
    previousModels: [model('cursor', 70)],
    nextModels: [model('cursor', 90, { stale: true })]
  });
  assert.deepEqual(stale.events, []);

  const unknown = evalAlerts({
    previousModels: [model('cursor', 70)],
    nextModels: [model('cursor', 90, { quotaState: 'unknown' })]
  });
  assert.deepEqual(unknown.events, []);
});

test('weekly window is named when it is the ring max', () => {
  const result = evalAlerts({
    previousModels: [model('gemini', 50, { sessionUsedPercent: 20, weeklyUsedPercent: 50 })],
    nextModels: [model('gemini', 81, { sessionUsedPercent: 20, weeklyUsedPercent: 81 })]
  });
  assert.equal(result.events[0].window, 'weekly');
  assert.equal(formatAlertBody(result.events[0]), 'gemini hit 81% (weekly)');
});

test('hysteresis waits until quota falls 3 points under threshold', () => {
  const fired = evalAlerts({
    previousModels: [model('opencode', 70)],
    nextModels: [model('opencode', 80)]
  });
  assert.equal(fired.events.length, 1);

  const stillHot = evalAlerts({
    previousModels: [model('opencode', 80)],
    nextModels: [model('opencode', 78)],
    firedIds: fired.firedIds
  });
  assert.deepEqual(stillHot.events, []);
  assert.ok(stillHot.firedIds.includes('opencode'));

  const cooled = evalAlerts({
    previousModels: [model('opencode', 78)],
    nextModels: [model('opencode', 77)],
    firedIds: stillHot.firedIds
  });
  assert.ok(!cooled.firedIds.includes('opencode'));

  const recross = evalAlerts({
    previousModels: [model('opencode', 77)],
    nextModels: [model('opencode', 80)],
    firedIds: cooled.firedIds
  });
  assert.equal(recross.events.length, 1);
});

test('two accounts can cross in the same tick', () => {
  const result = evalAlerts({
    previousModels: [model('claude', 60), model('grok', 60)],
    nextModels: [model('claude', 82), model('grok', 99)]
  });
  assert.deepEqual(result.events.map((event) => event.id), ['claude', 'grok']);
});

test('per-model alertThreshold is used when present', () => {
  const result = evalAlerts({
    defaultThreshold: 80,
    previousModels: [model('custom_1', 50, { alertThreshold: 60 })],
    nextModels: [model('custom_1', 61, { alertThreshold: 60 })]
  });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].id, 'custom_1');
});
