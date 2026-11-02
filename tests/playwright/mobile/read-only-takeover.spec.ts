import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PHONE_M1_TEST_IDS, PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { installDeterministicStorage } from './phoneFixture'

/**
 * Production 3.4.1 (2026-10-29, Android and iOS): "This project is read-only in this tab. Choose
 * "Take over editing" in the toolbar". The phone skin has no such toolbar, so the tab stayed read-only.
 *
 * Oracle: the second tab says Read-only, one tap on that status takes the project over, this tab can
 * then write and the first tab becomes the read-only one.
 */
test('a phone tab that does not hold a project can take over editing @phone', async ({ browser }, testInfo) => {
  test.setTimeout(240_000)
  const use = testInfo.project.use
  if (!use.baseURL || !use.viewport) throw new Error('Playwright baseURL and a phone viewport must be configured')
  const context = await browser.newContext({
    viewport: use.viewport, screen: use.viewport, deviceScaleFactor: use.deviceScaleFactor,
    isMobile: true, hasTouch: true, userAgent: use.userAgent,
  })
  try {
    const first = await context.newPage()
    await installDeterministicStorage(first, randomUUID())
    await first.goto(new URL('/m', use.baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const name = `Take over ${randomUUID().slice(0, 8)}`
    await expect(first.getByTestId(PHONE_M1_TEST_IDS.home), 'the phone home did not appear').toBeVisible({ timeout: 90_000 })
    const create = first.getByTestId(PHONE_M1_TEST_IDS.createProject)
    if (!await create.isVisible()) await first.getByTestId(PHONE_M1_TEST_IDS.newProject).click()
    await first.getByTestId(PHONE_M1_TEST_IDS.projectNameInput).fill(name)
    await create.click()
    await expect(first.getByTestId(PHONE_TEST_IDS.timeline), 'the project did not open').toBeVisible({ timeout: 60_000 })
    const firstStatus = first.getByTestId(PHONE_M1_TEST_IDS.storageStatus)
    await expect(firstStatus).toContainText('Saved', { timeout: 30_000 })

    const second = await context.newPage()
    await installDeterministicStorage(second, randomUUID())
    await second.goto(new URL('/m', use.baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const home = second.getByTestId(PHONE_M1_TEST_IDS.home)
    const timeline = second.getByTestId(PHONE_TEST_IDS.timeline)
    await expect(home.or(timeline).first()).toBeVisible({ timeout: 90_000 })
    if (await home.isVisible()) await second.getByTestId(PHONE_M1_TEST_IDS.projectRow).filter({ hasText: name }).click()
    await expect(timeline, 'the second tab did not open the project').toBeVisible({ timeout: 60_000 })
    const status = second.getByTestId(PHONE_M1_TEST_IDS.storageStatus)
    await expect(status, 'the second tab must say it is read-only').toContainText('Read-only', { timeout: 30_000 })

    await status.click()
    await expect(second.getByTestId(PHONE_M1_TEST_IDS.storageStatus), 'one tap must make this tab the writer')
      .toContainText('Saved', { timeout: 60_000 })
    await expect(firstStatus, 'the first tab hands the project over').toContainText('Read-only', { timeout: 60_000 })
  } finally {
    await context.close()
  }
})
