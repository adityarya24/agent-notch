const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readJobActivity, ringIdForAgent } = require('../electron/handoff_status');

test('Codex orchestrator dispatch alias uses the Codex ring', () => {
  assert.equal(ringIdForAgent('codex-orchestrator'), 'codex');
});

test('real-shaped usage handoff activates Codex and labels the banner', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-handoff-'));
  const previous = process.env.AGENT_DISPATCH_HOME;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_DISPATCH_HOME;
    else process.env.AGENT_DISPATCH_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.AGENT_DISPATCH_HOME = root;
  const jobDir = path.join(root, 'jobs', 'real-shaped');
  fs.mkdirSync(jobDir, { recursive: true });
  const at = new Date().toISOString();
  fs.writeFileSync(path.join(jobDir, 'meta.json'), JSON.stringify({
    id: 'real-shaped', status: 'running', agent: 'codex-orchestrator',
    startedAt: at, updatedAt: at,
    handoffs: [{ from: 'claude', to: 'codex-orchestrator', reason: 'usage_threshold', at }]
  }));
  const activity = readJobActivity();
  assert.equal(activity.activeRing, 'codex');
  assert.equal(activity.handoff.fromRing, 'claude');
  assert.equal(activity.handoff.toRing, 'codex');
  assert.equal(activity.handoff.line, 'claude → codex (usage threshold)');
});
