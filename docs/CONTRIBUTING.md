# Contributing to TraceDeck

Thank you for your interest in contributing to TraceDeck!

## Core Principles

1. **Zero External Runtime Dependencies**:
   The core Node.js server, web dashboard, browser SDK, and CLI operate entirely on the Node.js standard library and native browser web APIs. We do not introduce npm runtime dependencies for core operations.
2. **Privacy-First & Secure by Default**:
   All captured telemetry must be redacted on the client before upload and sanitized on the server before storage.
3. **Cross-Platform Compatibility**:
   All scripts, paths, and tests must execute reliably on Windows, macOS, and Linux without external system binaries (such as `unzip` or `bash`).
4. **Deterministic Validation**:
   ZIP archives and data bundles must follow versioned schemas (`CaptureBundleV1`) and be verifiable using pure-JavaScript utilities.

---

## Local Development Workflow

### Prerequisites
- Node.js >= 20.0.0
- Git

### Quick Start
```bash
# Clone the repository
git clone https://github.com/abhinavsha077/tracedeck.git
cd tracedeck

# Start the local server
npm start
```

Visit `http://localhost:4177/app/` in your browser.

---

## Running Verification & Tests

Always run the full test suite before submitting pull requests:

```bash
# Run unit and integration tests (25+ tests covering API, storage, ZIP, redaction)
npm test

# Run API & web dashboard smoke validation
npm run smoke

# Run full end-to-end lifecycle verification flow
npm run test:flow

# Run all checks simultaneously
npm run check
```

---

## Code Structure

```text
apps/
  ├── extension/       # Chromium Manifest V3 extension source
  ├── server/          # Zero-dependency Node.js HTTP server & API
  └── web/             # Lightweight HTML5 / ES Modules dashboard
packages/
  ├── browser-sdk/     # Embedded SDK for web applications (@tracedeck/browser)
  └── capture-schema/  # Canonical CaptureBundleV1 JSON schema & validator
tools/
  ├── cli/             # TraceDeck command-line tool
  └── mcp/             # Model Context Protocol (MCP) stdio server
scripts/               # Maintenance, smoke testing, and packaging scripts
tests/                 # Native node:test unit and integration test suites
```

---

## Submitting Pull Requests

1. Fork the repository and create a feature branch.
2. Ensure all tests pass cleanly (`npm run check`).
3. Maintain documentation integrity and update relevant docs when adding new endpoints or features.
4. Open a Pull Request with a clear explanation of changes and verification evidence.
