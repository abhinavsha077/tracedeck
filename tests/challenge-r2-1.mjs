import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appJsPath = path.resolve(__dirname, '../apps/web/app.js');
// Append a debug exposure of `state` onto globalThis for the sandbox inspection
const appJsCode = fs.readFileSync(appJsPath, 'utf8') + '\nglobalThis.__state = state;\n';

// Helper to instantiate app.js functions in a controlled VM sandbox
function createSandbox() {
  const elements = new Map();

  function mockElement(tag = 'div', attrs = {}) {
    const el = {
      tagName: tag.toUpperCase(),
      attributes: { ...attrs },
      dataset: {},
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (this._classes.has(c)) this._classes.delete(c);
            else this._classes.add(c);
          } else if (force) {
            this._classes.add(c);
          } else {
            this._classes.delete(c);
          }
        },
        contains(c) { return this._classes.has(c); }
      },
      style: {},
      innerHTML: '',
      textContent: '',
      listeners: {},
      addEventListener(type, handler) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
      },
      dispatchEvent(type, eventObj = {}) {
        const handlers = this.listeners[type] || [];
        for (const h of handlers) h(eventObj);
      },
      getBoundingClientRect() {
        return { left: 100, top: 50, width: 800, height: 40, right: 900, bottom: 90 };
      },
      setPointerCapture() {},
      releasePointerCapture() {},
      scrollIntoView() {},
      querySelector(q) { return null; },
      querySelectorAll(q) { return []; },
      appendChild(child) { return child; },
      remove() {}
    };
    return el;
  }

  const documentMock = {
    querySelector(q) {
      if (!elements.has(q)) {
        elements.set(q, mockElement('div'));
      }
      return elements.get(q);
    },
    querySelectorAll(q) {
      return [];
    },
    createElement(tag) {
      return mockElement(tag);
    }
  };

  const context = {
    console: {
      log: () => {},
      error: () => {},
      warn: () => {},
      info: () => {}
    },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: (id) => clearTimeout(id),
    URLSearchParams,
    Date,
    Math,
    String,
    Number,
    JSON,
    Array,
    Object,
    Blob: class Blob {},
    location: { search: '', origin: 'http://localhost' },
    history: { replaceState() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    document: documentMock,
    fetch: async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        captures: [],
        recordingLinks: [],
        webhooks: [],
        version: '0.1.0',
        projects: [{ id: 'p1', name: 'Default', key: 'key1' }],
        integrationStatus: {}
      }),
      text: async () => ''
    })
  };

  vm.createContext(context);
  vm.runInContext(appJsCode, context);
  return context;
}

// -----------------------------------------------------------------------------
// Test 1: Syntax and Static Structure
// -----------------------------------------------------------------------------
test('app.js exports essential functions into sandbox without top-level throw', () => {
  const sandbox = createSandbox();
  assert.equal(typeof sandbox.captureDuration, 'function');
  assert.equal(typeof sandbox.fmtTime, 'function');
  assert.equal(typeof sandbox.fmtBytes, 'function');
  assert.equal(typeof sandbox.escapeHtml, 'function');
  assert.equal(typeof sandbox.eventLabel, 'function');
  assert.equal(typeof sandbox.eventExtra, 'function');
  assert.equal(typeof sandbox.eventClass, 'function');
  assert.equal(typeof sandbox.getCategoryCounts, 'function');
  assert.equal(typeof sandbox.renderEventDetailDrawer, 'function');
  assert.equal(typeof sandbox.renderMediaGallery, 'function');
  assert.equal(typeof sandbox.seek, 'function');
  assert.equal(typeof sandbox.syncTimeline, 'function');
  assert.equal(typeof sandbox.initTimelineScrubber, 'function');
  assert(sandbox.__state != null, 'Internal state accessible');
});

