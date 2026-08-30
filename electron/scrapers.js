const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { URL } = require('url');
const { execFile } = require('child_process');
const { DEFAULT_CONFIG, getLocalConfig, saveLocalConfig } = require('./config');

const homeDir = os.homedir();

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CLAUDE_OAUTH_BETA = 'oauth-2025-04-20';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLOUD_CODE_URL = 'https://cloudcode-pa.googleapis.com/v1internal';
const MAX_BODY_BYTES = 1_000_000;

let googleAccessCache = { token: null, expiresAt: 0 };
const readerCache = new Map();
const READER_POLL_MS = 60 * 1000;
const READER_MAX_BACKOFF_MS = 5 * 60 * 1000;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function tomlString(content, key) {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm');
  const match = content.match(re);
  return match ? match[1] : null;
}

function formatTimeRemaining(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return null;
  if (seconds <= 0) return 'Resetting soon';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs >= 48) {
    const days = Math.round(hrs / 24);
    return `Resets in ${days}d`;
  }
  if (hrs > 0) return `Resets in ${hrs}h ${mins}m`;
  return `Resets in ${mins}m`;
}

function formatResetAt(value) {
  if (value == null || value === '') return null;
  let date = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value > 1e12 ? value : value * 1000);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      date = new Date(num > 1e12 ? num : num * 1000);
    } else {
      date = new Date(trimmed);
    }
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  return formatTimeRemaining(Math.round((date.getTime() - Date.now()) / 1000));
}

function coercePercent(value) {
  if (typeof value === 'boolean' || value == null) return null;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number) || number < 0 || number > 100) return null;
  return Math.round(number);
}

function quotaStatus(percent, alertThreshold = 80) {
  if (percent == null) return 'unknown';
  const critical = Math.max(50, Math.min(100, Number(alertThreshold) || 80));
  const warning = Math.max(0, critical - 30);
  if (percent >= critical) return 'critical';
  if (percent >= warning) return 'warning';
  return 'normal';
}

function attachRing(model, alertThreshold = 80) {
  const session = model.sessionUsedPercent;
  const weekly = model.weeklyUsedPercent;
  let ring = null;
  if (model.quotaState === 'known') {
    if (session != null && weekly != null) ring = Math.max(session, weekly);
    else if (session != null) ring = session;
    else if (weekly != null) ring = weekly;
  }
  model.ringPercent = ring;
  model.alertThreshold = Math.max(50, Math.min(100, Number(alertThreshold) || 80));
  if (model.quotaState === 'known') {
    model.status = quotaStatus(ring, alertThreshold);
  }
  return model;
}

function detectedCard({
  id,
  name,
  provider,
  icon,
  quotaState,
  sessionUsedPercent = null,
  weeklyUsedPercent = null,
  sessionResetText = 'Quota unknown',
  weeklyResetText = 'Quota unknown',
  sessionLabel = 'Current session',
  weeklyLabel = 'Weekly',
  status = quotaState
}) {
  return attachRing({
    id,
    name,
    provider,
    icon,
    quotaState,
    quotaKnown: quotaState === 'known',
    sessionUsedPercent,
    weeklyUsedPercent,
    sessionResetText,
    weeklyResetText,
    sessionLabel,
    weeklyLabel,
    status
  });
}

