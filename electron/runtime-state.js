const fs = require('fs');
const os = require('os');
const path = require('path');

function runtimeDir() {
  const override = String(process.env.NOTCH_STATE_DIR || '').trim();
  if (override) return path.resolve(override);
  const local = String(process.env.LOCALAPPDATA || process.env.APPDATA || '').trim();
  return local ? path.join(local, 'Agent Notch') : path.join(os.homedir(), '.agent-notch');
}

function runtimePath(name) {
  return path.join(runtimeDir(), name);
}

function ensureRuntimeDir() {
  fs.mkdirSync(runtimeDir(), { recursive: true });
  return runtimeDir();
}

function readPid(filePath = runtimePath('notch.pid')) {
  try {
    const pid = Number(String(fs.readFileSync(filePath, 'utf8')).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    return null;
  }
}

function writePid(pid = process.pid, filePath = runtimePath('notch.pid')) {
  ensureRuntimeDir();
  const tmp = `${filePath}.${pid}.tmp`;
  fs.writeFileSync(tmp, `${pid}\n`, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    fs.copyFileSync(tmp, filePath);
    fs.unlinkSync(tmp);
  }
}

function clearPid(expectedPid = process.pid, filePath = runtimePath('notch.pid')) {
  try {
    if (readPid(filePath) !== expectedPid) return false;
    fs.unlinkSync(filePath);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { clearPid, ensureRuntimeDir, readPid, runtimeDir, runtimePath, writePid };
