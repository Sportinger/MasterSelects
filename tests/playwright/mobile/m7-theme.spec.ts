import type { Page } from '@playwright/test'
import { PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { expect, test } from './m1Fixture'

/**
 * G7 theme: the phone gets its light palette for every light editor theme, not only 'Light': 'System'
 * while the device is light and a bright 'Custom' theme too; dark themes keep the dark phone. The truth
 * is the settings store (set through the page) and the shell's real computed background, which comes
 * from the --phone-bg token the cascade resolves.
 */
const LIGHT_BG = 'rgb(236, 238, 242)'
const DARK_BG = 'rgb(11, 12, 15)'

interface ThemeState { theme: string; customBrightness: number }

async function settings(page: Page, patch?: Partial<ThemeState>): Promise<ThemeState> {
  return page.evaluate(async (next) => {
    const storeModule = '/src/stores/settingsStore.ts'
    const mod = await import(/* @vite-ignore */ storeModule) as { useSettingsStore: { getState: () => ThemeState & { setTheme: (t: string) => void; setCustomBrightness: (b: number) => void } } }
    const state = mod.useSettingsStore.getState()
    const before = { theme: state.theme, customBrightness: state.customBrightness }
    if (next?.customBrightness !== undefined) state.setCustomBrightness(next.customBrightness)
    if (next?.theme !== undefined) state.setTheme(next.theme)
    return before
  }, patch)
}

const shellBackground = (page: Page) => page.locator('.phone-shell').first().evaluate(element => getComputedStyle(element).backgroundColor)

async function withTheme(page: Page, patch: Partial<ThemeState>, check: () => Promise<void>): Promise<void> {
  const before = await settings(page, patch)
  try { await check() } finally { await settings(page, before); await page.emulateMedia({ colorScheme: null }) }
}

test('a bright custom theme gives the phone its light palette; a dark one keeps it dark', async ({ m1 }) => {
  const root = m1.page.getByTestId(PHONE_TEST_IDS.root)
  await withTheme(m1.page, { theme: 'custom', customBrightness: 85 }, async () => {
    await expect(root).toHaveAttribute('data-phone-scheme', 'light')
    await expect.poll(() => shellBackground(m1.page), { message: 'the phone shell did not turn light' }).toBe(LIGHT_BG)
    await settings(m1.page, { customBrightness: 20 })
    await expect(root).toHaveAttribute('data-phone-scheme', 'dark')
    await expect.poll(() => shellBackground(m1.page), { message: 'the phone shell did not return to dark' }).toBe(DARK_BG)
  })
})

test('the system theme follows the device: light device, light phone; dark device, dark phone', async ({ m1 }) => {
  const root = m1.page.getByTestId(PHONE_TEST_IDS.root)
  await m1.page.emulateMedia({ colorScheme: 'light' })
  await withTheme(m1.page, { theme: 'system' }, async () => {
    await expect(root).toHaveAttribute('data-phone-scheme', 'light')
    await expect.poll(() => shellBackground(m1.page), { message: 'system on a light device left the phone dark' }).toBe(LIGHT_BG)
    await m1.page.emulateMedia({ colorScheme: 'dark' })
    await expect(root).toHaveAttribute('data-phone-scheme', 'dark')
    await expect.poll(() => shellBackground(m1.page), { message: 'system on a dark device left the phone light' }).toBe(DARK_BG)
  })
})
