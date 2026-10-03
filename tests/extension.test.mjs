import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const dir = path.resolve('apps/extension');

test('extension manifest references existing MV3 assets and capture permissions', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  const files = [manifest.action.default_popup, manifest.background.service_worker, manifest.options_page, ...manifest.content_scripts.flatMap((x) => x.js), ...manifest.web_accessible_resources.flatMap((x) => x.resources), 'offscreen.html', 'offscreen.js', 'zip.js'];
  for (const file of files) await fs.access(path.join(dir, file));
  for (const permission of ['tabCapture','offscreen','desktopCapture','downloads']) assert(manifest.permissions.includes(permission));
  assert(manifest.optional_permissions.includes('debugger'));
});

test('extension exposes local-only portable bundle mode', async () => {
  const [worker, offscreen, options] = await Promise.all(['service-worker.js','offscreen.js','options.html'].map((f) => fs.readFile(path.join(dir, f), 'utf8')));
  assert.match(worker, /destination==='local'/);
  assert.match(worker, /OFFSCREEN_STOP_LOCAL/);
  assert.match(offscreen, /TraceDeckZip\.make/);
  assert.match(offscreen, /OFFSCREEN_DOWNLOAD_BUNDLE/);
  assert.match(options, /Local-only \.trace\.zip/);
});
