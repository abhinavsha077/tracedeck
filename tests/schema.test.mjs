import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaptureBundle } from '../packages/capture-schema/validate.mjs';

test('validateCaptureBundle passes with compliant CaptureBundleV1', () => {
  const validBundle = {
    schemaVersion: '1.0',
    capture: {
      id: 'cap_1',
      title: 'Checkout error',
      source: 'extension',
      durationMs: 1200,
      url: 'https://example.com/cart',
      environment: { browser: 'Chrome' },
      metadata: { user: 'test' }
    },
    events: [
      { type: 'console', ts: 100, level: 'error', data: { message: 'Network failed' } },
      { type: 'action', ts: 250, data: { action: 'click', selector: '#checkout' } }
    ],
    artifacts: [
      { kind: 'screenshot', name: 'error.png', contentType: 'image/png' }
    ]
  };

  const result = validateCaptureBundle(validBundle);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateCaptureBundle catches invalid schemaVersion and missing title', () => {
  const badBundle = {
    schemaVersion: '2.0',
    capture: {
      source: 'extension'
    },
    events: []
  };

  const result = validateCaptureBundle(badBundle);
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.includes('schemaVersion')));
  assert(result.errors.some((e) => e.includes('capture.title is required')));
});

test('validateCaptureBundle catches invalid source and negative timestamp', () => {
  const badBundle = {
    schemaVersion: '1.0',
    capture: {
      title: 'Valid title',
      source: 'unauthorized-source',
      durationMs: -50
    },
    events: [
      { type: 'click', ts: -10 }
    ]
  };

  const result = validateCaptureBundle(badBundle);
  assert.equal(result.valid, false);
  assert(result.errors.some((e) => e.includes('capture.source must be one of')));
  assert(result.errors.some((e) => e.includes('capture.durationMs must be a non-negative number')));
  assert(result.errors.some((e) => e.includes('events[0].ts is required and must be a non-negative number')));
});

test('validateCaptureBundle rejects non-object or null root', () => {
  assert.equal(validateCaptureBundle(null).valid, false);
  assert.equal(validateCaptureBundle('string').valid, false);
  assert.equal(validateCaptureBundle([]).valid, false);
});
