'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { OVERLAY, overlaySize, overlayBounds } = require('../electron/overlay-geometry');

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1032 };
const MODES = Object.keys(OVERLAY);

test('every overlay mode declares the same footprint', () => {
  const sizes = MODES.map((mode) => JSON.stringify(overlaySize(mode)));
  assert.strictEqual(new Set(sizes).size, 1, `modes differ in size: ${sizes.join(' ')}`);
});

test('switching modes never moves the window', () => {
  // This is the whole point: if bounds are identical, snapOverlay early-returns
  // and the HUD cannot drift when settings opens or closes.
  const bounds = MODES.map((mode) => JSON.stringify(overlayBounds(mode, WORK_AREA)));
  assert.strictEqual(new Set(bounds).size, 1, `modes differ in bounds: ${bounds.join(' ')}`);
});

test('the window stays anchored to the right edge of the work area', () => {
  for (const mode of MODES) {
    const b = overlayBounds(mode, WORK_AREA);
    assert.strictEqual(b.x + b.width, WORK_AREA.x + WORK_AREA.width, `${mode} right edge drifted`);
  }
});

test('the window stays vertically centred in the work area', () => {
  for (const mode of MODES) {
    const b = overlayBounds(mode, WORK_AREA);
    assert.strictEqual(b.y + (b.height / 2), WORK_AREA.y + (WORK_AREA.height / 2), `${mode} centre drifted`);
  }
});

test('the settings panel still fits: modal 300 + margin 8 + rail 92', () => {
  assert.ok(overlaySize('settings').width >= 300 + 8 + 92);
  assert.ok(overlaySize('settings').height >= 460, 'modal max-height must fit');
});

test('an unknown mode falls back to the dock footprint', () => {
  assert.deepStrictEqual(overlaySize('nonsense'), overlaySize('dock'));
});

test('bounds are never negative on a work area offset by a taskbar', () => {
  const offset = { x: 0, y: 48, width: 1366, height: 720 };
  for (const mode of MODES) {
    const b = overlayBounds(mode, offset);
    assert.ok(b.x >= 0 && b.y >= 0, `${mode} positioned off-screen`);
  }
});
