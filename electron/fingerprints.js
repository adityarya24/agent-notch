const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Bare interpreter names — never valid fingerprints on their own.
const BARE_RUNTIME_NAMES = new Set([
  'node', 'nodejs', 'bun', 'deno', 'python', 'pythonw', 'python3', 'ruby', 'java', 'javaw',
  'node.exe', 'bun.exe', 'deno.exe', 'python.exe', 'pythonw.exe', 'ruby.exe', 'java.exe', 'javaw.exe'
]);

const RUNTIME_NAME_RE = /^(node(?:js)?|bun|deno|pythonw?|ruby|java|javaw)(?:\d+(?:\.\d+)*)?$/i;

// Path/cmdline substring rules. Executable-name matching stays in process_activity.
// Each fingerprint is lowercase + slash-normalised; matching uses the same form.
const BUILTIN_FINGERPRINT_RULES = Object.freeze([
  Object.freeze({ ring: 'claude', fingerprints: Object.freeze(['/@anthropic-ai/claude-code/']) }),
  Object.freeze({
    ring: 'codex',
    fingerprints: Object.freeze(['/@openai/codex/']),
    // Background app-server daemons are not user sessions.
    exclude: Object.freeze([' app-server'])
  }),
  Object.freeze({ ring: 'gemini', fingerprints: Object.freeze(['/@google/gemini-cli/']) }),
  Object.freeze({ ring: 'cursor', fingerprints: Object.freeze(['/cursor-agent/versions/']) }),
  Object.freeze({ ring: 'opencode', fingerprints: Object.freeze(['/opencode-ai/']) }),
  Object.freeze({ ring: 'grok', fingerprints: Object.freeze(['/@vibe-kit/grok-cli/']) })
]);

// Exe-name rings that must still honour cmdline excludes (e.g. codex app-server).
const BUILTIN_NAME_EXCLUDES = Object.freeze({
  codex: Object.freeze([' app-server'])
});

function normalizeFingerprint(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase();
}

function isRuntimeProcessName(rawName) {
  const base = String(rawName || '')
    .trim()
    .split(/[\\/]/)
    .pop()
    .replace(/\.exe$/i, '')
    .toLowerCase();
  return RUNTIME_NAME_RE.test(base);
}

function isSafeFingerprint(value) {
  const fp = normalizeFingerprint(value);
  if (fp.length < 6) return false;
  const bare = fp.replace(/^\/+|\/+$/g, '');
  if (!bare) return false;
  if (BARE_RUNTIME_NAMES.has(fp) || BARE_RUNTIME_NAMES.has(bare)) return false;
  if (RUNTIME_NAME_RE.test(bare)) return false;
  return true;
}

function sanitizeFingerprint(value) {
  const fp = normalizeFingerprint(value);
  return isSafeFingerprint(fp) ? fp : null;
}

function buildMatchHaystack(executablePath, commandLine, processName) {
  return normalizeFingerprint([executablePath, processName, commandLine].filter(Boolean).join(' '));
}

function haystackExcluded(haystack, excludeList) {
  if (!haystack || !excludeList || !excludeList.length) return false;
  return excludeList.some((token) => haystack.includes(normalizeFingerprint(token)));
}

function ringsFromBuiltinFingerprints(haystack) {
  const rings = [];
  if (!haystack) return rings;
  for (const rule of BUILTIN_FINGERPRINT_RULES) {
    if (haystackExcluded(haystack, rule.exclude)) continue;
    const hit = (rule.fingerprints || []).some((fp) => haystack.includes(fp));
    if (hit) rings.push(rule.ring);
  }
  return rings;
}

function builtinNameExcluded(ring, haystack) {
  const exclude = BUILTIN_NAME_EXCLUDES[ring];
  return haystackExcluded(haystack, exclude);
}

/**
 * Extract `/node_modules/<pkg>/` from shim text or a path. Scoped packages keep the @scope/name form.
 */
function nodeModulesFingerprintFromText(text) {
  const normalized = normalizeFingerprint(text);
  const match = normalized.match(/node_modules\/((?:@[^/]+\/)[^/]+|[^/]+)/);
  if (!match) return null;
  return sanitizeFingerprint(`/node_modules/${match[1]}/`);
}

function readText(filePath, reader) {
  try {
    return String(reader(filePath, 'utf8'));
  } catch (e) {
    return '';
  }
}

