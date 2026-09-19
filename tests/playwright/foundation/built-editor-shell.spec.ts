import { test, expect } from '@playwright/test';

test('production build boots and exposes transport/export surfaces @built-smoke', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    // Use real browser storage for this portable shell check. The Windows beta
    // journey separately verifies native folder selection and permissions.
    Reflect.deleteProperty(window, 'showDirectoryPicker');
    Reflect.deleteProperty(window, 'showSaveFilePicker');
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

  const projectDialog = page.getByRole('dialog', { name: 'Choose project' });
  await projectDialog.getByRole('button', { name: 'New project Empty timeline' }).click();
  await projectDialog.getByRole('textbox', { name: 'Project name' }).fill('Built smoke');
  await projectDialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(projectDialog).toBeHidden();

  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Export' })).toBeVisible();
  expect(pageErrors, `Unexpected production-build page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
