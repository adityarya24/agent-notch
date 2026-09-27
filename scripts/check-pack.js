const { spawnSync } = require('node:child_process');

// Older npm prints `[{ files }]`; newer npm prints `{ "<name>": { files } }`.
// Normalize both to the array form.
function asPackReport(candidate) {
  const reports = Array.isArray(candidate) ? candidate : Object.values(candidate || {});
  return Array.isArray(reports[0]?.files) ? reports : null;
}

function parsePackReport(output) {
  const text = String(output || '');
  for (const [open, close] of [['[', ']'], ['{', '}']]) {
    const end = text.lastIndexOf(close);
    for (let start = text.lastIndexOf(open, end); start >= 0; start = text.lastIndexOf(open, start - 1)) {
      try {
        const report = asPackReport(JSON.parse(text.slice(start, end + 1)));
        if (report) return report;
      } catch (error) {}
    }
  }
  throw new Error('no valid package report found');
}

function main() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    process.stderr.write('npm_execpath is unavailable; run this check through npm.\n');
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      npm_config_ignore_scripts: 'true',
      FORCE_COLOR: '0'
    }
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || result.error?.message || 'npm pack failed\n');
    process.exit(result.status || 1);
  }

  let report;
  try {
    report = parsePackReport(result.stdout);
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
}

if (require.main === module) main();

module.exports = { parsePackReport };
