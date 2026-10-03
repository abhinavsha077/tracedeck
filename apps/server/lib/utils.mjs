import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export function id(prefix = '') {
  return prefix + crypto.randomBytes(10).toString('hex');
}

export function token(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function now() {
  return new Date().toISOString();
}

export function json(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...headers
  });
  res.end(body);
}

export function text(res, status, payload, contentType = 'text/plain; charset=utf-8', headers = {}) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': body.length,
    ...headers
  });
  res.end(body);
}

export async function readBody(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, maxBytes) {
  const body = await readBody(req, maxBytes);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON body');
    error.statusCode = 400;
    throw error;
  }
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function atomicWriteJson(file, data) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

export function safeFilename(name) {
  return String(name || 'artifact').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
}

export function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4'
  })[ext] || 'application/octet-stream';
}

export function hmac(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export function constantTimeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
