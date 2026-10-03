# TraceDeck Browser Extension Guide

The TraceDeck Chromium Extension (Manifest V3) allows developers and QA teams to capture rich visual bug reports directly from Chrome or Chromium-based browsers (Brave, Edge, Arc).

## Core Capabilities

- **Visible & Full-Page Screenshots**: Instant viewport capture or full-page scrolling stitch via Chrome DevTools Protocol (CDP).
- **Tab & Display Recording**: High-fidelity screen and audio capture using Chromium's offscreen document and `MediaRecorder` API.
- **Two-Minute Rolling Context**: Automatically retains a rolling buffer of recent console logs, network events, and user interactions prior to clicking record.
- **Local Client-Side Redaction**: Passwords, authorization tokens, session cookies, and sensitive input fields are scrubbed locally before any data leaves the browser.
- **Dual Destination Modes**:
  1. **TraceDeck Server**: Upload directly to your self-hosted TraceDeck instance.
  2. **Local-Only `.trace.zip`**: Zero-upload mode that bundles screenshots, video, and JSON metadata directly in the browser and downloads a `.trace.zip` to disk without contacting any server.

---

## Installation & Setup

### 1. Load Unpacked Extension
1. Open your browser and navigate to `chrome://extensions`.
2. Toggle **Developer mode** in the upper-right corner.
3. Click **Load unpacked**.
4. Select the `apps/extension` directory from the repository.

### 2. Configure Extension Settings
Click the TraceDeck extension icon and open **Settings** (or right-click and choose **Options**):
- **Destination**:
  - Select **TraceDeck server** to upload to your instance (default: `http://localhost:4177`, Project Key: `td_local_dev`).
  - Or select **Local-only .trace.zip** for zero-network, local-first capture bundles.
- **Deep Debug (Optional)**:
  - Toggle to enable full CDP network inspection. The browser will explicitly prompt for the optional `debugger` permission.

---

## Packaging the Extension

To build a clean, packaged `.zip` distribution ready for distribution or Chromium Web Store upload:

```bash
npm run pack:extension
```

This uses `scripts/pack-extension.mjs` to generate a verified, normalized ZIP archive at `dist/tracedeck-extension.zip`.

---

## Privacy Architecture

1. **Input Values**: By default, form inputs (such as text boxes and password fields) record only interaction timing and character count; typed text values are never captured.
2. **Explicit Masking**: Elements with the attribute `data-tracedeck-mask` have their content automatically blocked out.
3. **Sensitive Headers**: Standard sensitive request/response headers (including `Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`) are redacted at the client level before serialization.
