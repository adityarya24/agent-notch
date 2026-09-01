const { app, BrowserWindow, screen, ipcMain, Tray, Menu, globalShortcut, nativeImage, session, Notification } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const { getAllInstalledAgentUsage, getLocalConfig, saveLocalConfig, probeCli, suggestCustomClis } = require('./scrapers');
const { readJobActivity } = require('./handoff_status');
const { evaluateQuotaAlerts, formatAlertBody } = require('./alert-notify');
const { mergeActiveRings, readDirectAgentActivity } = require('./direct_activity');
const { customProcessMappings, ProcessActivityTracker } = require('./process_activity');
const { runtimePath, ensureRuntimeDir, writePid, clearPid } = require('./runtime-state');
const { activityFingerprint, quotaFingerprint, keepLastKnown } = require('./quota-state');
const { PERSISTED_QUOTA_TTL_MS, readQuotaCache, writeQuotaCache } = require('./quota-cache');

let mainWindow = null;
let tray = null;
let pollInterval = null;
let jobPollTimer = null;
let cachedQuotaState = null;
let usageRefreshPromise = null;
let overlayMode = 'dock';
let overlayAnimation = null;
let alertFiredIds = [];
const logFile = runtimePath('electron_boot.log');
const quotaCacheFile = runtimePath('quota-cache.json');
const APP_USER_MODEL_ID = 'com.adityarya.agent-notch';
const processActivity = new ProcessActivityTracker();

function readLocalActivities() {
  // Cursor Agent and OpenCode can run behind node.exe shims, so their narrow
  // artifact adapters stay enabled even when no dedicated process name exists.
  const includeRings = [...new Set([...processActivity.liveRings(), 'cursor', 'gemini', 'opencode'])];
  return [...readDirectAgentActivity({ includeRings }), ...processActivity.current()];
}

function configuredProcessMappings() {
  // Activity settings must reflect the just-saved file even when a slower
  // quota refresh is still resolving with its older config snapshot.
  const config = getLocalConfig();
  return customProcessMappings(config?.customAgents);
}

const OVERLAY = {
  dock: { width: 360, height: 620 },
  settings: { width: 440, height: 640 },
  // Collapsing tucks the full-size rail into the screen edge. Keeping the
  // window footprint stable avoids a detached mini-window and visual jump.
  collapsed: { width: 360, height: 620 }
};

function reduceMotionEnabled(cfg) {
  if (process.env.NOTCH_REDUCE_MOTION === '1') return true;
  return Boolean(cfg && cfg.reduceMotion);
}

function quotaConfigFingerprint(config) {
  return JSON.stringify({
    enabledModels: config?.enabledModels || {},
    customAgents: config?.customAgents || [],
    alertThreshold: config?.alertThreshold
  });
}

