import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type BridgeToolArgs = Record<string, unknown>

export interface BridgeToolResult<TData = unknown> {
  success: boolean
  data?: TData
  error?: string
}

export interface BridgeClientTab {
  tabId: string
  visibilityState: string
  hasFocus: boolean
  lastSeenAgoMs: number
  unresponsiveForMs: number
}

export interface BridgeStatus {
  status: string
  pending: number
  clients: number
  clientTabs: BridgeClientTab[]
}

export interface BridgeTargetReadiness {
  status: BridgeStatus
  tab: BridgeClientTab
  pollCount: number
  waitedMs: number
}

export interface BridgeClientOptions {
  baseURL: string
  targetTabId: string
  tokenPath?: string
  defaultToolTimeoutMs?: number
  targetFreshnessMs?: number
}

export interface WaitForBridgeTargetOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  requireVisible?: boolean
  requireFocused?: boolean
}

export interface BridgeToolOptions {
  timeoutMs?: number
  fetchTimeoutMs?: number
}

export type BridgeDebugActionOptions = BridgeToolOptions

interface BridgeErrorBody {
  error?: string
}

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_REPO_ROOT = path.resolve(FIXTURES_DIR, '..', '..', '..')
const CANONICAL_TOKEN_PATH = path.join(DEFAULT_REPO_ROOT, '.ai-bridge-token')
const DEFAULT_TOOL_TIMEOUT_MS = 35_000
const DEFAULT_TARGET_FRESHNESS_MS = 10_000

export class BridgeHttpError extends Error {
  readonly status: number
  readonly responseBody: unknown

  constructor(message: string, status: number, responseBody: unknown) {
    super(message)
    this.name = 'BridgeHttpError'
    this.status = status
    this.responseBody = responseBody
  }
}

/**
 * Node-side client for the authenticated Vite development bridge.
 *
 * A client is permanently bound to one known browser tab. Every tool request
 * contains that tab id, so another editor tab can never accidentally receive a
 * Playwright fixture mutation or diagnostic request.
 */
export class BridgeClient {
  readonly baseURL: string
  readonly targetTabId: string
  readonly tokenPath: string
  readonly defaultToolTimeoutMs: number
  readonly targetFreshnessMs: number

  private readonly apiURL: URL
  private readonly authCheckURL: URL
  private cachedToken: string | null = null

  constructor(options: BridgeClientOptions) {
    const targetTabId = options.targetTabId.trim()
    if (!targetTabId) {
      throw new Error('BridgeClient requires an explicit, non-empty targetTabId')
    }

    const parsedBaseURL = new URL(options.baseURL)
    if (parsedBaseURL.protocol !== 'http:' && parsedBaseURL.protocol !== 'https:') {
      throw new Error(`Unsupported bridge URL protocol: ${parsedBaseURL.protocol}`)
    }

    this.baseURL = parsedBaseURL.origin
    this.targetTabId = targetTabId
    this.tokenPath = path.resolve(options.tokenPath ?? defaultTokenPath(parsedBaseURL))
    this.defaultToolTimeoutMs = positiveInteger(
      options.defaultToolTimeoutMs,
      DEFAULT_TOOL_TIMEOUT_MS,
    )
    this.targetFreshnessMs = positiveInteger(
      options.targetFreshnessMs,
      DEFAULT_TARGET_FRESHNESS_MS,
    )
    this.apiURL = new URL('/api/ai-tools', parsedBaseURL)
    this.authCheckURL = new URL('/api/ai-tools/auth-check', parsedBaseURL)
  }

  async getStatus(timeoutMs = 5_000): Promise<BridgeStatus> {
    const raw = await this.fetchJson(this.apiURL, { method: 'GET' }, timeoutMs)
    return parseBridgeStatus(raw)
  }

  async authenticate(timeoutMs = 5_000): Promise<void> {
    const result = await this.authenticatedFetch(
      this.authCheckURL,
      { method: 'GET' },
      timeoutMs,
    )
    if (!isRecord(result) || result.status !== 'ok') {
      throw new Error('Bridge auth check returned an unexpected response')
    }
  }

