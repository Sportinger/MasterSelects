import { test, expect } from '@playwright/test';

test('production build boots and exposes transport/export surfaces @built-smoke', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.localStorage.setItem('masterselects-settings', JSON.stringify({
      state: {
        hasSeenTutorial: true,
        hasSeenTutorialPart2: true,
        showChangelogOnStartup: false,
        lastSeenChangelogVersion: 'playwright-built-smoke',
      },
      version: 0,
    }));
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app--editor-layout')).toBeVisible();

  const startEditing = page.getByRole('button', { name: /^Start editing\b/i });
  await expect(startEditing).toBeVisible();
  await startEditing.click();
  await expect(startEditing).toBeHidden();

  await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Export' })).toBeVisible();
  expect(pageErrors, `Unexpected production-build page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
