#!/usr/bin/env node
/**
 * Record a short HUD clip: load rings, plant a glow/handoff fixture, capture frames.
 * Does not burn provider quota.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const rawDir = path.join(root, 'docs', 'media', 'raw');
const outDir = path.join(root, 'docs', 'media');
const cli = path.join(root, 'bin', 'cli.js');
const mainJs = path.join(root, 'electron', 'main.js');
const python = process.env.PYTHON || 'python';
const frames = 36;
const goFile = path.join(rawDir, 'go.json');
const jobId = `notch-smoke-media-${Date.now()}`;
const jobDir = path.join(os.homedir(), '.mindsync', 'dispatch', 'jobs', jobId);

function resolveElectron() {
  try {
    const fromPkg = require('electron');
    if (typeof fromPkg === 'string' && fs.existsSync(fromPkg)) return fromPkg;
  } catch (e) {}
  return path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
}

function sleep(ms) {
  spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${Number(ms) || 0})`]);
}

function writeMeta() {
  const at = new Date().toISOString();
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'meta.json'), `${JSON.stringify({
    id: jobId,
    status: 'running',
    agent: 'grok',
    startedAt: at,
    updatedAt: at,
    attempts: [
      { agent: 'codex', status: 'quota_exhausted', startedAt: at, endedAt: at },
      { agent: 'grok', status: 'running', startedAt: at }
    ],
    handoffs: [{ from: 'codex', to: 'grok', reason: 'quota_exhausted', at }],
    handoffRouting: { agent: 'grok', reason: 'Selected grok; 4% used vs codex 89%.' }
  }, null, 2)}\n`);
}

function clearJob() {
  try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (e) {}
}

function waitDone(timeoutMs) {
  const done = path.join(rawDir, 'done.json');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(done)) return true;
    sleep(200);
  }
  return fs.existsSync(done);
}

function killNotchElectrons() {
  spawnSync(process.execPath, [cli, 'stop'], { stdio: 'inherit' });
  if (process.platform === 'win32') {
    spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name = 'electron.exe'\" | Where-Object { $_.CommandLine -like '*agent-notch*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    ], { stdio: 'inherit' });
  }
}

fs.rmSync(rawDir, { recursive: true, force: true });
fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
killNotchElectrons();

const electronBin = resolveElectron();
console.log('electron', electronBin);

writeMeta();
const child = spawn(electronBin, [mainJs], {
  cwd: root,
  env: {
    ...process.env,
    NOTCH_CAPTURE: rawDir,
    NOTCH_CAPTURE_WAIT: goFile,
    NOTCH_CAPTURE_FRAMES: String(frames),
    NOTCH_CAPTURE_MS: '110',
    NOTCH_CAPTURE_QUIT: '1'
  },
  stdio: 'inherit'
});

console.log('waiting for HUD to paint...');
sleep(1800);
fs.writeFileSync(goFile, `${JSON.stringify({ at: new Date().toISOString() })}\n`);
console.log('recording glow + handoff...');

if (!waitDone(25000)) {
  try { child.kill(); } catch (e) {}
  killNotchElectrons();
  clearJob();
  console.error('capture timed out — no done.json');
  if (fs.existsSync(rawDir)) console.error('raw', fs.readdirSync(rawDir));
  process.exit(1);
}

const stitch = path.join(__dirname, 'stitch-hud-media.py');
const stitched = spawnSync(python, [stitch, rawDir, outDir], { stdio: 'inherit' });
clearJob();
try { child.kill(); } catch (e) {}
killNotchElectrons();
process.exit(stitched.status || 0);
