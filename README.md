# ⚡ Agent Notch

<p align="center">
  <strong>Ambient right-edge desktop HUD for live AI coding-agent quotas and session limits.</strong><br>
  <em>Windows-first • Electron + React 19 + Tailwind CSS v4 • 100% Standalone • Zero telemetry</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2B-blue?style=flat-square&logo=windows" alt="Platform">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green?style=flat-square&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Stack-Electron%20%7C%20React%2019%20%7C%20Tailwind%20v4-61dafb?style=flat-square" alt="Stack">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License">
</p>

https://github.com/user-attachments/assets/1458bc99-1066-4766-8a93-5b83b652fc57

<p align="center">
  <em>Live quota rings. The glow marks whichever agent is actually working, and the flash is a job handing off when one hits its limit.<br>
  The handoff glow is powered by <a href="https://github.com/adityarya24/mindsync-ai"><strong>MindSync</strong></a> — Notch shows the orchestration, MindSync does it.</em>
</p>

---

## 🎯 Overview

**Agent Notch** is an ultra-lightweight, always-on-top ambient desktop HUD snapped to the right edge of your screen. It gives you instant, zero-friction visibility into live token quotas, session rate-limits, and weekly usage windows across all your AI coding tools — without opening browser dashboards or checking multiple terminals.

- **Account-Level Quota Rings**: Periodically refreshed session and plan-window usage percentages at a single glance.
- **Strictly Grounded Quotas**: Never estimates or shows fake percentages. Unknown or unauthenticated accounts display as `—` or `login`.
- **Honest Failure State**: A failed refresh can retain the last successful value for up to five minutes, clearly marked with `~` and a stale notice, before returning to unknown.
- **Zero-Lag Click-Through**: Transparent overlay pixels automatically forward all mouse clicks, drags, and scrolls to background windows.
- **100% Standalone & Local-First**: Works immediately out of the box using your local CLI credentials. Zero telemetry, zero external tracking servers.
- **Custom Extensible**: Easily monitor custom CLI agents or scripts via stdout JSON commands or manual snapshots.

---

## 📊 Supported Providers & Quota Adapters

Agent Notch detects and tracks live usage for major coding agent ecosystems directly from local session vaults:

| Provider / Ring | Monitored Windows | Data Source & Detection |
| :--- | :--- | :--- |
| **OpenAI Codex** | 5h Session + Weekly | ChatGPT WHAM usage endpoint (`~/.codex/auth.json`) |
| **Claude Code** | 5h Session + Weekly | Official Anthropic OAuth usage API (`~/.claude/.credentials.json`) |
| **Gemini / Antigravity** | Quota Summary / Limits | Official Antigravity CLI token vault & Cloud Code usage API |
| **Cursor** | Monthly Period Usage | Cursor IDE local state (`state.vscdb` / session token) |
| **Grok CLI** | Session + Billing Credits | Grok CLI local configuration & billing endpoint |
| **OpenCode Go** | Go Subscription Usage | OpenCode Go plan quota (excludes BYOK local engines) |
| **Custom CLIs** | Dynamic / Custom | Automatic PATH detection; JSON stdout reader or manual snapshot |

---

## 🖥️ Visual HUD Features

```
          [ Screen Edge ]
  ┌─────────────────────────┐
  │  (⚙️ Settings Drawer)   │
  │                         │   ┌──────┐
  │  Claude Code            │───│ (92%)│ 🔴 Critical (≥80%)
  │  Session: [████████--]  │   ├──────┤
  │  Weekly:  [████------]  │───│ (45%)│ 🟢 Normal (<50%)
  │  Resets in 1h 24m       │   ├──────┤
  │                         │───│ (65%)│ 🟡 Warning (50-80%)
  │  ● Active Session       │   ├──────┤
  │  5h window expiring     │───│ ( — )│ ⚪ Unknown / Unconfigured
  └─────────────────────────┘   └──────┘
```

- **Color-Coded Status Rings** (default 80% critical threshold; configurable in Settings):
  - 🟢 **Normal (< 50%)**: Healthy quota headroom.
  - 🟡 **Warning (50% – 80%)**: Approaching session threshold.
  - 🔴 **Critical (80%+)**: Imminent rate-limit window.
- **Hover Popover Cards**: Detailed dual-meter breakdown (Session vs. Weekly/Monthly) with exact humanized reset countdowns (e.g. *“Resets in 2h 15m”*).
- **Settings Drawer**: Toggle which CLIs appear, set the alert threshold, add custom CLIs, and turn handoff animation off.
- **Edge Collapse**: Fold the dock into a slim right-edge handle and reopen it in place; Notch remembers the last chosen state.

---

## 🔄 Optional: MindSync Multi-Agent Integration

> [!TIP]
> **Agent Notch works 100% standalone.** You do **not** need MindSync to monitor quotas.

