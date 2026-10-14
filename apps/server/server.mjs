#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './lib/config.mjs';
import { Store } from './lib/store.mjs';
import { analyzeCapture } from './lib/ai.mjs';
import { createExternalIssue } from './lib/integrations.mjs';
import { generatePlaywright } from './lib/playwright.mjs';
import { makeZip, readStoredZip, validateZip } from './lib/zip.mjs';
import { validateCaptureBundle } from '../../packages/capture-schema/validate.mjs';
import { triageCapture, captureToHar } from './lib/triage.mjs';
import { runReproduction } from './lib/reproduction.mjs';
import { contentTypeFor, hmac, json, readBody, readJson, text } from './lib/utils.mjs';
import { AuditEngine } from './lib/audit.mjs';
import { diffPngBuffers } from './lib/diff.mjs';
import { generateMswHandlers, generateFetchMock } from './lib/mock-generator.mjs';
import { SourceMapConsumer, symbolicateStackTrace } from './lib/sourcemap.mjs';
import { dispatchAutoFix } from './lib/ai-control.mjs';
import { runSecurityProbes } from './lib/security-probe.mjs';
import { detectCaptureSchemaDrift } from './lib/schema-drift.mjs';
import { buildA11yTree, auditClickTraps } from './lib/a11y-tree.mjs';
import { generateChaosSpec } from './lib/chaos-replay.mjs';
import { traceComponentLineage } from './lib/lineage.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '../web');
const sdkFile = path.resolve(__dirname, '../../packages/browser-sdk/tracedeck.js');
const store = await new Store(config.dataDir).init();
const auditEngine = new AuditEngine(store);

function cors(req, res) {
  res.setHeader('access-control-allow-origin', req.headers.origin || '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-tracedeck-key,x-artifact-kind,x-artifact-name,x-artifact-content-type');
  res.setHeader('access-control-expose-headers', 'content-disposition');
}

function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), geolocation=()');
}

function routeMatch(pathname, pattern) {
  const a = pathname.split('/').filter(Boolean);
  const b = pattern.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (b[i].startsWith(':')) params[b[i].slice(1)] = decodeURIComponent(a[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

function projectFromRequest(req, body = {}) {
  const key = req.headers['x-tracedeck-key'];
  if (key) return store.projectForKey(String(key));
  if (body.projectId) return store.listProjects().find((p) => p.id === body.projectId) || null;
  return store.listProjects()[0] || null;
}

async function dispatchWebhook(projectId, event, payload) {
  const hooks = store.webhooksFor(projectId, event);
  await Promise.all(hooks.map(async (hook) => {
    const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data: payload });
    let status = 0;
    let response = '';
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tracedeck-event': event,
          'x-tracedeck-signature': `sha256=${hmac(hook.secret, body)}`
        },
        body,
        signal: AbortSignal.timeout(10_000)
      });
      status = res.status;
      response = (await res.text()).slice(0, 1000);
    } catch (error) {
      response = error.message;
    }
    await store.addWebhookDelivery({ webhookId: hook.id, event, status, response });
  }));
}

