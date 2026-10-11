---
name: tracedeck-debugger
description: Autonomous visual debugging, causal triage, reproduction verification, and issue filing with TraceDeck. Use when investigating bug captures, diagnosing user sessions, generating reproduction tests, or creating captures from automated test failures.
---

# TraceDeck Debugger

Empowers AI coding agents to autonomously perform the complete human debugging workflow using TraceDeck: inspect captured evidence, extract root-cause causal chains, generate and run Playwright reproduction tests, post diagnostic comments, and file issues directly to Linear, Jira, or GitHub.

## When to Use

- When a human says: "Check TraceDeck for recent bug reports", "Diagnose capture cap_xxx", "Why is checkout failing in TraceDeck?"
- When investigating a front-end crash, unexpected 4xx/5xx network failure, or UI regression.
- When generating and running automated Playwright reproduction specs from captured user sessions.
- When filing verified bugs to Linear, Jira, GitHub, or Slack with complete developer evidence.
- When reporting bugs discovered by autonomous agents during web navigation or automated tests.

---

## Autonomous Debugging Workflow

```text
[Human Request / CI Alert]
          │
          ▼
1. Discover & Triage  ──► `triage_capture(captureId)` (Causal chain, severity, fix hint)
          │
          ▼
2. Reproduce          ──► `generate_playwright(captureId)` (Save & execute headlessly)
          │
          ▼
3. Localize & Fix     ──► Grep code for endpoint/stack trace, apply bugfix
          │
          ▼
4. Verify & Record    ──► Re-run Playwright spec; confirm pass
          │
          ▼
5. Collaborate        ──► `add_comment(captureId)` + `create_issue(provider)`
```

---

## Step-by-Step Instructions

### Step 1: Discover & Select Capture
To find available bug captures:
- Via MCP: Call `list_captures` (returns capture list with error/failed request counts).
- Via CLI: Run `node tools/cli/tracedeck.mjs list`.

Pick the target `captureId` (e.g., `cap_1042`).

### Step 2: Extract Root-Cause Causal Chain (Token-Efficient)
Do NOT load raw 500-event arrays into context. Call `triage_capture`:
- Via MCP: Call `triage_capture({ captureId: "cap_xxx" })`.
- Via CLI: Run `node tools/cli/tracedeck.mjs triage cap_xxx`.

This returns the **Golden Moment** of the bug:
1. `causalChain`:
   - Exact user click or input preceding the crash.
   - Network failure (HTTP status, method, URL, latency).
   - Client console exception (message, stack trace).
2. `suggestedFix`: Targeted recommendation (e.g., null check on property, backend 500 endpoint, CORS header).
3. `severity`: `critical`, `high`, `medium`, or `low`.

### Step 3: Automated Reproduction Verification
Before manually setting up tests, trigger TraceDeck's automated reproduction verification:
- Via MCP: Call `run_reproduction({ captureId: "cap_xxx", checkEndpoints: true })`.
- Via CLI: Run `node tools/cli/tracedeck.mjs reproduce cap_xxx`.

This returns:
- `verdict`: `REPRODUCED_FAILING_ENDPOINT`, `VERIFIED_ACTION_CHAIN`, or `POTENTIALLY_RESOLVED`.
- `endpointChecks`: Live status probe results of all failing network endpoints in the capture.
- `missingInputs`: Flagged fields where sensitive credentials were masked and require mock values.
- `playwrightScript`: Fully generated `@playwright/test` script ready to run:
  ```bash
  node tools/cli/tracedeck.mjs playwright cap_xxx --out repro.spec.ts
  npx playwright test repro.spec.ts
  ```

### Step 4: Distributed Tracing Correlation (OpenTelemetry)
If network requests failed, check `traceparent` or `traceId` in `triage_capture`:
- Format: `00-<trace_id>-<span_id>-01`
- Use the trace ID to query backend microservice telemetry (Jaeger, Datadog APM, Grafana Tempo) to pinpoint backend service exceptions.

### Step 5: Fix the Offending Code
Using the file path and line number from the stack trace and the endpoint from the network failure:
1. Locate the source file in the repository.
2. Formulate hypothesis and apply the fix.
3. Re-run reproduction verification: `node tools/cli/tracedeck.mjs reproduce cap_xxx` or `npx playwright test repro.spec.ts`.

### Step 6: Post Findings and File Issue
Keep the team in the loop:
1. **Add diagnostic note**:
   - Via MCP: `add_comment({ captureId: "cap_xxx", author: "Antigravity Agent", body: "Root cause: unhandled null in submitPayment. Fixed in commit abc123." })`.
   - Via CLI: `node tools/cli/tracedeck.mjs comment cap_xxx "Root cause verified and fixed."`.
2. **File external ticket (if requested)**:
   - Via MCP: `create_issue({ captureId: "cap_xxx", provider: "linear", options: { teamId: "ENG" } })`.
   - Or `provider: "jira"` with `{ projectKey: "DEV" }`.
   - Or `provider: "github"` with `{ repo: "owner/repo" }`.

### Step 7: Agent Bug Reporting (Autonomous Capture Creation)
When the AI agent encounters an unhandled bug while executing browser tasks or tests, it can record the failure back into TraceDeck for developers to review in the Web Management Portal:
```javascript
create_capture({
  title: "E2E Failure: Checkout payment button unresponsive",
  url: "https://staging.app/checkout",
  description: "Playwright test timed out waiting for #order-confirmation",
  events: [
    { type: "action", ts: 100, data: { action: "click", selector: "#pay" } },
    { type: "dom", ts: 200, data: { kind: "mutation", summary: "button#pay disabled" } },
    { type: "network", ts: 500, data: { method: "POST", url: "/api/pay", status: 504 } },
    { type: "console", ts: 600, level: "error", data: { message: "Gateway Timeout" } }
  ]
})
```

---

## Tool Quick Reference

| Action | MCP Tool | CLI Command |
|---|---|---|
| List captures | `list_captures` | `node tools/cli/tracedeck.mjs list` |
| Fast triage | `triage_capture` | `node tools/cli/tracedeck.mjs triage <id>` |
| Auto reproduction | `run_reproduction` | `node tools/cli/tracedeck.mjs reproduce <id>` |
| Playwright spec | `generate_playwright` | `node tools/cli/tracedeck.mjs playwright <id> --out <file>` |
| Export HAR 1.2 | `export_har` | `node tools/cli/tracedeck.mjs har <id> --out <file>` |
| Add comment | `add_comment` | `node tools/cli/tracedeck.mjs comment <id> "<text>"` |
| Create issue | `create_issue` | `node tools/cli/tracedeck.mjs issue <id> <provider> '<json>'` |
| Create capture | `create_capture` | `node tools/cli/tracedeck.mjs create <file.json>` |
| Delete capture | `delete_capture` | `node tools/cli/tracedeck.mjs delete <id>` |
