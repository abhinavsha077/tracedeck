import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemoryStorageAdapter } from '../apps/server/lib/storage/memory-adapter.mjs';
import { FileSystemStorageAdapter } from '../apps/server/lib/storage/fs-adapter.mjs';
import { Store } from '../apps/server/lib/store.mjs';

test('MemoryStorageAdapter provides isolated in-memory operations', async () => {
  const adapter = new MemoryStorageAdapter();
  await adapter.init();
  assert.equal(await adapter.readState(), null);

  await adapter.writeState({ test: 123 });
  assert.deepEqual(await adapter.readState(), { test: 123 });

  const saved = await adapter.saveArtifact('cap_1', 'art_1', 'screenshot.png', Buffer.from('image-bytes'));
  assert.equal(saved.size, 11);
  assert.equal(saved.path, 'memory://cap_1/screenshot.png');

  const read = await adapter.readArtifact('cap_1', 'art_1', 'screenshot.png');
  assert.equal(read.toString(), 'image-bytes');

  assert.equal(await adapter.getStorageSize() > 0, true);

  await adapter.deleteCaptureArtifacts('cap_1');
  assert.equal(await adapter.readArtifact('cap_1', 'art_1', 'screenshot.png'), null);
});

test('FileSystemStorageAdapter persists state and artifacts to disk', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tracedeck-fs-adapter-'));
  const adapter = new FileSystemStorageAdapter(tmpDir);
  await adapter.init();

  assert.equal(await adapter.readState(), null);
  await adapter.writeState({ hello: 'world' });
  assert.deepEqual(await adapter.readState(), { hello: 'world' });

  const saved = await adapter.saveArtifact('cap_2', 'art_2', 'log.txt', Buffer.from('error log'));
  assert.equal(saved.size, 9);
  assert(saved.path.endsWith('log.txt'));

  const read = await adapter.readArtifact('cap_2', 'art_2', 'log.txt');
  assert.equal(read.toString(), 'error log');

  const size = await adapter.getStorageSize();
  assert(size > 0);

  await adapter.deleteCaptureArtifacts('cap_2');
  assert.equal(await adapter.readArtifact('cap_2', 'art_2', 'log.txt'), null);
});

test('Store supports MemoryStorageAdapter and cascades capture deletion', async () => {
  const memoryAdapter = new MemoryStorageAdapter();
  const store = await new Store(memoryAdapter).init();
  const project = store.listProjects()[0];

  const cap = await store.createCapture({ title: 'Memory capture' }, project.id);
  const comment = await store.addComment(cap.id, { author: 'Dev', body: 'Investigating' });
  const share = await store.createShare(cap.id, {});
  const art = await store.addArtifact(cap.id, { name: 'trace.json' }, Buffer.from('{}'));

  assert.equal(store.getCapture(cap.id).comments.length, 1);
  assert.equal(store.getCapture(cap.id).shares.length, 1);
  assert.equal(store.getCapture(cap.id).artifacts.length, 1);

  // Cascade delete
  const deleted = await store.deleteCapture(cap.id);
  assert.equal(deleted, true);

  assert.equal(store.getCapture(cap.id), null);
  assert.equal(store.state.comments.filter((c) => c.captureId === cap.id).length, 0);
  assert.equal(store.state.shares.filter((s) => s.captureId === cap.id).length, 0);
  assert.equal(await store.readArtifact(cap.id, art.id), null);
});

test('Store retention engine prunes captures by count, age, and preserves active shares', async () => {
  const store = await new Store(new MemoryStorageAdapter()).init();
  const project = store.listProjects()[0];

  // 1. Create older capture (30 days ago) with no share
  const capOld = await store.createCapture({ title: 'Old capture' }, project.id);
  const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  capOld.createdAt = oldDate;

  // 2. Create older capture (30 days ago) with active share
  const capOldShared = await store.createCapture({ title: 'Old shared capture' }, project.id);
  capOldShared.createdAt = oldDate;
  await store.createShare(capOldShared.id, { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });

  // 3. Create fresh capture
  const capFresh = await store.createCapture({ title: 'Fresh capture' }, project.id);

  // Apply retention: maxAgeDays: 7, protectActiveShares: true
  const res1 = await store.applyRetention({ maxAgeDays: 7, protectActiveShares: true });
  assert.deepEqual(res1.deletedCaptureIds, [capOld.id]);
  assert.equal(store.getCapture(capOld.id), null);
  assert(store.getCapture(capOldShared.id) !== null);
  assert(store.getCapture(capFresh.id) !== null);

  // 4. Test maxCaptures count cap
  const capExtra1 = await store.createCapture({ title: 'Extra 1' }, project.id);
  const capExtra2 = await store.createCapture({ title: 'Extra 2' }, project.id);

  // Total captures now: capOldShared, capFresh, capExtra1, capExtra2 (4 captures)
  // Prune down to max 2 captures, protecting active share
  const res2 = await store.applyRetention({ maxCaptures: 2, protectActiveShares: true });
  // capFresh was oldest unshared capture
  assert(res2.deletedCaptureIds.length >= 1);
  assert(store.getCapture(capOldShared.id) !== null); // Protected
});
