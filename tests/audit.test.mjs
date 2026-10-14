import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readPng, writePng, diffPngBuffers } from '../apps/server/lib/diff.mjs';
import { AuditEngine } from '../apps/server/lib/audit.mjs';
import { MemoryStorageAdapter } from '../apps/server/lib/storage/memory-adapter.mjs';
import { Store } from '../apps/server/lib/store.mjs';

test('diffPngBuffers accurately detects identical and modified PNGs without Pillow', () => {
  const width = 10;
  const height = 10;
  const rgba1 = Buffer.alloc(width * height * 4);
  const rgba2 = Buffer.alloc(width * height * 4);

  // Fill rgba1 with solid blue
  for (let i = 0; i < width * height; i++) {
    rgba1[i * 4] = 0;
    rgba1[i * 4 + 1] = 0;
    rgba1[i * 4 + 2] = 255;
    rgba1[i * 4 + 3] = 255;

    rgba2[i * 4] = 0;
    rgba2[i * 4 + 1] = 0;
    rgba2[i * 4 + 2] = 255;
    rgba2[i * 4 + 3] = 255;
  }

  const png1 = writePng(width, height, rgba1);
  const png2 = writePng(width, height, rgba2);

  // Identical test
  const identicalResult = diffPngBuffers(png1, png2);
  assert.equal(identicalResult.match, true);
  assert.equal(identicalResult.mismatchCount, 0);
  assert.equal(identicalResult.mismatchPct, 0);

  // Modify 4 pixels in rgba2
  rgba2[0] = 255; // Red
  rgba2[1] = 0;
  rgba2[2] = 0;

  rgba2[4] = 255;
  rgba2[5] = 0;
  rgba2[6] = 0;

  const png3 = writePng(width, height, rgba2);
  const diffResult = diffPngBuffers(png1, png3, { tolerance: 10 });

  assert.equal(diffResult.match, false);
  assert.equal(diffResult.mismatchCount, 2);
  assert.equal(diffResult.totalPixels, 100);
  assert.equal(diffResult.mismatchPct, 2);
  assert.ok(diffResult.diffPng);
  assert.ok(diffResult.boundingBox);
  assert.equal(diffResult.boundingBox.minX, 0);
  assert.equal(diffResult.boundingBox.maxX, 1);
});

test('AuditEngine discovers routes, inventories controls, and creates captures on HTTP errors', async () => {
  // Mock server with 1 good page, 1 linked page with controls, and 1 500 error page
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`
        <html><body>
          <h1>Welcome</h1>
          <a href="/about">About Us</a>
          <a href="/broken">Broken Page</a>
          <button type="submit">Submit Info</button>
        </body></html>
      `);
    } else if (req.url === '/about') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`
        <html><body>
          <h1>About Us</h1>
          <input type="text" name="username" />
          <button>Click Me</button>
        </body></html>
      `);
    } else if (req.url === '/broken') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal Server Error 500');
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const targetUrl = `http://127.0.0.1:${port}/`;

  const memoryStore = new Store(new MemoryStorageAdapter());
  await memoryStore.init();

  const auditEngine = new AuditEngine(memoryStore);
  const audit = await auditEngine.startAudit({ url: targetUrl, maxRoutes: 5 });

  // Wait for audit crawl completion
  let attempts = 0;
  while (audit.status === 'running' && attempts < 50) {
    await new Promise(r => setTimeout(r, 50));
    attempts++;
  }

  assert.equal(audit.status, 'completed');
  assert.ok(audit.routesCrawled.length >= 3);
  assert.ok(audit.controlsDiscovered >= 3);
  assert.equal(audit.errorsFound.length, 1);
  assert.equal(audit.errorsFound[0].status, 500);

  // Check automated TraceDeck bug capture generation
  assert.equal(audit.capturesCreated.length, 1);
  const createdCapture = await memoryStore.getCapture(audit.capturesCreated[0].captureId);
  assert.ok(createdCapture);
  assert.equal(createdCapture.source, 'audit-studio');
  assert.ok(createdCapture.title.includes('HTTP 500'));

  server.closeAllConnections?.();
  await new Promise(r => server.close(r));
});