function httpsRequest({ method = 'GET', url, headers = {}, body = null, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body == null ? null : Buffer.from(body);
    const reqHeaders = { ...headers };
    if (payload) {
      reqHeaders['Content-Length'] = String(payload.length);
    }
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: reqHeaders,
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy();
          reject(new Error('response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch (e) {
          json = null;
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function claudeHome() {
  const override = (process.env.CLAUDE_CONFIG_DIR || '').trim();
  return override ? override : path.join(homeDir, '.claude');
}

function codexHome() {
  const override = (process.env.CODEX_HOME || '').trim();
  return override ? override : path.join(homeDir, '.codex');
}

function readClaudeModelName() {
  return 'Claude Code';
}

function readClaudeCredentials(credPath) {
  const cred = readJson(credPath);
  const oauth = cred && cred.claudeAiOauth;
  if (!oauth || typeof oauth !== 'object') return null;
  const accessToken = oauth.accessToken;
  const refreshToken = oauth.refreshToken;
  if (!accessToken && !refreshToken) return null;
  return { cred, oauth, accessToken, refreshToken, expiresAt: oauth.expiresAt };
}

function accessExpired(expiresAt, skewMs = 60_000) {
  if (typeof expiresAt !== 'number') return false;
  const ms = expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
  return ms <= Date.now() + skewMs;
}

function parseClaudeWindows(payload) {
  const session = { percent: null, reset: null };
  const weekly = { percent: null, reset: null };
  const limits = Array.isArray(payload.limits) ? payload.limits : [];
  for (const item of limits) {
    if (!item || typeof item !== 'object') continue;
    const percent = coercePercent(item.percent ?? item.utilization);
    if (percent == null) continue;
    if (item.kind === 'session') {
      session.percent = percent;
      session.reset = formatResetAt(item.resets_at);
    } else if (item.kind === 'weekly_all') {
      weekly.percent = percent;
      weekly.reset = formatResetAt(item.resets_at);
    }
  }
  if (session.percent == null && payload.five_hour) {
    session.percent = coercePercent(payload.five_hour.utilization ?? payload.five_hour.percent);
    session.reset = formatResetAt(payload.five_hour.resets_at);
  }
  if (weekly.percent == null && payload.seven_day) {
    weekly.percent = coercePercent(payload.seven_day.utilization ?? payload.seven_day.percent);
    weekly.reset = formatResetAt(payload.seven_day.resets_at);
  }
  return { session, weekly };
}

async function fetchClaudeUsage(accessToken) {
  return httpsRequest({
    url: CLAUDE_USAGE_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'anthropic-beta': CLAUDE_OAUTH_BETA,
      'anthropic-version': '2023-06-01',
      'x-app': 'cli',
      'User-Agent': 'claude-cli/2.1.246 (external, cli)'
    },
    timeoutMs: 10000
  });
}

async function getClaudeUsage() {
  const dir = claudeHome();
  if (!fs.existsSync(dir)) return null;
  const name = readClaudeModelName();
  const provider = 'Anthropic · Claude';
  const credPath = path.join(dir, '.credentials.json');
  if (!fs.existsSync(credPath)) {
    return detectedCard({
      id: 'claude',
      name,
      provider,
      icon: 'claude',
      quotaState: 'expired',
      sessionResetText: 'Sign in: claude auth login',
      weeklyResetText: 'No OAuth credentials',
      status: 'expired'
    });
  }

  try {
    let packed = readClaudeCredentials(credPath);
    if (!packed) {
      return detectedCard({
        id: 'claude',
        name,
        provider,
        icon: 'claude',
        quotaState: 'expired',
        sessionResetText: 'Sign in: claude auth login',
        weeklyResetText: 'OAuth credentials unreadable',
        status: 'expired'
      });
    }

    if (!packed.accessToken || accessExpired(packed.expiresAt)) {
      return detectedCard({
        id: 'claude',
        name,
        provider,
        icon: 'claude',
        quotaState: 'expired',
        sessionResetText: 'Open Claude Code to refresh sign-in',
        weeklyResetText: 'OAuth token expired',
        status: 'expired'
      });
    }

    const res = await fetchClaudeUsage(packed.accessToken);
    if (res.status === 401 || res.status === 403) {
      return detectedCard({
        id: 'claude',
        name,
        provider,
        icon: 'claude',
        quotaState: 'expired',
        sessionResetText: 'Sign in: claude auth login',
        weeklyResetText: 'OAuth token expired',
        status: 'expired'
      });
    }
    if (res.status !== 200 || !res.json) {
      return detectedCard({
        id: 'claude',
        name,
        provider,
        icon: 'claude',
        quotaState: 'unknown',
        sessionResetText: 'Usage endpoint unavailable',
        weeklyResetText: 'Try again shortly',
        status: 'unknown'
      });
    }

    const { session, weekly } = parseClaudeWindows(res.json);
    if (session.percent == null && weekly.percent == null) {
      return detectedCard({
        id: 'claude',
        name,
        provider,
        icon: 'claude',
        quotaState: 'unknown',
        sessionResetText: 'Usage data malformed',
        weeklyResetText: 'Quota unknown',
        status: 'unknown'
      });
    }

    return detectedCard({
      id: 'claude',
      name,
      provider,
      icon: 'claude',
      quotaState: 'known',
      sessionUsedPercent: session.percent,
      weeklyUsedPercent: weekly.percent,
      sessionLabel: '5h session',
      weeklyLabel: 'Weekly',
      sessionResetText: session.reset || (session.percent == null ? 'No session window' : 'Active'),
      weeklyResetText: weekly.reset || (weekly.percent == null ? 'No weekly window' : 'Active')
    });
  } catch (err) {
    return detectedCard({
      id: 'claude',
      name,
      provider,
      icon: 'claude',
      quotaState: 'unknown',
      sessionResetText: 'Quota unknown',
      weeklyResetText: 'Claude usage read failed',
      status: 'unknown'
    });
  }
}

function readCodexModelName() {
  return 'Codex';
}

async function getCodexUsage() {
  const dir = codexHome();
  const authPath = path.join(dir, 'auth.json');
  if (!fs.existsSync(authPath)) return null;
  const name = readCodexModelName();

  try {
    const authData = readJson(authPath);
    const accessToken = authData?.tokens?.access_token;
    const accountId = authData?.tokens?.account_id;
    if (!accessToken) {
      return detectedCard({
        id: 'codex',
        name,
        provider: 'OpenAI',
        icon: 'codex',
        quotaState: 'expired',
        sessionResetText: 'Sign in: codex login',
        weeklyResetText: 'No access token',
        status: 'expired'
      });
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'AgentNotch-usage-reader/1.0'
    };
    if (accountId) headers['ChatGPT-Account-Id'] = accountId;

    const res = await httpsRequest({
      url: CODEX_USAGE_URL,
      headers,
      timeoutMs: 10000
    });

    if (res.status === 401 || res.status === 403) {
      return detectedCard({
        id: 'codex',
        name,
        provider: 'OpenAI',
        icon: 'codex',
        quotaState: 'expired',
        sessionResetText: 'Sign in: codex login',
        weeklyResetText: 'OAuth token expired',
        status: 'expired'
      });
    }
    if (res.status !== 200 || !res.json) {
      return detectedCard({
        id: 'codex',
        name,
        provider: 'OpenAI',
        icon: 'codex',
        quotaState: 'unknown',
        sessionResetText: 'Usage endpoint unavailable',
        weeklyResetText: 'Quota unknown',
        status: 'unknown'
      });
    }

    const rateLimit = res.json.rate_limit || {};
    const primary = rateLimit.primary_window || {};
    const secondary = rateLimit.secondary_window || {};
    const sessionUsed = coercePercent(primary.used_percent ?? primary.usage_percent);
    const weeklyUsed = coercePercent(secondary.used_percent ?? secondary.usage_percent);
    const plan = res.json.plan_type ? String(res.json.plan_type).toUpperCase() : 'OpenAI';

    if (sessionUsed == null && weeklyUsed == null) {
      return detectedCard({
        id: 'codex',
        name,
        provider: `OpenAI · ${plan}`,
        icon: 'codex',
        quotaState: 'unknown',
        sessionResetText: 'Usage data malformed',
        weeklyResetText: 'Quota unknown',
        status: 'unknown'
      });
    }

    return detectedCard({
      id: 'codex',
      name,
      provider: `OpenAI · ${plan}`,
      icon: 'codex',
      quotaState: 'known',
      sessionUsedPercent: sessionUsed,
      weeklyUsedPercent: weeklyUsed,
      sessionLabel: '5h session',
      weeklyLabel: 'Weekly',
      sessionResetText: formatResetAt(primary.reset_at) || (sessionUsed == null ? 'No session window' : 'Active'),
      weeklyResetText: formatResetAt(secondary.reset_at) || (weeklyUsed == null ? 'No weekly window' : 'Active')
    });
  } catch (err) {
    return detectedCard({
      id: 'codex',
      name,
      provider: 'OpenAI',
      icon: 'codex',
      quotaState: 'unknown',
      sessionResetText: 'Quota unknown',
      weeklyResetText: 'Codex usage read failed',
      status: 'unknown'
    });
  }
}

function readWindowsGenericCredential(target) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, 'wincred.ps1');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Target', target],
      { timeout: 8000, windowsHide: true, maxBuffer: 256 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim()));
        } catch (e) {
          resolve(null);
        }
      }
    );
  });
}

