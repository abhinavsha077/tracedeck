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
});
