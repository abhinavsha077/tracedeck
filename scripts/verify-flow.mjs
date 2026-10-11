import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateZip } from '../apps/server/lib/zip.mjs';

const port = 44200 + (process.pid % 500);
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracedeck-flow-check-'));
const base = `http://127.0.0.1:${port}`;

console.log(`[1/6] Launching server on ${base}`);
const child = spawn(process.execPath, ['apps/server/server.mjs'], {
  env: {
    ...process.env,
    TRACEDECK_HOST: '127.0.0.1',
    TRACEDECK_PORT: String(port),
    TRACEDECK_PUBLIC_URL: base,
    TRACEDECK_DATA_DIR: dataDir
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });

async function wait() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server start failed: ' + stderr);
}

try {
  await wait();
  console.log('[2/6] Server online. Testing management APIs & seeding data...');
  const key = 'td_local_dev';
  
  // Create Capture
  const capRes = await fetch(base + '/api/captures', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tracedeck-key': key },
    body: JSON.stringify({
      title: 'Flow Verification: Order Checkout Crash',
      description: 'Reproduced 500 on submit payment button',
      url: 'https://shop.example/checkout',
      source: 'extension',
      durationMs: 3200,
      environment: { browser: 'Chrome 122', os: 'Windows 11', viewport: { width: 1920, height: 1080 } },
      metadata: { release: 'v1.4.0', userRole: 'customer' },
      events: [
        { type: 'action', ts: 200, data: { action: 'click', selector: '#checkout' } },
        { type: 'network', ts: 600, data: { phase: 'request', method: 'POST', url: 'https://shop.example/api/pay' } },
        { type: 'network', ts: 1200, data: { phase: 'response', method: 'POST', url: 'https://shop.example/api/pay', status: 500, durationMs: 600 } },
        { type: 'console', ts: 1220, level: 'error', data: { message: 'Uncaught TypeError: Cannot read properties of undefined' } }
      ]
    })
  });
  if (!capRes.ok) throw new Error('Create capture failed: ' + (await capRes.text()));
  const capData = await capRes.json();
  const capId = capData.capture.id;

  // Upload SVG screenshot
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#0d1c28"/><text x="50" y="100" fill="#ff7b89" font-size="24">Payment Error</text></svg>';
  const artRes = await fetch(capData.artifactUpload, {
    method: 'POST',
    headers: { 'content-type': 'image/svg+xml', 'x-artifact-kind': 'screenshot', 'x-artifact-name': 'error-screen.svg' },
    body: svg
  });
  if (!artRes.ok) throw new Error('Artifact upload failed');

  console.log('[3/6] Verifying Web Portal & detail views...');
  const appHtml = await (await fetch(base + '/app/')).text();
  if (!appHtml.includes('TraceDeck') || !appHtml.includes('id="captures-view"')) throw new Error('Web portal HTML malformed');

  const capList = await (await fetch(base + '/api/captures')).json();
  if (capList.captures.length === 0 || capList.captures[0].id !== capId) throw new Error('Capture missing from list');
  if (capList.captures[0].errorCount !== 1 || capList.captures[0].failedRequestCount !== 1) throw new Error('Badges mismatch');

  console.log('[4/6] Verifying Actions: comments, analysis, sharing, Playwright export...');
  // Comment
  const comRes = await fetch(base + `/api/captures/${capId}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ author: 'Alice (Engineer)', body: 'Backend logs confirm DB deadlock at /api/pay', ts: 1200 })
  });
  if (!comRes.ok) throw new Error('Comment failed');

  // AI Analysis
  const anaRes = await fetch(base + `/api/captures/${capId}/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const anaData = await anaRes.json();
  if (!anaData.analysis?.summary) throw new Error('Analysis failed');

  // Share link
  const shareRes = await (await fetch(base + `/api/captures/${capId}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  const shareView = await (await fetch(base + `/api/share/${shareRes.share.token}`)).json();
  if (shareView.capture.id !== capId) throw new Error('Share link failed');

  // Playwright repro
  const pwCode = await (await fetch(base + `/api/captures/${capId}/playwright`)).text();
  if (!pwCode.includes('@playwright/test') || !pwCode.includes('#checkout')) throw new Error('Playwright script generation failed');

  // AI Causal Triage
  const triageRes = await (await fetch(base + `/api/captures/${capId}/triage`)).json();
  if (!triageRes.triage?.causalChain?.length || triageRes.triage.severity !== 'critical') throw new Error('Triage check failed');

  // HAR 1.2 Export
  const harRes = await (await fetch(base + `/api/captures/${capId}/har`)).json();
  if (harRes.log?.version !== '1.2' || harRes.log?.entries?.length !== 1) throw new Error('HAR export check failed');

  // Automated Reproduction
  const reproRes = await (await fetch(base + `/api/captures/${capId}/reproduce?checkEndpoints=false`)).json();
  if (!reproRes.reproduction?.verdict || !reproRes.reproduction?.playwrightScript) throw new Error('Reproduction check failed');

  // Export .trace.zip
  const expZip = Buffer.from(await (await fetch(base + `/api/captures/${capId}/export`)).arrayBuffer());
  const zipCheck = validateZip(expZip);
  if (!zipCheck.valid) throw new Error('Exported .trace.zip invalid: ' + zipCheck.errors.join(', '));

  console.log('[5/6] Verifying Recording Links & Webhooks portal features...');
  // Recording Link
  const linkRes = await (await fetch(base + '/api/recording-links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Customer Reproduction Link', prompt: 'Click record and try again', targetUrl: 'https://shop.example' })
  })).json();
  const linkHtml = await (await fetch(base + '/record/' + linkRes.link.token)).text();
  if (!linkHtml.includes('Report an issue') || !linkHtml.includes('Start screen recording')) throw new Error('Recording Link page failed');
  const linkApiCheck = await (await fetch(base + '/api/recording-links/' + linkRes.link.token)).json();
  if (linkApiCheck.link.title !== 'Customer Reproduction Link') throw new Error('Recording link API mismatch');

  // Webhook creation
  const hookRes = await fetch(base + '/api/webhooks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1:9999/hook', events: ['capture.created'] })
  });
  if (!hookRes.ok) throw new Error('Webhook creation failed');

  console.log('[6/6] Verifying Capture Deletion and Retention cleanup...');
  // Delete capture
  const delRes = await fetch(base + `/api/captures/${capId}`, { method: 'DELETE' });
  if (delRes.status !== 204) throw new Error('Delete capture returned ' + delRes.status);
  const getDeleted = await fetch(base + `/api/captures/${capId}`);
  if (getDeleted.status !== 404) throw new Error('Capture still exists after deletion');

  console.log('SUCCESS: Complete flow verified successfully!');
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 200));
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
}
