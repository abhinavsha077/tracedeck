function q(value) { return JSON.stringify(String(value || '')); }

export function generatePlaywright(capture) {
  const actions = capture.events.filter((e) => e.type === 'action').sort((a, b) => a.ts - b.ts);
  const lines = [
    `import { test, expect } from '@playwright/test';`,
    '',
    `test(${q(capture.title || 'TraceDeck reproduction')}, async ({ page }) => {`,
    capture.url ? `  await page.goto(${q(capture.url)});` : `  // Add the starting URL for this reproduction.`
  ];

  for (const event of actions) {
    const d = event.data || {};
    const selector = d.selector || d.target;
    if (d.action === 'navigate' && d.url) lines.push(`  await page.goto(${q(d.url)});`);
    else if (d.action === 'click' && selector) lines.push(`  await page.locator(${q(selector)}).click();`);
    else if (d.action === 'input' && selector && d.value !== undefined && d.value !== '[REDACTED]') lines.push(`  await page.locator(${q(selector)}).fill(${q(d.value)});`);
    else if (d.action === 'submit' && selector) lines.push(`  await page.locator(${q(selector)}).press('Enter');`);
  }

  const failures = capture.events.filter((e) => e.type === 'network' && Number(e.data?.status || 0) >= 400);
  if (failures.length) lines.push(`  // Original capture contained ${failures.length} failed request(s); add an assertion for the corrected behavior.`);
  lines.push(`  await expect(page).toHaveURL(/.+/);`, `});`, '');
  return lines.join('\n');
}
