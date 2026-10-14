// Autonomous UI Audit & Exploration Engine for DevDesk
// Integrates Arc - UI Audit Studio crawling, control inventory, and automated bug discovery
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { diffPngBuffers } from './diff.mjs';

function fetchPage(targetUrl, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(targetUrl);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.get(targetUrl, {
        headers: { 'user-agent': 'TraceDeck-AuditEngine/2.0', 'connection': 'close' },
        timeout: timeoutMs
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout fetching ${targetUrl}`));
      });
    } catch (err) {
      reject(err);
    }
  });
}

function extractControlsAndLinks(html, baseUrl) {
  const links = new Set();
  const controls = [];
  const origin = new URL(baseUrl).origin;

  // Extract <a href="...">
  const aRegex = /<a\s+([^>]*?)href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  let match;
  while ((match = aRegex.exec(html)) !== null) {
    const rawHref = match[2].trim();
    const text = match[3].replace(/<[^>]+>/g, '').trim();
    try {
      const resolved = new URL(rawHref, baseUrl);
      if (resolved.origin === origin && !resolved.pathname.match(/\.(png|jpg|jpeg|gif|svg|css|js|ico)$/i)) {
        links.add(resolved.href.split('#')[0]);
      }
      controls.push({
        type: 'link',
        label: text || rawHref,
        href: resolved.href,
        sameOrigin: resolved.origin === origin
      });
    } catch {}
  }

  // Extract <button>
  const btnRegex = /<button\s*([^>]*)>(.*?)<\/button>/gis;
  while ((match = btnRegex.exec(html)) !== null) {
    const attrs = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    const isSubmit = /type=["']submit["']/i.test(attrs);
    controls.push({
      type: 'button',
      label: text || 'Button',
      subType: isSubmit ? 'submit' : 'button'
    });
  }

  // Extract <input>, <select>, <textarea>
  const inputRegex = /<(input|select|textarea)\s+([^>]*?)>/gis;
  while ((match = inputRegex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const nameMatch = attrs.match(/name=["']([^"']+)["']/i);
    const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
    controls.push({
      type: tag,
      name: nameMatch ? nameMatch[1] : undefined,
      inputType: typeMatch ? typeMatch[1] : (tag === 'input' ? 'text' : tag)
    });
  }

  return { links: Array.from(links), controls };
}

function isSafeAuditUrl(targetUrl) {
  try {
    const u = new URL(targetUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const hostname = u.hostname.toLowerCase();
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname === 'metadata.internal') return false;
    return true;
  } catch {
    return false;
  }
}

export class AuditEngine {
  constructor(store) {
    this.store = store;
    this.audits = new Map();
  }

  listAudits() {
    return Array.from(this.audits.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  getAudit(id) {
    return this.audits.get(id) || null;
  }

  async startAudit(options = {}) {
    const url = options.url;
    if (!url) throw new Error('Target URL is required for audit');
    if (!isSafeAuditUrl(url)) throw new Error('Invalid or restricted target URL for audit');

    const id = 'aud_' + Date.now().toString(36);
    const audit = {
      id,
      url,
      status: 'running',
      startedAt: Date.now(),
      completedAt: null,
      maxRoutes: Math.min(Number(options.maxRoutes) || 15, 50),
      policy: options.policy || 'safe_exploration',
      routesCrawled: [],
      controlsDiscovered: 0,
      errorsFound: [],
      capturesCreated: [],
      summary: null
    };

    this.audits.set(id, audit);

    // Asynchronously execute crawl
    this._runCrawl(audit, options).catch(err => {
      audit.status = 'failed';
      audit.error = err.message;
      audit.completedAt = Date.now();
    });

    return audit;
  }

  async _runCrawl(audit, options) {
    const queue = [audit.url];
    const visited = new Set();
    const origin = new URL(audit.url).origin;

    while (queue.length > 0 && visited.size < audit.maxRoutes) {
      const currentUrl = queue.shift();
      if (visited.has(currentUrl)) continue;
      visited.add(currentUrl);

      const routeRecord = {
        url: currentUrl,
        status: null,
        controlsCount: 0,
        linksCount: 0,
        errors: []
      };

      try {
        const res = await fetchPage(currentUrl);
        routeRecord.status = res.status;

        if (res.status >= 400) {
          const errItem = {
            url: currentUrl,
            kind: 'http_error',
            status: res.status,
            message: `HTTP error ${res.status} encountered on ${currentUrl}`
          };
          routeRecord.errors.push(errItem);
          audit.errorsFound.push(errItem);

          // Auto-generate TraceDeck capture bundle for this error!
          if (this.store) {
            const capture = await this.store.createCapture({
              title: `[Audit Failure] HTTP ${res.status} at ${new URL(currentUrl).pathname}`,
              description: `Automated audit detected an HTTP error status ${res.status} when crawling ${currentUrl}.`,
              url: currentUrl,
              source: 'audit-studio',
              events: [
                {
                  id: 'evt_aud_1',
                  type: 'action',
                  kind: 'action:navigate',
                  url: currentUrl,
                  offsetMs: 0
                },
                {
                  id: 'evt_aud_2',
                  type: 'network',
                  method: 'GET',
                  url: currentUrl,
                  status: res.status,
                  offsetMs: 150
                },
                {
                  id: 'evt_aud_3',
                  type: 'console',
                  level: 'error',
                  text: `Failed to load resource: the server responded with a status of ${res.status}`,
                  offsetMs: 200
                }
              ]
            });
            audit.capturesCreated.push({ captureId: capture.id, url: currentUrl, status: res.status });
          }
        } else {
          // Parse HTML for links and interactive controls
          const { links, controls } = extractControlsAndLinks(res.body, currentUrl);
          routeRecord.controlsCount = controls.length;
          routeRecord.linksCount = links.length;
          audit.controlsDiscovered += controls.length;

          for (const link of links) {
            if (!visited.has(link) && !queue.includes(link) && queue.length < (audit.maxRoutes * 2)) {
              queue.push(link);
            }
          }
        }
      } catch (err) {
        routeRecord.status = 'network_error';
        const errItem = {
          url: currentUrl,
          kind: 'network_failure',
          message: err.message
        };
        routeRecord.errors.push(errItem);
        audit.errorsFound.push(errItem);

        if (this.store) {
          const capture = await this.store.createCapture({
            title: `[Audit Failure] Network Failure at ${new URL(currentUrl).pathname}`,
            description: `Audit crawler failed to connect: ${err.message}`,
            url: currentUrl,
            source: 'audit-studio',
            events: [
              { id: 'evt_1', type: 'action', kind: 'action:navigate', url: currentUrl, offsetMs: 0 },
              { id: 'evt_2', type: 'console', level: 'error', text: err.message, offsetMs: 100 }
            ]
          });
          audit.capturesCreated.push({ captureId: capture.id, url: currentUrl, error: err.message });
        }
      }

      audit.routesCrawled.push(routeRecord);
    }

    audit.status = 'completed';
    audit.completedAt = Date.now();
    audit.summary = {
      totalRoutes: audit.routesCrawled.length,
      totalControls: audit.controlsDiscovered,
      errorsFound: audit.errorsFound.length,
      capturesGenerated: audit.capturesCreated.length,
      durationMs: audit.completedAt - audit.startedAt
    };
  }
}
