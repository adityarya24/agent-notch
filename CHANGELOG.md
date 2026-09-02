# Changelog

All notable changes to Agent Notch are documented here.

## [1.3.8] - 2026-09-02

### Fixed

- Choosing the Antigravity icon for a custom agent no longer silently saves the spark
  icon instead. The settings picker gained the option in 1.3.3 but `config.js` kept
  its own allowlist, and an icon missing from it is rewritten rather than rejected.

- The quota toast now sits beside the tucked rail instead of a tuck-width away from
  it. Collapsing moves the rail with a CSS transform, so layout still placed the
  toast against the rail's untucked box, leaving a 64px gap where 8px was intended.

- Opening and closing Settings no longer shifts the HUD. Each overlay mode declared
  its own window footprint, so switching modes animated the native window bounds --
  and resizing a transparent frameless window visibly moves its contents. All modes
  now share one footprint, so the transition has nothing to animate.

- The live-agent glow is no longer sheared into a rectangle. The ring list is a
  vertical scroller, and a scroll container clips its contents to the scrollport --
  with the rings flush against that edge the glow was cut off flat on both sides.
  The list now carries 12px of padding on every side, clearing both the halo's
  box-shadow and the arc's drop-shadow bloom -- vertically too, so the top and
  bottom rings no longer bleed into the rail's border. The list's max height grew
  by the same amount, so four rings still fit rather than the icons shrinking.
  The collapse offset moved 56px -> 68px to keep the tucked strip its original
  width; the toast reads the same constant and follows automatically.

- The chevron gutter is narrower: 28px (4 + 16 + 8) down to 22px.

- Two clipping bugs found on the way there, both real: the ring's SVG viewport cut
  off the arc's drop-shadow, and the pulsing halo relied on its parent's rounded
  overflow clip, which a composited child ignores. Both now clip correctly.

- The quota toast, the settings panel and the hover card now animate in. The card
  carried `animate-in fade-in zoom-in-95`, which emitted no CSS at all -- those
  utilities need `tailwindcss-animate`, which is not installed -- so all three
  simply appeared. They now share one keyframe that slides in from the screen edge.

### Changed

- The handoff notification is a toast instead of a line inside the rail. It used to
  render in the pill, which made the pill grow and shrink mid-glance and hid the
  notice entirely while tucked. As a toast it reads the same collapsed or expanded
  and never resizes the pill. It carries the destination's own quota colour, so a
  handoff into an agent that is itself near its limit reads red. The ring flash on
  the source and destination is unchanged.

- Motion is driven by three tokens (`--notch-fast` 160ms, `--notch-base` 260ms,
  `--notch-slow` 420ms) on one easing curve, replacing eight ad-hoc durations across
  four easings. A ring's fill, colour and glow settle together instead of at 600ms,
  400ms and 300ms. Reduce motion zeroes the tokens in a single rule, so a new
  animation cannot forget to honour the setting.

### Added

- Poll cadence can be overridden for tests and captures with `NOTCH_POLL_MS` and
  `NOTCH_READER_POLL_MS`. Unset, the 60s cycle is unchanged.

- README media: the handoff, full-tour, live-glow and tuck-alert clips, plus one
  image of the three rail states. Animated WebP rather than GIF -- more than twice
  the resolution at a third of the weight; the two GIFs it replaces were 6.5 MB.

## [1.3.7] - 2026-09-02

### Fixed

- The hover card is no longer clipped against the window edge. The 280px card, its
  8px margin and the rail did not fit in a 360px window; widening the chevron gutter
  in 1.3.6 pushed the shortfall from 6px to 12px and made it obvious. The dock is now
  380px, leaving the card 288px to sit in.

## [1.3.6] - 2026-09-02

### Fixed

- The working-agent glow no longer washes over the collapse chevron. The chevron sat
  6px from the ring's edge while the glow reaches about 8px, so an active ring tinted
  it. The gutter is now 12px, and the tucked rail's offset moves with it so the
  collapsed strip stays exactly as wide as before.

## [1.3.5] - 2026-09-02

### Fixed

- The working-agent pulse is visible again, and now the icon itself glows with it.
  Containing the glow in 1.3.4 left only a faint outer ring: the halo's inner glow was
  drawn under the opaque icon hub, so it never showed. The pulse now lives inside the
  hub, where it can be bright without reaching the next row.

## [1.3.4] - 2026-09-02

### Fixed

- The working-agent pulse no longer bleeds onto neighbouring icons. It was a filled,
  blurred disc that grew to `scale(1.22)` -- roughly 85px of glow against a 65px gap
  between rows -- so an agent at work lit up the icons above and below it and washed
  out its own percentage label. It is now a halo that hugs the ring, and the pulse
  animates opacity only.

## [1.3.3] - 2026-09-02

### Fixed

- The Grok card carried the X logo rather than Grok's own mark. It now uses the Grok
  mark, traced from the official artwork into a monochrome path that follows
  `currentColor` like every other icon.

## [1.3.2] - 2026-09-02

### Fixed

- The Claude card no longer greys out with "refresh failed" during normal use. The
  Anthropic usage endpoint rate-limits the shared OAuth token, and a 429 was being
  reported as an outage; the card then fell back to its last reading and went stale.
  A 429 is now treated as a throttle rather than a failure: it gets a cooldown that a
  forced refresh cannot punch through, it no longer escalates the failure backoff, and
  the last good reading keeps showing (bounded to 15 minutes) instead of blanking.

- The Antigravity card carried the Gemini spark, which belongs to a different product.
  It now uses the Antigravity mark, traced from the icon the installed app ships.
  `gemini` remains a valid icon id with its original artwork for saved custom agents.

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
