import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tracedeck-api-'));
process.env.TRACEDECK_DATA_DIR = tmp;
process.env.TRACEDECK_PUBLIC_URL = 'http://127.0.0.1';
const { server } = await import('../apps/server/server.mjs?api-test=' + Date.now());
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function j(pathname, options = {}) {
  const res = await fetch(base + pathname, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await res.json();
  return { res, body };
}

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test('health and capture workflow work end to end', async () => {
  let r = await j('/api/health'); assert.equal(r.res.status, 200); assert.equal(r.body.ok, true);
  r = await j('/api/captures', { method: 'POST', headers: { 'x-tracedeck-key': 'td_local_dev' }, body: JSON.stringify({ title: 'E2E bug', url: 'https://example.test', durationMs: 900, events: [{ type: 'console', ts: 300, level: 'error', data: { message: 'boom' } }] }) });
  assert.equal(r.res.status, 201); const id = r.body.capture.id;
  const upload = await fetch(base + `/api/captures/${id}/artifacts`, { method: 'POST', headers: { 'content-type': 'image/svg+xml', 'x-artifact-kind': 'screenshot', 'x-artifact-name': 'screen.svg' }, body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' });
  assert.equal(upload.status, 201);
  r = await j(`/api/captures/${id}/comments`, { method: 'POST', body: JSON.stringify({ author: 'Tester', body: 'Confirmed' }) }); assert.equal(r.res.status, 201);
  r = await j(`/api/captures/${id}/analyze`, { method: 'POST', body: '{}' }); assert.equal(r.body.analysis.provider, 'local-heuristic');
  r = await j(`/api/captures/${id}/share`, { method: 'POST', body: '{}' }); assert.equal(r.res.status, 201); const shareToken = r.body.share.token;
  r = await j(`/api/share/${shareToken}`); assert.equal(r.body.capture.id, id);
  const pw = await fetch(base + `/api/captures/${id}/playwright`); assert.equal(pw.status, 200); assert.match(await pw.text(), /@playwright\/test/);
  const exp = await fetch(base + `/api/captures/${id}/export`); assert.equal(exp.status, 200); const buf = Buffer.from(await exp.arrayBuffer()); assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const imported = await fetch(base + '/api/captures/import', { method: 'POST', headers: { 'content-type': 'application/zip', 'x-tracedeck-key': 'td_local_dev' }, body: buf });
  assert.equal(imported.status, 201); const importedBody = await imported.json(); assert.equal(importedBody.capture.title, 'E2E bug'); assert.equal(importedBody.capture.artifacts.length, 1);
});

test('recording-link SDK live session merges sanitized app context', async () => {
  const projects = await j('/api/projects'); const projectId = projects.body.projects[0].id;
  let r = await j('/api/recording-links', { method: 'POST', body: JSON.stringify({ projectId, title: 'Customer bug', targetUrl: 'https://app.test' }) });
  const token = r.body.link.token;
  r = await j(`/api/recording-links/${token}/sessions`, { method: 'POST', body: '{}' }); const sessionToken = r.body.session.token;
  r = await j(`/api/live-sessions/${sessionToken}/events`, { method: 'POST', body: JSON.stringify({ events: [{ kind: 'metadata', at: Date.now(), data: { release: 'r1' } }], metadata: { password: 'secret', build: 'b42' }, identity: { id: 'u1' } }) }); assert.equal(r.res.status, 202);
  r = await j(`/api/recording-links/${token}/captures`, { method: 'POST', body: JSON.stringify({ title: 'Customer bug', sessionToken, durationMs: 1000, events: [] }) });
  const cap = r.body.capture; assert.equal(cap.metadata.password, '[REDACTED]'); assert.equal(cap.metadata.build, 'b42'); assert(cap.events.some((e) => e.type === 'app'));
});

test('web app and SDK are served', async () => {
  let r = await fetch(base + '/app/'); assert.equal(r.status, 200); assert.match(await r.text(), /TraceDeck/);
  r = await fetch(base + '/sdk/tracedeck.js'); assert.equal(r.status, 200); assert.match(await r.text(), /global\.TraceDeck/);
});

test('DELETE /api/captures/:id and error handling on import work properly', async () => {
  // Create a capture to delete
  const created = await j('/api/captures', {
    method: 'POST',
    headers: { 'x-tracedeck-key': 'td_local_dev' },
    body: JSON.stringify({ title: 'Temporary capture', events: [] })
  });
  assert.equal(created.res.status, 201);
  const capId = created.body.capture.id;

  // Verify GET 200
  const get1 = await j(`/api/captures/${capId}`);
  assert.equal(get1.res.status, 200);

  // DELETE 204
  const del = await fetch(base + `/api/captures/${capId}`, { method: 'DELETE' });
  assert.equal(del.status, 204);

  // Verify GET 404
  const get2 = await j(`/api/captures/${capId}`);
  assert.equal(get2.res.status, 404);

  // Subsequent DELETE returns 404
  const del2 = await fetch(base + `/api/captures/${capId}`, { method: 'DELETE' });
  assert.equal(del2.status, 404);

  // Import with corrupted ZIP returns 400
  const corruptZipRes = await fetch(base + '/api/captures/import', {
    method: 'POST',
    headers: { 'content-type': 'application/zip', 'x-tracedeck-key': 'td_local_dev' },
    body: Buffer.from('NOT A VALID ZIP ARCHIVE')
  });
  assert.equal(corruptZipRes.status, 400);

  // Import with invalid schema returns 400
  const invalidSchemaRes = await j('/api/captures/import', {
    method: 'POST',
    headers: { 'x-tracedeck-key': 'td_local_dev' },
    body: JSON.stringify({ schemaVersion: '2.0', capture: {}, events: [] })
  });
  assert.equal(invalidSchemaRes.res.status, 400);

  // Retention endpoint returns 200
  const retentionRes = await j('/api/retention', {
    method: 'POST',
    headers: { 'x-tracedeck-key': 'td_local_dev' },
    body: JSON.stringify({ maxCaptures: 100 })
  });
  assert.equal(retentionRes.res.status, 200);
  assert(Array.isArray(retentionRes.body.deletedCaptureIds));
});

