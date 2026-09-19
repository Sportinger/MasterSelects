import { defineConfig } from '@playwright/test'
import path from 'node:path'

const root = process.env.MS_BETA_OUTPUT || path.join('output/windows-beta', new Date().toISOString().replace(/[:.]/g, '-'))
const allowedRoot = path.resolve('output/windows-beta')
if (!path.resolve(root).startsWith(allowedRoot + path.sep)) {
  throw new Error('Beta run output must be a fresh child directory of output/windows-beta')
}
export default defineConfig({
  globalTeardown: './tests/playwright/beta/cleanup.ts',
  testDir: './tests/playwright/beta', testMatch: '**/*.spec.ts',
  outputDir: path.join(root, 'artifacts'), workers: 1, retries: 0,
  timeout: 180_000, expect: { timeout: 15_000 }, forbidOnly: true,
  reporter: [['list'], ['html', { outputFolder: path.join(root, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(root, 'results.json') }]],
  use: { baseURL: 'http://127.0.0.1:4187', viewport: { width: 1920, height: 1080 },
    headless: false, actionTimeout: 15_000, screenshot: 'only-on-failure', trace: 'off', video: 'off' },
  projects: [{ name: 'windows-beta' }],
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4187 --strictPort',
    url: 'http://127.0.0.1:4187', reuseExistingServer: false, timeout: 120_000,
    env: { MASTERSELECTS_E2E_FREEZE_SOURCE: '1',
      MASTERSELECTS_BRIDGE_TOKEN_FILE: 'test-results/playwright/.ai-bridge-token-4187' } },
})
