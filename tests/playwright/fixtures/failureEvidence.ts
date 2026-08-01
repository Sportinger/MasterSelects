import os from 'node:os'
import path from 'node:path'
import type {
  ConsoleMessage,
  Page,
  TestInfo,
} from '@playwright/test'
import { DEFAULT_REPO_ROOT, type BridgeClient, type BridgeToolResult } from './bridgeClient'

export interface BrowserConsoleEvidence {
  type: 'error' | 'warning'
  text: string
  location: {
    url?: string
    lineNumber?: number
    columnNumber?: number
  }
  recordedAt: string
}

export interface PageErrorEvidence {
  name: string
  message: string
  stack?: string
  recordedAt: string
}

export class FailureEvidenceCollector {
  readonly consoleEntries: BrowserConsoleEvidence[] = []
  readonly pageErrors: PageErrorEvidence[] = []

  private readonly page: Page
  private readonly testInfo: TestInfo
  private bridge: BridgeClient | null = null
  private readonly onConsoleMessage = (message: ConsoleMessage) => {
    const type = message.type()
    if (type !== 'error' && type !== 'warning') return
    this.consoleEntries.push({
      type,
      text: message.text(),
      location: message.location(),
      recordedAt: new Date().toISOString(),
    })
  }
  private readonly onPageError = (error: Error) => {
    this.pageErrors.push({
      name: error.name,
      message: error.message,
      stack: error.stack,
      recordedAt: new Date().toISOString(),
    })
  }

  constructor(
    page: Page,
    testInfo: TestInfo,
  ) {
    this.page = page
    this.testInfo = testInfo
    page.on('console', this.onConsoleMessage)
    page.on('pageerror', this.onPageError)
  }

  setBridge(bridge: BridgeClient): void {
    this.bridge = bridge
  }

  async finish(): Promise<void> {
    this.page.off('console', this.onConsoleMessage)
    this.page.off('pageerror', this.onPageError)
    if (this.testInfo.status === this.testInfo.expectedStatus) return

    const redaction = {
      repoRoot: DEFAULT_REPO_ROOT,
      testRoot: this.testInfo.outputDir,
    }

    await this.attachJson('browser-console', this.consoleEntries, redaction)
    await this.attachJson('page-errors', this.pageErrors, redaction)
    await this.attachJson('page-metadata', await this.collectPageMetadata(), redaction)

    if (this.bridge) {
      const [timelineState, runtimeDiagnostics, playbackTrace] = await Promise.all([
        safeTool(this.bridge, 'getTimelineState', {}, 7_000),
        safeTool(this.bridge, 'getRuntimeDiagnostics', { limit: 500 }, 7_000),
        safeTool(this.bridge, 'getPlaybackTrace', { windowMs: 15_000, limit: 500 }, 7_000),
      ])
      await this.attachJson('timeline-state', timelineState, redaction)
      await this.attachJson('runtime-diagnostics', runtimeDiagnostics, redaction)
      await this.attachJson('playback-trace', playbackTrace, redaction)
    }

    await this.attachScreenshot()
  }

  private async collectPageMetadata(): Promise<Record<string, unknown>> {
    let documentState: unknown = null
    if (!this.page.isClosed()) {
      try {
        documentState = await this.page.evaluate(() => ({
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
          readyState: document.readyState,
          sessionTabId: sessionStorage.getItem('masterselects.aiBridgeTabId'),
        }))
      } catch (error) {
        documentState = { collectionError: errorMessage(error) }
      }
    }

    return {
      url: this.page.url(),
      viewport: this.page.viewportSize(),
      browserVersion: this.page.context().browser()?.version() ?? null,
      pageClosed: this.page.isClosed(),
      document: documentState,
      testStatus: this.testInfo.status,
      expectedStatus: this.testInfo.expectedStatus,
      retry: this.testInfo.retry,
      workerIndex: this.testInfo.workerIndex,
      parallelIndex: this.testInfo.parallelIndex,
    }
  }

  private async attachJson(
    name: string,
    value: unknown,
    redaction: RedactionContext,
  ): Promise<void> {
    const body = JSON.stringify(redactEvidence(value, redaction), null, 2)
    await this.testInfo.attach(`${name}.json`, {
      body,
      contentType: 'application/json',
    })
  }

  private async attachScreenshot(): Promise<void> {
    if (this.page.isClosed()) return
    try {
      const screenshot = await this.page.screenshot({
        fullPage: true,
        animations: 'disabled',
        timeout: 10_000,
      })
      await this.testInfo.attach('failure-evidence.png', {
        body: screenshot,
        contentType: 'image/png',
      })
    } catch (error) {
      await this.testInfo.attach('failure-screenshot-error.txt', {
        body: errorMessage(error),
        contentType: 'text/plain',
      })
    }
  }
}

interface RedactionContext {
  repoRoot: string
  testRoot: string
}

async function safeTool(
  bridge: BridgeClient,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<BridgeToolResult | { success: false; collectionError: string }> {
  try {
    return await bridge.tool(name, args, { timeoutMs, fetchTimeoutMs: timeoutMs + 2_000 })
  } catch (error) {
    return { success: false, collectionError: errorMessage(error) }
  }
}

function redactEvidence(
  value: unknown,
  context: RedactionContext,
  key = '',
  seen = new WeakSet<object>(),
): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return '[redacted secret]'
  if (typeof value === 'string') return redactString(value, context)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (value === undefined) return null
  if (typeof value !== 'object') return String(value)

  if (seen.has(value)) return '[redacted circular reference]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((entry) => redactEvidence(entry, context, key, seen))
  }

  const result: Record<string, unknown> = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = redactEvidence(entryValue, context, entryKey, seen)
  }
  return result
}

const SECRET_KEY_PATTERN = /(?:authorization|credential|password|secret|token|api[_-]?key)/i

function redactString(value: string, context: RedactionContext): string {
  if (value.startsWith('data:')) {
    const comma = value.indexOf(',')
    const metadata = comma >= 0 ? value.slice(0, comma) : 'data:'
    return `[redacted ${metadata} payload]`
  }
  if (value.length > 512 && /^[a-zA-Z0-9+/=_-]+$/.test(value)) {
    return `[redacted encoded payload, ${value.length} characters]`
  }

  let redacted = replacePath(value, context.testRoot, '<test-output>')
  redacted = replacePath(redacted, context.repoRoot, '<repo-root>')
  redacted = replacePath(redacted, os.homedir(), '<user-home>')
  return redacted
}

function replacePath(value: string, target: string, replacement: string): string {
  if (!target) return value
  const normalizedTarget = path.resolve(target)
  const variants = new Set([
    normalizedTarget,
    normalizedTarget.replace(/\\/g, '/'),
  ])
  let result = value
  for (const variant of variants) {
    result = result.replaceAll(variant, replacement)
  }
  return result
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
