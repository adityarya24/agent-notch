'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_ROOT = path.join(__dirname, '..');

// Before this port, macOS fell through to ~/.agent-notch. Keep using it when it
// exists and Application Support does not, so an upgrade doesn't lose config.
function darwinRoot(home, exists = fs.existsSync) {
  const support = path.join(home, 'Library', 'Application Support', 'Agent Notch');
  const legacy = path.join(home, '.agent-notch');
  if (!exists(support) && exists(legacy)) return legacy;
  return support;
}

/**
 * Per-user config root.
 * Env NOTCH_CONFIG_DIR always wins. win32 keeps %APPDATA%\\Agent Notch;
 * darwin uses ~/Library/Application Support/Agent Notch; else ~/.agent-notch.
 */
function appDataRoot(platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync) {
  const override = String(env.NOTCH_CONFIG_DIR || '').trim();
  if (override) return path.resolve(override);
  if (platform === 'win32') {
    const appData = String(env.APPDATA || '').trim();
    return appData ? path.join(appData, 'Agent Notch') : path.join(home, '.agent-notch');
  }
  if (platform === 'darwin') return darwinRoot(home, exists);
  return path.join(home, '.agent-notch');
}

/**
 * Runtime / PID / cache directory.
 * Env NOTCH_STATE_DIR always wins. win32 keeps %LOCALAPPDATA% (or APPDATA);
 * darwin shares Application Support with config; else ~/.agent-notch.
 */
function runtimeDir(platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync) {
  const override = String(env.NOTCH_STATE_DIR || '').trim();
  if (override) return path.resolve(override);
  if (platform === 'win32') {
    const local = String(env.LOCALAPPDATA || env.APPDATA || '').trim();
    return local ? path.join(local, 'Agent Notch') : path.join(home, '.agent-notch');
  }
  if (platform === 'darwin') return darwinRoot(home, exists);
  return path.join(home, '.agent-notch');
}

/**
 * Resolve the Electron binary for the given platform.
 * Prefer require('electron') when it matches the live platform; never default to .exe off Windows.
 */
function electronBinary(platform = process.platform, rootDir = DEFAULT_ROOT) {
  // Use the installed package path only for the live app root + matching platform.
  // Custom rootDir (tests) always builds the expected dist path for that OS.
  if (platform === process.platform && path.resolve(rootDir) === path.resolve(DEFAULT_ROOT)) {
    try {
      const fromPkg = require('electron');
      if (typeof fromPkg === 'string' && fs.existsSync(fromPkg)) return fromPkg;
    } catch (e) {}
  }

  const dist = path.join(rootDir, 'node_modules', 'electron', 'dist');
  if (platform === 'win32') {
    const win = path.join(dist, 'electron.exe');
    if (fs.existsSync(win)) return win;
    return win;
  }
  if (platform === 'darwin') {
    const macApp = path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
    if (fs.existsSync(macApp)) return macApp;
    const bare = path.join(dist, 'electron');
    if (fs.existsSync(bare)) return bare;
    return macApp;
  }
  const nix = path.join(dist, 'electron');
  if (fs.existsSync(nix)) return nix;
  return nix;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function windowsProcessCommandLine(pid, spawn = spawnSync) {
  const script = "(Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $env:NOTCH_PID)).CommandLine";
  const result = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, NOTCH_PID: String(pid) }
  });
  return String(result.stdout || '').trim();
}

function unixProcessCommand(pid, spawn = spawnSync) {
  const result = spawn('ps', ['-ww', '-p', String(pid), '-o', 'command='], {
    encoding: 'utf8'
  });
  return String(result.stdout || '').trim();
}

/**
 * True when pid is alive and looks like our Electron main process.
 * win32: PowerShell Win32_Process.CommandLine must contain main.js.
 * darwin/linux: `ps -ww -p PID -o command=` must contain main.js.
 */
function isOwnedPid(pid, platform = process.platform, options = {}) {
  const {
    alive = isPidAlive,
    spawn = spawnSync,
    mainNeedle = 'main.js'
  } = options;
  if (!pid || !alive(pid)) return false;
  const needle = String(mainNeedle).toLowerCase();
  if (platform === 'win32') {
    return windowsProcessCommandLine(pid, spawn).toLowerCase().includes(needle);
  }
  return unixProcessCommand(pid, spawn).toLowerCase().includes(needle);
}

function sleepSync(ms) {
  const wait = Math.max(0, Number(ms) || 0);
  if (wait <= 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
  } catch (e) {
    const end = Date.now() + wait;
    while (Date.now() < end) {
      /* busy wait fallback */
    }
  }
}

