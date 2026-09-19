import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { BridgeClient, DEFAULT_REPO_ROOT } from './bridgeClient'

export interface EditorBootstrapOptions {
  baseURL: string
  tabId?: string
  navigationPath?: string
  navigationTimeoutMs?: number
  welcomeTimeoutMs?: number
  bridgeTimeoutMs?: number
  readyTimeoutMs?: number
  prepareEntry?: (page: Page) => Promise<void>
}

interface EditorStats {
  engineReady?: boolean
  projectLoadProgress?: {
    active?: boolean
    phase?: string
  }
}

const BRIDGE_TAB_SESSION_KEY = 'masterselects.aiBridgeTabId'
const SETTINGS_STORAGE_KEY = 'masterselects-settings'

export class EditorPage {
  readonly page: Page
  readonly baseURL: string
  readonly tabId: string
  readonly bridge: BridgeClient
  readonly shell: Locator

  private constructor(page: Page, baseURL: string, tabId: string, bridge?: BridgeClient) {
    this.page = page
    this.baseURL = baseURL
    this.tabId = tabId
    this.bridge = bridge ?? new BridgeClient({ baseURL, targetTabId: tabId })
    this.shell = page.locator('.app--editor-layout')
  }

  static async adoptExistingReady(page: Page, bridge: BridgeClient): Promise<EditorPage> {
    if (page.url() !== `${bridge.baseURL}/editor`) throw new Error('Existing editor URL changed')
    const editor = new EditorPage(page, bridge.baseURL, bridge.targetTabId, bridge)
    await editor.shell.waitFor({ state: 'visible', timeout: 15_000 })
    if (await page.getByRole('dialog', { name: 'Choose project' }).isVisible()) {
      throw new Error('Root must provide the already-loaded MSTEST project')
    }
    await editor.waitForProjectIdle()
    return editor
  }

  static async bootstrap(
    page: Page,
    options: EditorBootstrapOptions,
  ): Promise<EditorPage> {
    const tabId = options.tabId ?? randomUUID()
    assertUuidLike(tabId)

    const editor = new EditorPage(page, options.baseURL, tabId)
    await editor.installDeterministicStorage()
    if (!options.prepareEntry) {
      await page.addInitScript(() => {
        // The default profile owns a fresh browser context. Keep its project
        // in browser storage; Windows beta supplies its own native entry flow.
        Reflect.deleteProperty(window, 'showDirectoryPicker')
        Reflect.deleteProperty(window, 'showSaveFilePicker')
      })
    }

    const targetURL = new URL(options.navigationPath ?? '/', options.baseURL).toString()
    await page.goto(targetURL, {
      waitUntil: 'domcontentloaded',
      timeout: options.navigationTimeoutMs ?? 60_000,
    })

    await editor.shell.waitFor({ state: 'visible', timeout: options.welcomeTimeoutMs ?? 30_000 })
    if (options.prepareEntry) await options.prepareEntry(page)
    else await editor.createBrowserProjectThroughUI(options.welcomeTimeoutMs ?? 30_000)
    await editor.bridge.waitForTarget({
      timeoutMs: options.bridgeTimeoutMs ?? 30_000,
      requireVisible: true,
    })
    await editor.bridge.authenticate()
    await editor.bridge.tool('clearRuntimeDiagnostics', {}, { timeoutMs: 10_000 })
    await editor.waitForProjectIdle(options.readyTimeoutMs ?? 30_000)

    return editor
  }

  async waitForProjectIdle(timeoutMs = 30_000): Promise<EditorStats> {
    const startedAt = Date.now()
    const deadline = startedAt + timeoutMs
    let lastStats: EditorStats | null = null
    let lastError: unknown

    do {
      try {
        const result = await this.bridge.tool<EditorStats>('getStats', {}, {
          timeoutMs: 3_000,
          fetchTimeoutMs: 5_000,
        })
        if (result.success && result.data) {
          lastStats = result.data
          const progress = result.data.projectLoadProgress
          if (progress?.active === false && (progress.phase === 'idle' || !progress.phase)) {
            return result.data
          }
        } else {
          lastError = new Error(result.error ?? 'getStats failed')
        }
      } catch (error) {
        lastError = error
      }
      await this.page.waitForTimeout(200)
    } while (Date.now() <= deadline)

    const lastPhase = lastStats?.projectLoadProgress?.phase
    const reason = lastError instanceof Error ? `; last error: ${lastError.message}` : ''
    throw new Error(
      `Editor project did not become idle within ${Date.now() - startedAt}ms`
      + (lastPhase ? `; last phase: ${lastPhase}` : '')
      + reason,
    )
  }

  private async installDeterministicStorage(): Promise<void> {
    const appVersion = await readAppVersion()
    await this.page.addInitScript((seed) => {
      window.sessionStorage.setItem(seed.bridgeTabKey, seed.tabId)

      let persisted: Record<string, unknown> = {}
      try {
        const raw = window.localStorage.getItem(seed.settingsKey)
        if (raw) {
          const parsed = JSON.parse(raw) as unknown
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            persisted = parsed as Record<string, unknown>
          }
        }
      } catch {
        persisted = {}
      }

      const previousState = typeof persisted.state === 'object'
        && persisted.state !== null
        && !Array.isArray(persisted.state)
        ? persisted.state as Record<string, unknown>
        : {}

      window.localStorage.setItem(seed.settingsKey, JSON.stringify({
        ...persisted,
        state: {
          ...previousState,
          hasSeenTutorial: true,
          hasSeenTutorialPart2: true,
          showChangelogOnStartup: false,
          lastSeenChangelogVersion: seed.appVersion,
        },
        version: typeof persisted.version === 'number' ? persisted.version : 0,
      }))
    }, {
      appVersion,
      bridgeTabKey: BRIDGE_TAB_SESSION_KEY,
      settingsKey: SETTINGS_STORAGE_KEY,
      tabId: this.tabId,
    })
  }

  private async createBrowserProjectThroughUI(timeoutMs: number): Promise<void> {
    const dialog = this.page.getByRole('dialog', { name: 'Choose project' })
    await dialog.waitFor({ state: 'visible', timeout: timeoutMs })
    await dialog.getByRole('button', { name: 'New project Empty timeline' }).click()
    await dialog.getByRole('textbox', { name: 'Project name' }).fill(`Playwright ${this.tabId}`)
    await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
    await dialog.waitFor({ state: 'hidden', timeout: timeoutMs })
  }
}

let appVersionPromise: Promise<string> | null = null

function readAppVersion(): Promise<string> {
  appVersionPromise ??= readFile(path.join(DEFAULT_REPO_ROOT, 'package.json'), 'utf8')
    .then((raw) => {
      const parsed = JSON.parse(raw) as unknown
      if (
        typeof parsed !== 'object'
        || parsed === null
        || Array.isArray(parsed)
        || !('version' in parsed)
        || typeof parsed.version !== 'string'
        || !parsed.version.trim()
      ) {
        throw new Error('Root package.json does not contain a valid application version')
      }
      return parsed.version.trim()
    })
  return appVersionPromise
}

export function createEditorTabId(testInfo: TestInfo): string {
  // The UUID is the actual bridge contract. Test metadata is intentionally not
  // encoded into it, keeping the browser-side id accepted by UUID-aware tools.
  void testInfo
  return randomUUID()
}

function assertUuidLike(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Editor bridge tab id must be UUID-like, received: ${value}`)
  }
}