function snapOverlay(mode) {
  overlayMode = Object.hasOwn(OVERLAY, mode) ? mode : 'dock';
  const size = OVERLAY[overlayMode];
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: workX, y: workY, width: workWidth, height: workHeight } = primaryDisplay.workArea;
  const posX = Math.max(0, workX + workWidth - size.width);
  const posY = Math.max(0, workY + Math.round((workHeight - size.height) / 2));
  const target = { x: posX, y: posY, width: size.width, height: size.height };
  const start = mainWindow.getBounds();
  if (overlayAnimation) clearInterval(overlayAnimation);
  if (start.x === target.x && start.y === target.y && start.width === target.width && start.height === target.height) return;
  const duration = reduceMotionEnabled(getLocalConfig()) ? 0 : 180;
  if (!duration) {
    mainWindow.setBounds(target);
    return;
  }

  mainWindow.setResizable(true);
  const startedAt = Date.now();
  overlayAnimation = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearInterval(overlayAnimation);
      overlayAnimation = null;
      return;
    }
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 1 - ((1 - progress) ** 3);
    const next = Object.fromEntries(
      Object.keys(target).map((key) => [key, Math.round(start[key] + ((target[key] - start[key]) * eased))])
    );
    mainWindow.setBounds(next);
    if (progress >= 1) {
      clearInterval(overlayAnimation);
      overlayAnimation = null;
      mainWindow.setBounds(target);
      mainWindow.setResizable(false);
    }
  }, 15);
}

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: workX, y: workY, width: workWidth, height: workHeight } = primaryDisplay.workArea;
  const initialMode = getLocalConfig().collapsed ? 'collapsed' : 'dock';
  const size = OVERLAY[initialMode];
  overlayMode = initialMode;
  const distIndex = path.join(__dirname, '../dist/index.html');
  const distUrl = pathToFileURL(distIndex).href;

  const posX = Math.max(0, workX + workWidth - size.width);
  const posY = Math.max(0, workY + Math.round((workHeight - size.height) / 2));

  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: posX,
    y: posY,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true, // Minimized to System Tray instead of taskbar clutter
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== distUrl) event.preventDefault();
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile(distIndex);

  mainWindow.webContents.on('did-finish-load', async () => {
    mainWindow.show();
    mainWindow.focus();

    // Trigger immediate live refresh
    refreshUsageData();
    if (process.env.NOTCH_CAPTURE) {
      runCaptureIfRequested().catch((err) => {
        console.error('[Agent Notch] capture failed', err);
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function attachActivity(data) {
  const activity = readJobActivity();
  const directActivities = readLocalActivities();
  data.jobActivity = activity;
  data.activeRings = mergeActiveRings(activity, directActivities);
  data.handoff = activity && activity.handoff ? activity.handoff : null;
  data.reduceMotion = reduceMotionEnabled(data.config || getLocalConfig());
  return data;
}

function scheduleJobPoll(activeRings = [], delayOverride = null) {
  if (jobPollTimer) clearTimeout(jobPollTimer);
  const delay = delayOverride ?? (activeRings.length ? 3000 : 7500);
  jobPollTimer = setTimeout(() => {
    refreshJobActivity();
  }, delay);
}

function publishState(next) {
  cachedQuotaState = next;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('usage-updated', next);
  }
}

function ringsVisible() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return false;
  return overlayMode !== 'collapsed';
}

function revealNotch() {
  const config = saveLocalConfig({ ...getLocalConfig(), collapsed: false });
  snapOverlay('dock');
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('collapsed-changed', false);
  }
  if (cachedQuotaState) {
    publishState({
      ...cachedQuotaState,
      config,
      reduceMotion: reduceMotionEnabled(config)
    });
  }
}

function maybeNotifyQuotaAlerts(previous, next) {
  const config = (next && next.config) || getLocalConfig();
  const result = evaluateQuotaAlerts({
    previousModels: previous && previous.models,
    nextModels: next && next.models,
    visible: ringsVisible(),
    notifyEnabled: config.notifyWhenTucked !== false,
    firedIds: alertFiredIds,
    defaultThreshold: config.alertThreshold || 80
  });
  alertFiredIds = result.firedIds;
  if (!result.events.length) return;
  const windowVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  if (windowVisible) {
    mainWindow.webContents.send('quota-alert', result.events);
    return;
  }
  if (!Notification.isSupported()) return;
  for (const event of result.events) {
    const note = new Notification({
      title: 'Agent Notch',
      body: formatAlertBody(event)
    });
    note.on('click', revealNotch);
    note.show();
  }
}

async function refreshUsageData({ force = false } = {}) {
  if (usageRefreshPromise) return usageRefreshPromise;
  usageRefreshPromise = (async () => {
    try {
      const liveData = attachActivity(await getAllInstalledAgentUsage({ force }));
      const merged = keepLastKnown(cachedQuotaState, liveData, Date.now(), PERSISTED_QUOTA_TTL_MS);
      merged.jobActivity = liveData.jobActivity;
      merged.activeRings = liveData.activeRings;
      merged.handoff = liveData.handoff;
      merged.reduceMotion = liveData.reduceMotion;
      writeQuotaCache(quotaCacheFile, merged);
      if (cachedQuotaState && quotaFingerprint(cachedQuotaState) === quotaFingerprint(merged)) {
        cachedQuotaState = { ...merged, lastUpdated: liveData.lastUpdated };
        scheduleJobPoll(merged.activeRings);
        return cachedQuotaState;
      }
      maybeNotifyQuotaAlerts(cachedQuotaState, merged);
      publishState(merged);
      scheduleJobPoll(merged.activeRings);
      return merged;
    } catch (err) {
      console.error('[Agent Notch] Error refreshing quota:', err);
      return cachedQuotaState;
    } finally {
      usageRefreshPromise = null;
    }
  })();
  return usageRefreshPromise;
}

async function refreshJobActivity() {
  try {
    if (!cachedQuotaState) {
      refreshUsageData();
      return;
    }
    await processActivity.sample(configuredProcessMappings());
    const activity = readJobActivity();
    const activeRings = mergeActiveRings(activity, readLocalActivities());
    const reduceMotion = reduceMotionEnabled(cachedQuotaState.config || getLocalConfig());
    const prev = activityFingerprint(cachedQuotaState.jobActivity, cachedQuotaState.activeRings);
    const next = activityFingerprint(activity, activeRings);
    if (prev === next && Boolean(cachedQuotaState.reduceMotion) === reduceMotion) {
      scheduleJobPoll(activeRings);
      return;
    }
    publishState({
      ...cachedQuotaState,
      jobActivity: activity,
      activeRings,
      handoff: activity && activity.handoff ? activity.handoff : null,
      reduceMotion
    });
    scheduleJobPoll(activeRings);
  } catch (err) {
    console.error('[Agent Notch] Error refreshing job activity:', err);
    scheduleJobPoll(cachedQuotaState?.activeRings || []);
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray_icon.png');
  const trayIcon = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Agent Notch HUD (Active)', enabled: false },
    { type: 'separator' },
    {
      label: 'Refresh Quotas Now',
      click: () => {
        refreshUsageData({ force: true });
      }
    },
    {
      label: 'Toggle Notch (Ctrl+Shift+U)',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      }
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
          path: process.execPath,
          args: [path.resolve(__dirname, 'main.js')]
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Agent Notch',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Agent Notch — AI Session Quota HUD');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// IPC Handlers
ipcMain.handle('get-usage-data', async () => {
  return cachedQuotaState || refreshUsageData();
});

ipcMain.handle('get-config', () => {
  return getLocalConfig();
});

ipcMain.handle('save-config', async (_event, newConfig) => {
  try {
    const previous = getLocalConfig();
    const config = saveLocalConfig(newConfig);
    if (quotaConfigFingerprint(previous) !== quotaConfigFingerprint(config)) {
      await refreshUsageData({ force: true });
    } else if (cachedQuotaState) {
      publishState({
        ...cachedQuotaState,
        config,
        reduceMotion: reduceMotionEnabled(config)
      });
    } else {
      await refreshUsageData();
    }
    return { success: true, config };
  } catch (err) {
    return { success: false, message: err.message || String(err) };
  }
});

ipcMain.handle('trigger-handoff', () => {
  return { success: false, message: 'Notch displays MindSync handoff status; it does not transfer jobs.' };
});

ipcMain.handle('set-overlay-mode', (_event, mode) => {
  snapOverlay(mode);
  return { mode: overlayMode };
});

ipcMain.handle('probe-cli', (_event, bin) => probeCli(bin));

ipcMain.handle('suggest-custom-clis', () => {
  const config = getLocalConfig();
  return suggestCustomClis(config);
});

ipcMain.on('set-ignore-mouse-events', (_event, ignore) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (ignore) {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setIgnoreMouseEvents(false);
  }
});

async function runCaptureIfRequested() {
  const dir = String(process.env.NOTCH_CAPTURE || '').trim();
  try {
    fs.appendFileSync(logFile, `[capture] dir=${dir || '(empty)'}\n`);
  } catch (e) {}
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const frames = Math.max(1, Number(process.env.NOTCH_CAPTURE_FRAMES || 1) || 1);
  const interval = Math.max(50, Number(process.env.NOTCH_CAPTURE_MS || 120) || 120);
  const waitFile = String(process.env.NOTCH_CAPTURE_WAIT || '').trim();
  if (waitFile) {
    const t0 = Date.now();
    while (!fs.existsSync(waitFile) && Date.now() - t0 < 20000) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  } else {
    await new Promise((resolve) => setTimeout(resolve, 2200));
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  const withTimeout = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('capture timeout')), ms))
  ]);
  fs.writeFileSync(path.join(dir, 'started.json'), `${JSON.stringify({ frames, at: new Date().toISOString() })}\n`);
  for (let i = 0; i < frames; i += 1) {
    const n = String(i).padStart(2, '0');
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const page = await withTimeout(mainWindow.capturePage(), 2000);
        fs.writeFileSync(path.join(dir, `page-${n}.png`), page.toPNG());
      }
    } catch (e) {
      try { fs.appendFileSync(logFile, `[capture] page ${n} ${e.message}\n`); } catch (err) {}
    }
    if (i < frames - 1) {
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  fs.writeFileSync(path.join(dir, 'done.json'), `${JSON.stringify({ frames, at: new Date().toISOString() })}\n`);
  if (process.env.NOTCH_CAPTURE_QUIT === '1') app.quit();
}