function parseGoogleExpiry(raw) {
  if (!raw) return 0;
  const ms = Date.parse(String(raw));
  return Number.isNaN(ms) ? 0 : ms;
}

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  let raw = '';
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch (e) {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function antigravityOAuthClient() {
  loadDotEnv();
  const clientId = (
    process.env.NOTCH_ANTIGRAVITY_CLIENT_ID ||
    process.env.MINDSYNC_ANTIGRAVITY_CLIENT_ID ||
    ''
  ).trim();
  const clientSecret = (
    process.env.NOTCH_ANTIGRAVITY_CLIENT_SECRET ||
    process.env.MINDSYNC_ANTIGRAVITY_CLIENT_SECRET ||
    ''
  ).trim();
  return { clientId, clientSecret };
}

function remainingToUsed(fraction) {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return null;
  return coercePercent((1 - fraction) * 100);
}

function hottestRemainingBucket(buckets) {
  let best = null;
  for (const bucket of buckets) {
    const used = remainingToUsed(bucket && bucket.remainingFraction);
    if (used == null) continue;
    if (!best || used > best.used) {
      best = { used, reset: bucket.resetTime };
    }
  }
  return best;
}

async function getGoogleAccessToken() {
  const now = Date.now();
  if (googleAccessCache.token && now < googleAccessCache.expiresAt - 60_000) {
    return googleAccessCache.token;
  }
  const packed = await readWindowsGenericCredential('gemini:antigravity');
  const token = packed && packed.token;
  if (!token || !token.access_token) {
    throw Object.assign(new Error('missing google token'), { kind: 'expired' });
  }
  const expiryMs = parseGoogleExpiry(token.expiry);
  if (token.access_token && expiryMs > now + 60_000) {
    googleAccessCache = { token: token.access_token, expiresAt: expiryMs };
    return token.access_token;
  }
  if (!token.refresh_token) {
    throw Object.assign(new Error('google refresh missing'), { kind: 'expired' });
  }
  const { clientId, clientSecret } = antigravityOAuthClient();
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error('antigravity oauth client not configured'), { kind: 'expired' });
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
    client_id: clientId,
    client_secret: clientSecret
  }).toString();
  const res = await httpsRequest({
    method: 'POST',
    url: GOOGLE_TOKEN_URL,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    timeoutMs: 15000
  });
  if (res.status !== 200 || !res.json || !res.json.access_token) {
    throw Object.assign(new Error('google refresh failed'), { kind: 'expired', status: res.status });
  }
  const expiresIn = Number(res.json.expires_in) || 3600;
  googleAccessCache = {
    token: res.json.access_token,
    expiresAt: Date.now() + expiresIn * 1000
  };
  return googleAccessCache.token;
}

