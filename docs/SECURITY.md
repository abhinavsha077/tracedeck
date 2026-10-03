# Security & Privacy Architecture

TraceDeck captures visual recordings, console outputs, network events, and app state to facilitate rapid software debugging. Because debugging evidence can contain sensitive data, security and privacy are built into every layer of the architecture.

---

## 1. Threat Model & Boundaries

TraceDeck enforces strict trust boundaries across all ingestion points:

| Boundary | Threat | Mitigation |
|---|---|---|
| **Browser Extension** | Accidental capture of customer passwords / PII | Client-side input suppression, regex redaction, DOM masking attribute |
| **Ingest API** | Malicious file upload / Path traversal | File name sanitization (`safeFilename`), ID validation, strict size limits |
| **Import Endpoint** | Malformed ZIP archive / Zip slip attack | Pure-JS CRC and entry validation (`validateZip`), safe decompressor |
| **Shared Captures** | Unauthorized data access / Secret leakage | Share token isolation, removal of internal paths and tokens in shared views |
| **Webhooks** | Spoofed webhook notifications | SHA-256 HMAC payload signatures (`X-TraceDeck-Signature`) |
| **Network Exposure** | Unauthorized local server access | Default binding to `127.0.0.1` (loopback only) |

---

## 2. Redaction & Privacy Engine

TraceDeck employs a two-tier redaction pipeline:
1. **Tier 1 (Client-Side)**: Performed immediately inside the browser before any data is sent over the network.
2. **Tier 2 (Server-Side)**: Re-executed at server ingest as defense-in-depth before state is committed to disk.

### Automatic Masking & Scrubbing
- **Form Inputs**: Character counts are recorded for timing, but literal input values are omitted by default.
- **Explicit Masking**: Any DOM node with `data-tracedeck-mask` is blacked out in screenshots and recordings.
- **Sensitive Headers**: Standard sensitive request/response headers are redacted:
  - `Authorization` (Bearer tokens, Basic auth)
  - `Cookie`, `Set-Cookie`
  - `X-Api-Key`, `X-Auth-Token`, `ApiKey`
- **PII & Credential Patterns**:
  - Credit card numbers (matching major provider Luhn formats)
  - Passwords and secret keys in JSON payloads
  - JWT tokens (`eyJ...`)
  - Private tokens (`sk-...`, `ghp_...`, `xoxb-...`)

---

## 3. Storage & Artifact Isolation

- **Path Traversal Protection**: All uploaded artifact file names are filtered through `safeFilename()`, stripping directory traversal characters (`..`, `/`, `\`).
- **Scoped File Access**: Artifacts are stored under isolated capture directories (`data/artifacts/<captureId>/`) and served only via validated capture and artifact IDs.
- **Temporary Sessions**: Live SDK sessions created for recording links automatically expire after 1 hour.

---

## 4. Production Deployment Hardening

For Internet-facing or multi-tenant deployments:

1. **Reverse Proxy & TLS**: Place a TLS-terminating reverse proxy (such as Nginx, Caddy, or Cloudflare) in front of TraceDeck.
2. **Authentication Layer**: Deploy an authentication proxy (e.g. OAuth2 Proxy, Cloudflare Access, or HTTP Basic Auth) to protect the dashboard and management APIs.
3. **Signing Secret**: Set a cryptographically secure `TRACEDECK_SIGNING_SECRET` environment variable in production.
4. **Network Policies**: Restrict outbound egress if untrusted webhooks are permitted.

---

## 5. Vulnerability Reporting

If you discover a potential security issue in TraceDeck, please report it responsibly by contacting the repository maintainers or opening a private GitHub Security Advisory. Please do not publish sensitive vulnerabilities in public issue trackers.