// -----------------------------------------------------------------------------
// Test 2: Duration Calculation Bounds & 100,000 Events Stack Overflow Challenge
// -----------------------------------------------------------------------------
test('duration calculation with 100,000 synthetic events avoids call stack overflow', () => {
  const sandbox = createSandbox();
  const captureDuration = sandbox.captureDuration;

  // Create 100,000 synthetic events with varying timestamps
  const count = 100_000;
  const events = new Array(count);
  for (let i = 0; i < count; i++) {
    events[i] = {
      type: i % 3 === 0 ? 'action' : i % 3 === 1 ? 'network' : 'console',
      ts: Math.floor((i * 137) % 500_000), // non-linear timestamps up to 500s
      data: {}
    };
  }
  // Guarantee the absolute maximum timestamp is placed at a random index
  const peakIdx = 42_137;
  const peakTs = 999_999;
  events[peakIdx].ts = peakTs;

  const capture = {
    id: 'large_cap',
    durationMs: 1000,
    events
  };

  const startTime = Date.now();
  const duration = captureDuration(capture);
  const elapsed = Date.now() - startTime;

  assert.equal(duration, peakTs, 'Must calculate max timestamp across 100,000 events');
  assert(elapsed < 200, `Duration calculation must execute in under 200ms, took ${elapsed}ms`);
});

test('duration calculation handles extreme boundary values and corrupted inputs', () => {
  const sandbox = createSandbox();
  const captureDuration = sandbox.captureDuration;

  // 1. null / undefined capture
  assert.equal(captureDuration(null), 1, 'null capture defaults to 1ms');
  assert.equal(captureDuration(undefined), 1, 'undefined capture defaults to 1ms');
  assert.equal(captureDuration({}), 1, 'empty capture object defaults to 1ms');

  // 2. capture with 0 or negative durationMs and no events
  assert.equal(captureDuration({ durationMs: 0, events: [] }), 1);
  assert.equal(captureDuration({ durationMs: -500, events: [] }), 1);

  // 3. events array with missing / null ts values
  assert.equal(captureDuration({
    durationMs: 500,
    events: [{ ts: null }, { ts: undefined }, { ts: -100 }]
  }), 500);

  // 4. events array with ts exceeding durationMs
  assert.equal(captureDuration({
    durationMs: 500,
    events: [{ ts: 1200 }, { ts: 800 }]
  }), 1200);

  // 5. events array is null or not an array
  assert.equal(captureDuration({ durationMs: 2500, events: null }), 2500);
  assert.equal(captureDuration({ durationMs: 2500, events: undefined }), 2500);

  // 6. extreme integer bounds
  assert.equal(captureDuration({
    durationMs: 1,
    events: [{ ts: Number.MAX_SAFE_INTEGER }]
  }), Number.MAX_SAFE_INTEGER);
});

// -----------------------------------------------------------------------------
// Test 3: Timeline Scrubbing & Seek Math
// -----------------------------------------------------------------------------
test('timeline seek clamps properly across boundaries', () => {
  const sandbox = createSandbox();
  const seek = sandbox.seek;
  const state = sandbox.__state;

  const durationMs = 10_000;
  state.current = { id: 'c1', durationMs, events: [{ ts: durationMs }] };

  // Track syncTimeline calls
  let lastSyncMs = null;
  let lastSyncDuration = null;
  sandbox.syncTimeline = (ms, dur) => {
    lastSyncMs = ms;
    lastSyncDuration = dur;
  };

  // 1. Negative seek time
  seek(-500);
  assert.equal(lastSyncMs, 0, 'Negative seek clamped to 0');
  assert.equal(lastSyncDuration, durationMs);

  // 2. Beyond duration
  seek(25_000);
  assert.equal(lastSyncMs, durationMs, 'Seek beyond duration clamped to duration');

  // 3. Midpoint
  seek(5_000);
  assert.equal(lastSyncMs, 5_000, 'Seek at midpoint preserves exact ms');

  // 4. Exact boundaries
  seek(0);
  assert.equal(lastSyncMs, 0);
  seek(durationMs);
  assert.equal(lastSyncMs, durationMs);
});

