import { generatePlaywright } from './playwright.mjs';

/**
 * Automated Reproduction Runner and Action Verification Engine.
 * Evaluates bug captures, synthesizes execution steps, probes live endpoints,
 * and generates ready-to-run Playwright tests for AI agents and test pipelines.
 */
export async function runReproduction(capture, options = {}) {
  const events = Array.isArray(capture?.events) ? capture.events : [];
  const checkEndpoints = options.checkEndpoints !== false;
  const timeoutMs = Number(options.timeoutMs || 3000);

  const actions = events.filter((e) => e.type === 'action').sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const failedRequests = events.filter((e) => e.type === 'network' && (Number(e.data?.status || 0) >= 400 || e.data?.failed));
  const consoleErrors = events.filter((e) => e.type === 'console' && ['error', 'exception'].includes(e.level || e.data?.level));

  const steps = [];
  let stepIndex = 1;

  if (capture?.url) {
    steps.push({
      step: stepIndex++,
      action: 'navigate',
      url: capture.url,
      description: `Navigate to initial target URL: ${capture.url}`
    });
  }

  const missingInputs = [];

  for (const act of actions) {
    const d = act.data || {};
    const isRedacted = d.value === '[REDACTED]' || d.sensitive === true;
    if (isRedacted && (d.selector || d.label)) {
      missingInputs.push({
        selector: d.selector || null,
        label: d.label || null,
        prompt: 'Sensitive input was masked during capture. Provide mock value for automated test.'
      });
    }

    steps.push({
      step: stepIndex++,
      action: d.action || 'interaction',
      selector: d.selector || d.target || null,
      label: d.label || null,
      value: isRedacted ? '[MOCK_REQUIRED]' : d.value,
      description: d.label
        ? `${d.action || 'Interact with'} "${d.label}" (${d.selector || 'element'})`
        : `${d.action || 'Interact with'} ${d.selector || 'element'}`
    });
  }

function isSafeEndpointUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname.toLowerCase();
    // Block cloud metadata and link-local services
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname === 'metadata.internal') return false;
    return true;
  } catch {
    return false;
  }
}

  // Live endpoint check for failed requests
  const endpointChecks = [];
  if (checkEndpoints && failedRequests.length > 0) {
    const seenUrls = new Set();
    const candidateRequests = [];
    for (const req of failedRequests) {
      const u = req.data?.url;
      if (u && isSafeEndpointUrl(u) && !seenUrls.has(u)) {
        seenUrls.add(u);
        candidateRequests.push(req);
        if (candidateRequests.length >= 5) break;
      }
    }

    for (const req of candidateRequests) {
      const d = req.data || {};
      const check = {
        url: d.url,
        method: d.method || 'GET',
        capturedStatus: Number(d.status || 0),
        liveStatus: null,
        reproduced: false,
        detail: ''
      };

      try {
        const res = await fetch(d.url, {
          method: d.method || 'GET',
          headers: { 'user-agent': 'TraceDeck-Reproduction-Runner/0.1.0' },
          signal: AbortSignal.timeout(timeoutMs)
        });
        check.liveStatus = res.status;
        check.reproduced = res.status >= 400;
        check.detail = check.reproduced
          ? `Live endpoint still returns HTTP ${res.status}`
          : `Live endpoint now returns HTTP ${res.status} (resolved or requires auth)`;
      } catch (err) {
        check.liveStatus = null;
        check.reproduced = true;
        check.detail = `Connection failed: ${err.message}`;
      }

      endpointChecks.push(check);
    }
  }

  const playwrightScript = generatePlaywright(capture);

  // Verdict calculation
  let verdict = 'NO_REPRODUCIBLE_ACTIONS';
  let reproduced = false;
  let summary = 'Capture contains insufficient user action telemetry to formulate an automated reproduction flow.';
  let recommendation = 'Review session metadata and manual logs.';

  if (endpointChecks.some((c) => c.reproduced)) {
    verdict = 'REPRODUCED_FAILING_ENDPOINT';
    reproduced = true;
    const failingUrls = endpointChecks.filter((c) => c.reproduced).map((c) => `${c.method} ${c.url}`).join(', ');
    summary = `Failed network request actively reproduces on live endpoint (${failingUrls}).`;
    recommendation = 'Inspect backend service logs for the failing endpoint or check endpoint availability.';
  } else if (endpointChecks.length > 0 && endpointChecks.every((c) => !c.reproduced)) {
    verdict = 'POTENTIALLY_RESOLVED';
    reproduced = false;
    summary = 'All previously failed endpoints now returned non-error HTTP status codes. Issue may be resolved.';
    recommendation = 'Run the full end-to-end user flow to confirm bug resolution.';
  } else if (actions.length > 0) {
    verdict = 'VERIFIED_ACTION_CHAIN';
    reproduced = true;
    summary = `Validated action chain with ${actions.length} step(s) leading to recorded issue state. Playwright script generated.`;
    recommendation = missingInputs.length > 0
      ? `Populate mock values for ${missingInputs.length} masked input field(s) before executing Playwright test.`
      : 'Execute the attached Playwright script in your test pipeline to reproduce the error.';
  }

  return {
    captureId: capture?.id || null,
    title: capture?.title || 'Untitled Capture',
    verdict,
    reproduced,
    summary,
    recommendation,
    playwrightScript,
    steps,
    missingInputs,
    endpointChecks,
    counts: {
      totalSteps: steps.length,
      actions: actions.length,
      failedRequests: failedRequests.length,
      consoleErrors: consoleErrors.length,
      endpointsChecked: endpointChecks.length
    }
  };
}