if (gotTheLock) app.whenReady().then(() => {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  try {
    ensureRuntimeDir();
    const persisted = readQuotaCache(quotaCacheFile);
    if (persisted) {
      cachedQuotaState = {
        ...persisted,
        config: getLocalConfig(),
        reduceMotion: reduceMotionEnabled(getLocalConfig())
      };
    }
    fs.appendFileSync(logFile, `[boot] pid=${process.pid} capture=${process.env.NOTCH_CAPTURE || ''}\n`);
    writePid(process.pid);
  } catch (err) {
    console.error('[Agent Notch] Could not write runtime state:', err);
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createOverlayWindow();
  createTray();

  // Register Global Toggle Shortcut (Ctrl+Shift+U)
  globalShortcut.register('CommandOrControl+Shift+U', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  pollInterval = setInterval(() => refreshUsageData(), 60000);
  processActivity.sample(configuredProcessMappings()).finally(() => scheduleJobPoll([], 3000));
});

process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync(logFile, `[uncaught] ${err && err.stack ? err.stack : err}\n`);
  } catch (e) {}
});
process.on('unhandledRejection', (err) => {
  try {
    fs.appendFileSync(logFile, `[unhandled] ${err && err.stack ? err.stack : err}\n`);
  } catch (e) {}
});

if (gotTheLock) app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (pollInterval) clearInterval(pollInterval);
  if (jobPollTimer) clearTimeout(jobPollTimer);
  if (overlayAnimation) clearInterval(overlayAnimation);
  clearPid(process.pid);
});

if (gotTheLock) app.on('window-all-closed', () => {
  // Keep running in system tray
});
