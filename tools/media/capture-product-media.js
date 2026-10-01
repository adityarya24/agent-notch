#!/usr/bin/env node
// Run through Electron: isolated fixture capture, never reads live quota or user data.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const output = path.resolve(process.argv[2] || path.join(root, 'output', 'product-media'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function model(id, name, provider, used, weekly) {
  return {
    id, name, provider, icon: id, quotaState: 'known', authState: 'signed_in',
    status: used >= 80 ? 'critical' : used >= 50 ? 'warning' : 'normal',
    ringPercent: used, sessionUsedPercent: used, weeklyUsedPercent: weekly,
    sessionLabel: 'Current session', weeklyLabel: 'All models (Weekly)',
    sessionResetText: 'Resets in 2h 14m', weeklyResetText: 'Resets Monday',
    alertThreshold: 80, stale: false
  };
}

const models = [
  model('claude', 'Claude', 'Anthropic', 68, 42),
  model('codex', 'Codex', 'OpenAI', 88, 59),
  model('gemini', 'Gemini', 'Google', 27, 18),
  model('grok', 'Grok', 'xAI', 12, 8)
];
const config = {
  collapsed: false, reduceMotion: false, alertThreshold: 80,
  notifyWhenTucked: true,
  enabledModels: Object.fromEntries(models.map(({ id }) => [id, true])),
  modelOrder: models.map(({ id }) => id), customAgents: []
};
const base = {
  activeModel: 'claude', models,
  allDetectedIds: models.map(({ id, name, provider }) => ({ id, name, provider, custom: false })),
  config, activeRings: ['claude'], jobActivity: null, handoff: null,
  lastUpdated: new Date().toISOString(), reduceMotion: false
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  app.setPath('userData', path.join(output, '.electron-profile'));
  await app.whenReady();
  const win = new BrowserWindow({
    width: 440, height: 620, show: false, transparent: true, frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'media-preload.js'),
      offscreen: true, contextIsolation: true, sandbox: true
    }
  });
  try {
    await win.loadFile(path.join(root, 'dist', 'index.html'));
    async function state(next) {
      win.webContents.send('media-state', next);
      await sleep(650);
    }
    async function shot(name) {
      const image = await win.capturePage();
      const file = path.join(output, `${name}.png`);
      fs.writeFileSync(file, image.toPNG());
      console.log(file);
    }
    await state(base);
    await shot('01-overview');

    await win.webContents.executeJavaScript("document.querySelector('[data-model-id=\"codex\"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))");
    await sleep(350);
    await shot('02-quota-detail');

    await win.webContents.executeJavaScript("document.querySelector('button[title=\"Customize Visible Models\"]').click()");
    await sleep(450);
    await shot('03-settings');
    await win.webContents.executeJavaScript("document.querySelector('button[aria-label=\"Close settings\"]')?.click()");
    await win.webContents.executeJavaScript("document.querySelector('button[title=\"Customize Visible Models\"]')?.click()");
    await sleep(250);

    const at = new Date().toISOString();
    const handoff = {
      from: 'codex', to: 'grok', fromRing: 'codex', toRing: 'grok', at,
      line: 'codex → grok', routingHint: 'Work continues on Grok'
    };
    await state({
      ...base, activeModel: 'grok', activeRings: ['grok'], handoff,
      jobActivity: {
        jobId: 'demo-fixture', jobStatus: 'running', activeAgent: 'grok',
        activeRing: 'grok', handoff, routingReason: handoff.routingHint
      }
    });
    await shot('04-handoff');
    await sleep(2700);
    await shot('05-live-activity');
    fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify({
      fixture: true, source: 'dist/index.html', scenes: 5,
      capturedAt: new Date().toISOString()
    }, null, 2));
  } finally {
    win.destroy();
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