const ANTIGRAVITY_UA = 'Antigravity/4.3.0';

async function getGeminiUsage() {
  const geminiDir = path.join(homeDir, '.gemini');
  if (!fs.existsSync(geminiDir) && !fs.existsSync(path.join(homeDir, 'AppData', 'Local', 'agy'))) {
    return null;
  }

  try {
    const access = await getGoogleAccessToken();
    const googleHeaders = {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': ANTIGRAVITY_UA
    };
    const loaded = await httpsRequest({
      method: 'POST',
      url: `${CLOUD_CODE_URL}:loadCodeAssist`,
      headers: googleHeaders,
      body: '{}',
      timeoutMs: 15000
    });
    if (loaded.status === 401 || loaded.status === 403) {
      googleAccessCache = { token: null, expiresAt: 0 };
      return detectedCard({
        id: 'gemini',
        name: 'Antigravity',
        provider: 'Google',
        icon: 'gemini',
        quotaState: 'expired',
        sessionResetText: 'Sign in: agy',
        weeklyResetText: 'OAuth token expired',
        status: 'expired'
      });
    }
    const project = loaded.json && loaded.json.cloudaicompanionProject;
    const paid = loaded.json && loaded.json.paidTier && loaded.json.paidTier.name;
    const current = loaded.json && loaded.json.currentTier && loaded.json.currentTier.name;
    const provider = paid || current || 'Google';
    const payload = project
      ? JSON.stringify({ project: String(project).startsWith('projects/') ? project : `projects/${project}` })
      : '{}';
    const summary = await httpsRequest({
      method: 'POST',
      url: `${CLOUD_CODE_URL}:retrieveUserQuotaSummary`,
      headers: googleHeaders,
      body: payload,
      timeoutMs: 20000
    });
    const groups = summary.json && Array.isArray(summary.json.groups) ? summary.json.groups : [];
    if (summary.status !== 200 || groups.length === 0) {
      return detectedCard({
        id: 'gemini',
        name: 'Antigravity',
        provider,
        icon: 'gemini',
        quotaState: 'unknown',
        sessionResetText: 'Quota endpoint unavailable',
        weeklyResetText: 'Quota unknown',
        status: 'unknown'
      });
    }
    const sessionBuckets = [];
    const weeklyBuckets = [];
    for (const group of groups) {
      for (const bucket of group.buckets || []) {
        const window = String(bucket.window || bucket.bucketId || '').toLowerCase();
        if (window.includes('5h')) sessionBuckets.push(bucket);
        if (window.includes('weekly')) weeklyBuckets.push(bucket);
      }
    }
    const session = hottestRemainingBucket(sessionBuckets);
    const weekly = hottestRemainingBucket(weeklyBuckets);
    if (!session && !weekly) {
      return detectedCard({
        id: 'gemini',
        name: 'Antigravity',
        provider,
        icon: 'gemini',
        quotaState: 'unknown',
        sessionResetText: 'Usage data malformed',
        weeklyResetText: 'Quota unknown',
        status: 'unknown'
      });
    }
    return detectedCard({
      id: 'gemini',
      name: 'Antigravity',
      provider,
      icon: 'gemini',
      quotaState: 'known',
      sessionUsedPercent: session ? session.used : null,
      weeklyUsedPercent: weekly ? weekly.used : null,
      sessionLabel: '5h session',
      weeklyLabel: 'Weekly',
      sessionResetText: (session && formatResetAt(session.reset)) || (session ? 'Active' : 'No session window'),
      weeklyResetText: (weekly && formatResetAt(weekly.reset)) || (weekly ? 'Active' : 'No weekly window')
    });
  } catch (err) {
    const expired = err && err.kind === 'expired';
    return detectedCard({
      id: 'gemini',
      name: 'Antigravity',
      provider: 'Google',
      icon: 'gemini',
      quotaState: expired ? 'expired' : 'unknown',
      sessionResetText: expired ? 'Sign in: agy' : 'Quota unknown',
      weeklyResetText: expired ? 'OAuth token expired' : 'Antigravity usage read failed',
      status: expired ? 'expired' : 'unknown'
    });
  }
}

function readSqliteItem(dbPath, key) {
  return new Promise((resolve) => {
    const script = path.join(__dirname, 'sqlite-item.py');
    execFile(
      'python',
      [script, dbPath, key],
      { timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err || stdout == null || String(stdout).length === 0) {
          resolve(null);
          return;
        }
        resolve(String(stdout));
      }
    );
  });
}

