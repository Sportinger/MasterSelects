import type { IncomingMessage, ServerResponse } from 'http'
import type { ViteDevServer } from 'vite'

import {
  sanitizeBridgeTimeoutMs,
  validateBridgeRequest,
} from './auth.ts'
import {
  BridgeTraceStore,
  type BridgeToolSurface,
  type BridgeToolTrace,
} from './traceStore.ts'

const AGENT_CONTROL_MAX_BODY_BYTES = 2 * 1024 * 1024

export interface AgentControlSession {
  hasFocus: boolean
  lastSeenAt: number
  session: Record<string, unknown> | null
  sessionId: string
  unresponsiveUntil?: number
  visibilityState: string
}

interface AgentControlDispatchRequest {
  args?: Record<string, unknown>
  operation: string
  sessionId?: string | null
  timeoutMs?: number
}

interface AgentControlDispatchResult {
  result: unknown
  sessionId: string
}

export interface AgentControlEndpointDependencies {
  dispatch: (request: AgentControlDispatchRequest) => Promise<AgentControlDispatchResult>
  listSessions: () => AgentControlSession[]
  traceStore: BridgeTraceStore
}

interface AgentControlCallBody {
  args?: unknown
  confirm?: unknown
  dryRun?: unknown
  idempotencyKey?: unknown
  options?: unknown
  replayOf?: unknown
  sessionId?: unknown
  surface?: unknown
  timeoutMs?: unknown
  tool?: unknown
}

export function installAgentControlEndpoints(
  server: ViteDevServer,
  dependencies: AgentControlEndpointDependencies,
): void {
  server.middlewares.use('/api/agent-control', async (req, res) => {
    if (!validateBridgeRequest(req, res)) return

    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const pathParts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)

      if (req.method === 'GET' && pathParts.length === 1 && pathParts[0] === 'sessions') {
        sendJson(res, 200, {
          success: true,
          data: {
            sessions: dependencies.listSessions().map(toPublicSession),
          },
        })
        return
      }

      if (req.method === 'GET' && pathParts[0] === 'tools') {
        await handleToolsRequest(res, url, pathParts[1], dependencies)
        return
      }

      if (req.method === 'GET' && pathParts.length === 1 && pathParts[0] === 'history') {
        await handleHistoryRequest(res, url, dependencies)
        return
      }

      if (req.method === 'GET' && pathParts.length === 2 && pathParts[0] === 'calls') {
        await handleCallResultRequest(res, pathParts[1]!, url, dependencies)
        return
      }

      if (req.method === 'POST' && pathParts.length === 1 && pathParts[0] === 'call') {
        const body = await readJsonBody(req) as AgentControlCallBody
        await handleToolCall(res, req, body, dependencies)
        return
      }

      if (req.method === 'POST' && pathParts.length === 1 && pathParts[0] === 'replay') {
        const body = await readJsonBody(req) as AgentControlCallBody & {
          argumentsOverride?: unknown
          callId?: unknown
        }
        await handleReplay(res, body, dependencies)
        return
      }

      sendJson(res, 404, { success: false, error: 'Unknown agent-control endpoint.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const statusCode = /body too large/i.test(message)
        ? 413
        : /unknown or stale bridge session/i.test(message)
          ? 404
          : /timeout/i.test(message)
            ? 504
            : 400
      sendJson(res, statusCode, {
        success: false,
        error: message,
      })
    }
  })
}

async function handleToolsRequest(
  res: ServerResponse,
  url: URL,
  toolName: string | undefined,
  dependencies: AgentControlEndpointDependencies,
): Promise<void> {
  const sessionId = readOptionalString(url.searchParams.get('sessionId'))
  const surface = normalizeSurface(url.searchParams.get('surface'))
  const dispatched = await dependencies.dispatch({
    operation: toolName ? 'getToolSchema' : 'listTools',
    sessionId,
    args: toolName ? { surface, tool: toolName } : { surface },
  })
  sendJson(res, 200, attachSessionId(dispatched))
}

