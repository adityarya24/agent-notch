#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve(process.argv[2] || path.join(root, 'output', 'product-media', stamp));
if (fs.existsSync(out) && fs.readdirSync(out).length) {
  console.error(`Output already contains files: ${out}`);
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
function run(bin, args) {
  const result = spawnSync(bin, args, { cwd: root, stdio: 'inherit', timeout: 180000 });
  if (result.error || result.status !== 0) {
    console.error(result.error || `${bin} exited ${result.status}`);
    process.exit(1);
  }
}
run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
const electron = require('electron');
run(electron, [path.join(__dirname, 'capture-product-media.js'), out]);
run(process.env.PYTHON || 'python', [path.join(__dirname, 'render-product-media.py'), out]);
console.log(`Media ready: ${path.join(out, 'finished')}`);