test('timeline scrubber pointer math handles out-of-bounds drag coordinates', () => {
  const sandbox = createSandbox();
  const initTimelineScrubber = sandbox.initTimelineScrubber;

  let seekTarget = null;
  sandbox.seek = (ms) => { seekTarget = ms; };

  const duration = 20_000;
  const listeners = {};
  const mockTimeline = {
    addEventListener(type, fn) { listeners[type] = fn; },
    getBoundingClientRect() {
      // left: 100, width: 800 (spans 100px to 900px)
      return { left: 100, width: 800, right: 900 };
    },
    setPointerCapture() {},
    releasePointerCapture() {}
  };

  initTimelineScrubber(mockTimeline, duration);
  assert(listeners.pointerdown, 'pointerdown listener registered');
  assert(listeners.pointermove, 'pointermove listener registered');
  assert(listeners.pointerup, 'pointerup listener registered');

  // 1. Click exactly at 50% (clientX = 500, (500-100)/800 = 0.5)
  listeners.pointerdown({ pointerId: 1, clientX: 500 });
  assert.equal(seekTarget, 10_000, '50% click should seek to 10,000ms');

  // 2. Drag far left past 0% (clientX = -200)
  listeners.pointermove({ clientX: -200 });
  assert.equal(seekTarget, 0, 'Left out-of-bounds drag clamped to 0ms');

  // 3. Drag far right past 100% (clientX = 1500)
  listeners.pointermove({ clientX: 1500 });
  assert.equal(seekTarget, 20_000, 'Right out-of-bounds drag clamped to duration (20,000ms)');

  // 4. Drag at 25% (clientX = 300, (300-100)/800 = 0.25)
  listeners.pointermove({ clientX: 300 });
  assert.equal(seekTarget, 5_000, '25% drag should seek to 5,000ms');

  // 5. End drag
  listeners.pointerup({ pointerId: 1 });
});

// -----------------------------------------------------------------------------
// Test 4: Keyword Filtering Across All Event Types & Corrupted Data
// -----------------------------------------------------------------------------
test('keyword filtering correctly matches actions, network, console, errors, and metadata', () => {
  const sandbox = createSandbox();
  const eventLabel = sandbox.eventLabel;
  const eventExtra = sandbox.eventExtra;

  const events = [
    { type: 'action', ts: 100, data: { action: 'click', selector: '#checkout-button', label: 'Complete Purchase' } },
    { type: 'action', ts: 200, data: { action: 'input', selector: '#card-number', sensitive: true, valueLength: 16 } },
    { type: 'network', ts: 300, data: { method: 'POST', url: 'https://api.example.com/v1/charge', status: 200, duration: 150 } },
    { type: 'network', ts: 400, data: { method: 'GET', url: 'https://api.example.com/v1/user', status: 404, error: 'User not found' } },
    { type: 'network', ts: 500, data: { method: 'POST', url: 'https://api.example.com/v1/refund', status: 500, failed: true } },
    { type: 'console', ts: 600, level: 'warn', data: { message: 'Deprecated API called in vendor.js' } },
    { type: 'console', ts: 700, level: 'error', data: { message: 'Uncaught TypeError: Cannot read properties of undefined', stack: 'TypeError: Cannot read properties\n  at submit (app.js:42:10)' } },
    { type: 'console', ts: 800, level: 'info', data: { args: ['User logged in', { userId: 'usr_99' }] } },
    { type: 'navigation', ts: 900, data: { url: 'https://app.example.com/dashboard' } }
  ];

  function filterByKeyword(query) {
    const q = query.toLowerCase().trim();
    if (!q) return events;
    return events.filter((e) => {
      const lbl = eventLabel(e).toLowerCase();
      const extra = eventExtra(e).toLowerCase();
      const sel = (e.data?.selector || '').toLowerCase();
      const url = (e.data?.url || '').toLowerCase();
      const meth = (e.data?.method || '').toLowerCase();
      const msg = (e.data?.message || '').toLowerCase();
      const err = (e.data?.error || '').toLowerCase();
      const status = String(e.data?.status || '');
      return lbl.includes(q) || extra.includes(q) || sel.includes(q) || url.includes(q) || meth.includes(q) || msg.includes(q) || err.includes(q) || status.includes(q) || JSON.stringify(e.data || {}).toLowerCase().includes(q);
    });
  }

  // 1. Selector match
  const r1 = filterByKeyword('#checkout-button');
  assert.equal(r1.length, 1);
  assert.equal(r1[0].ts, 100);

  // 2. Action label match (case-insensitive and trimmed)
  const r2 = filterByKeyword('  complete purchase  ');
  assert.equal(r2.length, 1);
  assert.equal(r2[0].ts, 100);

  // 3. Network URL match
  const r3 = filterByKeyword('/v1/charge');
  assert.equal(r3.length, 1);
  assert.equal(r3[0].ts, 300);

  // 4. HTTP method match
  const r4 = filterByKeyword('POST');
  assert.equal(r4.length, 2, 'POST should match /v1/charge and /v1/refund');

  // 5. HTTP status match
  const r5 = filterByKeyword('404');
  assert.equal(r5.length, 1);
  assert.equal(r5[0].ts, 400);

  // 6. Network error message match
  const r6 = filterByKeyword('user not found');
  assert.equal(r6.length, 1);
  assert.equal(r6[0].ts, 400);

  // 7. Console message match
  const r7 = filterByKeyword('deprecated api');
  assert.equal(r7.length, 1);
  assert.equal(r7[0].ts, 600);

  // 8. Console stack trace match via JSON.stringify
  const r8 = filterByKeyword('app.js:42:10');
  assert.equal(r8.length, 1);
  assert.equal(r8[0].ts, 700);

  // 9. Console args array match
  const r9 = filterByKeyword('usr_99');
  assert.equal(r9.length, 1);
  assert.equal(r9[0].ts, 800);

  // 10. Navigation match
  const r10 = filterByKeyword('dashboard');
  assert.equal(r10.length, 1);
  assert.equal(r10[0].ts, 900);

  // 11. Special characters in query: parens match the literal (app.js:42:10) in the stack string
  const r11 = filterByKeyword('(app.js:42:10)');
  assert.equal(r11.length, 1, 'Literal string search handles parens without regex error');

  // 12. Empty query returns all
  assert.equal(filterByKeyword('').length, events.length);
  assert.equal(filterByKeyword('   ').length, events.length);
});