async function handleHistoryRequest(
  res: ServerResponse,
  url: URL,
  dependencies: AgentControlEndpointDependencies,
): Promise<void> {
  const sessionId = readOptionalString(url.searchParams.get('sessionId'))
  const surface = normalizeOptionalSurface(url.searchParams.get('surface'))
  const limit = normalizeLimit(url.searchParams.get('limit'))
  const dispatched = await dependencies.dispatch({
    operation: 'getHistory',
    sessionId,
    args: {
      includeMessages: url.searchParams.get('includeMessages') !== 'false',
      limit,
      tool: readOptionalString(url.searchParams.get('tool')),
    },
  })
  const browserResult = readSuccessData(dispatched.result)
  const bridgeCalls = dependencies.traceStore.list({
    limit,
    sessionId: dispatched.sessionId,
    surface,
    tool: readOptionalString(url.searchParams.get('tool')) ?? undefined,
  })

  sendJson(res, 200, {
    success: true,
    data: {
      bridgeCalls,
      browser: browserResult,
      sessionId: dispatched.sessionId,
    },
  })
}

async function handleCallResultRequest(
  res: ServerResponse,
  callId: string,
  url: URL,
  dependencies: AgentControlEndpointDependencies,
): Promise<void> {
  const bridgeCall = dependencies.traceStore.get(callId)
  if (bridgeCall) {
    sendJson(res, 200, { success: true, data: bridgeCall })
    return
  }

  const dispatched = await dependencies.dispatch({
    operation: 'getCall',
    sessionId: readOptionalString(url.searchParams.get('sessionId')),
    args: { callId },
  })
  sendJson(res, 200, attachSessionId(dispatched))
}

async function handleToolCall(
  res: ServerResponse,
  req: IncomingMessage,
  body: AgentControlCallBody,
  dependencies: AgentControlEndpointDependencies,
): Promise<void> {
  const tool = readRequiredString(body.tool)
  if (!tool) {
    sendJson(res, 400, { success: false, error: 'Missing "tool" field.' })
    return
  }

  const requestedSessionId = readOptionalString(body.sessionId)
  const surface = normalizeSurface(body.surface)
  const args = isRecord(body.args) ? body.args : {}
  const timeoutMs = sanitizeBridgeTimeoutMs(body.timeoutMs, 30000)
  const idempotencyKey = readOptionalString(body.idempotencyKey)
  if (
    requestedSessionId
    && !dependencies.listSessions().some((session) => session.sessionId === requestedSessionId)
  ) {
    sendJson(res, 404, {
      success: false,
      error: `Unknown or stale bridge session: ${requestedSessionId}`,
    })
    return
  }
  const resolvedSessionId = resolveSessionId(requestedSessionId, dependencies)
  if (!resolvedSessionId) {
    sendJson(res, 503, { success: false, error: 'No browser tab connected to the dev bridge.' })
    return
  }

  if (idempotencyKey) {
    const existing = dependencies.traceStore.findByIdempotencyKey(idempotencyKey, resolvedSessionId)
    if (existing) {
      sendJson(res, 200, {
        success: existing.status === 'succeeded',
        callId: existing.callId,
        data: existing.result,
        deduplicated: true,
        sessionId: resolvedSessionId,
        status: existing.status,
      })
      return
    }
  }

  const confirmation = await checkExecutionConfirmation({
    confirm: body.confirm === true,
    dependencies,
    dryRun: body.dryRun === true,
    sessionId: resolvedSessionId,
    surface,
    tool,
  })
  if (confirmation) {
    sendJson(res, 200, confirmation)
    return
  }

  await executeAndTraceCall(res, {
    args,
    dependencies,
    idempotencyKey,
    options: body.options,
    replayOf: readOptionalString(body.replayOf),
    requestSource: getRequestSource(req),
    sessionId: resolvedSessionId,
    surface,
    timeoutMs,
    tool,
  })
}

