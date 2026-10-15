// The SPEC's operator journey in a real browser, against the compose stack
// with the seeded scenario and the fixture model. Needs a fresh stack: it runs
// the demo scenario itself.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const PASSWORD = process.env.SEED_OPERATOR_PASSWORD ?? '';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('operator');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

// A card is its h2 title's grandparent (Card > CardHeader > CardTitle).
const card = (page: Page, title: string) =>
  page.getByRole('heading', { name: title, exact: true }).locator('xpath=../..');
const timeline = (page: Page) => card(page, 'Timeline');

test('operator journey: failures to verified recovery', async ({ page }) => {
  expect(PASSWORD, 'set SEED_OPERATOR_PASSWORD (the one compose seeded)').not.toBe('');

  await test.step('a signed-out visitor is sent to sign in', async () => {
    await page.goto('/incidents');
    await expect(page).toHaveURL(/\/login/);
  });

  await test.step('sign in; every screen says the data is simulated', async () => {
    await signIn(page);
    await expect(page.getByText('Simulated data')).toBeVisible();
  });

  await test.step('1. failures arrive from the simulated scenario', async () => {
    await page.getByRole('button', { name: 'Run demo scenario' }).click();
    await expect(page.getByText('40 simulated labs by state')).toBeVisible();
  });

  await test.step('2. related failures group; the permission failure stays apart', async () => {
    await page.goto('/incidents');
    const burst = page.getByRole('row').filter({ hasText: /PROVISION_TIMEOUT on/ });
    await expect(burst).toHaveCount(1);
    await expect(burst.getByRole('cell').nth(3)).toHaveText('12');
    await expect(page.getByRole('row').filter({ hasText: /PERMISSION_DENIED/ }).first()).toBeVisible();
    await burst.getByRole('link').click();
  });

  await test.step('3. each lab shows why it was included and how strongly', async () => {
    const rows = card(page, 'Why these labs are grouped').getByRole('row');
    await expect(rows).toHaveCount(13); // header + 12 labs
    for (const row of await rows.all().then((all) => all.slice(1))) {
      await expect(row.getByRole('cell').nth(1)).not.toBeEmpty();
    }
  });

  await test.step('4. the investigation shows cause, evidence and uncertainty', async () => {
    await page.getByRole('button', { name: 'Investigate' }).click();
    await expect(page.getByText(/^Likely cause:/)).toBeVisible();
    await expect(page.getByText('Evidence for', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Confidence: \d+% \(model's own estimate\)/)).toBeVisible();
  });

  await test.step('5-6. policy allows the retry; it shows its targets', async () => {
    await expect(page.getByText('RETRY_PROVISIONING', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/^Targets: /)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  });

  await test.step('a rejected proposal reopens the incident and can be redone', async () => {
    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Investigate' }).click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  });

  await test.step('7. a double-clicked approval runs once, verified without a reload', async () => {
    let fullLoads = 0;
    page.on('load', () => (fullLoads += 1));
    await page.getByRole('button', { name: 'Approve' }).dblclick();

    // The live stream refreshes the page; nothing here reloads it.
    await expect(page.getByText('Verification: passed, every lab ready')).toBeVisible();
    await expect(page.getByText(/Before: 12 failed · After: 12 ready/)).toBeVisible();
    expect(fullLoads).toBe(0);
    await expect(timeline(page).getByText(/^recovery approved ·/)).toHaveCount(1);
    await expect(timeline(page).getByText(/^recovery started ·/)).toHaveCount(1);
  });

  await test.step('8. the timeline records every step with its actor', async () => {
    for (const step of [
      /^incident created · .* · worker$/,
      /^investigation requested · .* · human$/,
      /^recovery proposed · .* · worker$/,
      /^recovery rejected · .* · human$/,
      /^recovery approved · .* · human$/,
      /^recovery verified · passed · worker$/,
    ]) {
      await expect(timeline(page).getByText(step).first()).toBeVisible();
    }
  });

  await test.step('metrics come from this run', async () => {
    await page.goto('/');
    const metrics = card(page, 'Metrics');
    await expect(metrics.getByText(/^Last 24 h, measured from committed rows/)).toBeVisible();
    const value = (label: string) =>
      metrics.getByText(label, { exact: true }).locator('xpath=following-sibling::span');
    await expect(value('Incidents created')).not.toHaveText('0');
    await expect(value('Recoveries succeeded / failed')).toHaveText('1 / 0');
    await expect(value('Approval to verified (p50 / p95)')).not.toHaveText('— / —');
  });
});
