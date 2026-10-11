/**
 * High-signal triage engine and HAR 1.2 exporter.
 * Optimized for AI agent context efficiency and cross-tool interoperability.
 */

export function triageCapture(capture) {
  const events = Array.isArray(capture.events) ? capture.events : [];
  
  const consoleErrors = events.filter((e) => 
    e.type === 'console' && ['error', 'exception'].includes(e.level || e.data?.level)
  );

  const failedRequests = events.filter((e) => 
    e.type === 'network' && (Number(e.data?.status || 0) >= 400 || e.data?.failed)
  );

  const actions = events.filter((e) => e.type === 'action');

  // Identify primary failure point (earliest fatal event)
  const failureCandidates = [
    ...consoleErrors.map((e) => ({ event: e, kind: 'console', ts: e.ts || 0 })),
    ...failedRequests.map((e) => ({ event: e, kind: 'network', ts: e.ts || 0 }))
  ].sort((a, b) => a.ts - b.ts);

  const primary = failureCandidates[0] || null;

  // Actions immediately preceding the primary failure
  const precedingActions = primary
    ? actions.filter((a) => (a.ts || 0) <= primary.ts && (primary.ts - (a.ts || 0)) <= 15000).slice(-4)
    : actions.slice(-4);

  // Causal Chain construction
  const causalChain = [];

  for (const act of precedingActions) {
    causalChain.push({
      phase: 'user-action',
      ts: act.ts,
      detail: act.data?.label || act.data?.action || act.data?.selector || 'User interacted with element',
      selector: act.data?.selector || null
    });
  }

  const domEvents = events.filter((e) => e.type === 'dom');
  const relevantDom = primary
    ? domEvents.find((d) => Math.abs((d.ts || 0) - primary.ts) <= 3000)
    : domEvents[0];
  if (relevantDom) {
    causalChain.push({
      phase: 'dom-state',
      ts: relevantDom.ts,
      kind: relevantDom.data?.kind || 'mutation',
      summary: relevantDom.data?.summary || 'DOM mutated near failure point',
      target: relevantDom.data?.selector || relevantDom.data?.target || null
    });
  }

  if (primary?.kind === 'network' || failedRequests.length) {
    const net = primary?.kind === 'network' ? primary.event : failedRequests[0];
    const netData = net.data || {};
    const traceparent = netData.traceparent || (netData.headers && (netData.headers.traceparent || netData.headers['x-traceparent']));
    const traceId = netData.traceId || (traceparent ? String(traceparent).split('-')[1] : null);
    causalChain.push({
      phase: 'network-failure',
      ts: net.ts,
      method: netData.method || 'GET',
      url: netData.url || '',
      status: Number(netData.status || 0),
      durationMs: netData.durationMs || null,
      traceparent: traceparent || null,
      traceId: traceId || null,
      headers: netData.responseHeaders || netData.headers || null
    });
  }

  if (primary?.kind === 'console' || consoleErrors.length) {
    const con = primary?.kind === 'console' ? primary.event : consoleErrors[0];
    causalChain.push({
      phase: 'client-exception',
      ts: con.ts,
      message: String(con.data?.message || con.data?.args || 'Uncaught error').slice(0, 1000),
      stack: con.data?.stack || null
    });
  }

  causalChain.sort((a, b) => (a.ts || 0) - (b.ts || 0));

  // Determine severity
  let severity = 'low';
  if (failedRequests.some((r) => Number(r.data?.status || 0) >= 500) || consoleErrors.length > 0) {
    severity = 'critical';
  } else if (failedRequests.some((r) => Number(r.data?.status || 0) >= 400)) {
    severity = 'high';
  } else if (actions.length > 0) {
    severity = 'medium';
  }

  // Fix direction heuristic
  let suggestedFix = 'No explicit error code or uncaught exception detected. Review user action sequence.';
  const firstNetStatus = Number(failedRequests[0]?.data?.status || 0);
  const firstErrText = String(consoleErrors[0]?.data?.message || '');

  if (firstNetStatus >= 500) {
    suggestedFix = `Backend server returned HTTP ${firstNetStatus} on ${failedRequests[0]?.data?.url || 'endpoint'}. Inspect server-side error logs and database transactions for this request.`;
  } else if (firstNetStatus === 401 || firstNetStatus === 403) {
    suggestedFix = `Authorization failure (HTTP ${firstNetStatus}) on ${failedRequests[0]?.data?.url || 'endpoint'}. Verify user session tokens, cookie transmission, or CORS credentials.`;
  } else if (firstNetStatus === 404) {
    suggestedFix = `Resource not found (HTTP 404) on ${failedRequests[0]?.data?.url || 'endpoint'}. Check API routing, route params, or resource ID.`;
  } else if (firstErrText.includes('Cannot read properties of undefined') || firstErrText.includes('is undefined') || firstErrText.includes('null is not an object')) {
    suggestedFix = `Null pointer or undefined dereference in client script: "${firstErrText.slice(0, 160)}". Add defensive guards or optional chaining (?.).`;
  } else if (firstErrText.includes('CORS') || firstErrText.includes('Cross-Origin')) {
    suggestedFix = 'Cross-Origin Resource Sharing (CORS) restriction blocked request. Verify Access-Control-Allow-Origin response headers on the target API.';
  } else if (consoleErrors.length) {
    suggestedFix = `Client error: ${firstErrText.slice(0, 200)}.`;
  }

  const reproductionSteps = precedingActions.length
    ? precedingActions.map((a, i) => `${i + 1}. ${a.data?.action || 'Click'} ${a.data?.label || a.data?.selector || 'target element'}`).join('\n')
    : 'No preceding user actions recorded.';

  return {
    captureId: capture.id,
    title: capture.title,
    url: capture.url || null,
    severity,
    primaryFailure: primary ? { kind: primary.kind, ts: primary.ts, summary: primary.kind === 'network' ? `HTTP ${primary.event.data?.status} on ${primary.event.data?.url}` : String(primary.event.data?.message || 'Error') } : null,
    causalChain,
    suggestedFix,
    reproductionSteps,
    counts: {
      totalEvents: events.length,
      actions: actions.length,
      consoleErrors: consoleErrors.length,
      failedRequests: failedRequests.length,
      domEvents: domEvents.length,
      artifacts: (capture.artifacts || []).length
    },
    artifacts: (capture.artifacts || []).map((a) => ({ id: a.id, name: a.name, kind: a.kind, bytes: a.bytes }))
  };
}

