const { app, BrowserWindow, screen, ipcMain, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { getAllInstalledAgentUsage, getLocalConfig, saveLocalConfig, probeCli, suggestCustomClis } = require('./scrapers');
const { readJobActivity } = require('./handoff_status');

let mainWindow = null;
let tray = null;
let pollInterval = null;
let jobPollTimer = null;
let cachedQuotaState = null;
let overlayMode = 'dock';
const pidFile = path.join(__dirname, '..', 'notch.pid');

function writePid() {
  try {
    fs.writeFileSync(pidFile, String(process.pid), 'utf8');
  } catch (e) {}
}

function clearPid() {
  try {
    fs.unlinkSync(pidFile);
  } catch (e) {}
}

const OVERLAY = {
  dock: { width: 360, height: 500 },
  settings: { width: 440, height: 520 }
};

function activityFingerprint(activity) {
  if (!activity) return '';
  const handoff = activity.handoff;
  return `${activity.jobId || ''}:${activity.jobStatus || ''}:${activity.activeAgent || ''}:${handoff ? `${handoff.at}:${handoff.from}->${handoff.to}` : ''}`;
}

function quotaFingerprint(data) {
  if (!data || !Array.isArray(data.models)) return '';
  const models = data.models
    .map((m) => `${m.id}:${m.ringPercent}:${m.quotaState}:${m.status}:${m.sessionUsedPercent}:${m.weeklyUsedPercent}`)
    .join('|');
  return `${models}|${activityFingerprint(data.jobActivity)}`;
}

function reduceMotionEnabled(cfg) {
  if (process.env.NOTCH_REDUCE_MOTION === '1') return true;
  return Boolean(cfg && cfg.reduceMotion);
}

function keepLastKnown(prev, next) {
  if (!prev || !Array.isArray(prev.models) || !next || !Array.isArray(next.models)) return next;
  const prevById = Object.fromEntries(prev.models.map((m) => [m.id, m]));
  return {
    ...next,
    models: next.models.map((m) => {
      const old = prevById[m.id];
      if (!old) return m;
      if (old.quotaState === 'known' && m.quotaState === 'unknown') {
        return { ...old, lastError: m.sessionResetText || m.weeklyResetText };
      }
      return m;
    })
  };
}

function snapOverlay(mode) {
  overlayMode = mode === 'settings' ? 'settings' : 'dock';
  const size = OVERLAY[overlayMode];
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { x: workX, y: workY, width: workWidth, height: workHeight } = primaryDisplay.workArea;
  const posX = Math.max(0, workX + workWidth - size.width);
  const posY = Math.max(0, workY + Math.round((workHeight - size.height) / 2));
  mainWindow.setResizable(true);
  mainWindow.setBounds({ x: posX, y: posY, width: size.width, height: size.height });
  mainWindow.setResizable(false);
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
  const size = OVERLAY.dock;

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
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const distIndex = path.join(__dirname, '../dist/index.html');
  mainWindow.loadFile(distIndex);

  mainWindow.webContents.on('did-finish-load', async () => {
    mainWindow.show();
    mainWindow.focus();

    // Trigger immediate live refresh
    refreshUsageData();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function attachActivity(data) {
  const activity = readJobActivity();
  data.jobActivity = activity;
  data.handoff = activity && activity.handoff ? activity.handoff : null;
  data.reduceMotion = reduceMotionEnabled(data.config || getLocalConfig());
  return data;
}

function scheduleJobPoll(activity) {
  if (jobPollTimer) clearTimeout(jobPollTimer);
  const ms = activity && activity.jobStatus === 'running' ? 2500 : 15000;
  jobPollTimer = setTimeout(() => {
    refreshJobActivity();
  }, ms);
}

function publishState(next) {
  cachedQuotaState = next;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('usage-updated', next);
  }
}

async function refreshUsageData() {
  try {
    const liveData = attachActivity(await getAllInstalledAgentUsage());
    const merged = keepLastKnown(cachedQuotaState, liveData);
    merged.jobActivity = liveData.jobActivity;
    merged.handoff = liveData.handoff;
    merged.reduceMotion = liveData.reduceMotion;
    if (cachedQuotaState && quotaFingerprint(cachedQuotaState) === quotaFingerprint(merged)) {
      cachedQuotaState = { ...merged, lastUpdated: liveData.lastUpdated };
      scheduleJobPoll(merged.jobActivity);
      return;
    }
    publishState(merged);
    scheduleJobPoll(merged.jobActivity);
  } catch (err) {
    console.error('[Agent Notch] Error refreshing quota:', err);
  }
}

function refreshJobActivity() {
  try {
    if (!cachedQuotaState) {
      refreshUsageData();
      return;
    }
    const activity = readJobActivity();
    const reduceMotion = reduceMotionEnabled(cachedQuotaState.config || getLocalConfig());
    const prev = activityFingerprint(cachedQuotaState.jobActivity);
    const next = activityFingerprint(activity);
    if (prev === next && Boolean(cachedQuotaState.reduceMotion) === reduceMotion) {
      scheduleJobPoll(activity);
      return;
    }
    publishState({
      ...cachedQuotaState,
      jobActivity: activity,
      handoff: activity && activity.handoff ? activity.handoff : null,
      reduceMotion
    });
    scheduleJobPoll(activity);
  } catch (err) {
    console.error('[Agent Notch] Error refreshing job activity:', err);
    scheduleJobPoll(null);
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
        refreshUsageData();
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
  if (!cachedQuotaState) {
    cachedQuotaState = attachActivity(await getAllInstalledAgentUsage());
  }
  return cachedQuotaState;
});

ipcMain.handle('get-config', () => {
  return getLocalConfig();
});

ipcMain.handle('save-config', async (_event, newConfig) => {
  saveLocalConfig(newConfig);
  await refreshUsageData();
  return { success: true };
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

app.whenReady().then(() => {
  writePid();
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

  pollInterval = setInterval(refreshUsageData, 60000);
  scheduleJobPoll(null);
});

process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync(path.join(__dirname, '..', 'electron_boot.log'), `[uncaught] ${err && err.stack ? err.stack : err}\n`);
  } catch (e) {}
});
process.on('unhandledRejection', (err) => {
  try {
    fs.appendFileSync(path.join(__dirname, '..', 'electron_boot.log'), `[unhandled] ${err && err.stack ? err.stack : err}\n`);
  } catch (e) {}
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (pollInterval) clearInterval(pollInterval);
  if (jobPollTimer) clearTimeout(jobPollTimer);
  clearPid();
});

app.on('window-all-closed', () => {
  // Keep running in system tray
});
