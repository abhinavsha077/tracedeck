# TraceDeck Delivery Roadmap

## Vision
TraceDeck is an open-source visual debugging and developer evidence platform with zero external runtime dependencies. It captures browser bugs with full timeline context (screen recording, console errors, network events, actions, environment) in portable `.trace.zip` bundles.

## Stack
| Layer | Choice | Why |
|---|---|---|
| Runtime | Pure Node.js (>=20) Standard Library | Zero external runtime dependencies, ultra-portable, easy self-host |
| Dashboard | Vanilla HTML5 / ES Modules / CSS Variables | Fast, zero build step, zero client framework dependencies |
| Extension | Chromium Manifest V3 | Standard extension architecture with offscreen recorder and CDP debug |
| Storage | Pluggable StorageAdapter (FS / Memory / DB) | Default zero-dependency local JSON/files with clean extension boundary |
| Test Runner | Native `node:test` + `node:assert` | Zero-dependency native testing |

---

## Build Order

| Phase | Goal | Key Deliverables | Status |
|---|---|---|---|
| **Phase 1** | Cross-Platform Test Compatibility | Pure-JS ZIP validator, fix Windows `unzip` test failure, pure Node extension packager | ✅ COMPLETE |
| **Phase 2** | Dashboard & Extension Capabilities | Timeline scrubbing, event filtering, detail drawer, media gallery, extension controls & fallback | ✅ COMPLETE |
| **Phase 3** | Modular Storage & Retention Architecture | `StorageAdapter`, `FileSystemStorageAdapter`, `MemoryStorageAdapter`, Store refactor, retention engine | ✅ COMPLETE |
| **Phase 4** | QA Audit & Hardening | `CaptureBundleV1` validator, `DELETE` endpoint, import error handling, test suites | ✅ COMPLETE |

---

## Phase 1 — Cross-Platform Test Compatibility ✅
*Completed: 2026-09-22*
*Goal: Enable full test suite execution across Windows, macOS, and Linux without external system binaries.*

### Task Checklist
- [x] Pure-JS ZIP validator (`validateZip`) in `apps/server/lib/zip.mjs` checking Local Headers, Central Directory, EOCD, and CRC-32.
- [x] Update `tests/core.test.mjs` to validate ZIP archives natively instead of spawning `unzip`.
- [x] Update `scripts/smoke.mjs` to validate ZIP archives natively.
- [x] Replace shell-dependent `scripts/pack-extension.sh` with pure Node `scripts/pack-extension.mjs`.
- [x] Verify `npm test` (11/11 passing), `npm run smoke`, and `npm run pack:extension` on Windows.

---

## Phase 2 — Web Dashboard & Extension Capabilities ✅
*Completed: 2026-09-22*
*Goal: Rich interactive debugging timeline in dashboard and resilient capture controls in extension.*

### Task Checklist
- [x] Interactive timeline scrubber with click-and-drag seek, hover tooltips, and smooth auto-scroll.
- [x] In-capture keyword search, log level filter, and HTTP status filter with live count badges.
- [x] Expandable event detail drawer displaying HTTP headers, stack traces, selector paths, and copyable JSON.
- [x] Multi-artifact media gallery supporting multiple video/screenshot attachments and direct downloads.
- [x] Extension pause/resume controls, elapsed recording timer, and live status badges in popup.
- [x] Non-destructive local download fallback when server upload fails on network interruption.
- [x] Continuous event retention during active recording sessions (bypass 2-min cutoff).
- [x] Sync parity across `apps/extension/` and `chrome extension/`.

---

## Phase 3 — Modular Storage & Retention Architecture ✅
*Completed: 2026-09-22*
*Goal: Introduce pluggable storage adapters and automated retention cleanup while preserving zero-dependency mandate.*

### Task Checklist
- [x] Create base `StorageAdapter` interface in `apps/server/lib/storage/adapter.mjs`.
- [x] Implement `FileSystemStorageAdapter` in `apps/server/lib/storage/fs-adapter.mjs`.
- [x] Implement `MemoryStorageAdapter` in `apps/server/lib/storage/memory-adapter.mjs`.
- [x] Refactor `apps/server/lib/store.mjs` to delegate state and artifact persistence to `StorageAdapter`.
- [x] Implement cascading capture deletion (`deleteCapture`) removing records and associated artifact files.
- [x] Implement automated retention engine supporting TTL (`maxAgeDays`), count limit (`maxCaptures`), and quota (`maxStorageBytes`) with active-share protection.
- [x] Create unit tests in `tests/storage.test.mjs` verifying adapter switching, persistence, cascading deletes, and retention policies.

---

## Phase 4 — QA Audit & Hardening ✅
*Completed: 2026-09-22*
*Goal: Validate capture bundle schema, harden API endpoints against corrupted data, and ensure full test suite coverage.*

### Task Checklist
- [x] Implement zero-dependency `CaptureBundleV1` validator in `packages/capture-schema/validate.mjs`.
- [x] Add `DELETE /api/captures/:id` endpoint returning 204 No Content on success or 404 on missing capture.
- [x] Harden `POST /api/captures/import` with `validateZip` and schema checks, returning 400 Bad Request on invalid payloads or corrupted archives.
- [x] Add `POST /api/retention` endpoint for triggering retention policies via API.
- [x] Add comprehensive schema validation unit tests in `tests/schema.test.mjs`.
- [x] Expand `tests/api.test.mjs` covering delete endpoint, corrupted import rejection, schema validation, and retention.
- [x] Verify `npm test` (20/20 passing) and `npm run smoke` pass 100% on Windows.