export function captureToHar(capture) {
  const events = Array.isArray(capture.events) ? capture.events : [];
  const networkEvents = events.filter((e) => e.type === 'network');
  const completedOrFailed = networkEvents.filter((e) => e.data?.phase === 'response' || e.data?.phase === 'failed' || e.data?.status || e.data?.failed);
  const targetEvents = completedOrFailed.length > 0 ? completedOrFailed : networkEvents;

  const entries = targetEvents.map((e, idx) => {
    const d = e.data || {};
    const baseMs = Date.parse(capture.createdAt || '') || Date.now();
    const startTime = new Date(baseMs + (Number(e.ts) || 0)).toISOString();
    const duration = Number(d.durationMs || 50);
    const status = Number(d.status || 200);

    const reqHeaders = Object.entries(d.headers || d.requestHeaders || {}).map(([name, value]) => ({
      name, value: String(value)
    }));

    if (d.traceparent && !reqHeaders.some((h) => h.name.toLowerCase() === 'traceparent')) {
      reqHeaders.push({ name: 'traceparent', value: String(d.traceparent) });
    }

    const resHeaders = Object.entries(d.responseHeaders || {}).map(([name, value]) => ({
      name, value: String(value)
    }));

    return {
      pageref: 'page_1',
      startedDateTime: startTime,
      time: duration,
      request: {
        method: d.method || 'GET',
        url: d.url || capture.url || 'https://unknown.local',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: reqHeaders,
        queryString: [],
        headersSize: -1,
        bodySize: -1
      },
      response: {
        status,
        statusText: status >= 500 ? 'Internal Server Error' : status >= 400 ? 'Client Error' : 'OK',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: resHeaders,
        content: {
          size: Number(d.bytes || 0),
          mimeType: d.contentType || 'application/json'
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: Number(d.bytes || -1)
      },
      cache: {},
      timings: {
        send: 0,
        wait: duration,
        receive: 0
      }
    };
  });

  return {
    log: {
      version: '1.2',
      creator: { name: 'TraceDeck', version: '0.1.0' },
      pages: [{
        startedDateTime: capture.createdAt || new Date().toISOString(),
        id: 'page_1',
        title: capture.title || 'Capture Session',
        pageTimings: { onContentLoad: -1, onLoad: -1 }
      }],
      entries
    }
  };
}
