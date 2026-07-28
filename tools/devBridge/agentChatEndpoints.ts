import type { IncomingMessage, ServerResponse } from 'http'
import type { ViteDevServer } from 'vite'

import {
  sanitizeBridgeTimeoutMs,
  validateBridgeRequest,
} from './auth.ts'

const MAX_BODY_BYTES = 2 * 1024 * 1024

interface AgentChatDispatchRequest {
  args?: Record<string, unknown>
  operation: string
  sessionId?: string | null
  timeoutMs?: number
}

interface AgentChatDispatchResult {
  result: unknown
  sessionId: string
}

interface AgentChatSession {
  sessionId: string
}

interface AgentChatEndpointDependencies {
  dispatch: (request: AgentChatDispatchRequest) => Promise<AgentChatDispatchResult>
  listSessions: () => AgentChatSession[]
}

interface AgentChatBody {
  confirm?: unknown
  dryRun?: unknown
  idempotencyKey?: unknown
  includeContext?: unknown
  includeHistory?: unknown
  includePlaybook?: unknown
  model?: unknown
  openAiReasoningEffort?: unknown
  persistToChat?: unknown
  prompt?: unknown
  promptVersion?: unknown
  provider?: unknown
  sessionId?: unknown
  systemPromptOverride?: unknown
  temperature?: unknown
  timeoutMs?: unknown
  toolExecutionMode?: unknown
}

export function installAgentChatEndpoints(
  server: ViteDevServer,
  dependencies: AgentChatEndpointDependencies,
): void {
  server.middlewares.use('/api/agent-chat', async (req, res) => {
    if (!validateBridgeRequest(req, res)) return

    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'prompt') {
        await handlePromptRequest(res, url, dependencies)
        return
      }
      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'runs') {
        await handleListRuns(res, url, dependencies)
        return
      }
      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'runs') {
        await handleGetRun(res, parts[1]!, url, dependencies)
        return
      }
      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'turn') {
        await handleChatTurn(req, res, await readJsonBody(req), dependencies)
        return
      }
      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'compare') {
        await handlePromptComparison(req, res, await readJsonBody(req), dependencies)
        return
      }

      sendJson(res, 404, { success: false, error: 'Unknown agent-chat endpoint.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = /unknown or stale/i.test(message)
        ? 404
        : /timeout/i.test(message)
          ? 504
          : /body too large/i.test(message)
            ? 413
            : 400
      sendJson(res, status, { success: false, error: message })
    }
  })
}

async function handlePromptRequest(
  res: ServerResponse,
  url: URL,
  dependencies: AgentChatEndpointDependencies,
): Promise<void> {
  const dispatched = await dependencies.dispatch({
    operation: 'getChatPrompt',
    sessionId: resolveRequestedSessionId(url.searchParams.get('sessionId'), dependencies),
    args: {
      includeContext: url.searchParams.get('includeContext') !== 'false',
      includePlaybook: url.searchParams.get('includePlaybook') !== 'false',
      prompt: readOptionalString(url.searchParams.get('prompt')),
      promptVersion: normalizePromptVersion(url.searchParams.get('promptVersion')),
    },
  })
  sendJson(res, 200, attachSessionId(dispatched))
}

async function handleListRuns(
  res: ServerResponse,
  url: URL,
  dependencies: AgentChatEndpointDependencies,
): Promise<void> {
  const dispatched = await dependencies.dispatch({
    operation: 'listChatRuns',
    sessionId: resolveRequestedSessionId(url.searchParams.get('sessionId'), dependencies),
    args: {
      limit: normalizeLimit(url.searchParams.get('limit')),
      source: readOptionalString(url.searchParams.get('source')),
    },
  })
  sendJson(res, 200, attachSessionId(dispatched))
}

async function handleGetRun(
  res: ServerResponse,
  runId: string,
  url: URL,
  dependencies: AgentChatEndpointDependencies,
): Promise<void> {
  const dispatched = await dependencies.dispatch({
    operation: 'getChatRun',
    sessionId: resolveRequestedSessionId(url.searchParams.get('sessionId'), dependencies),
    args: { runId },
  })
  sendJson(res, 200, attachSessionId(dispatched))
}

async function handleChatTurn(
  req: IncomingMessage,
  res: ServerResponse,
  body: AgentChatBody,
  dependencies: AgentChatEndpointDependencies,
): Promise<void> {
  const prompt = readRequiredString(body.prompt)
  if (!prompt) {
    sendJson(res, 400, { success: false, error: 'Missing "prompt" field.' })
    return
  }
  const sessionId = resolveRequestedSessionId(body.sessionId, dependencies)
  const idempotencyKey = readOptionalString(body.idempotencyKey)
  if (idempotencyKey) {
    const duplicate = await findDuplicateRun(idempotencyKey, sessionId, dependencies)
    if (duplicate) {
      if (readOptionalString(duplicate.prompt) !== prompt) {
        sendJson(res, 409, {
          success: false,
          error: 'The idempotency key already belongs to a different chat prompt.',
        })
        return
      }
      sendJson(res, 200, {
        success: duplicate.status === 'succeeded',
        data: duplicate,
        deduplicated: true,
        sessionId,
        status: duplicate.status,
      })
      return
    }
  }

  const toolExecutionMode = normalizeToolExecutionMode(body.toolExecutionMode)
  if (body.dryRun === true) {
    sendJson(res, 200, {
      success: true,
      data: {
        dryRun: true,
        estimatedProviderRounds: 1,
        promptVersion: normalizePromptVersion(body.promptVersion) ?? 'v2',
        toolExecutionMode,
      },
      sessionId,
    })
    return
  }
  if (body.confirm !== true) {
    sendJson(res, 200, {
      success: false,
      confirmationRequired: true,
      data: {
        message: toolExecutionMode === 'read-only'
          ? 'This chat turn can incur provider cost. Repeat with "confirm": true.'
          : 'This chat turn can incur provider cost and may mutate the editor. Repeat with "confirm": true.',
      },
      sessionId,
    })
    return
  }

  const dispatched = await dependencies.dispatch({
    operation: 'sendChatTurn',
    sessionId,
    timeoutMs: sanitizeBridgeTimeoutMs(body.timeoutMs, 180000),
    args: toChatArgs(req, body, prompt, idempotencyKey, toolExecutionMode),
  })
  sendJson(res, 200, attachSessionId(dispatched))
}

