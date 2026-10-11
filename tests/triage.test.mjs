import test from 'node:test';
import assert from 'node:assert/strict';
import { triageCapture, captureToHar } from '../apps/server/lib/triage.mjs';

const mockCapture = {
  id: 'cap_triage_1',
  title: 'Order Checkout Error',
  url: 'https://store.example/checkout',
  createdAt: '2026-10-03T01:00:00.000Z',
  durationMs: 3500,
  events: [
    { type: 'action', ts: 300, data: { action: 'click', selector: '#accept-terms', label: 'Agree to terms' } },
    { type: 'action', ts: 800, data: { action: 'click', selector: '#pay-now', label: 'Pay $49' } },
    { type: 'network', ts: 950, data: { phase: 'response', method: 'POST', url: 'https://store.example/api/pay', status: 500, durationMs: 450, headers: { 'content-type': 'application/json' } } },
    { type: 'console', ts: 1420, level: 'error', data: { message: 'Uncaught TypeError: Cannot read properties of undefined (reading token)' } }
  ],
  artifacts: [
    { id: 'art_1', name: 'screenshot.png', kind: 'screenshot', bytes: 1024 }
  ]
};

test('triageCapture extracts high-signal causal chain and severity', () => {
  const diagnosis = triageCapture(mockCapture);

  assert.equal(diagnosis.captureId, 'cap_triage_1');
  assert.equal(diagnosis.severity, 'critical');
  assert.equal(diagnosis.counts.consoleErrors, 1);
  assert.equal(diagnosis.counts.failedRequests, 1);
  assert.equal(diagnosis.counts.actions, 2);

  // Causal Chain checks
  assert(diagnosis.causalChain.length >= 3);
  const actions = diagnosis.causalChain.filter((c) => c.phase === 'user-action');
  const net = diagnosis.causalChain.find((c) => c.phase === 'network-failure');
  const err = diagnosis.causalChain.find((c) => c.phase === 'client-exception');

  assert(actions.length > 0);
  assert.equal(net.status, 500);
  assert.equal(net.method, 'POST');
  assert.match(err.message, /Cannot read properties of undefined/);

  // Suggested fix
  assert.match(diagnosis.suggestedFix, /Backend server returned HTTP 500/);

  // Reproduction steps
  assert.match(diagnosis.reproductionSteps, /1\./);
  assert.match(diagnosis.reproductionSteps, /Pay \$49/);
});

test('triageCapture handles clean captures without errors', () => {
  const cleanCapture = {
    id: 'cap_clean',
    title: 'Happy path test',
    events: [
      { type: 'action', ts: 100, data: { action: 'click', selector: '#home' } },
      { type: 'network', ts: 200, data: { method: 'GET', url: 'https://store.example/home', status: 200 } }
    ]
  };

  const diagnosis = triageCapture(cleanCapture);
  assert.equal(diagnosis.severity, 'medium');
  assert.equal(diagnosis.counts.consoleErrors, 0);
  assert.equal(diagnosis.counts.failedRequests, 0);
  assert.equal(diagnosis.primaryFailure, null);
});

test('captureToHar formats network events into valid HAR 1.2 JSON', () => {
  const har = captureToHar(mockCapture);

  assert.equal(har.log.version, '1.2');
  assert.equal(har.log.creator.name, 'TraceDeck');
  assert.equal(har.log.pages.length, 1);
  assert.equal(har.log.entries.length, 1);

  const entry = har.log.entries[0];
  assert.equal(entry.request.method, 'POST');
  assert.equal(entry.request.url, 'https://store.example/api/pay');
  assert.equal(entry.response.status, 500);
  assert.equal(entry.response.statusText, 'Internal Server Error');
  assert(entry.time > 0);
});

test('triageCapture correlates W3C TraceContext and extracts DOM state phase', () => {
  const otelCapture = {
    id: 'cap_otel_dom',
    title: 'Distributed OTel Trace Failure',
    events: [
      { type: 'action', ts: 100, data: { action: 'click', selector: '#checkout' } },
      { type: 'dom', ts: 150, data: { kind: 'mutation', summary: 'button#checkout[disabled]' } },
      {
        type: 'network',
        ts: 200,
        data: {
          method: 'POST',
          url: 'https://api.example/charge',
          status: 503,
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
        }
      },
      { type: 'console', ts: 300, level: 'error', data: { message: 'Service Unavailable' } }
    ]
  };

  const triage = triageCapture(otelCapture);
  assert.equal(triage.counts.domEvents, 1);
  assert.equal(triage.counts.failedRequests, 1);

  const domPhase = triage.causalChain.find((c) => c.phase === 'dom-state');
  assert(domPhase);
  assert.equal(domPhase.kind, 'mutation');
  assert.match(domPhase.summary, /disabled/);

  const netPhase = triage.causalChain.find((c) => c.phase === 'network-failure');
  assert(netPhase);
  assert.equal(netPhase.traceparent, '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  assert.equal(netPhase.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');

  // Verify HAR preservation of traceparent header
  const har = captureToHar(otelCapture);
  const reqHeader = har.log.entries[0].request.headers.find((h) => h.name.toLowerCase() === 'traceparent');
  assert(reqHeader);
  assert.equal(reqHeader.value, '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
});

