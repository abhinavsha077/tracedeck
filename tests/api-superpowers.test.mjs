import test from 'node:test';
import assert from 'node:assert/strict';
import { server, store } from '../apps/server/server.mjs';
import { writePng } from '../apps/server/lib/diff.mjs';

test('DevDesk API exposes audit, mock generation, auto-fix, security probe, and symbolicate endpoints', async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const key = store.listProjects()[0].key;

  // 1. Create a test capture
  const createRes = await fetch(`${baseUrl}/api/captures`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tracedeck-key': key },
    body: JSON.stringify({
      title: 'Crash on form submit',
      url: `${baseUrl}/app/`,
      events: [
        { id: '1', type: 'action', kind: 'action:click', offsetMs: 0 },
        { id: '2', type: 'network', method: 'GET', url: `${baseUrl}/api/captures`, status: 200, responseBody: '{"captures":[]}', offsetMs: 50 },
        { id: '3', type: 'network', method: 'POST', url: `${baseUrl}/api/broken`, status: 500, responseBody: '{"error":"boom"}', offsetMs: 100 },
        { id: '4', type: 'console', level: 'error', text: 'Uncaught Error: boom', offsetMs: 120 }
      ]
    })
  });
  assert.equal(createRes.status, 201);
  const { capture } = await createRes.json();
  assert.ok(capture.id);

  // 2. Test GET /api/captures/:id/mocks (MSW default)
  const mswRes = await fetch(`${baseUrl}/api/captures/${capture.id}/mocks`, {
    headers: { 'x-tracedeck-key': key }
  });
  assert.equal(mswRes.status, 200);
  const mswText = await mswRes.text();
  assert.ok(mswText.includes("http.post('http://127.0.0.1"));
  assert.ok(mswText.includes('status: 500'));

  // 3. Test GET /api/captures/:id/mocks?format=fetch
  const fetchMockRes = await fetch(`${baseUrl}/api/captures/${capture.id}/mocks?format=fetch`, {
    headers: { 'x-tracedeck-key': key }
  });
  assert.equal(fetchMockRes.status, 200);
  const fetchMockText = await fetchMockRes.text();
  assert.ok(fetchMockText.includes('installOfflineMocks'));

  // 4. Test POST /api/captures/:id/auto-fix (AI-Control Plane Bridge)
  const autoFixRes = await fetch(`${baseUrl}/api/captures/${capture.id}/auto-fix`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tracedeck-key': key },
    body: JSON.stringify({})
  });
  assert.equal(autoFixRes.status, 200);
  const { autoFix } = await autoFixRes.json();
  assert.ok(autoFix.capsule);
  assert.equal(autoFix.capsule.taskId, `fix_${capture.id}`);
  assert.equal(autoFix.branch, `fix/td-${capture.id}`);

  // 5. Test POST /api/captures/:id/security-probe
  const probeRes = await fetch(`${baseUrl}/api/captures/${capture.id}/security-probe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tracedeck-key': key },
    body: JSON.stringify({})
  });
  assert.equal(probeRes.status, 200);
  const { securityProbe } = await probeRes.json();
  assert.ok(securityProbe.probesExecuted > 0);

  // 6. Test POST /api/captures/:id/symbolicate
  const symRes = await fetch(`${baseUrl}/api/captures/${capture.id}/symbolicate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tracedeck-key': key },
    body: JSON.stringify({
      stack: 'Error: boom\n    at testFn (http://localhost/bundle.js:1:0)',
      sourceMap: {
        version: 3,
        sources: ['src/App.tsx'],
        sourcesContent: ['export function testFn() { throw new Error("boom"); }'],
        names: ['testFn'],
        mappings: 'AAAA;'
      }
    })
  });
  assert.equal(symRes.status, 200);
  const { symbolicatedStack } = await symRes.json();
  assert.ok(symbolicatedStack.includes('src/App.tsx'));

  // 7. Test POST /api/audit/start & GET /api/audit
  const startAuditRes = await fetch(`${baseUrl}/api/audit/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tracedeck-key': key },
    body: JSON.stringify({ url: `${baseUrl}/app/`, maxRoutes: 2 })
  });
  assert.equal(startAuditRes.status, 201);
  const { audit } = await startAuditRes.json();
  assert.ok(audit.id);

  const listAuditRes = await fetch(`${baseUrl}/api/audit`, {
    headers: { 'x-tracedeck-key': key }
  });
  assert.equal(listAuditRes.status, 200);
  const { audits } = await listAuditRes.json();
  assert.ok(audits.some(a => a.id === audit.id));

  // 8. Test POST /api/audit/diff
  const rgba = Buffer.alloc(16).fill(255);
  const pngBase64 = writePng(2, 2, rgba).toString('base64');
  const diffRes = await fetch(`${baseUrl}/api/audit/diff`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tracedeck-key': key },
    body: JSON.stringify({ image1: pngBase64, image2: pngBase64 })
  });
  assert.equal(diffRes.status, 200);
  const diffData = await diffRes.json();
  assert.equal(diffData.match, true);
  assert.equal(diffData.mismatchCount, 0);

  server.closeAllConnections?.();
  await new Promise(r => server.close(r));
});
