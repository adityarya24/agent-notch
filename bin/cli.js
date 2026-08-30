#!/usr/bin/env node

const { execSync, spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const {
  runtimePath,
  ensureRuntimeDir,
  readPid: readRuntimePid,
  clearPid: clearRuntimePid
} = require('../electron/runtime-state');

const rootDir = path.resolve(__dirname, '..');
const distIndex = path.join(rootDir, 'dist', 'index.html');
const legacyPidFile = path.join(rootDir, 'notch.pid');
const mainJs = path.join(rootDir, 'electron', 'main.js');
const logFile = runtimePath('electron_boot.log');
const smokeScript = path.join(rootDir, 'scripts', 'smoke-glow.js');

const args = process.argv.slice(2);
const command = args[0] || 'start';

function resolveElectron() {
  try {
    const fromPkg = require('electron');
    if (typeof fromPkg === 'string' && fs.existsSync(fromPkg)) return fromPkg;
  } catch (e) {}
  const win = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (fs.existsSync(win)) return win;
  const nix = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron');
  if (fs.existsSync(nix)) return nix;
  return win;
}

const electronPath = resolveElectron();

function readLegacyPid() {
  try {
    const pid = Number(String(fs.readFileSync(legacyPidFile, 'utf8')).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    return null;
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function windowsProcessCommandLine(pid) {
  if (process.platform !== 'win32') return '';
  const script = "(Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $env:NOTCH_PID)).CommandLine";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, NOTCH_PID: String(pid) }
  });
  return String(result.stdout || '').trim();
}

function isOwnedPid(pid) {
  if (!pid || !isPidAlive(pid)) return false;
  if (process.platform !== 'win32') return true;
  return windowsProcessCommandLine(pid).toLowerCase().includes(mainJs.toLowerCase());
}

function discoverWindowsPid() {
  if (process.platform !== 'win32') return null;
  const script = [
    "$needle = $env:NOTCH_MAIN_NEEDLE;",
    "Get-CimInstance Win32_Process -Filter \"Name = 'electron.exe'\" |",
    "  Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |",
    "  Select-Object -First 1 -ExpandProperty ProcessId"
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, NOTCH_MAIN_NEEDLE: mainJs }
  });
  const pid = Number(String(result.stdout || '').trim());
  return Number.isInteger(pid) && pid > 0 && isPidAlive(pid) ? pid : null;
}

function findRunningPid() {
  const runtimePid = readRuntimePid();
  if (isOwnedPid(runtimePid)) return runtimePid;
  const legacyPid = readLegacyPid();
  if (isOwnedPid(legacyPid)) return legacyPid;
  return discoverWindowsPid();
}

function isRunning() {
  return Boolean(findRunningPid());
}

function clearLegacyPid(expectedPid) {
  try {
    const current = readLegacyPid();
    if (expectedPid && current !== expectedPid) return;
    fs.unlinkSync(legacyPidFile);
  } catch (e) {}
}

function clearStalePidFiles() {
  const runtimePid = readRuntimePid();
  if (runtimePid && !isOwnedPid(runtimePid)) clearRuntimePid(runtimePid);
  const legacyPid = readLegacyPid();
  if (legacyPid && !isOwnedPid(legacyPid)) clearLegacyPid(legacyPid);
}

function sleep(ms) {
  spawnSync(process.execPath, ['-e', `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${Number(ms) || 0})`]);
}

function spawnElectron() {
  if (!fs.existsSync(electronPath)) {
    throw new Error(`Electron binary missing at ${electronPath}. From the repo run: npm install`);
  }
  if (!fs.existsSync(distIndex)) {
    console.log('📦 Building HUD bundle...');
    execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
  }
  let stdio = 'ignore';
  try {
    ensureRuntimeDir();
    const fd = fs.openSync(logFile, 'a');
    stdio = ['ignore', fd, fd];
  } catch (e) {}
  const child = spawn(electronPath, [mainJs], {
    detached: true,
    stdio,
    cwd: rootDir,
    windowsHide: true,
    env: process.env
  });
  child.unref();
  return child;
}

