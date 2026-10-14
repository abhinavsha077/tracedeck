import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateMswHandlers, generateFetchMock, extractNetworkCalls } from '../apps/server/lib/mock-generator.mjs';
import { decodeVlq, SourceMapConsumer, symbolicateStackTrace } from '../apps/server/lib/sourcemap.mjs';
import { buildTaskCapsule, dispatchAutoFix } from '../apps/server/lib/ai-control.mjs';
import { runSecurityProbes } from '../apps/server/lib/security-probe.mjs';

test('mock-generator generates valid MSW and Fetch mock scripts', () => {
  const sampleCapture = {
    id: 'cap_mock_1',
    title: 'Failed Cart Checkout',
    events: [
      {
        id: 'evt_1',
        type: 'network',
        method: 'GET',
        url: 'https://api.shop.com/v1/cart',
        status: 200,
        responseBody: '{"items": [{"id": 1, "name": "Desk Lamp"}]}'
      },
      {
        id: 'evt_2',
        type: 'network',
        method: 'POST',
        url: 'https://api.shop.com/v1/checkout',
        status: 500,
        responseBody: '{"error": "Payment service timeout"}'
      }
    ]
  };

  const calls = extractNetworkCalls(sampleCapture);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.shop.com/v1/cart');

  const mswCode = generateMswHandlers(sampleCapture);
  assert.ok(mswCode.includes("http.get('https://api.shop.com/v1/cart'"));
  assert.ok(mswCode.includes("http.post('https://api.shop.com/v1/checkout'"));
  assert.ok(mswCode.includes('status: 500'));

  const fetchCode = generateFetchMock(sampleCapture);
  assert.ok(fetchCode.includes('installOfflineMocks'));
  assert.ok(fetchCode.includes('POST:https://api.shop.com/v1/checkout'));
});

test('sourcemap decoder correctly unpacks VLQ and unminifies stack traces', () => {
  // Test VLQ decode
  const vlq = decodeVlq('AAAA');
  assert.deepEqual(vlq, [0, 0, 0, 0]);

  // Synthetic Source Map v3 for bundle.min.js
  // Generated line 1, col 0 -> src/index.ts, line 10, col 5
  // VLQ: [0, 0, 9, 5] -> AARF
  const fakeMap = {
    version: 3,
    sources: ['src/components/Checkout.tsx'],
    sourcesContent: ['// Line 1\n// Line 2\nexport function submitPayment() {\n  throw new Error("Failed");\n}\n'],
    names: ['submitPayment'],
    mappings: 'AAAA,SAASC;'
  };

  const consumer = new SourceMapConsumer(fakeMap);
  const pos = consumer.originalPositionFor(1, 0);
  assert.ok(pos);
  assert.equal(pos.source, 'src/components/Checkout.tsx');

  const minifiedStack = `Error: Payment failed
    at submitPayment (https://shop.com/static/bundle.min.js:1:0)`;

  const unminified = symbolicateStackTrace(minifiedStack, consumer);
  assert.ok(unminified.includes('src/components/Checkout.tsx'));
});

test('ai-control builds structured task capsule with causal chain', () => {
  const sampleCapture = {
    id: 'cap_aic_1',
    title: 'Crash on clicking submit',
    description: 'User clicked submit, 500 response, unhandled error thrown',
    url: 'http://localhost:3000/checkout',
    events: [
      { id: '1', type: 'action', kind: 'action:click', target: '#submit-btn', offsetMs: 0 },
      { id: '2', type: 'network', method: 'POST', url: 'http://localhost:3000/api/pay', status: 500, offsetMs: 50 },
      { id: '3', type: 'console', level: 'error', text: 'Uncaught TypeError: Cannot read property status of undefined', offsetMs: 60 }
    ]
  };

  const capsule = buildTaskCapsule(sampleCapture);
  assert.equal(capsule.taskId, 'fix_cap_aic_1');
  assert.equal(capsule.worktree.suggestedBranch, 'fix/td-cap_aic_1');
  assert.ok(capsule.reproductionSpec.includes('test('));
  assert.ok(capsule.diagnostics.errors.length > 0);
  assert.equal(capsule.diagnostics.failedRequests.length, 1);
});

test('security-probe detects CORS misconfiguration and reflected XSS', async () => {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');

    // Simulate vulnerable CORS
    if (req.headers.origin) {
      res.setHeader('access-control-allow-origin', req.headers.origin);
      res.setHeader('access-control-allow-credentials', 'true');
    }

    // Simulate reflected parameter
    if (u.searchParams.has('q')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body>Search results for: ${u.searchParams.get('q')}</body></html>`);
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body>OK</body></html>');
  });

  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const target = `http://127.0.0.1:${port}/`;

  const report = await runSecurityProbes(target);
  assert.equal(report.status, 'vulnerabilities_detected');
  assert.ok(report.findings.some(f => f.kind === 'cors_arbitrary_origin_credentials'));
  assert.ok(report.findings.some(f => f.kind === 'reflected_xss'));

  server.closeAllConnections?.();
  await new Promise(r => server.close(r));
});