async function handleReplay(
  res: ServerResponse,
  body: AgentControlCallBody & { argumentsOverride?: unknown; callId?: unknown },
  dependencies: AgentControlEndpointDependencies,
): Promise<void> {
  const callId = readRequiredString(body.callId)
  if (!callId) {
    sendJson(res, 400, { success: false, error: 'Missing "callId" field.' })
    return
  }

  const requestedSessionId = readOptionalString(body.sessionId)
  let original: BridgeToolTrace | Record<string, unknown> | null = dependencies.traceStore.get(callId)
  let sessionId = requestedSessionId ?? (original && 'sessionId' in original
    ? readOptionalString(original.sessionId)
    : null)

  if (!original) {
    const dispatched = await dependencies.dispatch({
      operation: 'getCall',
      sessionId,
      args: { callId },
    })
    sessionId = dispatched.sessionId
    original = readSuccessData(dispatched.result)
  }

  if (!original) {
    sendJson(res, 404, { success: false, error: `Tool call "${callId}" was not found.` })
    return
  }

  const tool = readRequiredString(original.tool)
  const surface = normalizeSurface(body.surface ?? original.surface)
  const originalArgs = isRecord(original.args) ? original.args : {}
  const args = isRecord(body.argumentsOverride) ? body.argumentsOverride : originalArgs
  if (!tool || !sessionId) {
    sendJson(res, 409, { success: false, error: 'The stored call is missing its tool or session.' })
    return
  }

  const confirmation = await checkExecutionConfirmation({
    confirm: body.confirm === true,
    dependencies,
    dryRun: body.dryRun === true,
    sessionId,
    surface,
    tool,
  })
  if (confirmation) {
    sendJson(res, 200, { ...confirmation, replayOf: callId })
    return
  }

  await executeAndTraceCall(res, {
    args,
    dependencies,
    idempotencyKey: readOptionalString(body.idempotencyKey),
    options: body.options,
    replayOf: callId,
    requestSource: 'replay',
    sessionId,
    surface,
    timeoutMs: sanitizeBridgeTimeoutMs(body.timeoutMs, 30000),
    tool,
  })
}

async function checkExecutionConfirmation(input: {
  confirm: boolean
  dependencies: AgentControlEndpointDependencies
  dryRun: boolean
  sessionId: string
  surface: BridgeToolSurface
  tool: string
}): Promise<Record<string, unknown> | null> {
  const schemaResult = await input.dependencies.dispatch({
    operation: 'getToolSchema',
    sessionId: input.sessionId,
    args: { surface: input.surface, tool: input.tool },
  })
  const descriptor = readSuccessData(schemaResult.result)
  if (!descriptor) {
    return {
      success: false,
      error: `Tool "${input.tool}" is unavailable on the ${input.surface} surface.`,
      sessionId: input.sessionId,
    }
  }

  const policy = isRecord(descriptor.policy) ? descriptor.policy : {}
  const requiresConfirmation = input.surface === 'devBridge'
    && (
      policy.readOnly === false
      || policy.requiresConfirmation === true
      || policy.localFileAccess === true
      || policy.sensitiveDataAccess === true
    )

  if (input.dryRun) {
    return {
      success: true,
      data: {
        dryRun: true,
        requiresConfirmation,
        schema: descriptor,
      },
      sessionId: input.sessionId,
    }
  }
  if (requiresConfirmation && !input.confirm) {
    return {
      success: false,
      confirmationRequired: true,
      data: {
        message: `Tool "${input.tool}" can modify state or access sensitive data. Repeat with "confirm": true.`,
        policy,
        tool: input.tool,
      },
      sessionId: input.sessionId,
    }
  }
  return null
}

