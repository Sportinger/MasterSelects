import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PHONE_M1_TEST_IDS, PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { installDeterministicStorage } from './phoneFixture'

/**
 * A phone browser without the origin private file system (Android Chrome before 109, some WebViews).
 * Production 3.3.4 (2026-10-27): "Failed to open the origin private file system" and "Project list
 * failed"; no project could be created at all and the message blamed Private Browsing.
 *
 * Oracle: the phone home says plainly that projects are only kept temporarily and why, a project
 * can be created and opened in the temporary store, and its save status reads Temporary.
 * Own context: the init script removes OPFS for the whole page.
 */
const OPFS_MISSING = () => { delete (StorageManager.prototype as unknown as { getDirectory?: unknown }).getDirectory }
// Production 3.4.3, Firefox Private Browsing and Firefox for Android: "Project creation failed: Security error when calling GetDirectory".
const OPFS_REFUSED = () => {
  StorageManager.prototype.getDirectory = () => Promise.reject(new DOMException('Security error when calling GetDirectory', 'SecurityError'))
}

for (const [title, removeOpfs, reason] of [
  ['a phone without OPFS', OPFS_MISSING, 'too old'],
  ['a browser that refuses OPFS with a SecurityError', OPFS_REFUSED, 'refused permanent storage'],
] as const) test(`${title} keeps projects in temporary storage and says so @phone`, async ({ browser }, testInfo) => {
  test.setTimeout(180_000)
  const use = testInfo.project.use
  if (!use.baseURL || !use.viewport) throw new Error('Playwright baseURL and a phone viewport must be configured')
  const context = await browser.newContext({
    viewport: use.viewport, screen: use.viewport, deviceScaleFactor: use.deviceScaleFactor,
    isMobile: true, hasTouch: true, userAgent: use.userAgent,
  })
  try {
    const page = await context.newPage()
    await installDeterministicStorage(page, randomUUID())
    await page.addInitScript(removeOpfs)
    await page.goto(new URL('/m', use.baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId(PHONE_M1_TEST_IDS.home), 'the phone home did not appear').toBeVisible({ timeout: 90_000 })

    const notice = page.getByTestId('temporary-storage-notice')
    await expect(notice, 'the home must say that projects are only kept temporarily').toBeVisible({ timeout: 15_000 })
    await expect(notice).toContainText('Projects are only kept temporarily in this browser')
    await expect(notice).toContainText(reason)

    const create = page.getByTestId(PHONE_M1_TEST_IDS.createProject)
    if (!await create.isVisible()) await page.getByTestId(PHONE_M1_TEST_IDS.newProject).click()
    await page.getByTestId(PHONE_M1_TEST_IDS.projectNameInput).fill('No OPFS')
    await create.click()
    await expect(page.getByTestId(PHONE_M1_TEST_IDS.home), 'the project did not open').toBeHidden({ timeout: 30_000 })
    await expect(page.getByTestId(PHONE_TEST_IDS.timeline)).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Temporary' }), 'the save status must read Temporary').toBeVisible()
  } finally {
    await context.close()
  }
})
