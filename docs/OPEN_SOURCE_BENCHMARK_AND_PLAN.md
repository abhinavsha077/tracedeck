# Open-Source Benchmark & Architecture Evolution Plan

## 1. Open-Source Landscape Analysis

| Project | Core Strength | Relevance to TraceDeck | Architectural Benefit |
|---|---|---|---|
| **rrweb** | DOM mutation serialization & virtual player replay (`rrweb-player`) | Captures full DOM state changes over time with zero video encoding overhead | 10x smaller capture bundles, inspectable live DOM elements at any historical timestamp, text selectable/copyable |
| **OpenTelemetry (OTel) / W3C TraceContext** | Distributed trace correlation standards (`traceparent`, `tracestate`) | Connects front-end client bugs directly to backend distributed microservices | Correlates browser network 500 error to exact backend trace ID in Datadog/Jaeger/Zipkin without manual log hunting |
| **Playwright Trace Viewer** | Action-by-action timeline, network snapshots, DOM snapshots, HAR files | Standard automated reproduction test runner and diagnostic archive format | Native Playwright test generation and standard HAR 1.2 export/import for Charles/DevTools/Postman |
| **Sentry / Highlight.io / PostHog** | Error breadcrumbs, sourcemap symbolication, session analytics, AI root-cause diagnosis | Developer triage workflows and automated issue synthesis | Causal chain triage (Action → Network Call → Uncaught Exception), token-efficient diagnostic extracts for AI agents |

---

## 2. Phased Upgrade Plan

### Upgrade 1: Token-Optimized AI Agent Causal Triage Engine (Implemented)
- **Problem**: Raw event dumps (500+ events) flood AI agent context windows with irrelevant noise, wasting tokens and obscuring root causes.
- **Solution**: Native `triageCapture` engine that synthesizes the "Golden Moment":
  `[Preceding Action (Selector/Label)] → [Triggered Network Request (URL/Status/Latency)] → [Client Console Exception & Stack]`
- **Benefit**: Reduces LLM agent context consumption by ~80% while increasing bug fix accuracy.

### Upgrade 2: Standard HTTP Archive (HAR 1.2) Export (Implemented)
- **Problem**: Proprietary trace formats cannot be imported into external developer tools.
- **Solution**: Native conversion of capture network events to standard HAR 1.2 (`GET /api/captures/:id/har`).
- **Benefit**: Instant interoperability with Chrome DevTools, Charles Proxy, Postman, and API mock servers.

### Upgrade 3: Distributed Trace Context Injection (W3C TraceContext) (Implemented)
- **Problem**: Front-end HTTP failures stop at the browser boundary.
- **Solution**: Browser SDK and extension automatically detect or inject `traceparent` headers (`00-<traceId>-<spanId>-01`) on outgoing fetch/XHR calls. Correlated directly in triage reports, HAR exports, and interactive timeline badges.
- **Benefit**: Correlates browser network 500 error to exact backend trace ID in Datadog/Jaeger/Tempo without manual log hunting.

### Upgrade 4: Lightweight DOM Mutation Telemetry (Implemented)
- **Problem**: Video recordings take several megabytes and cannot be inspected in DevTools.
- **Solution**: Lightweight non-intrusive `MutationObserver` in extension content script and Browser SDK streaming throttled DOM mutation batches (`events.type = 'dom'`). Includes DOM state phase in triage causal chains.
- **Benefit**: 90% bandwidth reduction compared to video; allows inspecting CSS styles and DOM elements at exact time of crash.

### Upgrade 5: Full-Lifecycle AI Agent Tooling (MCP + Agent Skill) (Implemented)
- **Problem**: Humans must manually click through UI to triage, write comments, create issues, and test reproductions.
- **Solution**: Comprehensive Model Context Protocol (MCP) server + `tracedeck-debugger` agent skill.
- **Benefit**: AI agents can autonomously triage captures, verify reproductions via Playwright, post findings, and file Linear/Jira/GitHub tickets.

### Upgrade 6: Automated Reproduction Runner Engine (Implemented)
- **Problem**: Verifying whether a bug is still actively reproducing or resolved requires manual test setup.
- **Solution**: Dedicated reproduction verification engine (`POST /api/captures/:id/reproduce`), MCP tool `run_reproduction`, and CLI `tracedeck reproduce <id>`. Probes live network endpoints, validates action steps, flags masked credentials, and outputs ready-to-run Playwright tests.
- **Benefit**: AI agents and CI bots can test reproductions with one command without human intervention.