async function executeAndTraceCall(
  res: ServerResponse,
  input: {
    args: Record<string, unknown>
    dependencies: AgentControlEndpointDependencies
    idempotencyKey: string | null
    options: unknown
    replayOf: string | null
    requestSource: BridgeToolTrace['source']
    sessionId: string
    surface: BridgeToolSurface
    timeoutMs: number
    tool: string
  },
): Promise<void> {
  const trace = input.dependencies.traceStore.begin({
    args: input.args,
    idempotencyKey: input.idempotencyKey ?? undefined,
    options: input.options,
    replayOf: input.replayOf ?? undefined,
    sessionId: input.sessionId,
    source: input.requestSource,
    surface: input.surface,
    tool: input.tool,
  })

  try {
    const dispatched = await input.dependencies.dispatch({
      operation: 'executeTool',
      sessionId: input.sessionId,
      timeoutMs: input.timeoutMs,
      args: {
        args: input.args,
        options: input.options,
        surface: input.surface,
        tool: input.tool,
      },
    })
    const result = dispatched.result
    const error = readResultError(result)
    const completed = input.dependencies.traceStore.complete(trace.callId, { error, result })
    sendJson(res, 200, {
      success: readResultSuccess(result),
      callId: trace.callId,
      data: result,
      durationMs: completed?.durationMs,
      error,
      replayOf: input.replayOf,
      sessionId: dispatched.sessionId,
      surface: input.surface,
      tool: input.tool,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const completed = input.dependencies.traceStore.complete(trace.callId, {
      error: message,
      result: { success: false, error: message },
      status: /timeout/i.test(message) ? 'timeout' : 'failed',
    })
    sendJson(res, /not connected|unknown session/i.test(message) ? 404 : 200, {
      success: false,
      callId: trace.callId,
      durationMs: completed?.durationMs,
      error: message,
      replayOf: input.replayOf,
      sessionId: input.sessionId,
      surface: input.surface,
      tool: input.tool,
    })
  }
}

function resolveSessionId(
  requestedSessionId: string | null,
  dependencies: AgentControlEndpointDependencies,
): string | null {
  const sessions = dependencies.listSessions()
  if (requestedSessionId) {
    return sessions.some((session) => session.sessionId === requestedSessionId)
      ? requestedSessionId
      : null
  }
  const focused = sessions.find((session) => session.visibilityState === 'visible' && session.hasFocus)
  const visible = sessions.find((session) => session.visibilityState === 'visible')
  return (focused ?? visible ?? sessions[0])?.sessionId ?? null
}

function toPublicSession(session: AgentControlSession): Record<string, unknown> {
  const now = Date.now()
  return {
    ...session.session,
    hasFocus: session.hasFocus,
    lastSeenAgoMs: Math.max(0, now - session.lastSeenAt),
    sessionId: session.sessionId,
    unresponsiveForMs: session.unresponsiveUntil && session.unresponsiveUntil > now
      ? session.unresponsiveUntil - now
      : 0,
    visibilityState: session.visibilityState,
  }
}

function attachSessionId(dispatched: AgentControlDispatchResult): unknown {
  if (isRecord(dispatched.result)) {
    return { ...dispatched.result, sessionId: dispatched.sessionId }
  }
  return { success: true, data: dispatched.result, sessionId: dispatched.sessionId }
}

function readSuccessData(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result) || result.success !== true || !isRecord(result.data)) return null
  return result.data
}

function readResultSuccess(result: unknown): boolean {
  return !isRecord(result) || result.success !== false
}

function readResultError(result: unknown): string | undefined {
  return isRecord(result) && typeof result.error === 'string' ? result.error : undefined
}

function normalizeSurface(value: unknown): BridgeToolSurface {
  return value === 'devBridge' ? 'devBridge' : 'chat'
}

function normalizeOptionalSurface(value: unknown): BridgeToolSurface | undefined {
  return value === 'chat' || value === 'devBridge' ? value : undefined
}

function normalizeLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? Math.max(1, Math.min(2_000, Math.round(parsed)))
    : 500
}

function getRequestSource(req: IncomingMessage): BridgeToolTrace['source'] {
  return req.headers['x-masterselects-bridge-client'] === 'mcp' ? 'mcp' : 'http'
}

function readRequiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalString(value: unknown): string | null {
  const normalized = readRequiredString(value)
  return normalized || null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  if (res.writableEnded) return
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > AGENT_CONTROL_MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('Invalid JSON body.'))
      }
    })
    req.on('error', reject)
  })
}
