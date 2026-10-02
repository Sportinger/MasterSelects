import { chromium, type FullConfig } from '@playwright/test'

/** Transform the cold Vite module graph before measuring editor scenarios. */
export default async function warmDevServer(config: FullConfig): Promise<void> {
  const { baseURL, channel, headless, launchOptions } = config.projects[0].use
  if (!baseURL) throw new Error('The development suite requires a baseURL')

  const browser = await chromium.launch({ ...launchOptions, channel, headless })
  try {
    const page = await browser.newPage()
    await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.locator('.app--editor-layout').waitFor({ state: 'visible', timeout: 120_000 })
  } finally {
    await browser.close()
  }
}