function looksLikeNpmCmdShim(content) {
  const text = String(content || '');
  return /node_modules/i.test(text) && (/@echo\s+off/i.test(text) || /%~dp0/i.test(text) || /\.js"/i.test(text));
}

function looksLikeNpmPs1Shim(content) {
  const text = String(content || '');
  return /node_modules/i.test(text) && (/\$basedir/i.test(text) || /\$ret\s*=/i.test(text));
}

function looksLikePosixNodeShim(content) {
  const text = String(content || '');
  return /^\s*#!/.test(text) && /node_modules/i.test(text) && (/node["'\s]/i.test(text) || /exec\s+/i.test(text));
}

function looksLikePythonShebang(content) {
  return /^\s*#!.*python/i.test(String(content || ''));
}

function isPythonScriptsLauncher(resolvedPath) {
  const normalized = normalizeFingerprint(resolvedPath);
  return /\/scripts\/[^/]+\.exe$/.test(normalized);
}

/**
 * Derive a safe activityFingerprint from a resolved executable/shim path.
 * Never executes the program — only reads shim files when needed.
 */
function fingerprintFromResolvedPath(resolvedPath, options = {}) {
  const reader = options.readFileSync || ((file, enc) => fs.readFileSync(file, enc));
  const absolute = path.resolve(String(resolvedPath || '').trim());
  if (!absolute) return null;

  const lower = absolute.toLowerCase();
  const ext = path.extname(absolute).toLowerCase();

  if (ext === '.cmd' || ext === '.bat' || ext === '.ps1') {
    const content = readText(absolute, reader);
    const fromShim = nodeModulesFingerprintFromText(content) || nodeModulesFingerprintFromText(absolute);
    if (fromShim) return fromShim;
  }

  if (!ext || ext === '.exe') {
    if (isPythonScriptsLauncher(absolute)) {
      return sanitizeFingerprint(absolute);
    }
  }

  // POSIX shims and node_modules bins often have no extension.
  const content = readText(absolute, reader);
  if (content) {
    if (looksLikeNpmCmdShim(content) || looksLikeNpmPs1Shim(content) || looksLikePosixNodeShim(content)) {
      const fromShim = nodeModulesFingerprintFromText(content);
      if (fromShim) return fromShim;
    }
    if (looksLikePythonShebang(content)) {
      return sanitizeFingerprint(absolute);
    }
    // node_modules/.bin shell shim without obvious markers still embeds the target path.
    const embedded = nodeModulesFingerprintFromText(content);
    if (embedded) return embedded;
  }

  const fromPath = nodeModulesFingerprintFromText(absolute);
  if (fromPath) return fromPath;

  // Native binary (or unresolved launcher): absolute slash-normalised path.
  return sanitizeFingerprint(absolute);
}

function resolveCommandPath(command, options = {}) {
  const name = String(command || '').trim();
  if (!name || /\s/.test(name)) return null;
  if (options.resolvePath) {
    try {
      return options.resolvePath(name) || null;
    } catch (e) {
      return null;
    }
  }
  const platform = options.platform || process.platform;
  try {
    if (platform === 'win32') {
      const stdout = execFileSync('where.exe', [name], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
        maxBuffer: 16 * 1024
      });
      return String(stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
    }
    const stdout = execFileSync('sh', ['-c', `command -v -- ${JSON.stringify(name)}`], {
      encoding: 'utf8',
      timeout: 3000,
      maxBuffer: 16 * 1024
    });
    return String(stdout || '').trim().split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Auto-detect activityFingerprint for a custom agent command / process name.
 * Safe: never executes the resolved program.
 */
function resolveActivityFingerprint(command, options = {}) {
  const explicit = sanitizeFingerprint(options.explicit || options.activityFingerprint || '');
  if (explicit) return explicit;

  const resolved = resolveCommandPath(command, options);
  if (!resolved) return null;
  return fingerprintFromResolvedPath(resolved, options);
}

function customFingerprintMappings(customAgents) {
  const mappings = [];
  for (const agent of customAgents || []) {
    const id = String(agent?.id || '');
    if (!/^custom_[A-Za-z0-9_-]+$/.test(id)) continue;
    const fp = sanitizeFingerprint(agent.activityFingerprint);
    if (!fp) continue;
    mappings.push({ fingerprint: fp, ring: id });
  }
  return mappings;
}

function ringsFromCustomFingerprints(haystack, fingerprintMappings = []) {
  const rings = [];
  if (!haystack) return rings;
  for (const entry of fingerprintMappings || []) {
    const fp = sanitizeFingerprint(entry.fingerprint || entry);
    const ring = entry.ring || entry.id;
    if (!fp || !ring) continue;
    if (haystack.includes(fp)) rings.push(ring);
  }
  return rings;
}

/**
 * Fill missing activityFingerprint fields for custom agents (Settings save path).
 * Never overwrites an explicit fingerprint; never executes resolved programs.
 */
function enrichCustomAgentsFingerprints(customAgents, options = {}) {
  return (customAgents || []).map((agent) => {
    if (!agent || typeof agent !== 'object') return agent;
    if (sanitizeFingerprint(agent.activityFingerprint)) return agent;
    const command = String(agent.activityProcess || agent.command || '').trim();
    if (!command || /\s/.test(command)) return agent;
    const fp = resolveActivityFingerprint(command, options);
    if (!fp) return agent;
    return { ...agent, activityFingerprint: fp };
  });
}

module.exports = {
  BARE_RUNTIME_NAMES,
  BUILTIN_FINGERPRINT_RULES,
  BUILTIN_NAME_EXCLUDES,
  buildMatchHaystack,
  builtinNameExcluded,
  customFingerprintMappings,
  enrichCustomAgentsFingerprints,
  fingerprintFromResolvedPath,
  isRuntimeProcessName,
  isSafeFingerprint,
  nodeModulesFingerprintFromText,
  normalizeFingerprint,
  resolveActivityFingerprint,
  resolveCommandPath,
  ringsFromBuiltinFingerprints,
  ringsFromCustomFingerprints,
  sanitizeFingerprint
};
