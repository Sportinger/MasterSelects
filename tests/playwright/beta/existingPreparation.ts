import { readFile, writeFile } from 'node:fs/promises'
import type { Page, TestInfo } from '@playwright/test'
import { sha, origin } from './existingGuards.mjs'

const fixture = 'E:/CodexTaskWorkspaces/MasterSelects/AQ-090-release/built-regression-fixture.msproj'
const fixtureSha256 = '4bdd9c0ffc527c2a6b57199dd23d7c5254ef469a1898c8157ab3089609db8c6e'
const project = 'C:/Users/admin/Documents/MSTEST/MSTEST Workflow 20260908/MSTEST Workflow 20260908.msproj'

// Same instrumentation as the owned fixture, installed before the same-tab reload.
// The guard prevents duplicate wrappers if CDP init scripts survive a test boundary.
function installAudit() {
  const global = window as unknown as { __betaAuditInstalled?: boolean }
  if (global.__betaAuditInstalled) return
  global.__betaAuditInstalled = true
  const gpuFailures: unknown[] = []
  Object.assign(window, { __betaGpuImportFailures: gpuFailures })
  const deviceClass = (globalThis as unknown as { GPUDevice?: {
    prototype: { importExternalTexture(descriptor: { source: unknown }): unknown }
  } }).GPUDevice
  if (deviceClass) {
    const original = deviceClass.prototype.importExternalTexture
    deviceClass.prototype.importExternalTexture = function (descriptor) {
      try { return original.call(this, descriptor) }
      catch (error) {
        const source = descriptor.source
        if (gpuFailures.length < 20) gpuFailures.push({ error: String(error), time: performance.now(),
          source: source instanceof HTMLVideoElement ? { src: source.currentSrc, seeking: source.seeking,
            readyState: source.readyState, networkState: source.networkState, paused: source.paused,
            currentTime: source.currentTime, width: source.videoWidth, height: source.videoHeight,
            connected: source.isConnected, totalFrames: source.getVideoPlaybackQuality().totalVideoFrames } : 'VideoFrame' })
        throw error
      }
    }
  }
  const records: Array<{ operation: string; url: string; stack?: string }> = []
  Object.assign(window, { __betaObjectUrlAudit: records })
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
  URL.createObjectURL = value => {
    const url = create(value)
    if (records.length < 1000) records.push({ operation: 'create', url, stack: new Error().stack })
    return url
  }
  URL.revokeObjectURL = url => {
    if (records.length < 1000) records.push({ operation: 'revoke', url, stack: new Error().stack })
    revoke(url)
  }
}

export async function prepareExistingProject(page: Page, testInfo: TestInfo) {
  const bytes = await readFile(fixture)
  if (sha(bytes) !== fixtureSha256) throw Error('Existing MSTEST fixture changed')
  const prior = await readFile(project)
  await testInfo.attach('prior-mstest-project', { body: prior, contentType: 'application/zip' })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.bringToFront()
  await page.addInitScript(installAudit)
  await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5_000 })
  await writeFile(project, bytes)
  if (sha(await readFile(project)) !== fixtureSha256) throw Error('MSTEST fixture restore failed')
  await page.goto(origin + '/editor', { waitUntil: 'domcontentloaded', timeout: 15_000 })
  await page.waitForTimeout(5_000)
  const restore = page.getByRole('button', { name: 'Restore "MSTEST Workflow 20260908"' })
  if (await restore.isVisible()) await restore.click({ timeout: 3_000 })
  // Permission is already granted to this profile. Missing permission fails visibly;
  // this adapter neither invents a folder click nor silently creates a new project.
  await page.getByText('tueftenbacchus.mp4', { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 })
  const walkthrough = page.getByRole('button', { name: 'End walkthrough', exact: true })
  if (await walkthrough.isVisible()) await walkthrough.click()
  await page.locator('button[data-layout-id="factory-video-edit"]').click({ timeout: 3_000 })
  const audit = await page.evaluate(() => {
    const state = window as unknown as { __betaObjectUrlAudit: unknown; __betaGpuImportFailures: unknown }
    return { urls: Array.isArray(state.__betaObjectUrlAudit), gpu: Array.isArray(state.__betaGpuImportFailures), width: innerWidth, height: innerHeight }
  })
  if (!audit.urls || !audit.gpu || audit.width !== 1920 || audit.height !== 1080) throw Error('Startup audit or viewport missing')
  await testInfo.attach('existing-project-preparation', { body: JSON.stringify({ fixture, fixtureSha256, project,
    priorSha256: sha(prior), restoration: 'same pinned project bytes before each case', audit }), contentType: 'application/json' })
}
