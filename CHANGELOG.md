# Changelog

All notable changes to Agent Notch are documented here.

## [1.0.1] - 2026-08-31

### Fixed

- Moved config and runtime state out of the installed package directory, with non-destructive migration of legacy config.
- Made `notch status`, stop, restart, and single-instance PID ownership reliable across stale files and upgrades.
- Stopped disabled providers from being queried and added single-flight polling, caching, and bounded retry backoff.
- Expired Claude credentials are now read-only; Notch asks Claude Code to refresh the sign-in.
- Stale quota values are clearly marked and expire after five minutes instead of persisting indefinitely.
- Applied the configurable alert threshold and provider-specific quota-window labels.
- Added a persistent edge-collapse handle and optically centered the OpenAI ring icon.
- Included the production `dist/` bundle in npm packages.

### Security

- Upgraded to Electron 44 and enabled renderer sandboxing, navigation denial, permission denial, and a restrictive Content Security Policy.
- Removed runtime Google Fonts requests and documented the exact credential/network boundary.
- Added config sanitization and a warning for trusted local custom quota commands.

### Quality

- Added deterministic config, polling, stale-state, and runtime-state tests.
- Added Windows and Linux CI gates for tests, smoke logic, build, package contents, and high-severity dependency audit.
