# Changelog

All notable changes to Agent Notch are documented here.

## [1.3.2] - 2026-09-02

### Fixed

- The Claude card no longer greys out with "refresh failed" during normal use. The
  Anthropic usage endpoint rate-limits the shared OAuth token, and a 429 was being
  reported as an outage; the card then fell back to its last reading and went stale.
  A 429 is now treated as a throttle rather than a failure: it gets a cooldown that a
  forced refresh cannot punch through, it no longer escalates the failure backoff, and
  the last good reading keeps showing (bounded to 15 minutes) instead of blanking.

### Added

- `NOTCH_DEBUG_PROVIDER=claude,grok` (or `all`) logs what each reader returned next to
  what the UI was shown. The persisted cache cannot distinguish a held-over reading
  from a fresh one -- both record `known`. Off by default.

## [1.3.1] - 2026-09-01

### Fixed

- The collapse chevron now has its own gutter and no longer overlaps provider icons.

## [1.3.0] - 2026-09-01

### Added

- Provider self-registration through `notch provider add` / `register`, plus `list`, `remove`, and detection-only `discover` commands backed by validated atomic config writes.
- Shared discovery for Aider, GitHub Copilot, Amp, Goose, Crush, Qwen, and ZCode across Settings and the CLI; PATH-based tools use executable lookup, ZCode can also be found from its Windows install path, and `--icon auto` uses catalog mappings with a generic Spark fallback.

### Changed

- Tucked rail is a quota-colored jewel remnant instead of a dead chevron.
- Quota-cross alerts while the HUD is visible are an in-rail glass toast; Windows toasts remain only when the window is hidden.
- Codex uses the official OpenAI logomark at the same size as the other rings.
- Hover cards wait a beat before swapping, drag lifts the ring, and the rail no longer shifts padding on hover.

### Fixed

- The tucked jewel now follows each ring's configured critical threshold instead of assuming the default 80% threshold.

## [1.2.1] - 2026-09-01

### Fixed

- Open but idle Claude, Gemini, Grok, Cursor, and OpenCode sessions no longer keep the activity ring glowing; session-backed providers now require a recent trustworthy work signal, while CPU fallback providers require sustained activity.

## [1.2.0] - 2026-09-01

### Added

- Desktop toast when a quota crosses the critical threshold while the rail is tucked or hidden. Click the toast to reveal the HUD. Settings: **Notify when tucked**.
- Direct activity glow for every active supported local CLI, including simultaneous agents and custom providers mapped to an exact native executable.

### Changed

- Last-known successful quota readings now survive restarts for up to 24 hours, remain visibly stale until refreshed, and are never replaced by unknown-only data.
- Custom providers keep activity-process detection separate from optional JSON quota commands, with legacy config migration and reliable quoted Windows commands.

### Fixed

- Grok now distinguishes a valid signed-in session with unavailable quota from expired authentication and does not treat on-demand spend as included quota.
- Codex quota windows are classified by their provider-reported duration, so personal 5-hour and weekly windows and Team weekly-only responses are labeled correctly regardless of response order.

### Security

- Persisted quota snapshots whitelist display-only fields; direct activity detection reads process and session metadata without reading prompts or transcripts.

## [1.1.0] - 2026-08-31

### Added

- Drag-to-reorder rings. The first four stay in view; extra rings scroll underneath.
- Healthy (green) percentages now use the same quota color as the ring.

### Changed

- Collapse control is an in-rail chevron: right to tuck, left to pull. The tucked pill keeps the open rail’s height.
- Active-agent glow uses the working ring’s own color, stays inside the pill, and no longer uses a green pip.
- Overlay content is vertically centered in the work area.
- README hero is a set of stills instead of the demo video.

## [1.0.1] - 2026-08-31

### Fixed

- Moved config and runtime state out of the installed package directory, with non-destructive migration of legacy config.
- Made `notch status`, stop, restart, and single-instance PID ownership reliable across stale files and upgrades.
- Stopped disabled providers from being queried and added single-flight polling, caching, and bounded retry backoff.
- Expired Claude credentials are now read-only; Notch asks Claude Code to refresh the sign-in.
- Stale quota values are clearly marked and expire after five minutes instead of persisting indefinitely.
- Applied the configurable alert threshold and provider-specific quota-window labels.
- Added a persistent edge-tuck interaction with a slim curved grip, and optically centered the OpenAI ring icon.
- Included the production `dist/` bundle in npm packages.

### Security

- Upgraded to Electron 44 and enabled renderer sandboxing, navigation denial, permission denial, and a restrictive Content Security Policy.
- Removed runtime Google Fonts requests and documented the exact credential/network boundary.
- Added config sanitization and a warning for trusted local custom quota commands.

### Quality

- Added deterministic config, polling, stale-state, and runtime-state tests.
- Added Windows and Linux CI gates for tests, smoke logic, build, package contents, and high-severity dependency audit.