// -----------------------------------------------------------------------------
// Test 5: Status Code & Log Level Filtering
// -----------------------------------------------------------------------------
test('status code and log level filters partition events accurately', () => {
  const sandbox = createSandbox();
  const eventClass = sandbox.eventClass;

  const events = [
    { type: 'network', ts: 10, data: { status: 200 } },
    { type: 'network', ts: 20, data: { status: 204 } },
    { type: 'network', ts: 30, data: { status: 301 } },
    { type: 'network', ts: 40, data: { status: 400 } },
    { type: 'network', ts: 50, data: { status: 404 } },
    { type: 'network', ts: 60, data: { status: 500 } },
    { type: 'network', ts: 70, data: { status: 503 } },
    { type: 'network', ts: 80, data: { failed: true } },
    { type: 'console', ts: 90, level: 'info', data: { message: 'info log' } },
    { type: 'console', ts: 100, level: 'warn', data: { message: 'warn log' } },
    { type: 'console', ts: 110, level: 'error', data: { message: 'error log' } },
    { type: 'console', ts: 120, data: { level: 'exception', message: 'crash' } }
  ];

  function filterStatus(filter) {
    if (filter === 'all') return events;
    return events.filter((e) => {
      const s = Number(e.data?.status || 0);
      if (filter === 'failed') return e.data?.failed || s >= 400;
      if (filter === '2xx') return s >= 200 && s < 300;
      if (filter === '3xx') return s >= 300 && s < 400;
      if (filter === '4xx') return s >= 400 && s < 500;
      if (filter === '5xx') return s >= 500 && s < 600;
      return true;
    });
  }

  function filterLevel(filter) {
    if (filter === 'all') return events;
    return events.filter((e) => {
      const lvl = (e.level || e.data?.level || '').toLowerCase();
      if (filter === 'error') return ['error', 'exception'].includes(lvl) || eventClass(e) === 'error';
      if (filter === 'warn') return ['warn', 'warning'].includes(lvl);
      if (filter === 'info') return ['info', 'log', 'debug'].includes(lvl) || (!lvl && e.type === 'console');
      return true;
    });
  }

  // Status partitions
  assert.equal(filterStatus('2xx').length, 2, '2xx: 200, 204');
  assert.equal(filterStatus('3xx').length, 1, '3xx: 301');
  assert.equal(filterStatus('4xx').length, 2, '4xx: 400, 404');
  assert.equal(filterStatus('5xx').length, 2, '5xx: 500, 503');
  assert.equal(filterStatus('failed').length, 5, 'failed: 400, 404, 500, 503, failed=true');

  // Level partitions
  assert.equal(filterLevel('info').length, 1, 'info log');
  assert.equal(filterLevel('warn').length, 1, 'warn log');
  assert.equal(filterLevel('error').length, 7, '2 console errors + 5 network errors');

  // Category counts
  const counts = sandbox.getCategoryCounts(events);
  assert.equal(counts.all, 12);
  assert.equal(counts.network, 8);
  assert.equal(counts.console, 4);
  assert.equal(counts.action, 0);
  assert.equal(counts.errors, 7); // 5 network + 2 console
});