async function getCursorUsage() {
  const cursorHome = path.join(homeDir, '.cursor');
  const cursorAppData = path.join(process.env.APPDATA || '', 'Cursor');
  if (!fs.existsSync(cursorHome) && !fs.existsSync(cursorAppData)) return null;
  const dbPath = path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  if (!fs.existsSync(dbPath)) {
    return detectedCard({
      id: 'cursor',
      name: 'Cursor',
      provider: 'Cursor',
      icon: 'cursor',
      quotaState: 'expired',
      sessionResetText: 'Sign in to Cursor',
      weeklyResetText: 'No local session token',
      status: 'expired'
    });
  }

  try {
    const token = await readSqliteItem(dbPath, 'cursorAuth/accessToken');
    const planHint = await readSqliteItem(dbPath, 'cursorAuth/stripeMembershipType');
    if (!token) {
      return detectedCard({
        id: 'cursor',
        name: 'Cursor',
        provider: 'Cursor',
        icon: 'cursor',
        quotaState: 'expired',
        sessionResetText: 'Sign in to Cursor',
        weeklyResetText: 'No access token',
        status: 'expired'
      });
    }
    const res = await httpsRequest({
      method: 'POST',
      url: 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Connect-Protocol-Version': '1',
        'User-Agent': 'Mozilla/5.0'
      },
      body: '{}',
      timeoutMs: 15000
    });
    if (res.status === 401 || res.status === 403) {
      return detectedCard({
        id: 'cursor',
        name: 'Cursor',
        provider: 'Cursor',
        icon: 'cursor',
        quotaState: 'expired',
        sessionResetText: 'Sign in to Cursor',
        weeklyResetText: 'Session expired',
        status: 'expired'
      });
    }
    const plan = res.json && res.json.planUsage;
    const total = coercePercent(plan && plan.totalPercentUsed);
    const auto = coercePercent(plan && plan.autoPercentUsed);
    if (res.status !== 200 || (total == null && auto == null)) {
      return detectedCard({
        id: 'cursor',
        name: 'Cursor',
        provider: 'Cursor',
        icon: 'cursor',
        quotaState: 'unknown',
        sessionResetText: 'Usage endpoint unavailable',
        weeklyResetText: 'Quota unknown',
        status: 'unknown'
      });
    }
    const cycle = formatResetAt(res.json.billingCycleEnd);
    const planName = (planHint || 'Cursor').replace(/\b\w/g, (c) => c.toUpperCase());
    return detectedCard({
      id: 'cursor',
      name: 'Cursor',
      provider: `Cursor · ${planName}`,
      icon: 'cursor',
      quotaState: 'known',
      sessionUsedPercent: auto,
      weeklyUsedPercent: total,
      sessionLabel: 'Auto usage',
      weeklyLabel: 'Billing period',
      sessionResetText: cycle || (auto == null ? 'No session window' : 'Billing cycle'),
      weeklyResetText: cycle || (total == null ? 'No plan window' : 'Billing cycle')
    });
  } catch (err) {
    return detectedCard({
      id: 'cursor',
      name: 'Cursor',
      provider: 'Cursor',
      icon: 'cursor',
      quotaState: 'unknown',
      sessionResetText: 'Quota unknown',
      weeklyResetText: 'Cursor usage read failed',
      status: 'unknown'
    });
  }
}

function opencodeAuthPath() {
  const override = (process.env.XDG_DATA_HOME || '').trim();
  if (override) return path.join(override, 'opencode', 'auth.json');
  return path.join(homeDir, '.local', 'share', 'opencode', 'auth.json');
}

function pickOpenCodeWindow(usage, keys) {
  for (const key of keys) {
    const win = usage && usage[key];
    const percent = coercePercent(win && (win.percent ?? win.usagePercent));
    if (percent == null) continue;
    return { percent, reset: win.resetsAt || win.resetAt };
  }
  return null;
}

