import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tracedeck-mcp-test-'));
process.env.TRACEDECK_DATA_DIR = tmp;
process.env.TRACEDECK_PUBLIC_URL = 'http://127.0.0.1';

const { server, store } = await import('../apps/server/server.mjs?mcp-test=' + Date.now());
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
process.env.TRACEDECK_URL = base;
process.env.TRACEDECK_KEY = 'td_local_dev';

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('MCP endpoints triage and har are served by API', async () => {
  // 1. Create a capture
  const project = store.listProjects()[0];
  const cap = await store.createCapture({
    title: 'MCP diagnostic test',
    events: [
      { type: 'action', ts: 100, data: { action: 'click', selector: '#login' } },
      { type: 'network', ts: 250, data: { method: 'POST', url: 'https://app.test/login', status: 401 } },
      { type: 'console', ts: 300, level: 'error', data: { message: 'Unauthorized' } }
    ]
  }, project.id);

  // 2. Fetch triage
  const triageRes = await fetch(`${base}/api/captures/${cap.id}/triage`, {
    headers: { 'x-tracedeck-key': 'td_local_dev' }
  });
  assert.equal(triageRes.status, 200);
  const triageData = await triageRes.json();
  assert.equal(triageData.triage.captureId, cap.id);
  assert.equal(triageData.triage.severity, 'critical');
  assert(triageData.triage.causalChain.length >= 2);

  // 3. Fetch HAR
  const harRes = await fetch(`${base}/api/captures/${cap.id}/har`, {
    headers: { 'x-tracedeck-key': 'td_local_dev' }
  });
  assert.equal(harRes.status, 200);
  const harData = await harRes.json();
  assert.equal(harData.log.version, '1.2');
  assert.equal(harData.log.entries[0].response.status, 401);

  // 4. Fetch Reproduction (POST & GET)
  const reproPost = await fetch(`${base}/api/captures/${cap.id}/reproduce`, {
    method: 'POST',
    headers: { 'x-tracedeck-key': 'td_local_dev', 'content-type': 'application/json' },
    body: JSON.stringify({ checkEndpoints: false })
  });
  assert.equal(reproPost.status, 200);
  const reproPostData = await reproPost.json();
  assert.equal(reproPostData.reproduction.captureId, cap.id);
  assert.equal(reproPostData.reproduction.verdict, 'VERIFIED_ACTION_CHAIN');
  assert.equal(reproPostData.reproduction.reproduced, true);

  const reproGet = await fetch(`${base}/api/captures/${cap.id}/reproduce?checkEndpoints=false`, {
    headers: { 'x-tracedeck-key': 'td_local_dev' }
  });
  assert.equal(reproGet.status, 200);
  const reproGetData = await reproGet.json();
  assert.equal(reproGetData.reproduction.captureId, cap.id);

  // 5. Config exposes telemetry
  const cfgRes = await fetch(`${base}/api/config`);
  assert.equal(cfgRes.status, 200);
  const cfgData = await cfgRes.json();
  assert('telemetry' in cfgData);

  // 6. Test mocks and auto-fix endpoints for MCP integration
  const mockRes = await fetch(`${base}/api/captures/${cap.id}/mocks?format=msw`, {
    headers: { 'x-tracedeck-key': 'td_local_dev' }
  });
  assert.equal(mockRes.status, 200);
  const mockCode = await mockRes.text();
  assert.ok(mockCode.includes('import { http, HttpResponse } from \'msw\''));

  const autoFixRes = await fetch(`${base}/api/captures/${cap.id}/auto-fix`, {
    method: 'POST',
    headers: { 'x-tracedeck-key': 'td_local_dev', 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(autoFixRes.status, 200);
  const autoFixData = await autoFixRes.json();
  assert.equal(autoFixData.autoFix.capsule.taskId, `fix_${cap.id}`);

  // 7. Test Deep Superpowers API endpoints
  const driftRes = await fetch(`${base}/api/captures/${cap.id}/schema-drift`, {
    method: 'POST',
    headers: { 'x-tracedeck-key': 'td_local_dev', 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(driftRes.status, 200);
  const driftData = await driftRes.json();
  assert.ok(driftData.schemaDrift);

  const a11yRes = await fetch(`${base}/api/captures/${cap.id}/a11y-tree`, {
    method: 'POST',
    headers: { 'x-tracedeck-key': 'td_local_dev', 'content-type': 'application/json' },
    body: JSON.stringify({ html: '<main><button>Test Control</button></main>' })
  });
  assert.equal(a11yRes.status, 200);
  const a11yData = await a11yRes.json();
  assert.ok(a11yData.a11y.treeText.includes('button "Test Control"'));

  const chaosRes = await fetch(`${base}/api/captures/${cap.id}/chaos`, {
    headers: { 'x-tracedeck-key': 'td_local_dev' }
  });
  assert.equal(chaosRes.status, 200);
  const chaosText = await chaosRes.text();
  assert.ok(chaosText.includes('@playwright/test'));

  const linRes = await fetch(`${base}/api/captures/${cap.id}/lineage`, {
    headers: { 'x-tracedeck-key': 'td_local_dev' }
  });
  assert.equal(linRes.status, 200);
  const linData = await linRes.json();
  assert.ok(linData.lineage.diagnosisVerdict);
});

test('TraceDeck CLI supports drift, a11y, chaos, and lineage commands', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);

  const project = store.listProjects()[0];
  const cap = await store.createCapture({
    title: 'CLI deep superpowers test',
    events: [
      { type: 'action', ts: 100, data: { action: 'click', selector: '#checkout-button', label: 'Checkout' } },
      { type: 'network', ts: 200, data: { method: 'POST', url: 'https://api.shop.com/checkout', status: 500, responseBody: '{"error":"out_of_stock"}' } }
    ]
  }, project.id);

  // 1. CLI drift
  const { stdout: driftOut } = await exec(process.execPath, ['tools/cli/tracedeck.mjs', 'drift', cap.id, '--server', base]);
  const driftJson = JSON.parse(driftOut);
  assert.ok(driftJson.schemaDrift);

  // 2. CLI a11y
  const { stdout: a11yOut } = await exec(process.execPath, ['tools/cli/tracedeck.mjs', 'a11y', cap.id, '--server', base]);
  const a11yJson = JSON.parse(a11yOut);
  assert.ok(a11yJson.a11y);

  // 3. CLI chaos
  const { stdout: chaosOut } = await exec(process.execPath, ['tools/cli/tracedeck.mjs', 'chaos', cap.id, '--server', base]);
  assert.ok(chaosOut.includes('@playwright/test'));

  // 4. CLI lineage
  const { stdout: lineageOut } = await exec(process.execPath, ['tools/cli/tracedeck.mjs', 'lineage', cap.id, '--server', base]);
  const lineageJson = JSON.parse(lineageOut);
  assert.ok(lineageJson.lineage);
});


