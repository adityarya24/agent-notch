#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
if (process.env.NOTCH_SKIP_BUILD === '1') process.exit(0);

const dist = path.join(root, 'dist', 'index.html');
const viteJs = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

function runBuild() {
  if (fs.existsSync(viteJs)) {
    return spawnSync(process.execPath, [viteJs, 'build'], { cwd: root, stdio: 'inherit' });
  }
  return spawnSync('npx', ['--yes', 'vite', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
}

const result = runBuild();
if ((result.status || 0) !== 0 && !fs.existsSync(dist)) {
  process.exit(result.status || 1);
}
process.exit(0);