async function getOpenCodeUsage() {
  const authPath = opencodeAuthPath();
  const configDir = path.join(homeDir, '.config', 'opencode');
  if (!fs.existsSync(authPath) && !fs.existsSync(configDir)) return null;
  if (!fs.existsSync(authPath)) {
    return detectedCard({
      id: 'opencode',
      name: 'OpenCode',
      provider: 'OpenCode',
      icon: 'opencode',
      quotaState: 'expired',
      sessionResetText: 'Connect OpenCode Go',
      weeklyResetText: 'No API key in auth.json',
      status: 'expired'
    });
  }

  try {
    const auth = readJson(authPath);
    const key = (auth['opencode-go'] && auth['opencode-go'].key) || (auth.opencode && auth.opencode.key);
    if (!key) {
      return detectedCard({
        id: 'opencode',
        name: 'OpenCode',
        provider: 'OpenCode',
        icon: 'opencode',
        quotaState: 'expired',
        sessionResetText: 'Connect OpenCode Go',
        weeklyResetText: 'No Go API key',
        status: 'expired'
      });
    }
    const res = await httpsRequest({
      url: 'https://opencode.ai/zen/go/v1/usage',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenCode/1.0'
      },
      timeoutMs: 12000
    });
    if (res.status === 401 || res.status === 403) {
      return detectedCard({
        id: 'opencode',
        name: 'OpenCode',
        provider: 'OpenCode Go',
        icon: 'opencode',
        quotaState: res.status === 401 ? 'expired' : 'unknown',
        sessionResetText: res.status === 401 ? 'Reconnect OpenCode Go' : 'Usage blocked',
        weeklyResetText: 'Quota unknown',
        status: res.status === 401 ? 'expired' : 'unknown'
      });
    }
    const usage = res.json && res.json.usage;
    const session = pickOpenCodeWindow(usage, ['rolling', 'rollingUsage']);
    const weekly = pickOpenCodeWindow(usage, ['weekly', 'weeklyUsage']);
    const monthly = pickOpenCodeWindow(usage, ['monthly', 'monthlyUsage']);
    const plan = monthly && (!weekly || monthly.percent > weekly.percent) ? monthly : weekly;
    if (res.status !== 200 || (!session && !plan)) {
      return detectedCard({
        id: 'opencode',
        name: 'OpenCode',
        provider: 'OpenCode Go',
        icon: 'opencode',
        quotaState: 'unknown',
        sessionResetText: 'Usage endpoint unavailable',
        weeklyResetText: 'Quota unknown',
        status: 'unknown'
      });
    }
    return detectedCard({
      id: 'opencode',
      name: 'OpenCode',
      provider: 'OpenCode Go',
      icon: 'opencode',
      quotaState: 'known',
      sessionUsedPercent: session ? session.percent : null,
      weeklyUsedPercent: plan ? plan.percent : null,
      sessionLabel: 'Rolling window',
      weeklyLabel: 'Plan period',
      sessionResetText: (session && formatResetAt(session.reset)) || (session ? 'Active' : 'No session window'),
      weeklyResetText: (plan && formatResetAt(plan.reset)) || (plan ? 'Active' : 'No plan window')
    });
  } catch (err) {
    return detectedCard({
      id: 'opencode',
      name: 'OpenCode',
      provider: 'OpenCode',
      icon: 'opencode',
      quotaState: 'unknown',
      sessionResetText: 'Quota unknown',
      weeklyResetText: 'OpenCode usage read failed',
      status: 'unknown'
    });
  }
}

function grokHome() {
  const override = (process.env.GROK_HOME || process.env.XAI_HOME || '').trim();
  return override ? override : path.join(homeDir, '.grok');
}

function readGrokModelName() {
  return 'Grok';
}

function readGrokSession() {
  const grokDir = grokHome();
  const authPath = path.join(grokDir, 'auth.json');
  if (!fs.existsSync(authPath)) return null;
  const auth = readJson(authPath);
  if (!auth || typeof auth !== 'object') return null;
  for (const entry of Object.values(auth)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.auth_mode === 'api_key' || entry.auth_mode === 'web_login') continue;
    const token = entry.key || entry.access_token;
    if (!token) continue;
    return {
      token,
      userId: entry.user_id || '',
      version: (() => {
        try {
          const v = path.join(grokDir, '.metadata_version');
          return fs.existsSync(v) ? fs.readFileSync(v, 'utf8').trim() : '1.0.13';
        } catch (e) {
          return '1.0.13';
        }
      })()
    };
  }
  return null;
}

async function getGrokUsage() {
  const grokDir = grokHome();
  if (!fs.existsSync(grokDir)) return null;
  const name = readGrokModelName();
  const provider = 'xAI';
  let session = readGrokSession();
  if (!session) {
    return detectedCard({
      id: 'grok',
      name,
      provider,
      icon: 'grok',
      quotaState: 'expired',
      sessionResetText: 'Sign in: grok login',
      weeklyResetText: 'No OAuth session',
      status: 'expired'
    });
  }

  try {
    const res = await httpsRequest({
      url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
      headers: {
        Authorization: `Bearer ${session.token}`,
        Accept: 'application/json',
        'User-Agent': `grok-cli/${session.version}`,
        'X-XAI-Token-Auth': 'xai-grok-cli',
        'x-grok-client-version': session.version,
        'x-grok-client-mode': 'interactive',
        ...(session.userId ? { 'x-userid': String(session.userId) } : {})
      },
      timeoutMs: 10000
    });
    if (res.status === 401 || res.status === 403) {
      return detectedCard({
        id: 'grok',
        name,
        provider,
        icon: 'grok',
        quotaState: 'expired',
        sessionResetText: 'Sign in: grok login',
        weeklyResetText: 'OAuth token expired',
        status: 'expired'
      });
    }
    const config = res.json && res.json.config;
    if (res.status !== 200 || !config) {
      return detectedCard({
        id: 'grok',
        name,
        provider,
        icon: 'grok',
        quotaState: 'unknown',
        sessionResetText: 'Billing endpoint unavailable',
        weeklyResetText: 'Quota unknown',
        status: 'unknown'
      });
    }

    const weekly = coercePercent(config.creditUsagePercent);
    let sessionUsed = null;
    const products = Array.isArray(config.productUsage) ? config.productUsage : [];
    for (const product of products) {
      const pct = coercePercent(product && (product.usagePercent ?? product.creditUsagePercent));
      if (pct != null) {
        sessionUsed = pct;
        break;
      }
    }
    const weeklyReset = formatResetAt(config.currentPeriod && config.currentPeriod.end)
      || formatResetAt(config.billingPeriodEnd);

    if (weekly == null && sessionUsed == null) {
      return detectedCard({
        id: 'grok',
        name,
        provider,
        icon: 'grok',
        quotaState: 'unknown',
        sessionResetText: 'Usage data malformed',
        weeklyResetText: 'Quota unknown',
        status: 'unknown'
      });
    }

    return detectedCard({
      id: 'grok',
      name,
      provider,
      icon: 'grok',
      quotaState: 'known',
      sessionUsedPercent: sessionUsed,
      weeklyUsedPercent: weekly,
      sessionLabel: 'Product usage',
      weeklyLabel: 'Billing period',
      sessionResetText: sessionUsed == null ? 'No session window' : 'Active',
      weeklyResetText: weeklyReset || (weekly == null ? 'No weekly window' : 'Active')
    });
  } catch (err) {
    return detectedCard({
      id: 'grok',
      name,
      provider,
      icon: 'grok',
      quotaState: 'unknown',
      sessionResetText: 'Quota unknown',
      weeklyResetText: 'Grok billing read failed',
      status: 'unknown'
    });
  }
}