function waitUntilRunning(ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (isRunning()) return true;
    sleep(150);
  }
  return isRunning();
}

function stopNotch() {
  const pid = findRunningPid();
  if (pid && isPidAlive(pid)) {
    const result = process.platform === 'win32'
      ? spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      : spawnSync('kill', [String(pid)], { stdio: 'ignore' });
    if (result.status === 0 || !isPidAlive(pid)) {
      clearRuntimePid(pid);
      clearLegacyPid(pid);
      console.log('Agent Notch stopped.');
      return;
    }
    console.error(`Could not stop Agent Notch process ${pid}.`);
    process.exitCode = 1;
    return;
  }
  clearStalePidFiles();
  console.log('No active Agent Notch instance found.');
}

function startNotch() {
  if (isRunning()) {
    spawnElectron();
    console.log('Agent Notch already running — HUD brought to the front.');
    console.log('Hotkey Ctrl+Shift+U hides/shows. It cannot start the app after Quit.');
    return;
  }
  clearStalePidFiles();
  try {
    spawnElectron();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
  if (!waitUntilRunning()) {
    console.error(`Failed to start Agent Notch. See ${logFile}`);
    process.exit(1);
  }
  console.log('Agent Notch launched in the background.');
  console.log('  Position: right edge');
  console.log('  Toggle:   Ctrl+Shift+U  (hide/show, not start/stop)');
  console.log('  CLI:      notch stop | notch status | notch smoke');
}

function startupVbsPath() {
  return path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'agent_notch_autostart.vbs');
}

function vbsQuote(value) {
  return String(value).replace(/"/g, '""');
}

function enableAutostart() {
  try {
    const startupVbs = startupVbsPath();
    const vbs = [
      'Set WshShell = CreateObject("WScript.Shell")',
      `WshShell.CurrentDirectory = "${vbsQuote(rootDir)}"`,
      `WshShell.Run """${vbsQuote(electronPath)}"" ""${vbsQuote(mainJs)}""", 0, False`,
      ''
    ].join('\r\n');
    fs.writeFileSync(startupVbs, vbs, 'utf8');
    console.log(`Added to Windows Startup: ${startupVbs}`);
  } catch (e) {
    console.error('Failed to configure startup:', e.message);
    process.exit(1);
  }
}

function disableAutostart() {
  try {
    const startupVbs = startupVbsPath();
    if (fs.existsSync(startupVbs)) {
      fs.unlinkSync(startupVbs);
      console.log('Removed from Windows Startup.');
    }
  } catch (e) {}
}

function printHelp() {
  console.log(`Agent Notch — right-edge AI quota HUD

Install (pip-style, Node):
  npm i -g github:adityarya24/agent-notch
  notch
  notch autostart

Commands:
  notch / notch start   Start, or show HUD if already running
  notch stop            Quit the HUD
  notch restart         Stop + start
  notch status          Running or not
  notch autostart       Launch at Windows logon
  notch disable-startup Remove logon launch
  notch smoke           Glow demo on the live HUD (no quota burn)
  notch smoke --clear   Remove leftover smoke jobs
  notch help            This text

Hotkey Ctrl+Shift+U only works while Notch is running (hide/show).
`);
}

function runSmoke() {
  const extra = args.slice(1);
  if (!extra.includes('--hud') && !extra.includes('--logic') && !extra.includes('--clear')) {
    extra.unshift('--hud');
  }
  const result = spawnSync(process.execPath, [smokeScript, ...extra], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env
  });
  process.exit(result.status == null ? 1 : result.status);
}

switch (command) {
  case 'stop':
  case 'kill':
    stopNotch();
    break;
  case 'restart':
    stopNotch();
    sleep(600);
    startNotch();
    break;
  case 'status':
    if (isRunning()) {
      console.log('Agent Notch is RUNNING (right edge + tray).');
    } else {
      console.log('Agent Notch is NOT running. Type `notch` to launch.');
    }
    break;
  case 'autostart':
  case 'enable-startup':
    enableAutostart();
    break;
  case 'disable-startup':
    disableAutostart();
    break;
  case 'smoke':
    runSmoke();
    break;
  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;
  case 'start':
    startNotch();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
