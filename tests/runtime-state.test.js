const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../electron/runtime-state');

test('PID state only clears when the expected process owns it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notch-state-'));
  const pidPath = path.join(root, 'notch.pid');
  try {
    runtime.writePid(12345, pidPath);
    assert.equal(runtime.readPid(pidPath), 12345);
    assert.equal(runtime.clearPid(99999, pidPath), false);
    assert.equal(runtime.readPid(pidPath), 12345);
    assert.equal(runtime.clearPid(12345, pidPath), true);
    assert.equal(runtime.readPid(pidPath), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
