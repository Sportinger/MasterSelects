import { existingTest } from './existingFixture'
import { chromium } from '@playwright/test'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { test as editorTest } from '../fixtures/test'
import { EditorPage, createEditorTabId } from '../fixtures/editorPage'
import { BridgeClient } from '../fixtures/bridgeClient'
import { cleanupCase } from './cleanup'

let chromeProfile = ''
let projectWorkspace = ''
const execute = promisify(execFile)

// The user explicitly requested closing test-owned browsers and removing their
// temporary folders, including failed runs. Ordinary Chrome profiles are excluded.
const ownedTest = editorTest.extend({
  editorPage: async ({ page, baseURL, failureEvidence }, provide, testInfo) => {
    const tabId = createEditorTabId(testInfo)
    failureEvidence.setBridge(new BridgeClient({ baseURL: baseURL!, targetTabId: tabId }))
    const projectRoot = path.join(projectWorkspace, 'native-project-root')
    await mkdir(path.dirname(projectRoot), { recursive: true })
    const editor = await EditorPage.bootstrap(page, { baseURL: baseURL!, tabId,
      prepareEntry: async page => {
        const dialog = page.getByRole('dialog', { name: 'Choose project' })
        await dialog.getByRole('button', { name: 'New project Empty timeline' }).click()
        await dialog.getByRole('textbox', { name: 'Project name' }).fill(`Beta ${tabId.slice(0, 8)}`)
        const readyFile = testInfo.outputPath('native-ready')
        const controller = new AbortController()
        const native = execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
          path.resolve('tests/playwright/beta/selectWindowsFolder.ps1'), '-ChromeProfile', chromeProfile,
          '-TargetDirectory', projectRoot, '-ReadyFile', readyFile], { windowsHide: true, timeout: 65_000, signal: controller.signal })
          .then(result => ({ result }), error => ({ error }))
        try {
        await Promise.race([native.then(outcome => { if ('error' in outcome) throw outcome.error }),
          (async () => { for (let i = 0; i < 150; i++) {
            try { await access(readyFile); return } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
          } throw new Error('Native desktop driver did not become ready') })()])
        await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
        const outcome = await native
        if ('error' in outcome) throw outcome.error
        await testInfo.attach('native-folder-dialog', { body: outcome.result.stdout, contentType: 'application/json' })
        await dialog.waitFor({ state: 'hidden', timeout: 30_000 })
        } finally {
          controller.abort()
          await native
        }
      } })
    failureEvidence.setBridge(editor.bridge)
    await provide(editor)
  },
  context: async ({}, provide, testInfo) => {
    if (process.platform !== 'win32') throw new Error('This profile requires Windows with installed Chrome')
    const candidates = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).map(root => path.join(root!, 'Google/Chrome/Application/chrome.exe'))
    let executable: string | undefined
    for (const file of candidates) { try { await access(file); executable = file; break } catch { /* next */ } }
    if (!executable) throw new Error('Installed Google Chrome was not found')
    const profile = await mkdtemp(path.join(os.tmpdir(), 'masterselects-beta-chrome-'))
    const workspace = await mkdtemp(path.resolve('output/windows-beta/work-'))
    chromeProfile = profile
    projectWorkspace = workspace
    await mkdir(testInfo.outputDir, { recursive: true })
    await writeFile(testInfo.outputPath('browser.json'), JSON.stringify({ profile, workspace }))
    try {
    const child = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0',
      '--no-first-run', '--no-default-browser-check', '--disable-features=Translate', '--window-size=1920,1080', 'about:blank'],
    { detached: true, stdio: 'ignore' })
    child.unref()
    let endpoint: string | undefined
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const [port, ws] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)
        endpoint = `ws://127.0.0.1:${port}${ws}`; break
      } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
    }
    if (!endpoint) throw new Error('Dedicated Chrome did not expose its automation endpoint')
    const browser = await chromium.connectOverCDP(endpoint)
    const context = browser.contexts()[0]
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    try {
      await provide(context)
    } finally {
      const trace = testInfo.outputPath('trace.zip')
      await context.tracing.stop({ path: trace })
      await testInfo.attach('trace', { path: trace, contentType: 'application/zip' })
    }
    } finally {
      const cleanup = await cleanupCase(testInfo.outputDir)
      await testInfo.attach('cleanup', { body: JSON.stringify(cleanup), contentType: 'application/json' })
    }
  },
  page: async ({ context }, provide, testInfo) => {
    const page = context.pages()[0] || await context.newPage()
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.bringToFront()
    await page.addInitScript(() => {
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
    })
    try { await provide(page) }
    finally {
      if (!page.isClosed()) await testInfo.attach('resource-lifetimes', { body: JSON.stringify(await page.evaluate(() => {
        const state = window as unknown as { __betaObjectUrlAudit: unknown; __betaGpuImportFailures: unknown }
        return { urls: state.__betaObjectUrlAudit, gpuImportFailures: state.__betaGpuImportFailures }
      })), contentType: 'application/json' })
    }
  },
})
export { expect } from '@playwright/test'

export const test = process.env.MS_BETA_EXISTING === '1' ? existingTest : ownedTest
