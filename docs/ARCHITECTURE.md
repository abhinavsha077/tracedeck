# Architecture

## Canonical object

Every report is a `CaptureBundleV1`: capture metadata, timestamped events and external artifacts. All event timestamps are milliseconds relative to capture start. The schema lives in `packages/capture-schema/capture-bundle.schema.json`.

## Runtime

`apps/server` uses the Node standard library and persists state atomically to `data/state.json`; binary artifacts live under `data/artifacts/<captureId>`. This intentionally keeps the OSS build simple to run and easy to replace with a database/object-store adapter later.

`apps/web` is a dependency-free dashboard served by the same process. `apps/extension` is a Manifest V3 extension. Page-world hooks observe console/fetch/XHR; the isolated content script observes user actions and holds a rolling two-minute evidence buffer; the service worker coordinates screenshots, tabCapture, optional CDP events and uploads; an offscreen document owns MediaRecorder.

Recording Links use `getDisplayMedia`. For richer app telemetry, a temporary SDK session is created and the instrumented target app streams sanitized events to `/api/live-sessions/:token/events`.

## Data flow

```text
Browser/SDK/Recording Link
        |
        v
 local redaction
        |
        v
 CaptureBundle + artifacts
        |
        v
 Node API ----> webhooks/integrations
    |  |
    |  +------> AI/local analysis
    |
    +---------> state.json + artifacts/
        |
        v
 Web viewer / CLI / MCP / .trace export
```

## Extension event sources

- Page hook: console, uncaught errors, unhandled rejections, fetch, XHR.
- Content script: clicks, submits, input occurrence (values redacted), navigation hints, browser environment.
- Optional CDP: request/response/failure metadata and runtime exceptions.
- Browser SDK: identity, release/build/tenant metadata, custom logs and errors.

## Integrations

The server includes provider adapters for GitHub Issues, Linear, Jira Cloud and Slack incoming webhooks. Webhooks use `X-TraceDeck-Signature: sha256=<HMAC>`.