async function handlePromptComparison(
  req: IncomingMessage,
  res: ServerResponse,
  body: AgentChatBody,
  dependencies: AgentChatEndpointDependencies,
): Promise<void> {
  const prompt = readRequiredString(body.prompt)
  if (!prompt) {
    sendJson(res, 400, { success: false, error: 'Missing "prompt" field.' })
    return
  }
  const sessionId = resolveRequestedSessionId(body.sessionId, dependencies)
  if (body.dryRun === true) {
    sendJson(res, 200, {
      success: true,
      data: {
        dryRun: true,
        estimatedProviderRounds: 2,
        promptVersions: ['legacy-v1', 'v2'],
        toolExecutionMode: 'read-only',
      },
      sessionId,
    })
    return
  }
  if (body.confirm !== true) {
    sendJson(res, 200, {
      success: false,
      confirmationRequired: true,
      data: {
        message: 'A/B comparison makes two read-only provider runs and may incur two round charges. Repeat with "confirm": true.',
      },
      sessionId,
    })
    return
  }

  const dispatched = await dependencies.dispatch({
    operation: 'compareChatPrompts',
    sessionId,
    timeoutMs: sanitizeBridgeTimeoutMs(body.timeoutMs, 300000),
    args: {
      ...toChatArgs(req, body, prompt, null, 'read-only'),
      includeHistory: body.includeHistory === true,
      persistToChat: false,
    },
  })
  sendJson(res, 200, attachSessionId(dispatched))
}

async function findDuplicateRun(
  idempotencyKey: string,
  sessionId: string,
  dependencies: AgentChatEndpointDependencies,
): Promise<Record<string, unknown> | null> {
  const dispatched = await dependencies.dispatch({
    operation: 'findChatRunByIdempotencyKey',
    sessionId,
    args: { idempotencyKey },
  })
  return readSuccessData(dispatched.result)
}

function toChatArgs(
  req: IncomingMessage,
  body: AgentChatBody,
  prompt: string,
  idempotencyKey: string | null,
  toolExecutionMode: 'normal' | 'read-only',
): Record<string, unknown> {
  return {
    idempotencyKey: idempotencyKey ?? undefined,
    includeContext: readOptionalBoolean(body.includeContext),
    includeHistory: readOptionalBoolean(body.includeHistory),
    includePlaybook: readOptionalBoolean(body.includePlaybook),
    model: readOptionalString(body.model),
    openAiReasoningEffort: readOptionalString(body.openAiReasoningEffort),
    persistToChat: readOptionalBoolean(body.persistToChat),
    prompt,
    promptVersion: normalizePromptVersion(body.promptVersion),
    provider: readOptionalString(body.provider),
    runSource: req.headers['x-masterselects-bridge-client'] === 'mcp' ? 'mcp' : 'bridge',
    systemPromptOverride: readOptionalString(body.systemPromptOverride),
    temperature: readOptionalNumber(body.temperature),
    toolExecutionMode,
  }
}

function resolveRequestedSessionId(
  value: unknown,
  dependencies: AgentChatEndpointDependencies,
): string {
  const requested = readOptionalString(value)
  const sessions = dependencies.listSessions()
  if (requested && !sessions.some((session) => session.sessionId === requested)) {
    throw new Error(`Unknown or stale bridge session: ${requested}`)
  }
  const resolved = requested ?? sessions[0]?.sessionId
  if (!resolved) throw new Error('No browser tab connected to the dev bridge')
  return resolved
}

function attachSessionId(dispatched: AgentChatDispatchResult): Record<string, unknown> {
  const result = isRecord(dispatched.result)
    ? dispatched.result
    : { success: true, data: dispatched.result }
  return { ...result, sessionId: dispatched.sessionId }
}

function readSuccessData(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) return null
  return value.data
}

function readJsonBody(req: IncomingMessage): Promise<AgentChatBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        resolve(isRecord(parsed) ? parsed : {})
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function normalizeToolExecutionMode(value: unknown): 'normal' | 'read-only' {
  return value === 'read-only' ? 'read-only' : 'normal'
}

function normalizePromptVersion(value: unknown): 'v2' | 'legacy-v1' | undefined {
  return value === 'v2' || value === 'legacy-v1' ? value : undefined
}

function normalizeLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? Math.max(1, Math.min(2000, Math.round(parsed)))
    : 100
}

function readRequiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}
