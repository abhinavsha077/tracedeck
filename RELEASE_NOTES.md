# TraceDeck v0.1.0 Release Notes

TraceDeck v0.1.0 is a complete, runnable open-source developer debugging evidence platform with zero external runtime dependencies.

## Key Capabilities

- **Chromium MV3 Extension**: Full-page and visible screenshots, tab and window recording, rolling two-minute event context, W3C `traceparent` context injection, DOM mutation telemetry, and optional CDP Deep Debug.
- **Client & Server Privacy**: Automatic credential and PII redaction; no form values captured by default.
- **Dual Destinations**: Collaborative server upload or zero-network local-only `.trace.zip` export.
- **Web Dashboard**: Synchronized visual evidence timeline, interactive scrubbing, OTel trace correlation, DOM mutation inspection, error and network inspection, comments, public share links, and Playwright reproduction script generation.
- **Automated Reproduction Runner**: Built-in verification engine probes live network endpoints, validates action steps, flags masked credentials, and outputs ready-to-run Playwright tests.
- **AI Agent Native Tooling**: Model Context Protocol (MCP) server, token-optimized causal chain triage engine, HAR 1.2 export, and the `tracedeck-debugger` agent skill.
- **Zero-Install Recording Links**: Browser-native screen recording links for reporters with temporary SDK session bridging.
- **Pluggable Modular Storage**: `FileSystemStorageAdapter` and `MemoryStorageAdapter` with automated retention cleanup policies and cascading deletions.
- **Hardened Issue Integrations**: Direct export integrations for GitHub Issues, Linear, Jira Cloud (Atlassian Document Format v1), and Slack webhooks (Block Kit).
- **Developer Tooling**: CLI tool and native Model Context Protocol (MCP) stdio server for AI coding assistants.
- **Packaging & Deployment**: Lightweight Node-only runtime and production-ready Docker Compose packaging.

## Verification & Test Coverage

All test suites execute natively with 0 failures:
- `npm test`: **34/34 passing** (covering API, store persistence, redaction, ZIP verification, Playwright generation, schema conformance, storage adapters, retention policies, causal triage, reproduction runner, and integrations).
- `npm run smoke`: **Passing** (API, web UI, recording link UI, artifact serving, and ZIP export).
- `npm run test:flow`: **Passing** (Full 6-step lifecycle verification).
- Extension packaging: **Passing** (pure Node ZIP packaging with forward-slash normalization and MV3 asset validation).

See [BUILD_STATUS.md](BUILD_STATUS.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for architecture details.
