# TraceDeck Storage & Retention Architecture

TraceDeck features a modular, zero-dependency persistence architecture centered around the `StorageAdapter` contract. This enables seamless switching between local file-based storage, ephemeral in-memory storage, and external database adapters while ensuring strict isolation and data safety.

## Storage Architecture Overview

```text
┌────────────────────────────────────────────────────────┐
│                   Store (store.mjs)                    │
│     - In-memory cache & write serialization queue      │
│     - Business logic: Captures, Shares, Webhooks       │
│     - Automated Retention & Cascade Deletion Engine    │
└──────────────────────────┬─────────────────────────────┘
                           │ delegates via
                           ▼
┌────────────────────────────────────────────────────────┐
│               StorageAdapter (adapter.mjs)             │
│                  Abstract Interface                    │
├──────────────────────────┬─────────────────────────────┤
│                          │                             │
▼                          ▼                             ▼
FileSystemStorageAdapter   MemoryStorageAdapter         Custom Adapter
(fs-adapter.mjs)           (memory-adapter.mjs)         (e.g., S3/Postgres)
- state.json persistence   - In-memory Maps             - Future distributed
- Local artifact directory - Zero disk I/O               storage backends
- Atomic file writes       - Unit & mock tests
```

---

## Storage Adapters

### 1. FileSystemStorageAdapter (`apps/server/lib/storage/fs-adapter.mjs`)
The default production adapter for self-hosted instances:
- **State File**: Atomically written JSON (`state.json`) with safe temp file swapping (`atomicWriteJson`) to prevent corruption during sudden server restarts.
- **Artifacts Directory**: Files organized hierarchically by capture ID under `<dataDir>/artifacts/<captureId>/<safeFilename>`.
- **Zero External Dependencies**: Uses only standard `node:fs/promises` and `node:path`.

### 2. MemoryStorageAdapter (`apps/server/lib/storage/memory-adapter.mjs`)
A lightweight, high-performance in-memory adapter:
- Ideal for automated testing, CI pipelines, and ephemeral scratch sessions.
- Simulates artifact storage via in-memory `Buffer` maps (`memory://<captureId>/<filename>`).
- Completely isolated between test runs with zero disk writes.

---

## Retention Policy Engine

TraceDeck provides an automated capture lifecycle and pruning engine accessible via the `POST /api/retention` endpoint and unit-tested in `tests/storage.test.mjs`.

### Retention Criteria

The retention engine applies three configurable policies:

1. **TTL / Max Age (`maxAgeDays`)**:
   Prunes captures older than a given number of days based on their `createdAt` timestamp.
2. **Count Limit (`maxCaptures`)**:
   Enforces a cap on total captures per project, retaining only the most recent N records.
3. **Storage Quota (`maxStorageBytes`)**:
   Calculates total artifact byte usage and deletes oldest captures until total storage consumption drops beneath the specified quota.

### Active Share Preservation (`preserveShares: true`)
When enabled, captures that have active, unexpired public share links are exempt from automatic pruning, ensuring shared customer bugs and triage links remain accessible.

### Cascading Deletion
When a capture is deleted (either via manual `DELETE /api/captures/:id` or automated retention pruning):
1. The capture record is removed from `state.captures`.
2. All associated comments are purged from `state.comments`.
3. All public share tokens are invalidated and removed from `state.shares`.
4. The entire artifact directory `<dataDir>/artifacts/<captureId>` is recursively deleted from disk (or memory), preventing orphaned binary files.
