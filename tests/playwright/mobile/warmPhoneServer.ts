import { chromium, type FullConfig } from '@playwright/test'

// A cold Vite module graph takes minutes; transform /m once before the suite so
// that time does not count against any test. A warm-up that cannot reach the
// phone skin is not fatal here: the worker fixture then fails with the precise
// reason (the skin is not built yet, the route is missing, ...).
const WARMUP_TIMEOUT_MS = Number(process.env.MASTERSELECTS_E2E_WARM_TIMEOUT_MS) || 300_000

export default async function warmPhoneServer(config: FullConfig): Promise<void> {
  const { baseURL, channel, headless, launchOptions } = config.projects[0].use
  if (!baseURL) throw new Error('The phone suite requires a baseURL')
  const browser = await chromium.launch({ ...launchOptions, channel, headless })
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } })
    await page.goto(new URL('/m', baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: WARMUP_TIMEOUT_MS })
    await page.locator('[data-testid="phone-root"], [role="dialog"]').first().waitFor({ state: 'visible', timeout: WARMUP_TIMEOUT_MS })
  } catch (error) {
    console.warn(`Phone warm-up did not reach /m: ${(error as Error).message.split('\n')[0]}`)
  } finally {
    await browser.close()
  }
}
