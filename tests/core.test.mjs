import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../apps/server/lib/store.mjs';
import { redact } from '../apps/server/lib/redact.mjs';
import { generatePlaywright } from '../apps/server/lib/playwright.mjs';
import { makeZip, readStoredZip, validateZip } from '../apps/server/lib/zip.mjs';
import { createExternalIssue } from '../apps/server/lib/integrations.mjs';

const sampleCapture = {
  id: 'cap_test', title: 'Checkout fails', description: 'Pay button fails', url: 'https://example.test/checkout',
  environment: { browser: 'Chrome' }, metadata: {}, comments: [], artifacts: [], externalIssues: [],
  events: [
    { type: 'action', ts: 100, data: { action: 'click', selector: '#pay', label: 'Pay now' } },
    { type: 'network', ts: 200, data: { method: 'POST', url: '/api/pay', status: 500 } },
    { type: 'console', ts: 220, level: 'error', data: { message: 'PaymentIntent missing' } }
  ]
};

test('redaction removes common secrets recursively', () => {
  const out = redact({ authorization: 'Bearer abc.def.ghi', nested: { password: 'hello', ok: 'visible' }, card: '4111 1111 1111 1111' });
  assert.equal(out.authorization, '[REDACTED]');
  assert.equal(out.nested.password, '[REDACTED]');
  assert.equal(out.nested.ok, 'visible');
  assert.match(out.card, /REDACTED:CARD/);
});

test('Store persists captures, comments, links and artifacts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracedeck-store-'));
  const store = await new Store(dir).init();
  const project = store.listProjects()[0];
  const cap = await store.createCapture({ title: 'Test', events: sampleCapture.events, metadata: { password: 'nope' } }, project.id);
  assert.equal(cap.metadata.password, '[REDACTED]');
  const comment = await store.addComment(cap.id, { author: 'QA', body: 'Reproduced', ts: 100 });
  assert.equal(comment.captureId, cap.id);
  const share = await store.createShare(cap.id, {});
  assert.equal(store.captureForShare(share.token).id, cap.id);
  const artifact = await store.addArtifact(cap.id, { kind: 'screenshot', name: '../../bad.png', contentType: 'image/png' }, Buffer.from('png'));
  assert(!artifact.name.includes('/'));
  assert.equal((await fs.readFile(store.artifactPath(cap.id, artifact.id).path)).toString(), 'png');
  const link = await store.createRecordingLink({ projectId: project.id, targetUrl: 'https://app.test', title: 'Report' });
  const session = await store.createLiveSession(link);
  await store.ingestLiveSession(session.token, { events: [{ kind: 'metadata', at: Date.now(), data: { build: 'abc' } }], metadata: { accessToken: 'secret' } });
  assert.equal(store.liveSession(session.token).metadata.accessToken, '[REDACTED]');
});

test('Playwright generator converts captured actions', () => {
  const code = generatePlaywright(sampleCapture);
  assert.match(code, /page\.goto\("https:\/\/example\.test\/checkout"\)/);
  assert.match(code, /locator\("#pay"\)\.click/);
  assert.match(code, /failed request/);
});

test('ZIP writer creates a structurally valid ZIP archive', async () => {
  const zip = makeZip([{ name: 'capture.json', data: '{"ok":true}' }, { name: 'artifacts/a.txt', data: 'hello' }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracedeck-zip-'));
  const file = path.join(dir, 'test.zip');
  await fs.writeFile(file, zip);
  const fileBuf = await fs.readFile(file);
  const validation = validateZip(fileBuf);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
  assert.deepEqual(validation.files, ['capture.json', 'artifacts/a.txt']);
  const parsed = readStoredZip(zip);
  assert.equal(parsed.get('capture.json').toString(), '{"ok":true}');
  assert.equal(parsed.get('artifacts/a.txt').toString(), 'hello');
});

test('validateZip verifies integrity and catches corrupted archives', () => {
  const zip = makeZip([{ name: 'file1.txt', data: 'content1' }, { name: 'file2.txt', data: 'content2' }]);
  const ok = validateZip(zip);
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.files, ['file1.txt', 'file2.txt']);

  // Corrupt data payload
  const corruptPayload = Buffer.from(zip);
  corruptPayload[39] = corruptPayload[39] ^ 0xff;
  const corruptRes = validateZip(corruptPayload);
  assert.equal(corruptRes.valid, false);
  assert.match(corruptRes.errors[0], /CRC-32 checksum failure/);

  // Corrupt signature
  const corruptSig = Buffer.from(zip);
  corruptSig.writeUInt32LE(0x12345678, 0);
  const sigRes = validateZip(corruptSig);
  assert.equal(sigRes.valid, false);
  assert.match(sigRes.errors[0], /Invalid Local File Header signature/);

  // Truncated buffer
  const truncated = zip.subarray(0, 15);
  const truncRes = validateZip(truncated);
  assert.equal(truncRes.valid, false);

  // throwOnError option
  assert.throws(() => {
    validateZip(truncated, { throwOnError: true });
  }, /Invalid ZIP/);
});

test('GitHub integration adapter produces an issue result', async () => {
  let request;
  const mockFetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ number: 42, html_url: 'https://github.test/issues/42', title: 'Checkout fails' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const issue = await createExternalIssue('github', sampleCapture, { repo: 'acme/app', token: 'x' }, {}, 'http://trace.test', mockFetch);
  assert.equal(issue.id, '42');
  assert.equal(request.url, 'https://api.github.com/repos/acme/app/issues');
  assert.match(request.options.body, /TraceDeck capture/);
});
