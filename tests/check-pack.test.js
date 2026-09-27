const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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

test('package report parser accepts the newer npm object keyed by package name', () => {
  // Newer npm prints `{ "agent-notch": { ... } }` instead of `[{ ... }]`; CI's npm
  // still prints the array, so only a local run caught the difference.
  const report = { size: 123, files: [{ path: 'dist/index.html' }] };
  const output = [
    'build complete',
    JSON.stringify({ 'agent-notch': report }, null, 2)
  ].join('\n');

  assert.deepEqual(parsePackReport(output), [report]);
});

test('every electron main-process file parses', () => {
  // `npm test` never requires main.js -- it needs an Electron runtime -- so a syntax
  // error there sails past a fully green suite and only shows up as a window that
  // never appears. Parse each file instead.
  const dir = path.join(__dirname, '..', 'electron');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js'));
  assert.ok(files.includes('main.js'), 'expected electron/main.js to exist');
  for (const name of files) {
    const result = spawnSync(process.execPath, ['--check', path.join(dir, name)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `electron/${name} failed to parse:\n${result.stderr}`);
  }
});
