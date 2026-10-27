import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { PHONE_M1_TEST_IDS, PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { installDeterministicStorage } from './phoneFixture'

/**
 * Phones open the phone editor instead of the desktop editor (src/routing/phoneEntry.ts). The full
 * editor stays one tap away and keeps that choice across reloads; the Mobile toggle comes back.
 * Own context: this journey leaves /m, so it must not share the Sammeltest page.
 */
test('a phone opening /editor lands in the phone editor, can switch to the full editor and back @phone', async ({ browser }, testInfo) => {
  const use = testInfo.project.use
  if (!use.baseURL || !use.viewport) throw new Error('Playwright baseURL and a phone viewport must be configured')
  const context = await browser.newContext({
    viewport: use.viewport, screen: use.viewport, deviceScaleFactor: use.deviceScaleFactor,
    isMobile: true, hasTouch: true, userAgent: use.userAgent,
  })
  try {
    const page = await context.newPage()
    await installDeterministicStorage(page, randomUUID())
    await page.goto(new URL('/editor', use.baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 })

    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches), 'the phone emulation has no coarse pointer').toBe(true)
    await expect(page, 'a phone on /editor was not sent to the phone editor').toHaveURL(/\/m$/)
    const home = page.getByTestId(PHONE_M1_TEST_IDS.home)
    await expect(home, 'the phone home did not appear after the redirect').toBeVisible({ timeout: 90_000 })

    await home.getByTestId(PHONE_M1_TEST_IDS.fullEditor).tap()
    await expect(page, 'Full editor did not open /editor').toHaveURL(/\/editor$/, { timeout: 30_000 })
    const mobileToggle = page.getByRole('button', { name: 'Mobile mode' })
    await expect(mobileToggle, 'the desktop editor did not load').toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId(PHONE_TEST_IDS.root), 'the phone skin is still mounted in the full editor').toHaveCount(0)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(mobileToggle, 'the full-editor choice was not kept across a reload').toBeVisible({ timeout: 90_000 })
    await expect(page).toHaveURL(/\/editor$/)

    await mobileToggle.tap()
    await expect(page, 'the Mobile toggle did not open the phone editor').toHaveURL(/\/m$/, { timeout: 30_000 })
    await expect(home, 'the phone home did not appear after Mobile').toBeVisible({ timeout: 90_000 })

    await page.goto(new URL('/editor', use.baseURL).toString(), { waitUntil: 'domcontentloaded' })
    await expect(page, 'Mobile did not end the full-editor choice').toHaveURL(/\/m$/)
  } finally {
    await context.close()
  }
})