  async waitForTarget(
    options: WaitForBridgeTargetOptions = {},
  ): Promise<BridgeTargetReadiness> {
    const timeoutMs = nonNegativeInteger(options.timeoutMs, 30_000)
    const pollIntervalMs = positiveInteger(options.pollIntervalMs, 200)
    const startedAt = Date.now()
    const deadline = startedAt + timeoutMs
    let pollCount = 0
    let lastError: unknown

    do {
      pollCount += 1
      try {
        const status = await this.getStatus(Math.min(5_000, Math.max(1_000, timeoutMs)))
        const tab = status.clientTabs.find((candidate) => candidate.tabId === this.targetTabId)
        if (tab && this.isTargetReady(tab, options)) {
          return {
            status,
            tab,
            pollCount,
            waitedMs: Date.now() - startedAt,
          }
        }
        lastError = new Error(
          tab
            ? `Bridge tab ${this.targetTabId} is registered but not ready`
            : `Bridge tab ${this.targetTabId} is not registered`,
        )
      } catch (error) {
        lastError = error
      }

      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) break
      await sleep(Math.min(pollIntervalMs, remainingMs))
    } while (Date.now() <= deadline)

    const reason = lastError instanceof Error ? `: ${lastError.message}` : ''
    throw new Error(
      `Timed out after ${Date.now() - startedAt}ms waiting for bridge tab ${this.targetTabId}${reason}`,
    )
  }

  async tool<TData = unknown, TArgs extends BridgeToolArgs = BridgeToolArgs>(
    name: string,
    args?: TArgs,
    options: BridgeToolOptions = {},
  ): Promise<BridgeToolResult<TData>> {
    const toolName = name.trim()
    if (!toolName) {
      throw new Error('Bridge tool name must not be empty')
    }

    const timeoutMs = positiveInteger(options.timeoutMs, this.defaultToolTimeoutMs)
    const fetchTimeoutMs = positiveInteger(options.fetchTimeoutMs, timeoutMs + 5_000)
    const result = await this.authenticatedFetch(
      this.apiURL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: toolName,
          args: args ?? {},
          timeoutMs,
          targetTabId: this.targetTabId,
        }),
      },
      fetchTimeoutMs,
    )

    if (!isRecord(result) || typeof result.success !== 'boolean') {
      throw new Error(`Bridge tool ${toolName} returned an invalid result envelope`)
    }
    return result as unknown as BridgeToolResult<TData>
  }

  async toolData<TData = unknown, TArgs extends BridgeToolArgs = BridgeToolArgs>(
    name: string,
    args?: TArgs,
    options: BridgeToolOptions = {},
  ): Promise<TData> {
    const result = await this.tool<TData, TArgs>(name, args, options)
    if (!result.success) {
      throw new Error(`${name}: ${result.error ?? 'bridge tool failed'}`)
    }
    if (result.data === undefined) {
      throw new Error(`${name}: bridge tool succeeded without a data payload`)
    }
    return result.data
  }

  async debugAction<TData = unknown, TArgs extends BridgeToolArgs = BridgeToolArgs>(
    action: string,
    args?: TArgs,
    options: BridgeDebugActionOptions = {},
  ): Promise<BridgeToolResult<TData>> {
    const actionName = action.trim()
    if (!actionName) throw new Error('Bridge debug action name must not be empty')

    const timeoutMs = positiveInteger(options.timeoutMs, this.defaultToolTimeoutMs)
    const fetchTimeoutMs = positiveInteger(options.fetchTimeoutMs, timeoutMs + 5_000)
    const result = await this.authenticatedFetch(
      new URL('/api/debug/action', this.baseURL),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionName,
          args: args ?? {},
          timeoutMs,
          targetTabId: this.targetTabId,
        }),
      },
      fetchTimeoutMs,
    )

    if (!isRecord(result) || typeof result.success !== 'boolean') {
      throw new Error(`Bridge debug action ${actionName} returned an invalid result envelope`)
    }
    return result as unknown as BridgeToolResult<TData>
  }

  async debugActionData<TData = unknown, TArgs extends BridgeToolArgs = BridgeToolArgs>(
    action: string,
    args?: TArgs,
    options: BridgeDebugActionOptions = {},
  ): Promise<TData> {
    const result = await this.debugAction<TData, TArgs>(action, args, options)
    if (!result.success) {
      throw new Error(`${action}: ${result.error ?? 'bridge debug action failed'}`)
    }
    if (result.data === undefined) {
      throw new Error(`${action}: bridge debug action succeeded without a data payload`)
    }
    return result.data
  }

  private isTargetReady(
    tab: BridgeClientTab,
    options: WaitForBridgeTargetOptions,
  ): boolean {
    return tab.lastSeenAgoMs <= this.targetFreshnessMs
      && tab.unresponsiveForMs <= 0
      && (!options.requireVisible || tab.visibilityState === 'visible')
      && (!options.requireFocused || tab.hasFocus)
  }

  private async authenticatedFetch(
    url: URL,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<unknown> {
    let token = await this.readToken(false)
    try {
      return await this.fetchJson(url, withBearer(init, token), timeoutMs)
    } catch (error) {
      if (!(error instanceof BridgeHttpError) || error.status !== 401) {
        throw error
      }
      token = await this.readToken(true)
      return this.fetchJson(url, withBearer(init, token), timeoutMs)
    }
  }

  private async readToken(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh && this.cachedToken) return this.cachedToken

    let token: string
    try {
      token = (await readFile(this.tokenPath, 'utf8')).trim()
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : ''
      throw new Error(`Could not read bridge token at ${this.tokenPath}${reason}`)
    }
    if (!token) {
      throw new Error(`Bridge token file is empty: ${this.tokenPath}`)
    }
    this.cachedToken = token
    return token
  }

  private async fetchJson(url: URL, init: RequestInit, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), positiveInteger(timeoutMs, 5_000))
    try {
      let response: Response
      try {
        response = await fetch(url, { ...init, signal: controller.signal })
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error(`Bridge request timed out after ${timeoutMs}ms: ${url.pathname}`)
        }
        throw error
      }

      const text = await response.text()
      const parsed = parseJsonResponse(text, response.status, url.pathname)
      if (!response.ok) {
        const message = isRecord(parsed) && typeof parsed.error === 'string'
          ? parsed.error
          : response.statusText
        throw new BridgeHttpError(
          `Bridge request failed with HTTP ${response.status}: ${message}`,
          response.status,
          parsed as BridgeErrorBody,
        )
      }
      return parsed
    } finally {
      clearTimeout(timer)
    }
  }
}