async function serveFile(res, file, extraHeaders = {}) {
  try {
    const data = await fs.readFile(file);
    text(res, 200, data, contentTypeFor(file), { 'cache-control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=300', ...extraHeaders });
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

function sanitizeCaptureForShare(capture) {
  const copy = structuredClone(capture);
  for (const artifact of copy.artifacts || []) delete artifact.file;
  for (const share of copy.shares || []) delete share.token;
  return copy;
}

function captureBundle(capture) {
  return {
    schemaVersion: '1.0',
    capture: {
      id: capture.id,
      title: capture.title,
      description: capture.description,
      url: capture.url,
      createdAt: capture.createdAt,
      startedAt: capture.startedAt,
      durationMs: capture.durationMs,
      source: capture.source,
      environment: capture.environment,
      metadata: capture.metadata,
      analysis: capture.analysis,
      externalIssues: capture.externalIssues
    },
    events: capture.events,
    comments: capture.comments || [],
    artifacts: (capture.artifacts || []).map(({ file, ...a }) => a)
  };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { ok: true, name: 'TraceDeck', version: '0.1.0', storage: 'local', now: new Date().toISOString() });
  }
  if (req.method === 'GET' && pathname === '/api/config') {
    return json(res, 200, {
      publicUrl: config.publicUrl,
      projects: store.listProjects().map(({ key, ...project }) => project),
      features: { ai: Boolean(config.ai.baseUrl && config.ai.apiKey && config.ai.model), localAiFallback: true, recordingLinks: true, webhooks: true, integrations: ['github', 'linear', 'jira', 'slack'], mcp: true, cli: true },
      telemetry: config.telemetry,
      integrationStatus: {
        github: Boolean(config.integrations.githubToken && config.integrations.githubRepo),
        linear: Boolean(config.integrations.linearToken),
        jira: Boolean(config.integrations.jiraBaseUrl && config.integrations.jiraEmail && config.integrations.jiraToken),
        slack: Boolean(config.integrations.slackWebhookUrl)
      }
    });
  }

  if (req.method === 'GET' && pathname === '/api/projects') return json(res, 200, { projects: store.listProjects() });
  if (req.method === 'POST' && pathname === '/api/projects') {
    const body = await readJson(req);
    const project = await store.createProject(body);
    return json(res, 201, { project });
  }

  if (req.method === 'GET' && pathname === '/api/captures') {
    const projectId = url.searchParams.get('projectId');
    const captures = store.listCaptures(projectId).map((c) => ({
      id: c.id, projectId: c.projectId, title: c.title, description: c.description, url: c.url, source: c.source,
      createdAt: c.createdAt, durationMs: c.durationMs, status: c.status,
      eventCount: c.events.length, artifactCount: c.artifacts.length,
      errorCount: c.events.filter((e) => e.type === 'console' && ['error', 'exception'].includes(e.level || e.data?.level)).length,
      failedRequestCount: c.events.filter((e) => e.type === 'network' && (Number(e.data?.status || 0) >= 400 || e.data?.failed)).length
    }));
    return json(res, 200, { captures });
  }

  if (req.method === 'POST' && pathname === '/api/captures') {
    const body = await readJson(req, 20 * 1024 * 1024);
    const project = projectFromRequest(req, body);
    if (!project) return json(res, 401, { error: 'Invalid project key or projectId' });
    const capture = await store.createCapture(body, project.id);
    dispatchWebhook(project.id, 'capture.created', { capture: captureBundle(store.getCapture(capture.id)) }).catch(console.error);
    return json(res, 201, { capture, artifactUpload: `${config.publicUrl}/api/captures/${capture.id}/artifacts` });
  }

  if (req.method === 'POST' && pathname === '/api/captures/import') {
    const contentType = String(req.headers['content-type'] || '');
    let bundle;
    let zipFiles = null;
    if (contentType.includes('zip') || contentType.includes('octet-stream')) {
      let bytes;
      try {
        bytes = await readBody(req, config.maxUploadBytes);
      } catch (err) {
        return json(res, err.statusCode || 400, { error: err.message });
      }
      const zipCheck = validateZip(bytes);
      if (!zipCheck.valid) {
        return json(res, 400, { error: `Invalid ZIP archive: ${zipCheck.errors.join(', ')}` });
      }
      try {
        zipFiles = readStoredZip(bytes);
      } catch (err) {
        return json(res, 400, { error: `Corrupted ZIP archive: ${err.message}` });
      }
      const manifest = zipFiles.get('capture.json');
      if (!manifest) return json(res, 400, { error: 'Trace bundle is missing capture.json' });
      try {
        bundle = JSON.parse(manifest.toString('utf8'));
      } catch {
        return json(res, 400, { error: 'Invalid capture.json in trace bundle' });
      }
    } else {
      try {
        bundle = await readJson(req, 20 * 1024 * 1024);
      } catch (err) {
        return json(res, 400, { error: 'Malformed JSON payload' });
      }
    }

    const validation = validateCaptureBundle(bundle);
    if (!validation.valid) {
      return json(res, 400, { error: `Invalid CaptureBundleV1: ${validation.errors.join('; ')}` });
    }

    const project = projectFromRequest(req, bundle);
    if (!project) return json(res, 401, { error: 'Invalid project' });
    const capture = await store.createCapture({ ...bundle.capture, events: bundle.events, source: 'import' }, project.id);
    if (zipFiles) {
      for (const artifactMeta of bundle.artifacts || []) {
        const bytes = zipFiles.get(`artifacts/${artifactMeta.name}`);
        if (bytes) await store.addArtifact(capture.id, artifactMeta, bytes);
      }
    }
    return json(res, 201, { capture: store.getCapture(capture.id) });
  }

  if (req.method === 'POST' && pathname === '/api/retention') {
    const body = await readJson(req).catch(() => ({}));
    const project = projectFromRequest(req, body);
    if (!project) return json(res, 401, { error: 'Invalid project' });
    const result = await store.applyRetention(body);
    return json(res, 200, result);
  }

  let m = routeMatch(pathname, '/api/captures/:id');
  if (m && req.method === 'GET') {
    const capture = store.getCapture(m.id);
    return capture ? json(res, 200, { capture }) : json(res, 404, { error: 'Capture not found' });
  }
  if (m && req.method === 'PATCH') {
    const body = await readJson(req);
    const capture = await store.updateCapture(m.id, body);
    return capture ? json(res, 200, { capture }) : json(res, 404, { error: 'Capture not found' });
  }
  if (m && req.method === 'DELETE') {
    const deleted = await store.deleteCapture(m.id);
    return deleted ? json(res, 204, null) : json(res, 404, { error: 'Capture not found' });
  }

  m = routeMatch(pathname, '/api/captures/:id/artifacts');
  if (m && req.method === 'POST') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const bytes = await readBody(req, config.maxUploadBytes);
    const artifact = await store.addArtifact(m.id, {
      kind: req.headers['x-artifact-kind'] || url.searchParams.get('kind') || 'attachment',
      name: req.headers['x-artifact-name'] || url.searchParams.get('name') || 'artifact.bin',
      contentType: req.headers['x-artifact-content-type'] || req.headers['content-type'] || 'application/octet-stream'
    }, bytes);
    return json(res, 201, { artifact });
  }

  m = routeMatch(pathname, '/api/captures/:captureId/artifacts/:artifactId');
  if (m && req.method === 'GET') {
    const item = store.artifactPath(m.captureId, m.artifactId);
    if (!item) return json(res, 404, { error: 'Artifact not found' });
    try {
      const bytes = await fs.readFile(item.path);
      return text(res, 200, bytes, item.artifact.contentType, { 'content-disposition': `inline; filename="${item.artifact.name}"`, 'cache-control': 'private, max-age=60' });
    } catch {
      return json(res, 404, { error: 'Artifact file missing' });
    }
  }

  m = routeMatch(pathname, '/api/captures/:id/comments');
  if (m && req.method === 'POST') {
    const comment = await store.addComment(m.id, await readJson(req));
    return comment ? json(res, 201, { comment }) : json(res, 404, { error: 'Capture not found' });
  }

  m = routeMatch(pathname, '/api/captures/:id/share');
  if (m && req.method === 'POST') {
    const share = await store.createShare(m.id, await readJson(req));
    return share ? json(res, 201, { share, url: `${config.publicUrl}/s/${share.token}` }) : json(res, 404, { error: 'Capture not found' });
  }

  m = routeMatch(pathname, '/api/captures/:id/analyze');
  if (m && req.method === 'POST') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const analysis = await analyzeCapture(capture, config.ai);
    await store.updateCapture(m.id, { analysis });
    dispatchWebhook(capture.projectId, 'analysis.completed', { captureId: m.id, analysis }).catch(console.error);
    return json(res, 200, { analysis });
  }

  m = routeMatch(pathname, '/api/captures/:id/triage');
  if (m && req.method === 'GET') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    return json(res, 200, { triage: triageCapture(capture) });
  }

  m = routeMatch(pathname, '/api/captures/:id/har');
  if (m && req.method === 'GET') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    return json(res, 200, captureToHar(capture), { 'content-disposition': `attachment; filename="${m.id}.har"` });
  }

  m = routeMatch(pathname, '/api/captures/:id/playwright');
  if (m && req.method === 'GET') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    return text(res, 200, generatePlaywright(capture), 'text/plain; charset=utf-8', { 'content-disposition': `attachment; filename="${m.id}.spec.ts"` });
  }

  m = routeMatch(pathname, '/api/captures/:id/reproduce');
  if (m && (req.method === 'POST' || req.method === 'GET')) {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const body = req.method === 'POST'
      ? await readJson(req).catch(() => ({}))
      : { checkEndpoints: url.searchParams.get('checkEndpoints') !== 'false' };
    const report = await runReproduction(capture, body);
    return json(res, 200, { reproduction: report });
  }

  m = routeMatch(pathname, '/api/captures/:id/export');
  if (m && req.method === 'GET') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const files = [{ name: 'capture.json', data: JSON.stringify(captureBundle(capture), null, 2) }];
    for (const artifact of capture.artifacts) {
      const item = store.artifactPath(capture.id, artifact.id);
      if (!item) continue;
      try { files.push({ name: `artifacts/${artifact.name}`, data: await fs.readFile(item.path) }); } catch { /* missing file omitted */ }
    }
    const zip = makeZip(files);
    return text(res, 200, zip, 'application/zip', { 'content-disposition': `attachment; filename="${capture.id}.trace.zip"` });
  }

  m = routeMatch(pathname, '/api/captures/:id/issues');
  if (m && req.method === 'POST') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const body = await readJson(req);
    try {
      const issue = await createExternalIssue(body.provider, capture, body.options || {}, config.integrations, config.publicUrl);
      await store.addExternalIssue(m.id, issue);
      dispatchWebhook(capture.projectId, 'issue.created', { captureId: m.id, issue }).catch(console.error);
      return json(res, 201, { issue });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  m = routeMatch(pathname, '/api/captures/:id/mocks');
  if (m && req.method === 'GET') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const format = url.searchParams.get('format') || 'msw';
    if (format === 'fetch') {
      return text(res, 200, generateFetchMock(capture), 'application/javascript; charset=utf-8', { 'content-disposition': `attachment; filename="${m.id}.mock-fetch.js"` });
    }
    return text(res, 200, generateMswHandlers(capture), 'application/javascript; charset=utf-8', { 'content-disposition': `attachment; filename="${m.id}.handlers.js"` });
  }

  m = routeMatch(pathname, '/api/captures/:id/auto-fix');
  if (m && req.method === 'POST') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const body = await readJson(req).catch(() => ({}));
    const autoFix = await dispatchAutoFix(capture, body);
    return json(res, 200, { autoFix });
  }

  m = routeMatch(pathname, '/api/captures/:id/security-probe');
  if (m && req.method === 'POST') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    if (!capture.url || !/^https?:\/\//i.test(capture.url)) {
      return json(res, 400, { error: 'Capture target URL is not a valid HTTP/HTTPS endpoint to probe' });
    }
    const body = await readJson(req).catch(() => ({}));
    const report = await runSecurityProbes(capture.url, body);
    return json(res, 200, { securityProbe: report });
  }

  m = routeMatch(pathname, '/api/captures/:id/symbolicate');
  if (m && req.method === 'POST') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const body = await readJson(req).catch(() => ({}));
    if (!body || !body.stack || !body.sourceMap) {
      return json(res, 400, { error: 'stack and sourceMap fields are required' });
    }
    try {
      const consumer = new SourceMapConsumer(body.sourceMap);
      const symbolicated = symbolicateStackTrace(body.stack, consumer);
      return json(res, 200, { symbolicatedStack: symbolicated });
    } catch (err) {
      return json(res, 400, { error: 'Failed to symbolicate: ' + err.message });
    }
  }

  m = routeMatch(pathname, '/api/captures/:id/schema-drift');
  if (m && req.method === 'POST') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const body = await readJson(req).catch(() => ({}));
    const report = detectCaptureSchemaDrift(capture, body.contracts || {});
    return json(res, 200, { schemaDrift: report });
  }

  m = routeMatch(pathname, '/api/captures/:id/a11y-tree');
  if (m && (req.method === 'POST' || req.method === 'GET')) {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const domSnapshot = (capture.events || []).find(e => e.type === 'dom' && (e.html || e.data?.html)) || null;
    const body = req.method === 'POST' ? await readJson(req).catch(() => ({})) : {};
    const htmlToAnalyze = body.html || domSnapshot?.html || domSnapshot?.data?.html || '<body><main><h1>Page</h1></main></body>';
    const a11y = buildA11yTree(htmlToAnalyze);
    const traps = auditClickTraps(htmlToAnalyze);
    return json(res, 200, { a11y, clickTraps: traps });
  }

  m = routeMatch(pathname, '/api/captures/:id/chaos');
  if (m && req.method === 'GET') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const spec = generateChaosSpec(capture);
    return text(res, 200, spec, 'text/plain; charset=utf-8', { 'content-disposition': `attachment; filename="${m.id}.chaos.spec.ts"` });
  }

  m = routeMatch(pathname, '/api/captures/:id/lineage');
  if (m && req.method === 'GET') {
    const capture = store.getCapture(m.id);
    if (!capture) return json(res, 404, { error: 'Capture not found' });
    const lineage = traceComponentLineage(capture);
    return json(res, 200, { lineage });
  }

  m = routeMatch(pathname, '/api/share/:token');
  if (m && req.method === 'GET') {
    const capture = store.captureForShare(m.token);
    return capture ? json(res, 200, { capture: sanitizeCaptureForShare(capture) }) : json(res, 404, { error: 'Share link not found or expired' });
  }

  if (req.method === 'POST' && pathname === '/api/recording-links') {
    const body = await readJson(req);
    const link = await store.createRecordingLink(body);
    return json(res, 201, { link, url: `${config.publicUrl}/record/${link.token}` });
  }
  if (req.method === 'GET' && pathname === '/api/recording-links') return json(res, 200, { recordingLinks: store.state.recordingLinks });

  m = routeMatch(pathname, '/api/recording-links/:token');
  if (m && req.method === 'GET') {
    const link = store.recordingLinkForToken(m.token);
    return link ? json(res, 200, { link }) : json(res, 404, { error: 'Recording link not found or expired' });
  }

  m = routeMatch(pathname, '/api/recording-links/:token/sessions');
  if (m && req.method === 'POST') {
    const link = store.recordingLinkForToken(m.token);
    if (!link) return json(res, 404, { error: 'Recording link not found or expired' });
    const session = await store.createLiveSession(link);
    return json(res, 201, { session: { token: session.token, expiresAt: session.expiresAt }, targetUrl: link.targetUrl || '' });
  }

  m = routeMatch(pathname, '/api/live-sessions/:token/events');
  if (m && req.method === 'POST') {
    const session = await store.ingestLiveSession(m.token, await readJson(req, 2 * 1024 * 1024));
    return session ? json(res, 202, { ok: true }) : json(res, 404, { error: 'Live session not found or expired' });
  }

  m = routeMatch(pathname, '/api/recording-links/:token/captures');
  if (m && req.method === 'POST') {
    const link = store.recordingLinkForToken(m.token);
    if (!link) return json(res, 404, { error: 'Recording link not found or expired' });
    const body = await readJson(req, 20 * 1024 * 1024);
    const live = body.sessionToken ? store.liveSession(body.sessionToken) : null;
    const liveStart = live?.events?.length ? Math.min(...live.events.map((e) => Number(e.at || Date.now()))) : Date.now();
    const liveEvents = (live?.events || []).map((e) => ({ type: 'app', level: e.level, ts: Math.max(0, Number(e.at || liveStart) - liveStart), data: { kind: e.kind, ...(e.data || {}), sdkUrl: e.url } }));
    const capture = await store.createCapture({ ...body, events: [...(body.events || []), ...liveEvents], source: 'recording-link', environment: { ...(live?.environment || {}), ...(body.environment || {}) }, metadata: { ...(live?.metadata || {}), ...(body.metadata || {}), ...(live?.identity ? { reporterIdentity: live.identity } : {}), recordingLinkId: link.id } }, link.projectId);
    dispatchWebhook(link.projectId, 'recording_link.submitted', { capture: captureBundle(store.getCapture(capture.id)), recordingLinkId: link.id }).catch(console.error);
    return json(res, 201, { capture, artifactUpload: `${config.publicUrl}/api/captures/${capture.id}/artifacts` });
  }

  if (req.method === 'POST' && pathname === '/api/webhooks') {
    const body = await readJson(req);
    if (!/^https?:\/\//i.test(body.url || '')) return json(res, 400, { error: 'Webhook URL must use http or https' });
    const hook = await store.addWebhook(body);
    return json(res, 201, { webhook: hook });
  }
  if (req.method === 'GET' && pathname === '/api/webhooks') {
    return json(res, 200, { webhooks: store.state.webhooks.map(({ secret, ...hook }) => hook), deliveries: store.state.webhookDeliveries.slice(0, 50) });
  }

  if (req.method === 'GET' && pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    const captures = q ? store.listCaptures().filter((c) => JSON.stringify([c.title, c.description, c.url, c.metadata, c.environment]).toLowerCase().includes(q)).slice(0, 50) : [];
    return json(res, 200, { captures });
  }

  if (req.method === 'POST' && pathname === '/api/audit/start') {
    const body = await readJson(req);
    if (!body.url) return json(res, 400, { error: 'Target URL is required' });
    try {
      const audit = await auditEngine.startAudit(body);
      return json(res, 201, { audit });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/audit') {
    return json(res, 200, { audits: auditEngine.listAudits() });
  }

  m = routeMatch(pathname, '/api/audit/:id');
  if (m && req.method === 'GET') {
    const audit = auditEngine.getAudit(m.id);
    return audit ? json(res, 200, { audit }) : json(res, 404, { error: 'Audit run not found' });
  }

  if (req.method === 'POST' && pathname === '/api/audit/diff') {
    const body = await readJson(req);
    if (!body.image1 || !body.image2) {
      return json(res, 400, { error: 'image1 and image2 (base64 PNG strings) are required' });
    }
    try {
      const buf1 = Buffer.from(body.image1.replace(/^data:image\/png;base64,/, ''), 'base64');
      const buf2 = Buffer.from(body.image2.replace(/^data:image\/png;base64,/, ''), 'base64');
      const diffResult = diffPngBuffers(buf1, buf2, { tolerance: body.tolerance || 16 });
      return json(res, 200, {
        match: diffResult.match,
        mismatchCount: diffResult.mismatchCount,
        totalPixels: diffResult.totalPixels,
        mismatchPct: diffResult.mismatchPct,
        boundingBox: diffResult.boundingBox,
        diffImageBase64: 'data:image/png;base64,' + diffResult.diffPng.toString('base64')
      });
    } catch (err) {
      return json(res, 400, { error: 'Failed to compute diff: ' + err.message });
    }
  }

  return json(res, 404, { error: 'API route not found' });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  securityHeaders(res);
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url, config.publicUrl);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/sdk/tracedeck.js') return await serveFile(res, sdkFile, { 'access-control-allow-origin': '*' });
    if (url.pathname.startsWith('/s/')) {
      const tokenValue = url.pathname.split('/')[2];
      res.writeHead(302, { location: `/app/?share=${encodeURIComponent(tokenValue)}` });
      return res.end();
    }
    if (url.pathname.startsWith('/record/')) return await serveFile(res, path.join(webDir, 'record.html'));
    if (url.pathname === '/' || url.pathname === '/app' || url.pathname === '/app/') return await serveFile(res, path.join(webDir, 'index.html'));
    if (url.pathname.startsWith('/app/')) {
      const rel = url.pathname.slice('/app/'.length);
      const resolved = path.resolve(webDir, rel);
      if (!resolved.startsWith(webDir + path.sep)) return json(res, 403, { error: 'Forbidden' });
      return await serveFile(res, resolved);
    }
    return json(res, 404, { error: 'Not found', app: `${config.publicUrl}/app/` });
  } catch (error) {
    if (process.env.TRACEDECK_DEV) console.error(error);
    return json(res, error.statusCode || 500, { error: error.message || 'Internal server error' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(config.port, config.host, () => {
    console.log(`TraceDeck running at ${config.publicUrl}/app/`);
    console.log(`Default project key: ${store.listProjects()[0]?.key}`);
  });
}

export { server, store };
