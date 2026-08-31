const assert = require('node:assert/strict');
const test = require('node:test');
const { moveId, sanitizeModelOrder, sortModelsByOrder } = require('../electron/model-order');

test('sortModelsByOrder follows saved ids then appends newcomers', () => {
  const models = [{ id: 'codex' }, { id: 'claude' }, { id: 'grok' }];
  assert.deepEqual(sortModelsByOrder(models, ['grok', 'codex']).map((m) => m.id), ['grok', 'codex', 'claude']);
  assert.deepEqual(sortModelsByOrder(models, []).map((m) => m.id), ['codex', 'claude', 'grok']);
});

test('moveId reorders without dropping items', () => {
  assert.deepEqual(moveId(['a', 'b', 'c', 'd'], 'd', 'a'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveId(['a', 'b', 'c'], 'b', 'c'), ['a', 'c', 'b']);
  assert.deepEqual(moveId(['a', 'b'], 'x', 'a'), ['a', 'b']);
});

test('sanitizeModelOrder rejects unknowns and caps length', () => {
  const allowed = new Set(['codex', 'grok']);
  assert.deepEqual(sanitizeModelOrder(['grok', 'codex', 'grok', 'nope'], allowed), ['grok', 'codex']);
});
