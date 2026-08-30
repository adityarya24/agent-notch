const { spawnSync } = require('node:child_process');

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  process.stderr.write('npm_execpath is unavailable; run this check through npm.\n');
  process.exit(1);
}
const result = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  windowsHide: true
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || result.error?.message || 'npm pack failed\n');
  process.exit(result.status || 1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch (error) {
  process.stderr.write(`Could not parse npm pack output: ${error.message}\n`);
  process.exit(1);
}

const files = new Set((report[0]?.files || []).map((entry) => entry.path.replace(/\\/g, '/')));
const required = ['dist/index.html', 'electron/main.js', 'bin/cli.js', 'README.md'];
const forbidden = ['notch_config.json', 'electron_boot.log', '.env'];
const missing = required.filter((name) => !files.has(name));
const leaked = forbidden.filter((name) => files.has(name));

if (missing.length || leaked.length) {
  if (missing.length) process.stderr.write(`Missing package files: ${missing.join(', ')}\n`);
  if (leaked.length) process.stderr.write(`Forbidden package files: ${leaked.join(', ')}\n`);
  process.exit(1);
}

console.log(`Package contents verified (${files.size} files, ${report[0].size} bytes).`);