/**
 * Stop a process tree/process. win32: taskkill /T /F.
 * else: SIGTERM then SIGKILL after a short wait.
 * Returns a small result object; does not throw on missing pid.
 */
function killPid(pid, platform = process.platform, options = {}) {
  const {
    spawn = spawnSync,
    kill = process.kill.bind(process),
    alive = isPidAlive,
    waitMs = 400,
    sleep = sleepSync
  } = options;
  if (!pid) return { ok: false, reason: 'no-pid' };

  if (platform === 'win32') {
    const result = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
    const ok = result.status === 0 || !alive(pid);
    return { ok, status: result.status, signal: null };
  }

  try {
    kill(pid, 'SIGTERM');
  } catch (e) {
    if (!alive(pid)) return { ok: true, status: 0, signal: 'SIGTERM' };
    return { ok: false, error: e, signal: 'SIGTERM' };
  }

  sleep(waitMs);
  if (!alive(pid)) return { ok: true, status: 0, signal: 'SIGTERM' };

  try {
    kill(pid, 'SIGKILL');
  } catch (e) {
    if (!alive(pid)) return { ok: true, status: 0, signal: 'SIGKILL' };
    return { ok: false, error: e, signal: 'SIGKILL' };
  }
  sleep(50);
  return { ok: !alive(pid), status: 0, signal: 'SIGKILL' };
}

/**
 * Describe how to open a terminal at cwd (and optional command).
 * Returns the plan only — does not spawn. Hook for future "tap quota ring → agent terminal".
 */
function openTerminal({ cwd, command, terminal } = {}, platform = process.platform, env = process.env) {
  const dir = cwd ? path.resolve(String(cwd)) : process.cwd();
  const cmd = command == null ? '' : String(command);

  if (platform === 'win32') {
    const wtArgs = ['-d', dir];
    if (cmd) wtArgs.push('cmd', '/k', cmd);
    const primary = { bin: 'wt.exe', args: wtArgs, cwd: dir };
    // `start` with empty title then directory opens a shell in that folder.
    const fallbackArgs = cmd
      ? ['/c', 'start', '', '/D', dir, 'cmd', '/k', cmd]
      : ['/c', 'start', '', '/D', dir, 'cmd'];
    const fallback = { bin: 'cmd.exe', args: fallbackArgs, cwd: dir };
    return { platform, cwd: dir, command: cmd || null, primary, fallback, argv: [primary.bin, ...primary.args] };
  }

  if (platform === 'darwin') {
    const termProgram = String(env.TERM_PROGRAM || '').toLowerCase();
    const configured = terminal || (termProgram.includes('iterm') ? 'iTerm' : 'Terminal');
    const appName = /iterm/i.test(configured) ? 'iTerm' : 'Terminal';
    const primary = { bin: 'open', args: ['-a', appName, dir], cwd: dir };
    return {
      platform,
      cwd: dir,
      command: cmd || null,
      terminal: appName,
      primary,
      fallback: null,
      argv: [primary.bin, ...primary.args]
    };
  }

  // Generic Unix: prefer $TERMINAL, else x-terminal-emulator.
  const bin = String(env.TERMINAL || 'x-terminal-emulator').trim() || 'x-terminal-emulator';
  const args = cmd ? ['-e', cmd] : [];
  // Many emulators accept --working-directory; keep cwd in the plan either way.
  if (!cmd) args.push('--working-directory', dir);
  const primary = { bin, args, cwd: dir };
  return { platform, cwd: dir, command: cmd || null, primary, fallback: null, argv: [bin, ...args] };
}

/** Tray / settings checkbox label for login-item toggle. */
function openAtLoginLabel(platform = process.platform) {
  if (platform === 'win32') return 'Start with Windows';
  return 'Open at Login';
}

/** Whether CLI .vbs / Startup-folder autostart is implemented. */
function supportsCliAutostart(platform = process.platform) {
  return platform === 'win32';
}

function cliAutostartUnsupportedMessage(platform = process.platform) {
  if (platform === 'darwin') {
    return 'Autostart via CLI is not yet supported on macOS; use the tray\'s Open at Login instead.';
  }
  return `Autostart via CLI is not yet supported on ${platform}; use the tray's Open at Login when available.`;
}

module.exports = {
  appDataRoot,
  runtimeDir,
  electronBinary,
  isOwnedPid,
  isPidAlive,
  killPid,
  openTerminal,
  openAtLoginLabel,
  supportsCliAutostart,
  cliAutostartUnsupportedMessage
};
