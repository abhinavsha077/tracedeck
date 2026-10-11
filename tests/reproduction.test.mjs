import test from 'node:test';
import assert from 'node:assert/strict';
import { runReproduction } from '../apps/server/lib/reproduction.mjs';

test('runReproduction detects missing sensitive inputs and generates Playwright spec', async () => {
  const capture = {
    id: 'cap_repro_1',
    title: 'Password login failure',
    url: 'https://auth.example/login',
    events: [
      { type: 'action', ts: 100, data: { action: 'click', selector: '#email', label: 'Email Address' } },
      { type: 'action', ts: 200, data: { action: 'input', selector: '#email', label: 'Email Address', value: 'user@example.com' } },
      { type: 'action', ts: 400, data: { action: 'input', selector: '#pass', label: 'Password', value: '[REDACTED]', sensitive: true } },
      { type: 'action', ts: 700, data: { action: 'click', selector: '#submit-btn', label: 'Sign In' } },
      { type: 'network', ts: 900, data: { method: 'POST', url: 'https://auth.example/api/login', status: 401 } },
      { type: 'console', ts: 950, level: 'error', data: { message: 'Invalid credentials' } }
    ]
  };

  const report = await runReproduction(capture, { checkEndpoints: false });

  assert.equal(report.captureId, 'cap_repro_1');
  assert.equal(report.verdict, 'VERIFIED_ACTION_CHAIN');
  assert.equal(report.reproduced, true);
  assert.equal(report.steps.length, 5); // 1 navigate + 4 actions
  assert.equal(report.missingInputs.length, 1);
  assert.equal(report.missingInputs[0].selector, '#pass');
  assert.match(report.playwrightScript, /await page\.goto\("https:\/\/auth\.example\/login"\)/);
  assert.match(report.playwrightScript, /#submit-btn/);
});

test('runReproduction handles empty captures gracefully', async () => {
  const emptyCapture = { id: 'cap_empty', title: 'Empty', events: [] };
  const report = await runReproduction(emptyCapture, { checkEndpoints: false });

  assert.equal(report.verdict, 'NO_REPRODUCIBLE_ACTIONS');
  assert.equal(report.reproduced, false);
  assert.equal(report.steps.length, 0);
  assert.equal(report.missingInputs.length, 0);
});

test('runReproduction executes live endpoint checks and records status', async () => {
  // Mock endpoint capture with localhost port that will fail connection
  const mockCapture = {
    id: 'cap_net_test',
    title: 'Offline API failure',
    url: 'http://127.0.0.1:44999/page',
    events: [
      { type: 'action', ts: 100, data: { action: 'click', selector: '#fetch-btn', label: 'Fetch Data' } },
      { type: 'network', ts: 300, data: { method: 'GET', url: 'http://127.0.0.1:44999/api/data', status: 502 } }
    ]
  };

  const report = await runReproduction(mockCapture, { checkEndpoints: true, timeoutMs: 200 });

  assert.equal(report.verdict, 'REPRODUCED_FAILING_ENDPOINT');
  assert.equal(report.reproduced, true);
  assert.equal(report.endpointChecks.length, 1);
  assert.equal(report.endpointChecks[0].url, 'http://127.0.0.1:44999/api/data');
  assert.equal(report.endpointChecks[0].reproduced, true);
});
