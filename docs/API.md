# TraceDeck REST API Reference

TraceDeck provides a lightweight, zero-dependency REST API for creating, managing, sharing, and exporting visual bug captures.

## Authentication & Headers

TraceDeck uses project keys for API access when creating captures:
- Header: `X-TraceDeck-Key: <project_key>` (default development key: `td_local_dev`)
- Alternatively, include `projectId` in the JSON request body.

---

## Endpoints

### 1. System & Health

#### `GET /api/health`
Check server health and current status.

**Response `200 OK`:**
```json
{
  "ok": true,
  "name": "TraceDeck",
  "version": "0.1.0",
  "storage": "local",
  "now": "2026-10-03T01:30:00.000Z"
}
```

#### `GET /api/config`
Retrieve server configuration, enabled features, and integration readiness.

**Response `200 OK`:**
```json
{
  "publicUrl": "http://localhost:4177",
  "projects": [
    { "id": "prj_example", "name": "Default Project", "createdAt": "2026-10-03T01:00:00.000Z" }
  ],
  "features": {
    "ai": false,
    "localAiFallback": true,
    "recordingLinks": true,
    "webhooks": true,
    "integrations": ["github", "linear", "jira", "slack"],
    "mcp": true,
    "cli": true
  },
  "integrationStatus": {
    "github": false,
    "linear": false,
    "jira": false,
    "slack": false
  }
}
```

---

### 2. Captures

#### `GET /api/captures`
List recent captures with summary statistics.
- Query Parameter: `projectId` (optional): Filter captures by project.

**Response `200 OK`:**
```json
{
  "captures": [
    {
      "id": "cap_1234567890",
      "projectId": "prj_example",
      "title": "Checkout payment failure",
      "description": "Error occurred on step 3",
      "url": "https://example.com/checkout",
      "source": "extension",
      "createdAt": "2026-10-03T01:15:00.000Z",
      "durationMs": 3500,
      "eventCount": 42,
      "artifactCount": 2,
      "errorCount": 1,
      "failedRequestCount": 1
    }
  ]
}
```

#### `POST /api/captures`
Create a new bug capture. Events and metadata are automatically redacted for sensitive tokens before storage.

**Headers:**
- `X-TraceDeck-Key: <key>`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "title": "Payment gateway 500 error",
  "description": "User clicked submit and received an unexpected 500 status",
  "url": "https://shop.example.com/checkout",
  "source": "extension",
  "durationMs": 4200,
  "environment": {
    "browser": "Chrome 122",
    "os": "Linux",
    "viewport": { "width": 1920, "height": 1080 }
  },
  "metadata": {
    "release": "v2.1.0",
    "build": "2026.10"
  },
  "events": [
    { "type": "action", "ts": 120, "data": { "action": "click", "selector": "#pay-button" } },
    { "type": "network", "ts": 340, "data": { "method": "POST", "url": "/api/pay", "status": 500 } },
    { "type": "console", "ts": 350, "level": "error", "data": { "message": "Unhandled Promise Rejection" } }
  ]
}
```

**Response `201 Created`:**
```json
{
  "capture": { "id": "cap_1234567890", "...": "..." },
  "artifactUpload": "http://localhost:4177/api/captures/cap_1234567890/artifacts"
}
```

#### `GET /api/captures/:id`
Retrieve full capture record including timeline events, comments, and shares.

**Response `200 OK` or `404 Not Found`**

#### `PATCH /api/captures/:id`
Update capture fields (e.g., `title`, `description`, `analysis`).

**Response `200 OK` or `404 Not Found`**

#### `DELETE /api/captures/:id`
Permanently delete a capture and cascade removal of all associated stored artifacts.

**Response `204 No Content` or `404 Not Found`**

---

### 3. Artifacts

#### `POST /api/captures/:id/artifacts`
Upload a binary artifact (screenshot, screen recording, console log dump) attached to the capture.

**Headers:**
- `Content-Type: <mime_type>` (e.g. `image/png`, `video/webm`, `image/svg+xml`)
- `X-Artifact-Kind: screenshot | recording | attachment`
- `X-Artifact-Name: filename.png`

**Response `201 Created`:**
```json
{
  "artifact": {
    "id": "art_1234567890",
    "kind": "screenshot",
    "name": "filename.png",
    "contentType": "image/png",
    "size": 45210,
    "createdAt": "2026-10-03T01:20:00.000Z"
  }
}
```

#### `GET /api/captures/:captureId/artifacts/:artifactId`
Stream the raw binary artifact payload with appropriate `Content-Type` and `Content-Disposition`.

---

### 4. Import & Export

#### `GET /api/captures/:id/export`
Export the entire capture (events, comments, metadata, and binary artifacts) as a portable `.trace.zip` archive.

**Response `200 OK`:**
- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="<captureId>.trace.zip"`

#### `POST /api/captures/import`
Import an exported `.trace.zip` archive or raw `CaptureBundleV1` JSON file.
- Header `Content-Type: application/zip` for archive import
- Header `Content-Type: application/json` for manifest JSON import

**Response `201 Created`:** Returns the imported capture record.

---

### 5. Sharing & Analysis

#### `POST /api/captures/:id/share`
Create a public read-only share token for external stakeholder viewing.

**Response `201 Created`:**
```json
{
  "share": { "token": "sh_abcdef123456" },
  "url": "http://localhost:4177/s/sh_abcdef123456"
}
```

#### `GET /api/share/:token`
Fetch sanitized read-only capture details for a shared link.

#### `POST /api/captures/:id/analyze`
Trigger heuristic or AI-assisted diagnostic analysis on captured timeline events.

#### `GET /api/captures/:id/playwright`
Generate a standalone Playwright reproduction script (`.spec.ts`) automatically translated from user actions and network events.

---

### 6. Storage Retention

#### `POST /api/retention`
Trigger automated capture cleanup policies across one or all projects.

**Request Body:**
```json
{
  "projectId": "prj_example",
  "maxCaptures": 50,
  "maxAgeDays": 30,
  "maxStorageBytes": 1073741824,
  "preserveShares": true
}
```

**Response `200 OK`:**
```json
{
  "scanned": 120,
  "pruned": 70,
  "retained": 50,
  "bytesFreed": 345000000
}
```

---

### 7. Recording Links & Live Sessions

#### `POST /api/recording-links`
Generate a zero-install browser recording link for non-technical reporters.

#### `GET /api/recording-links`
List active recording links.

#### `POST /api/recording-links/:token/sessions`
Initialize a temporary 1-hour SDK session bridge for an instrumented app.

#### `POST /api/live-sessions/:token/events`
Stream sanitized real-time events from an instrumented browser app into an active session.

#### `POST /api/recording-links/:token/captures`
Submit a completed recording link report.

---

### 8. Webhooks

#### `POST /api/webhooks`
Register an HTTP callback URL for events:
- `capture.created`
- `analysis.completed`
- `issue.created`
- `recording_link.submitted`

Every outgoing POST request includes an HMAC signature:
- Header: `X-TraceDeck-Signature: sha256=<hmac_hex>`
- Computed using the webhook's assigned secret and payload body.
