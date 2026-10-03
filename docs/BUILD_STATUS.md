# TraceDeck v0.1 build status

This repository is a runnable open-source implementation of the core TraceDeck/Jam-style debugging workflow, not a static prototype.

## Implemented and wired end to end

- Chromium MV3 capture extension: visible screenshot, CDP full-page screenshot, tab video, screen/window/tab picker recording, recent two-minute evidence, console/errors, fetch/XHR network metadata, user actions, SPA navigation, environment/performance context, optional CDP Deep Debug.
- Privacy: form values excluded by default; common secrets/authorization/cookies/tokens redacted before capture and again at server ingest.
- Two destinations: collaborative server upload, or local-only portable `.trace.zip` download with no TraceDeck server request.
- Versioned `CaptureBundleV1` JSON schema and `.trace.zip` export/import round trip.
- Node server, persistent local file store, artifact streaming, comments, search, shares, Recording Links, SDK live sessions, webhook delivery, AI analysis abstraction, Playwright generation.
- Web dashboard with synchronized media/event timeline, console/network/action/error views, metadata/environment, comments, analysis, issue creation, exports, imports, links, webhooks and settings.
- Browser SDK, CLI, MCP stdio server, GitHub/Linear/Jira/Slack adapters, Docker packaging.

## Deliberately not claimed as v0.1 functionality

The longer-range roadmap also described native iOS/Android capture, SAML/SCIM enterprise identity, organization-grade RBAC, retention policy automation, Kubernetes manifests and a production distributed Postgres/Redis worker topology. Those are not falsely stubbed as “complete” here. The v0.1 package uses a durable local JSON/file store so the whole product can run with Node alone, while the APIs and capture format provide migration boundaries for a distributed backend later.

## Validation

Run:

```bash
npm test
npm run smoke
python3 scripts/ui-smoke.py
npm run pack:extension
```

The test suite covers API capture lifecycle, artifacts, sharing, analysis, ZIP export/import, Recording Link SDK sessions, redaction, Playwright generation, integration request construction and extension packaging. The Chromium smoke test exercises real dashboard DOM rendering and the browser-side ZIP writer used for local-only capture.