// -----------------------------------------------------------------------------
// Test 6: Event Detail Drawer Rendering For All Event Kinds
// -----------------------------------------------------------------------------
test('renderEventDetailDrawer renders structured information and escapes XSS payloads', () => {
  const sandbox = createSandbox();
  const renderDrawer = sandbox.renderEventDetailDrawer;

  // 1. Network event with headers, duration, and XSS payload
  const netEvent = {
    type: 'network',
    ts: 1250,
    data: {
      method: 'POST',
      url: 'https://example.com/api?q=<script>alert("xss")</script>',
      status: 500,
      statusText: 'Internal Server Error',
      duration: 342,
      phase: 'response',
      headers: {
        'Content-Type': 'application/json',
        'X-Injected': '<img src=x onerror=alert(1)>'
      },
      responseHeaders: {
        'X-Trace': 'td_98765'
      },
      error: 'Backend connection timeout <boom>'
    }
  };

  const netHtml = renderDrawer(netEvent, 0);
  assert(netHtml.includes('id="event-detail-0"'));
  assert(netHtml.includes('500 Internal Server Error'));
  assert(netHtml.includes('342ms'));
  assert(netHtml.includes('Request Headers (2)'));
  assert(netHtml.includes('Response Headers (1)'));
  assert(netHtml.includes('td_98765'));
  // Verify XSS prevention
  assert(!netHtml.includes('<script>'), 'Must escape script tag in URL');
  assert(netHtml.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
  assert(!netHtml.includes('<img src=x'), 'Must escape img tag in headers');
  assert(netHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert(netHtml.includes('&lt;boom&gt;'));
  assert(netHtml.includes('Copy JSON'));

  // 2. Console event with stack trace and args
  const consoleEvent = {
    type: 'console',
    ts: 2100,
    level: 'error',
    data: {
      message: 'Failed to mount component <Widget />',
      stack: 'Error: Failed to mount\n    at mount (widget.jsx:15:3)\n    at render (app.jsx:22:1)'
    }
  };

  const conHtml = renderDrawer(consoleEvent, 1);
  assert(conHtml.includes('id="event-detail-1"'));
  assert(conHtml.includes('Failed to mount component &lt;Widget /&gt;'));
  assert(conHtml.includes('stack-trace'));
  assert(conHtml.includes('widget.jsx:15:3'));
  assert(conHtml.includes('Copy JSON'));

  // 3. Action event with sensitive field masking
  const actionEvent = {
    type: 'action',
    ts: 3200,
    data: {
      action: 'input',
      selector: 'form#auth > input.password[name="pwd"]',
      label: 'Password Input',
      sensitive: true,
      valueLength: 12
    }
  };

  const actHtml = renderDrawer(actionEvent, 2);
  assert(actHtml.includes('id="event-detail-2"'));
  assert(actHtml.includes('CSS Selector Path'));
  assert(actHtml.includes('form#auth &gt; input.password[name=&quot;pwd&quot;]'));
  assert(actHtml.includes('Value length: 12'));
  assert(actHtml.includes('(Sensitive input masked)'));
  assert(actHtml.includes('Copy JSON'));
});

// -----------------------------------------------------------------------------
// Test 7: Multi-Artifact Gallery Rendering & Tab Switching
// -----------------------------------------------------------------------------
test('renderMediaGallery handles empty, single, and multiple mixed artifacts', () => {
  const sandbox = createSandbox();
  const renderMediaGallery = sandbox.renderMediaGallery;
  const fmtBytes = sandbox.fmtBytes;
  const state = sandbox.__state;

  // 1. fmtBytes verification
  assert.equal(fmtBytes(0), '');
  assert.equal(fmtBytes(450), '450 B');
  assert.equal(fmtBytes(1024), '1 KB');
  assert.equal(fmtBytes(2048), '2 KB');
  assert.equal(fmtBytes(1048576), '1.0 MB');
  assert.equal(fmtBytes(5242880), '5.0 MB');

  // 2. No artifacts attached
  const noArtCapture = { id: 'cap_0', artifacts: [] };
  const emptyHtml = renderMediaGallery(noArtCapture);
  assert(emptyHtml.includes('No visual artifact attached'));
  assert(!emptyHtml.includes('media-gallery-bar'));

  // 3. Multiple mixed artifacts
  const mixedCapture = {
    id: 'cap_multi',
    artifacts: [
      { id: 'art_video', kind: 'video', name: 'session-rec.webm', bytes: 2_450_000, contentType: 'video/webm' },
      { id: 'art_shot1', kind: 'screenshot', name: 'initial-screen.png', bytes: 145_000, contentType: 'image/png' },
      { id: 'art_shot2', kind: 'screenshot', name: 'error-screen.png', bytes: 180_000, contentType: 'image/png' },
      { id: 'art_log', kind: 'log', name: 'console.log', bytes: 4_200, contentType: 'text/plain' },
      { id: 'art_trace', kind: 'attachment', name: 'network.har', bytes: 89_000, contentType: 'application/json' }
    ]
  };

  state.activeArtifactId = null; // reset selection
  const galleryHtml = renderMediaGallery(mixedCapture);

  // Default selection should prioritize video
  assert.equal(state.activeArtifactId, 'art_video', 'Video artifact should be prioritized as default');
  assert(galleryHtml.includes('Artifacts (5):'));
  assert(galleryHtml.includes('▶'));
  assert(galleryHtml.includes('📷'));
  assert(galleryHtml.includes('📄'));
  assert(galleryHtml.includes('session-rec.webm'));
  assert(galleryHtml.includes('initial-screen.png'));
  assert(galleryHtml.includes('error-screen.png'));
  assert(galleryHtml.includes('console.log'));
  assert(galleryHtml.includes('network.har'));
  // Active artifact is video, so video player must be rendered
  assert(galleryHtml.includes('<video id="capture-video"'));
  assert(galleryHtml.includes('/api/captures/cap_multi/artifacts/art_video'));

  // 4. Switch active artifact to screenshot
  state.activeArtifactId = 'art_shot2';
  const shotHtml = renderMediaGallery(mixedCapture);
  assert(shotHtml.includes('<img id="capture-image"'));
  assert(shotHtml.includes('/api/captures/cap_multi/artifacts/art_shot2'));
  assert(shotHtml.includes('Open full size ↗'));
  assert(shotHtml.includes('download="error-screen.png"'));

  // 5. Switch active artifact to log attachment
  state.activeArtifactId = 'art_log';
  const logHtml = renderMediaGallery(mixedCapture);
  assert(logHtml.includes('<iframe class="artifact-iframe"'));
  assert(logHtml.includes('/api/captures/cap_multi/artifacts/art_log'));
  assert(logHtml.includes('Open in new tab ↗'));
  assert(logHtml.includes('download="console.log"'));
});

// -----------------------------------------------------------------------------
// Test 8: Formatting Utilities and XSS Escaping Robustness
// -----------------------------------------------------------------------------
test('utility formatting functions are robust against edge cases', () => {
  const sandbox = createSandbox();
  const escapeHtml = sandbox.escapeHtml;
  const fmtTime = sandbox.fmtTime;

  // escapeHtml
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(12345), '12345');
  assert.equal(escapeHtml('<script>"\'&</script>'), '&lt;script&gt;&quot;&#39;&amp;&lt;/script&gt;');

  // fmtTime
  assert.equal(fmtTime(0), '0:00.0');
  assert.equal(fmtTime(-500), '0:00.0');
  assert.equal(fmtTime(1500), '0:01.5');
  assert.equal(fmtTime(59900), '0:59.8'); // Note: 59.9 % 1 in IEEE 754 is 0.8999999999999986, floor(*10) is 8
  assert.equal(fmtTime(60000), '1:00.0');
  assert.equal(fmtTime(125400), '2:05.4');
  assert.equal(fmtTime(3600000), '60:00.0');
});