function defaultTokenPath(baseURL: URL): string {
  const configured = process.env.MASTERSELECTS_BRIDGE_TOKEN_FILE?.trim()
  if (configured) return path.resolve(DEFAULT_REPO_ROOT, configured)

  const port = baseURL.port || (baseURL.protocol === 'https:' ? '443' : '80')
  if (port === '5173') return CANONICAL_TOKEN_PATH
  return path.join(
    DEFAULT_REPO_ROOT,
    'test-results',
    'playwright',
    `.ai-bridge-token-${port}`,
  )
}

function parseBridgeStatus(value: unknown): BridgeStatus {
  if (!isRecord(value) || !Array.isArray(value.clientTabs)) {
    throw new Error('Bridge status returned an invalid response')
  }

  const clientTabs = value.clientTabs.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.tabId !== 'string') {
      throw new Error(`Bridge status contains an invalid tab at index ${index}`)
    }
    return {
      tabId: entry.tabId,
      visibilityState: typeof entry.visibilityState === 'string'
        ? entry.visibilityState
        : 'hidden',
      hasFocus: entry.hasFocus === true,
      lastSeenAgoMs: finiteNumber(entry.lastSeenAgoMs, Number.MAX_SAFE_INTEGER),
      unresponsiveForMs: finiteNumber(entry.unresponsiveForMs, 0),
    }
  })

  return {
    status: typeof value.status === 'string' ? value.status : 'unknown',
    pending: finiteNumber(value.pending, 0),
    clients: finiteNumber(value.clients, clientTabs.length),
    clientTabs,
  }
}

function parseJsonResponse(text: string, status: number, pathname: string): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(
      `Bridge returned non-JSON content for ${pathname} (HTTP ${status}): ${text.slice(0, 240)}`,
    )
  }
}

function withBearer(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return { ...init, headers }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
