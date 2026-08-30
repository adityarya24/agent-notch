const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePackReport } = require('../scripts/check-pack');

test('package report parser ignores lifecycle output before npm JSON', () => {
  const output = [
    '\u001b[36mvite v6.4.3 building for production...\u001b[39m',
    'build complete',
    JSON.stringify([{ size: 123, files: [{ path: 'dist/index.html' }] }], null, 2)
  ].join('\n');

  assert.deepEqual(parsePackReport(output), [
    { size: 123, files: [{ path: 'dist/index.html' }] }
  ]);
});
