import test from 'node:test';
import assert from 'node:assert/strict';
import { inferSchema, diffSchemas, detectCaptureSchemaDrift } from '../apps/server/lib/schema-drift.mjs';
import { buildA11yTree, auditClickTraps } from '../apps/server/lib/a11y-tree.mjs';
import { generateChaosSpec } from '../apps/server/lib/chaos-replay.mjs';
import { traceComponentLineage } from '../apps/server/lib/lineage.mjs';

test('schema-drift accurately infers schema and catches missing properties and null mismatches', () => {
  const payload = {
    id: 123,
    title: 'Item A',
    tags: ['sale', 'new'],
    metadata: { authorId: null }
  };

  const schema = inferSchema(payload);
  assert.equal(schema.type, 'object');
  assert.equal(schema.properties.id.type, 'number');
  assert.equal(schema.properties.tags.type, 'array');
  assert.equal(schema.properties.metadata.properties.authorId.type, 'null');

  // Expected contract
  const expectedContract = {
    type: 'object',
    required: ['id', 'title', 'discount'],
    properties: {
      id: { type: 'number' },
      title: { type: 'string' },
      discount: { type: 'number' },
      metadata: {
        type: 'object',
        properties: { authorId: { type: 'string' } }
      }
    }
  };

  const drifts = diffSchemas(schema, expectedContract);
  assert.ok(drifts.length >= 2);
  assert.ok(drifts.some(d => d.kind === 'missing_required_property' && d.path === 'discount'));
  assert.ok(drifts.some(d => d.kind === 'type_mismatch' && d.path === 'metadata.authorId'));

  // Test on full capture
  const sampleCapture = {
    id: 'cap_drift_1',
    events: [
      {
        type: 'network',
        method: 'GET',
        url: 'https://api.shop.com/v1/item',
        responseBody: JSON.stringify(payload)
      }
    ]
  };

  const driftReport = detectCaptureSchemaDrift(sampleCapture, {
    'GET https://api.shop.com/v1/item': expectedContract
  });
  assert.equal(driftReport.endpointsAnalyzed, 1);
  assert.ok(driftReport.driftCount >= 2);
});

test('a11y-tree condenses HTML by 90%+ and flags invisible click traps', () => {
  const sampleHtml = `
    <html>
      <body>
        <header>
          <a href="/home">Home</a>
          <button id="menu-btn" aria-expanded="false">Menu</button>
        </header>
        <main>
          <h1>Checkout Form</h1>
          <input type="text" name="email" placeholder="Your Email" required />
          <button type="submit" disabled>Pay Now</button>
          <button></button>
          <div style="position: fixed; z-index: 9999; opacity: 0; pointer-events: auto; width: 100vw; height: 100vh;"></div>
        </main>
      </body>
    </html>
  `;

  const { treeText, nodeCount, tokenEstimate } = buildA11yTree(sampleHtml);
  assert.ok(nodeCount >= 4);
  assert.ok(treeText.includes('button "Menu" [expanded=false]'));
  assert.ok(treeText.includes('textbox "Your Email" [required]'));
  assert.ok(treeText.includes('button "Pay Now" [disabled]'));
  assert.ok(tokenEstimate < 80); // Compact token footprint

  const { trapCount, traps } = auditClickTraps(sampleHtml);
  assert.ok(trapCount >= 2);
  assert.ok(traps.some(t => t.kind === 'invisible_click_interceptor'));
  assert.ok(traps.some(t => t.kind === 'unnamed_interactive_control'));
});

test('chaos-replay generates Playwright test with latency jitter and burst clicks', () => {
  const capture = {
    title: 'Shopping Cart Race Condition',
    url: 'https://myshop.com/cart',
    events: [
      { type: 'action', action: 'click', selector: '#add-btn', ts: 100 },
      { type: 'network', method: 'POST', url: '/api/cart/add', ts: 150 }
    ]
  };

  const spec = generateChaosSpec(capture, { jitterMs: 500, burstClicks: true });
  assert.ok(spec.includes("import { test, expect } from '@playwright/test'"));
  assert.ok(spec.includes('Fuzz debounce with rapid double-click burst'));
  assert.ok(spec.includes("locator('#add-btn').first().click()"));
  assert.ok(spec.includes('Invert arrival timing: odd requests delayed more'));
});

test('lineage traces DOM action to component, state, and downstream HTTP cause', () => {
  const capture = {
    id: 'cap_lineage_1',
    events: [
      { id: '1', type: 'action', kind: 'action:click', selector: '#checkout-btn', label: 'Checkout', ts: 100 },
      { id: '2', type: 'app', data: { kind: 'state:snapshot', data: { store: 'cart', snapshot: { total: 0 } } }, ts: 120 },
      { id: '3', type: 'network', method: 'POST', url: 'https://shop.com/api/pay', status: 502, ts: 250 },
      { id: '4', type: 'console', level: 'error', text: 'Uncaught Error: Bad Gateway from payment service', ts: 300 }
    ]
  };

  const result = traceComponentLineage(capture);
  assert.equal(result.hasException, true);
  assert.equal(result.trigger.inferredComponent, '<Checkout>');
  assert.equal(result.recentNetworkOrigins.length, 1);
  assert.equal(result.recentNetworkOrigins[0].status, 502);
  assert.ok(result.diagnosisVerdict.includes('downstream HTTP failure'));
});