function runQuotaCommand(command) {
  return new Promise((resolve) => {
    const trimmed = String(command || '').trim();
    if (!trimmed) {
      resolve(null);
      return;
    }
    const child = execFile(
      process.platform === 'win32' ? 'cmd.exe' : 'sh',
      process.platform === 'win32' ? ['/d', '/s', '/c', trimmed] : ['-c', trimmed],
      { timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(String(stdout).trim()));
        } catch (e) {
          resolve(null);
        }
      }
    );
    child.on('error', () => resolve(null));
  });
}

function customDisplayName(agent) {
  const name = String(agent.name || 'Custom CLI').trim() || 'Custom CLI';
  const model = String(agent.modelName || '').trim();
  return model ? `${name} (${model})` : name;
}

async function getCustomUsage(agent) {
  if (!agent || !agent.id) return null;
  const name = customDisplayName(agent);
  const provider = String(agent.provider || 'Custom').trim() || 'Custom';
  const icon = String(agent.icon || 'spark');
  const source = agent.quotaSource || 'unknown';

  if (source === 'command') {
    const parsed = await runQuotaCommand(agent.command);
    const session = coercePercent(parsed && (parsed.sessionUsedPercent ?? parsed.session));
    const weekly = coercePercent(parsed && (parsed.weeklyUsedPercent ?? parsed.weekly));
    if (!parsed || (session == null && weekly == null)) {
      return detectedCard({
        id: agent.id,
        name,
        provider,
        icon,
        quotaState: 'unknown',
        sessionResetText: 'Custom command failed',
        weeklyResetText: 'Need JSON with session/weekly %',
        status: 'unknown'
      });
    }
    return detectedCard({
      id: agent.id,
      name: parsed.name || name,
      provider,
      icon,
      quotaState: 'known',
      sessionUsedPercent: session,
      weeklyUsedPercent: weekly,
      sessionResetText: parsed.sessionResetText || (session == null ? 'No session window' : 'Active'),
      weeklyResetText: parsed.weeklyResetText || (weekly == null ? 'No weekly window' : 'Active')
    });
  }

  if (source === 'manual') {
    const session = coercePercent(agent.sessionUsedPercent);
    const weekly = coercePercent(agent.weeklyUsedPercent);
    if (session == null && weekly == null) {
      return detectedCard({
        id: agent.id,
        name,
        provider,
        icon,
        quotaState: 'unknown',
        sessionResetText: 'Set a percent in Settings',
        weeklyResetText: 'Manual quota empty',
        status: 'unknown'
      });
    }
    return detectedCard({
      id: agent.id,
      name,
      provider,
      icon,
      quotaState: 'known',
      sessionUsedPercent: session,
      weeklyUsedPercent: weekly,
      sessionResetText: agent.sessionResetText || 'Manual',
      weeklyResetText: agent.weeklyResetText || 'Manual'
    });
  }

  return detectedCard({
    id: agent.id,
    name,
    provider,
    icon,
    quotaState: 'unknown',
    sessionResetText: 'No quota source yet',
    weeklyResetText: 'Pick manual % or a command',
    status: 'unknown'
  });
}

const SUGGEST_CLIS = [
  { name: 'Aider', command: 'aider', icon: 'spark' },
  { name: 'GitHub Copilot', command: 'copilot', icon: 'codex' },
  { name: 'Amp', command: 'amp', icon: 'spark' },
  { name: 'Goose', command: 'goose', icon: 'spark' },
  { name: 'Crush', command: 'crush', icon: 'spark' },
  { name: 'Qwen', command: 'qwen', icon: 'spark' }
];

