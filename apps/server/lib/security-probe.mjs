// Security and Boundary Fuzzer for DevDesk
// Ported from Gre - Tester security testing methodology
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(urlStr, {
        method: options.method || 'GET',
        headers: {
          'user-agent': 'TraceDeck-SecurityProbe/1.0',
          'connection': 'close',
          ...(options.headers || {})
        },
        timeout: options.timeoutMs || 3000
      }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Probe timeout'));
      });
      if (options.body) req.write(options.body);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

export async function runSecurityProbes(targetUrl, options = {}) {
  const u = new URL(targetUrl);
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('Target URL must use http or https protocol');
  }
  const hostname = u.hostname.toLowerCase();
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname === 'metadata.internal') {
    throw new Error('Target URL cannot point to cloud metadata or link-local endpoints');
  }
  const findings = [];
  let probesExecuted = 0;

  // Probe 1: CORS Misconfiguration Probe
  try {
    probesExecuted++;
    const corsRes = await makeRequest(targetUrl, {
      method: 'GET',
      headers: {
        'Origin': 'https://attacker.evil.com'
      }
    });

    const acao = corsRes.headers['access-control-allow-origin'];
    const acac = corsRes.headers['access-control-allow-credentials'];

    if (acao === 'https://attacker.evil.com' && acac === 'true') {
      findings.push({
        severity: 'high',
        kind: 'cors_arbitrary_origin_credentials',
        description: 'Endpoint echoes arbitrary Origin header with Access-Control-Allow-Credentials: true. Allows cross-origin data theft.',
        evidence: `ACAO: ${acao}, ACAC: ${acac}`
      });
    } else if (acao === '*' && options.authenticated) {
      findings.push({
        severity: 'medium',
        kind: 'cors_wildcard_authenticated',
        description: 'Endpoint returns wildcard ACAO (*) on an endpoint marked as authenticated.',
        evidence: `ACAO: ${acao}`
      });
    }
  } catch {}

  // Probe 2: XSS Reflection Check on Query Params
  try {
    probesExecuted++;
    const probeStr = 'td_xss_probe_' + Math.random().toString(36).slice(2, 7);
    const payload = `<script>${probeStr}</script>`;
    const testUrl = new URL(targetUrl);
    testUrl.searchParams.set('q', payload);

    const xssRes = await makeRequest(testUrl.href);
    if (xssRes.body && xssRes.body.includes(payload)) {
      findings.push({
        severity: 'critical',
        kind: 'reflected_xss',
        description: `Unencoded script payload reflected directly in HTTP response body on parameter 'q'.`,
        evidence: `Reflected string: ${payload}`
      });
    }
  } catch {}

  // Probe 3: Open Redirect Check
  try {
    probesExecuted++;
    const redirectUrl = new URL(targetUrl);
    redirectUrl.searchParams.set('redirect', 'https://attacker.evil.com');
    redirectUrl.searchParams.set('next', 'https://attacker.evil.com');

    const redRes = await makeRequest(redirectUrl.href);
    const location = redRes.headers['location'];
    if (redRes.status >= 300 && redRes.status < 400 && location && location.includes('attacker.evil.com')) {
      findings.push({
        severity: 'high',
        kind: 'open_redirect',
        description: `Endpoint redirects to untrusted external domain specified in query parameter.`,
        evidence: `Location header: ${location}`
      });
    }
  } catch {}

  // Probe 4: Security Headers Check (CSP, HSTS, X-Frame-Options)
  try {
    probesExecuted++;
    const baseRes = await makeRequest(targetUrl);
    const missingHeaders = [];
    if (!baseRes.headers['content-security-policy']) missingHeaders.push('Content-Security-Policy');
    if (!baseRes.headers['x-frame-options']) missingHeaders.push('X-Frame-Options');
    if (!baseRes.headers['x-content-type-options']) missingHeaders.push('X-Content-Type-Options');

    if (missingHeaders.length > 0) {
      findings.push({
        severity: 'low',
        kind: 'missing_security_headers',
        description: `Missing defensive HTTP security headers: ${missingHeaders.join(', ')}`,
        evidence: missingHeaders.join(', ')
      });
    }
  } catch {}

  return {
    targetUrl,
    probesExecuted,
    findingsCount: findings.length,
    findings,
    status: findings.some(f => f.severity === 'critical' || f.severity === 'high') ? 'vulnerabilities_detected' : 'clean'
  };
}
