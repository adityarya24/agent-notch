# Agent Notch — roadmap

Right-edge HUD for live AI coding-agent quotas, plus a read-only view of MindSync job handoffs.

**Status (2026-08-31):** Public at [adityarya24/agent-notch](https://github.com/adityarya24/agent-notch) (`v1.1.0`). Compact four-ring HUD, drag-reorder, in-rail collapse, quota-color glow. Mac / multi-monitor / packaged installer are demand-driven — see README Upcoming.

---

## Phase 1: Edge-docked window — done

- [x] Frameless transparent window snapped to the primary display's right edge.
- [x] Always-on-top overlay; transparent pixels click through.
- [x] Circular SVG rings: green &lt;50%, amber 50–80%, red 80%+ (no pulse).
- [x] Hover popover with session + weekly windows and reset text.
- [x] Compact settings drawer that stays fully on-screen.

---

## Phase 2: Live provider adapters — done

Account-level live % where the vendor exposes it. Provider name on the ring. Unknown quota is a dash.

- [x] OpenAI Codex — ChatGPT WHAM (5h + weekly).
- [x] Claude Code — Anthropic OAuth usage.
- [x] Cursor — IDE session token + dashboard period usage.
- [x] Gemini / Antigravity — official CLI vault + quota summary.
- [x] Grok CLI — billing credits.
- [x] OpenCode Go — Go plan only.
- [x] Custom CLI — PATH detect; JSON command or manual snapshot, otherwise dash.

Notch does **not** transfer jobs. It displays the latest MindSync handoff (`from → to`) from `~/.mindsync/dispatch/jobs/*/meta.json`.

---

## Phase 3: MindSync visibility — in progress

MindSync dispatch has preemptive readers and headroom ranking. Notch stays a spectator — it does not transfer jobs.

- [x] Active-agent glow in the ring’s own quota color (no pip).
- [x] Four-ring viewport, scroll for extras, drag-to-reorder.
- [x] One-shot handoff flash (`from → to (reason)`), 2–3s, no replay.
- [x] Poll job `meta.json` every 2.5s while a job is running; quiet when none.
- [x] Reduce-motion setting / `NOTCH_REDUCE_MOTION=1`.
- [ ] Stronger live bridge than polling job `meta.json`.
- [ ] Dock badge when a provider is in cooldown.

---

## Phase 4: System polish — partial

- [x] System tray + `Ctrl+Shift+U`.
- [x] Persistent edge-tuck collapse with an in-place reveal grip.
- [x] Windows autostart via `notch autostart`.
- [x] Reliable `notch status` / restart via per-user PID state plus process ownership discovery.
- [ ] Multi-monitor pick (primary vs secondary).
- [x] One-click Windows install (`install.bat` / `install.ps1`) plus `npm i -g github:adityarya24/agent-notch`.
- [x] Antigravity Google OAuth client via env / gitignored `.env` (same names as MindSync).
- [ ] Packaged NSIS installer (Windows; macOS later).

---

## Tech stack

- Desktop: Electron (frameless overlay)
- UI: React + Vite + Tailwind CSS v4
- Quota readers: `electron/scrapers.js`
- Handoff status: MindSync job metadata (display only)