If you also use [**MindSync**](https://github.com/adityarya24/mindsync-ai) for multi-agent task dispatch and automated failover across local and VPS agents, Notch automatically surfaces live orchestration status:

- **Active Agent Glow**: The actively executing agent ring gains a subtle emerald indicator dot and soft background glow.
- **One-Shot Handoff Flash**: When MindSync transitions a task between agents (e.g. `codex → grok (quota exhausted)`), a non-intrusive 2–3s banner plays once and quietly settles.
- **Pure Spectator**: Notch never touches job execution, task transfers, or dispatch — it purely reflects live state from `~/.mindsync/dispatch/jobs/`.

---

## 🚀 Quick Start & Installation

### Option 1: One-Click Windows Install (Recommended)

Run via PowerShell (User-level, no admin required):
```powershell
irm https://raw.githubusercontent.com/adityarya24/agent-notch/main/install.ps1 | iex
```
*Or clone the repository and double-click `install.bat`.*

### Option 2: Global NPM Install

```bash
npm i -g github:adityarya24/agent-notch
notch
notch autostart
```

### Option 3: Run Once via NPX

```bash
npx github:adityarya24/agent-notch
```

### Option 4: Local Development Clone

```bash
git clone https://github.com/adityarya24/agent-notch.git
cd agent-notch
npm install
npm run build
npm link
notch
```

---

## ⌨️ CLI Reference

Manage Agent Notch from any terminal via the `notch` command:

| Command | Description |
| :--- | :--- |
| `notch` / `notch start` | Start the HUD, or bring it to the foreground if already running |
| `notch stop` / `notch kill` | Safely terminate the HUD process |
| `notch restart` | Perform a clean stop and restart |
| `notch status` | Check process status and background PID |
| `notch autostart` | Register Agent Notch in Windows Startup (logon launch) |
| `notch disable-startup` | Remove Agent Notch from Windows Startup |
| `notch smoke` | Run an end-to-end glow & handoff demo on the live HUD (0 quota burn) |
| `notch smoke --clear` | Clean up leftover test artifacts from smoke runs |
| `notch help` | Display available CLI commands |

> [!NOTE]
> **Hotkey**: Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>U</kbd> to toggle HUD visibility while running. (Note: Hotkey toggles visibility of the active instance; if the process is stopped via `notch stop`, launch it again using `notch`).

---

## ⚙️ Configuration & Environment

### Antigravity / Gemini Token Refresh (Optional)

Quota scraping works out-of-the-box using local credentials. If automatic OAuth token refresh for Google Antigravity is required:

1. Copy `.env.example` to `.env` (gitignored):
   ```bash
   cp .env.example .env
   ```
2. Configure your Google OAuth credentials:
   ```env
   MINDSYNC_ANTIGRAVITY_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   MINDSYNC_ANTIGRAVITY_CLIENT_SECRET="your-client-secret"
   ```
   *(Aliases `NOTCH_ANTIGRAVITY_CLIENT_ID` and `NOTCH_ANTIGRAVITY_CLIENT_SECRET` are also supported).*

### Motion Settings

To reduce animations (disables sliding handoff animations and keeps glow effects static):
- Toggle **Reduce Motion** in the in-app Settings Drawer (⚙️ gear icon).
- Or export the environment variable: `NOTCH_REDUCE_MOTION=1`.

### Local Settings File

Notch stores its own settings in `%APPDATA%\Agent Notch\config.json`. Existing installs are migrated from the legacy repository-level `notch_config.json` on first read; the legacy file is left untouched.

---

## 🛠️ Adding Custom CLI Agents

You can add any custom coding assistant or local LLM CLI to the dock via the Settings Drawer (⚙️):

1. Click the **Settings Gear** at the bottom of the dock.
2. Under **Custom Agents**, click **Add Custom CLI**.
3. Supply a **Display Name** and an optional executable name on your `PATH`.
4. Choose a Quota Source:
   - **Command Stdout**: Point to a command/script that outputs JSON:
     ```json
     {
       "sessionUsedPercent": 25,
       "weeklyUsedPercent": 60
     }
     ```
   - **Manual Snapshot**: Set fixed percentage values for manual tracking.
   - **Unmanaged**: Displays as an unmetered ring with active process detection.

Custom quota commands run locally on each refresh. Only configure commands you trust.

---

## 🏛️ Architecture & Design Philosophy

- **Zero Interruption**: Frameless, transparent Electron overlay configured with OS-level click forwarding so your IDE, terminal, and browser interactions remain completely uninterrupted.
- **Local-First Security**: Notch has no telemetry or tracking backend. Provider credentials are read locally and sent only to that provider's official usage, billing, or OAuth endpoint when needed to retrieve quota data.
- **Credential Spectator Boundary**: Notch does not rewrite or refresh provider credential files. An expired Claude session asks you to sign in through Claude Code. Google token refresh, when explicitly configured, is held in memory.
- **Job Spectator Boundary**: Notch never transfers jobs or controls MindSync execution; it only reads MindSync job metadata for the active glow and handoff flash.

---

## 🗺️ Upcoming (demand-driven)

Windows is the supported host. No dates — these land if people actually ask:

- **macOS** — overlay + Login Item + Keychain / Cursor `Library` paths. Electron can show a window today; CLI, autostart, and several quota readers are still Windows-only.
- **Multi-monitor** — pick which display’s right edge.
- **Packaged Windows installer** — NSIS / winget after the `npm i -g` path.
- **Vertical slide** on the right edge so the dock can sit above or below other overlays.

Not on the list: free-floating drag, fake desktop glass, or job transfer (that stays MindSync).

---

## 📜 License

MIT License © 2026 [Aditya Arya](https://github.com/adityarya24)
