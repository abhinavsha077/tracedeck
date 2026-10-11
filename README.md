# TraceDeck

> **Open-source visual debugging, developer evidence platform, and zero-dependency bug capture workflow.**

TraceDeck captures browser bugs once and preserves the full context: screen recording, screenshots, console logs, network activity, user interactions, environment data, comments, AI-assisted diagnosis, and reproduction tests—packaged together in a single portable bundle.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-34%20passing-brightgreen.svg)](tests/)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0%20runtime-success.svg)](package.json)

---

## Features

- **Zero Runtime Dependencies**: Core server, dashboard, extension, SDK, and CLI operate purely on the Node.js standard library and native browser APIs.
- **Chromium MV3 Extension**: Full-page screenshots via CDP, tab and window recording with offscreen `MediaRecorder`, rolling 2-minute context buffer, and console/network tap.
- **W3C Distributed Tracing & OpenTelemetry**: Intercepts or generates standard `traceparent` context (`00-<trace_id>-<span_id>-01`) correlating front-end errors directly to backend APM traces (Jaeger, Datadog, Tempo).
- **Lightweight DOM Mutation Telemetry**: rrweb-style non-intrusive DOM state change tracking and element snapshots with zero video encoding overhead.
- **Automated Reproduction Runner**: Built-in verification engine tests live backend endpoints, checks action sequence viability, flags masked inputs, and produces ready-to-run Playwright tests.
- **Dual Destination Modes**: Direct server upload or **Local-Only zero-network `.trace.zip` export** directly within the browser.
- **Synchronized Evidence Timeline**: Interactive scrubber with millisecond precision, keyword search, log level filtering, HTTP status badges, and expandable event drawers.
- **Client & Server Redaction**: Sensitive authorization headers, cookies, API tokens, passwords, and credit card numbers are scrubbed before capture and re-validated at ingest.
- **Recording Links**: Zero-install browser recording links for non-technical reporters with optional Browser SDK integration.
- **Automated Playwright Generation**: Instantly export captured actions and network calls as executable Playwright reproduction scripts (`.spec.ts`).
- **External Issue Adapters**: Direct export to GitHub Issues, Linear, Jira Cloud (Atlassian Document Format), and Slack incoming webhooks.
- **Model Context Protocol (MCP) Server**: Native stdio MCP server for direct integration with AI coding assistants (Claude Code, Antigravity, Cursor).
- **Pluggable Modular Storage**: Built-in `FileSystemStorageAdapter` and `MemoryStorageAdapter` with automated retention cleanup policies (TTL, count limit, and storage quotas).

---

## Quick Start

### Prerequisites
- Node.js >= 20.0.0

### Run Locally
```bash
# 1. Start the TraceDeck server
npm start

# 2. Open dashboard in your browser
# Visit http://localhost:4177/app/
```
The first launch automatically provisions a default project with the development key `td_local_dev`.

### Seed Sample Data
In a separate terminal while the server is running:
```bash
npm run seed
```

### Run Test Suite & Flow Verification
```bash
# Run 25+ native unit and integration tests
npm test

# Run API and dashboard smoke test
npm run smoke

# Run full end-to-end flow verification
npm run test:flow
```

---

## Docker Deployment

TraceDeck can be deployed anywhere with Docker and Docker Compose:

```bash
cp .env.example .env
docker compose up -d --build
```

Data and artifacts are persisted in the `tracedeck_data` volume.

---

## Browser Extension (Chromium MV3)

1. Open Chrome or Chromium and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the upper right).
3. Click **Load unpacked** and select the `apps/extension` directory.
4. Open the extension **Options** to configure your server URL or enable **Local-only `.trace.zip` mode**.

To package the extension into a distributable archive:
```bash
npm run pack:extension
```
See the [Extension Guide](docs/EXTENSION_GUIDE.md) for full details.

---

## Browser SDK Instrumentation

Embed the lightweight Browser SDK in your web application for enhanced telemetry:

```html
<script src="http://localhost:4177/sdk/tracedeck.js"></script>
<script>
  TraceDeck.init({ serverUrl: 'http://localhost:4177' })
    .identify({ id: 'user_123', plan: 'enterprise' })
    .metadata({ release: 'v1.4.0', environment: 'staging' });
</script>
```

When users open a Recording Link targeting your instrumented app, session telemetry merges into the report automatically.

---

## CLI & MCP Server

### Command Line Interface
```bash
# List recent captures
node tools/cli/tracedeck.mjs list

# Inspect capture details
node tools/cli/tracedeck.mjs inspect <captureId>

# Fast causal chain triage (Action -> Network -> Exception)
node tools/cli/tracedeck.mjs triage <captureId>

# Run automated reproduction verification
node tools/cli/tracedeck.mjs reproduce <captureId>

# Generate Playwright reproduction script
node tools/cli/tracedeck.mjs playwright <captureId> --out repro.spec.ts

# Export standard HTTP Archive (HAR 1.2)
node tools/cli/tracedeck.mjs har <captureId> --out requests.har

# Post comment or diagnostic note
node tools/cli/tracedeck.mjs comment <captureId> "Root cause investigated"

# File issue directly to Linear, Jira, or GitHub
node tools/cli/tracedeck.mjs issue <captureId> linear '{"teamId":"ENG"}'

# Export portable bundle
node tools/cli/tracedeck.mjs export <captureId> --out issue.trace.zip
```

### Model Context Protocol (MCP) & AI Agent Skill
TraceDeck includes an autonomous AI agent skill (`skills/tracedeck-debugger/SKILL.md`) and a stdio MCP server enabling AI coding agents to perform human-level debugging workflows:
- `triage_capture`: Token-efficient causal chain extraction
- `run_reproduction`: Automated reproduction verification and live endpoint probing
- `generate_playwright`: Auto-generate reproduction specs
- `create_capture`: File bug captures directly from agent automated runs
- `add_comment`: Post diagnostic findings to timelines
- `create_issue`: File tickets directly to Linear, Jira, or GitHub
- `export_har`: Standard HTTP Archive generation

Configure TraceDeck in your assistant:
```json
{
  "mcpServers": {
    "tracedeck": {
      "command": "node",
      "args": ["tools/mcp/server.mjs"],
      "env": {
        "TRACEDECK_URL": "http://localhost:4177",
        "TRACEDECK_KEY": "td_local_dev"
      }
    }
  }
}
```

---

## Documentation

- [REST API Reference](docs/API.md) — Complete endpoint documentation and webhook schema
- [Architecture Overview](docs/ARCHITECTURE.md) — System boundaries, data flow, and runtime details
- [Storage & Retention Guide](docs/STORAGE_GUIDE.md) — Pluggable adapters, retention policies, and cascade cleanup
- [Security & Privacy](docs/SECURITY.md) — Redaction rules, threat model, and production hardening
- [Browser Extension Guide](docs/EXTENSION_GUIDE.md) — MV3 architecture, permissions, and local capture
- [Contributing](docs/CONTRIBUTING.md) — Development guidelines and testing standards
- [Build Status](BUILD_STATUS.md) — Validated capabilities and delivery roadmap

---

## License

TraceDeck is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). The browser SDK (`packages/browser-sdk`) and CaptureBundle schema (`packages/capture-schema`) are additionally available under the Apache License 2.0.
