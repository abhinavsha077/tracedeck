// Zero-dependency Network Chaos & Race-Condition Reproduction Generator for DevDesk
// Exposes intermittent timing flaws, debounce bugs, and out-of-order promise overwrites

export function generateChaosSpec(capture, options = {}) {
  const title = capture.title || 'Untitled Capture';
  const url = capture.url || 'http://localhost:3000';
  const actions = (capture.events || []).filter(e => e.type === 'action');
  const network = (capture.events || []).filter(e => e.type === 'network');

  const jitterMs = options.jitterMs || 400;
  const burstClicks = options.burstClicks !== false;

  const stepsCode = actions.map((act, idx) => {
    const rawSel = act.target || act.selector || act.data?.selector || act.data?.target || 'button';
    const sel = String(rawSel).replace(/'/g, "\\'");
    const kind = act.kind || act.action || act.data?.action || 'click';

    if (kind.includes('click') || kind === 'click') {
      if (burstClicks) {
        return `    // Step ${idx + 1}: Fuzz debounce with rapid double-click burst
    await page.locator('${sel}').first().click();
    await page.waitForTimeout(25);
    await page.locator('${sel}').first().click().catch(() => {});
    await page.waitForTimeout(100);`;
      }
      return `    // Step ${idx + 1}: Click
    await page.locator('${sel}').first().click();
    await page.waitForTimeout(100);`;
    }

    if (kind.includes('type') || kind === 'type' || kind.includes('input')) {
      const rawVal = act.value || act.data?.value || 'test_input';
      const val = String(rawVal).replace(/'/g, "\\'");
      return `    // Step ${idx + 1}: Type input
    await page.locator('${sel}').first().fill('${val}');
    await page.waitForTimeout(50);`;
    }

    return `    // Step ${idx + 1}: Action ${kind}
    await page.waitForTimeout(100);`;
  }).join('\n\n');

  return `import { test, expect } from '@playwright/test';

test.describe('TraceDeck Chaos & Race-Condition Reproduction: ${title.replace(/'/g, "\\'")}', () => {
  test('reproduces UI behavior under high latency and out-of-order responses', async ({ page }) => {
    const uncaughtErrors = [];
    page.on('pageerror', err => uncaughtErrors.push(err.message));

    // 1. Inject Network Chaos: Random Jitter (200ms - ${200 + jitterMs}ms) & Route Jitter
    let requestCount = 0;
    await page.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.includes('/api/') || reqUrl.includes('/graphql')) {
        requestCount++;
        // Invert arrival timing: odd requests delayed more to induce race conditions
        const delay = requestCount % 2 === 1 ? ${jitterMs + 300} : 50;
        await new Promise(r => setTimeout(r, delay));
      }
      await route.continue();
    });

    // 2. Navigate to target URL
    await page.goto('${url.replace(/'/g, "\\'")}', { waitUntil: 'domcontentloaded' });

    // 3. Replay user actions with rapid timing
${stepsCode || '    await page.waitForTimeout(500);'}

    // 4. Assert no uncaught page crashes during chaotic async resolution
    await page.waitForTimeout(1000);
    expect(uncaughtErrors, 'Uncaught exceptions detected during chaos replay').toEqual([]);
  });
});
`;
}
