#!/usr/bin/env node
/**
 * Fixture-job smoke for active-agent glow + one-shot handoff.
 * Does not call provider APIs or burn quota.
 *
 * Default: isolated temp dispatch dir (does not touch ~/.mindsync).
 * --hud: plant a job the live HUD can see. Does NOT restart/kill Notch.
 * --keep: leave the fixture (clear with --clear).
 * --clear: delete notch-smoke-* jobs and exit.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const rawArgs = process.argv.slice(2);
const wantClear = rawArgs.includes('--clear');
const hud = rawArgs.includes('--hud');
const keep = rawArgs.includes('--keep');
const restart = rawArgs.includes('--restart');
const holdMs = Number((rawArgs.find((a) => a.startsWith('--hold-ms=')) || '').split('=')[1]) || (hud ? 25000 : 0);
const pollWaitMs = hud ? 16000 : 0;

const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-smoke-'));
if (!hud && !wantClear) process.env.AGENT_DISPATCH_HOME = isolatedRoot;

const { readJobActivity, ringIdForAgent } = require('../electron/handoff_status');

const jobsRoot = hud || wantClear
  ? path.join(os.homedir(), '.mindsync', 'dispatch', 'jobs')
  : path.join(isolatedRoot, 'jobs');
const jobId = `notch-smoke-${Date.now()}`;
const jobDir = path.join(jobsRoot, jobId);
const metaPath = path.join(jobDir, 'meta.json');
const cli = path.join(__dirname, '..', 'bin', 'cli.js');

function nowIso() {
  return new Date().toISOString();
}

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

function sleep(ms) {
  spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${Number(ms) || 0})`]);
}

function writeMeta(patch) {
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(metaPath, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');
}

function fail(msg) {
  cleanup();
  console.error(`FAIL ${msg}`);
  process.exit(1);
}

function cleanup() {
  try {
    fs.rmSync(jobDir, { recursive: true, force: true });
  } catch (e) {}
  if (!hud && !wantClear) {
    try {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    } catch (e) {}
  }
}

function clearSmokeJobs() {
  let n = 0;
  try {
    for (const name of fs.readdirSync(jobsRoot)) {
      if (!name.startsWith('notch-smoke-')) continue;
      fs.rmSync(path.join(jobsRoot, name), { recursive: true, force: true });
      n += 1;
    }
  } catch (e) {}
  console.log(`cleared ${n} smoke job(s)`);
}

function ensureHud() {
  spawnSync(process.execPath, [cli, restart ? 'restart' : 'start'], { stdio: 'inherit' });
}

function assertSecretFree() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'scrapers.js'), 'utf8');
  const googleSecretPrefix = `GOC${'SPX-'}`;
  if (src.includes(googleSecretPrefix) || /ANTIGRAVITY_CLIENT_(ID|SECRET)\s*=\s*['"]/.test(src)) {
    fail('scrapers.js still has a hardcoded Antigravity OAuth client');
  }
  console.log('PASS no hardcoded Antigravity OAuth client');
}

if (wantClear) {
  clearSmokeJobs();
  process.exit(0);
}

try {
  assertSecretFree();

  if (ringIdForAgent('agy') !== 'gemini') fail('agy should map to gemini ring');
  console.log('PASS agy → gemini ring map');

  writeMeta({
    id: jobId,
    status: 'running',
    agent: 'codex',
    startedAt: hoursAgoIso(48),
    updatedAt: hoursAgoIso(48)
  });
  const zombie = readJobActivity();
  if (zombie && zombie.jobId === jobId) fail('stale running job must not glow');
  console.log('PASS zombie running job ignored (6h freshness)');

  const started = nowIso();
  writeMeta({
    id: jobId,
    status: 'running',
    agent: 'agy',
    startedAt: started,
    updatedAt: started,
    attempts: [{ agent: 'codex', status: 'quota_exhausted', startedAt: started, endedAt: started }],
    handoffs: []
  });
  const mapped = readJobActivity();
  if (!mapped || mapped.activeRing !== 'gemini' || mapped.jobStatus !== 'running') {
    fail(`expected running gemini via agy, got ${JSON.stringify(mapped)}`);
  }
  console.log('PASS active-agent agy glows gemini');

  writeMeta({
    id: jobId,
    status: 'running',
    agent: 'grok',
    startedAt: started,
    updatedAt: started,
    attempts: [{ agent: 'codex', status: 'quota_exhausted', startedAt: started, endedAt: started }],
    handoffs: []
  });
  const active = readJobActivity();
  if (!active || active.activeRing !== 'grok' || active.jobStatus !== 'running') {
    fail(`expected running grok, got ${JSON.stringify(active)}`);
  }
  console.log('PASS active-agent grok (glow target)');

  if (hud) ensureHud();

  const at = nowIso();
  writeMeta({
    id: jobId,
    status: 'running',
    agent: 'grok',
    startedAt: started,
    updatedAt: at,
    attempts: [
      { agent: 'codex', status: 'quota_exhausted', startedAt: started, endedAt: at },
      { agent: 'grok', status: 'running', startedAt: at }
    ],
    handoffs: [{ from: 'codex', to: 'grok', reason: 'quota_exhausted', at }],
    handoffRouting: {
      agent: 'grok',
      reason: 'Selected grok because it is installed and matched: general; routing priority 70; 4% used vs codex 89%.'
    }
  });

  const flashed = readJobActivity();
  if (!flashed || !flashed.handoff) fail('expected handoff payload');
  if (flashed.handoff.fromRing !== 'codex' || flashed.handoff.toRing !== 'grok') {
    fail(`bad rings ${JSON.stringify(flashed.handoff)}`);
  }
  if (!flashed.handoff.line.includes('codex → grok') || !flashed.handoff.line.includes('quota exhausted')) {
    fail(`bad line ${flashed.handoff.line}`);
  }
  console.log(`PASS handoff flash "${flashed.handoff.line}"`);
  if (flashed.routingReason && flashed.routingReason.includes('4% used vs codex 89%')) {
    console.log('PASS routing hint');
  }

  if (hud) {
    console.log('');
    console.log('>>> DEKHO RIGHT EDGE — grok ring glow + "codex → grok (quota exhausted)"');
    console.log(`>>> HUD poll up to ${Math.round(pollWaitMs / 1000)}s, then hold ${Math.round(holdMs / 1000)}s. Notch is NOT being killed.`);
    console.log('');
    sleep(pollWaitMs);
    sleep(holdMs);
  }

  if (keep) {
    console.log(`KEEP ${jobDir}`);
    console.log('Clear later: notch smoke --clear');
    process.exit(0);
  }

  cleanup();
  const gone = readJobActivity();
  if (gone && gone.jobId === jobId) fail('smoke job still visible after cleanup');
  console.log('PASS cleanup (no leftover smoke job)');
  process.exit(0);
} catch (err) {
  cleanup();
  console.error(err);
  process.exit(1);
}
