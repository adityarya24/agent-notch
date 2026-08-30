# Agent Notch

Right-edge desktop HUD for live AI coding-agent quotas. Windows-first (tray, autostart, `notch` CLI). Hover a ring for session + weekly windows. MindSync handoffs show as status only — Notch does not transfer jobs.

Built with Electron, React, Vite, and Tailwind CSS v4.

## What is live (Phase 2 wrap)

Account-level rings. Provider name on the dock, not a model slug. Unknown quota is a dash — never a fake percent.

| Dock | Source |
| :--- | :--- |
| Codex | ChatGPT WHAM (5h + weekly) |
| Claude Code | `~/.claude/.credentials.json` + Anthropic OAuth usage |
| Grok | Grok CLI session + billing credits |
| Gemini / Antigravity | Official Antigravity CLI vault + quota summary |
| Cursor | Cursor IDE session token + period usage |
| OpenCode Go | Go subscription usage only (not BYOK OpenCode) |
| Custom CLI | PATH detect; dash unless you supply a JSON command or a manual snapshot |

Ring colors: green under 50%, amber 50–80%, red 80%+. No pulse. Transparent pixels click through. Settings gear opens a compact drawer (toggle CLIs, add custom).

If a MindSync job is running, the current agent gets a small emerald dot and a light glow — the quota ring itself does not change. A handoff plays once as `codex → grok (quota exhausted)` for a couple of seconds, then settles. No job data means no indicator (no guess). Gear → **Handoff animation** off (or `NOTCH_REDUCE_MOTION=1`) keeps a static glow. Custom CLIs with no MindSync adapter stay quiet.

## Install

Node.js 18+. This is an Electron app, so the pip analog is npm (not pip).

```bash
npm i -g github:adityarya24/agent-notch
notch
notch autostart
```

One-shot without a global install:

```bash
npx github:adityarya24/agent-notch
```

Private repo: GitHub auth is required. After it is public those commands work as-is.

From a clone (dev): `npm install` then `npm link` then `notch`. Windows double-click: `install.bat`. After pulling code: `npm run build` then `notch` (that **shows** the HUD if it is already running — it does not kill it). Use `notch restart` only when you mean to relaunch.

### Antigravity / Gemini refresh

Quota rings work from local tokens. Google OAuth **refresh** for Antigravity needs a client id/secret. Copy `.env.example` to `.env` (gitignored) and set `MINDSYNC_ANTIGRAVITY_CLIENT_ID` / `MINDSYNC_ANTIGRAVITY_CLIENT_SECRET` — same names as MindSync. `NOTCH_ANTIGRAVITY_CLIENT_*` aliases also work. Missing keys → Gemini shows a dash when the access token expires. Never commit `.env`.

Glow demo (no quota burn): `notch smoke` or `npm run smoke`. Watch the right edge ~40s. Clear leftovers: `notch smoke --clear`.

## CLI

| Command | Description |
| :--- | :--- |
| `notch` / `notch start` | Start the HUD, or show it if it is already running |
| `notch stop` | Quit |
| `notch restart` | Stop + start |
| `notch status` | Running or not |
| `notch autostart` | Windows logon |
| `notch disable-startup` | Remove logon launch |
| `notch smoke` | Glow/handoff demo on the live HUD (does not kill Notch) |
| `notch help` | Command list |

Hotkey **Ctrl+Shift+U** hides or shows the HUD **while it is running**. After Quit (tray or `notch stop`) the hotkey is dead — run `notch` again. Tray icon toggles the same way.

## Custom CLI

Gear → add a display name (required) and optionally a binary on PATH. Quota stays a dash unless you set a manual snapshot or a command that prints:

```json
{"sessionUsedPercent":12,"weeklyUsedPercent":40}
```

## Not in this app

- Job transfer / successor pick — that is MindSync dispatch.
- Packaged NSIS installer and multi-monitor picker — later (`install.bat` is the current one-click).
- macOS/Linux autostart — not wired; overlay may run, Windows is the supported host.
