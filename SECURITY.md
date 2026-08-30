# Security policy

## Supported versions

Security fixes are applied to the latest released version of Agent Notch.

## Data and network boundary

Agent Notch has no telemetry service and does not upload usage data to an Agent Notch backend. It reads supported CLI credentials from local storage and uses them only against the corresponding provider's official usage, billing, or OAuth endpoint. It does not rewrite provider credential files.

MindSync integration is read-only: Notch reads local job metadata to render activity and handoff status, but cannot dispatch or transfer work.

Custom quota commands are intentionally powerful and run locally under the current user. Only configure commands you trust.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not include access tokens, credential files, or private usage payloads in a report. Include the affected Agent Notch version, operating system, reproduction steps, and expected impact.
