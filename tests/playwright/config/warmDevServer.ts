import { chromium, type FullConfig } from '@playwright/test'

// A cold Vite module graph takes several minutes on the Windows test host;
// the warmup runs once before the suite and keeps that out of test timeouts.
const WARMUP_TIMEOUT_MS = 600_000

/** Transform the cold Vite module graph before measuring editor scenarios. */
export default async function warmDevServer(config: FullConfig): Promise<void> {
  const { baseURL, channel, headless, launchOptions } = config.projects[0].use
  if (!baseURL) throw new Error('The development suite requires a baseURL')

  const browser = await chromium.launch({ ...launchOptions, channel, headless })
  try {
    const page = await browser.newPage()
    await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: WARMUP_TIMEOUT_MS })
    await page.locator('.app--editor-layout').waitFor({ state: 'visible', timeout: WARMUP_TIMEOUT_MS })
  } finally {
    await browser.close()
  }
}