function probeCli(bin) {
  return new Promise((resolve) => {
    const name = String(bin || '').trim();
    if (!name || !/^[A-Za-z0-9._\\/:-]+$/.test(name)) {
      resolve({ found: false, path: null });
      return;
    }
    const tool = process.platform === 'win32' ? 'where.exe' : 'which';
    execFile(
      tool,
      process.platform === 'win32' ? [name] : [name],
      { timeout: 3000, windowsHide: true, maxBuffer: 16 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve({ found: false, path: null });
          return;
        }
        const first = String(stdout)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean) || null;
        resolve({ found: Boolean(first), path: first });
      }
    );
  });
}

async function suggestCustomClis(config) {
  const custom = Array.isArray(config?.customAgents) ? config.customAgents : [];
  const taken = new Set(
    custom
      .map((agent) => String(agent.command || agent.name || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const results = [];
  for (const item of SUGGEST_CLIS) {
    if (taken.has(item.command.toLowerCase()) || taken.has(item.name.toLowerCase())) continue;
    const probe = await probeCli(item.command);
    if (probe.found) {
      results.push({ ...item, path: probe.path });
    }
  }
  return results;
}

const BUILTIN_READERS = [
  { id: 'codex', name: 'Codex', provider: 'OpenAI', read: getCodexUsage },
  { id: 'claude', name: 'Claude Code', provider: 'Anthropic', read: getClaudeUsage },
  { id: 'gemini', name: 'Antigravity', provider: 'Google', read: getGeminiUsage },
  { id: 'cursor', name: 'Cursor', provider: 'Cursor', read: getCursorUsage },
  { id: 'opencode', name: 'OpenCode', provider: 'OpenCode', read: getOpenCodeUsage },
  { id: 'grok', name: 'Grok', provider: 'xAI', read: getGrokUsage }
];

function cloneResult(value) {
  return value && typeof value === 'object' ? { ...value } : value;
}

function readerDelay(failures) {
  return Math.min(READER_POLL_MS * (2 ** Math.max(0, failures - 1)), READER_MAX_BACKOFF_MS);
}

function readWithCache(entry, { force = false, now = Date.now() } = {}) {
  const existing = readerCache.get(entry.id) || { result: null, failures: 0, nextPollAt: 0, inFlight: null };
  if (existing.inFlight) return existing.inFlight.then(cloneResult);
  if (!force && existing.nextPollAt > now) return Promise.resolve(cloneResult(existing.result));

  const inFlight = Promise.resolve()
    .then(() => entry.read())
    .then((raw) => {
      const attemptedAt = new Date(now).toISOString();
      const result = raw ? { ...raw, attemptedAt } : null;
      const available = result && result.quotaState === 'known';
      if (available) result.observedAt = attemptedAt;
      const failures = available ? 0 : existing.failures + 1;
      const delay = available ? READER_POLL_MS : readerDelay(failures);
      readerCache.set(entry.id, { result, failures, nextPollAt: now + delay, inFlight: null });
      return cloneResult(result);
    })
    .catch(() => {
      const attemptedAt = new Date(now).toISOString();
      const failures = existing.failures + 1;
      const result = existing.result
        ? { ...existing.result, quotaState: 'unknown', status: 'unknown', attemptedAt }
        : null;
      readerCache.set(entry.id, {
        result,
        failures,
        nextPollAt: now + readerDelay(failures),
        inFlight: null
      });
      return cloneResult(result);
    });
  readerCache.set(entry.id, { ...existing, inFlight });
  return inFlight;
}

async function getAllInstalledAgentUsage({ force = false, now = Date.now() } = {}) {
  const config = getLocalConfig();
  const enabledMap = config.enabledModels || DEFAULT_CONFIG.enabledModels;
  const customAgents = Array.isArray(config.customAgents) ? config.customAgents : [];
  const customReaders = customAgents.map((agent) => ({
    id: agent.id,
    name: customDisplayName(agent),
    provider: agent.provider || 'Custom',
    read: () => getCustomUsage(agent)
  }));
  const enabledReaders = [...BUILTIN_READERS, ...customReaders]
    .filter((entry) => enabledMap[entry.id] !== false);
  const results = await Promise.all(
    enabledReaders.map((entry) => readWithCache(entry, { force, now }))
  );

  const allDetected = results.filter(Boolean);
  const filteredModels = allDetected.map((model) => attachRing({ ...model }, config.alertThreshold));
  const allDetectedIds = [
    ...BUILTIN_READERS.map(({ id, name, provider }) => ({ id, name, provider, custom: false })),
    ...customReaders.map(({ id, name, provider }) => ({ id, name, provider, custom: true }))
  ];

  return {
    activeModel: filteredModels[0]?.id || 'codex',
    models: filteredModels,
    allDetectedIds,
    config,
    lastUpdated: new Date().toISOString()
  };
}

module.exports = {
  getAllInstalledAgentUsage,
  getLocalConfig,
  saveLocalConfig,
  probeCli,
  suggestCustomClis,
  _test: {
    attachRing,
    coercePercent,
    quotaStatus,
    readWithCache,
    resetReaderCache: () => readerCache.clear()
  }
};
