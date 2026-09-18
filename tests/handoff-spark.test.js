const assert = require('node:assert/strict');
const test = require('node:test');

// Keep in sync with src/handoffSpark.js — Node tests are CJS, the HUD is ESM.
function sparkStops(railBox, fromBox, toBox) {
  if (!railBox || !fromBox || !toBox) return null;
  return {
    from: fromBox.top + fromBox.height / 2 - railBox.top,
    to: toBox.top + toBox.height / 2 - railBox.top
  };
}

test('spark stops travel from the source ring centre to the destination', () => {
  const rail = { top: 100 };
  const from = { top: 140, height: 50 };
  const to = { top: 260, height: 50 };
  assert.deepEqual(sparkStops(rail, from, to), { from: 65, to: 185 });
});

test('spark stops fail closed when a ring is missing', () => {
  assert.equal(sparkStops({ top: 0 }, { top: 10, height: 10 }, null), null);
});
