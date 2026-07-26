import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { devBridgeRoot } from './auth.ts'

const DEFAULT_TRACE_LIMIT = 2_000
const MAX_LOADED_TRACE_BYTES = 32 * 1024 * 1024
const MAX_TRACE_STRING_LENGTH = 20_000
const MAX_TRACE_ARRAY_LENGTH = 200
const MAX_TRACE_OBJECT_KEYS = 200
const MAX_TRACE_DEPTH = 8
const REDACTED_VALUE = '[REDACTED]'
const OMITTED_BINARY_VALUE = '[binary/image data omitted]'

const SENSITIVE_KEY_PATTERN = /^(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?token|refresh[-_]?token)$/i
const DATA_URL_PATTERN = /^data:(?:image|audio|video|application\/octet-stream)\/?[^;,]*;base64,/i

export type BridgeTraceStatus = 'running' | 'succeeded' | 'failed' | 'timeout'
export type BridgeToolSurface = 'chat' | 'devBridge'

export interface BridgeToolTrace {
  args: Record<string, unknown>
  callId: string
  durationMs?: number
  error?: string
  finishedAt?: string
  idempotencyKey?: string
  options?: unknown
  replayOf?: string
  requestId?: string
  result?: unknown
  sessionId: string | null
  source: 'http' | 'mcp' | 'replay'
  startedAt: string
  status: BridgeTraceStatus
  surface: BridgeToolSurface
  tool: string
}

interface BeginBridgeTraceInput {
  args: Record<string, unknown>
  idempotencyKey?: string
  options?: unknown
  replayOf?: string
  requestId?: string
  sessionId: string | null
  source?: BridgeToolTrace['source']
  surface?: BridgeToolSurface
  tool: string
}

interface ListBridgeTracesOptions {
  limit?: number
  sessionId?: string
  surface?: BridgeToolSurface
  tool?: string
}

export class BridgeTraceStore {
  private readonly traces = new Map<string, BridgeToolTrace>()
  private readonly orderedCallIds: string[] = []
  private readonly traceFilePath: string
  private readonly traceLimit: number

  constructor(
    traceFilePath = path.resolve(devBridgeRoot, '.ai-bridge-tool-history.jsonl'),
    traceLimit = DEFAULT_TRACE_LIMIT,
  ) {
    this.traceFilePath = traceFilePath
    this.traceLimit = traceLimit
    this.loadPersistedTraces()
  }

  begin(input: BeginBridgeTraceInput): BridgeToolTrace {
    const trace: BridgeToolTrace = {
      args: sanitizeTraceValue(input.args) as Record<string, unknown>,
      callId: createBridgeCallId(),
      idempotencyKey: input.idempotencyKey,
      options: sanitizeTraceValue(input.options),
      replayOf: input.replayOf,
      requestId: input.requestId,
      sessionId: input.sessionId,
      source: input.source ?? 'http',
      startedAt: new Date().toISOString(),
      status: 'running',
      surface: input.surface ?? 'devBridge',
      tool: input.tool,
    }
    this.store(trace)
    return trace
  }

  complete(
    callId: string,
    update: {
      error?: string
      result?: unknown
      status?: Exclude<BridgeTraceStatus, 'running'>
    },
  ): BridgeToolTrace | null {
    const current = this.traces.get(callId)
    if (!current) return null

    const finishedAt = new Date()
    const trace: BridgeToolTrace = {
      ...current,
      durationMs: Math.max(0, finishedAt.getTime() - Date.parse(current.startedAt)),
      error: update.error,
      finishedAt: finishedAt.toISOString(),
      result: sanitizeTraceValue(update.result),
      status: update.status ?? inferTraceStatus(update.result, update.error),
    }
    this.store(trace)
    return trace
  }

  get(callId: string): BridgeToolTrace | null {
    return this.traces.get(callId) ?? null
  }

  findByIdempotencyKey(idempotencyKey: string, sessionId: string | null): BridgeToolTrace | null {
    if (!idempotencyKey) return null
    for (let index = this.orderedCallIds.length - 1; index >= 0; index -= 1) {
      const trace = this.traces.get(this.orderedCallIds[index]!)
      if (trace?.idempotencyKey === idempotencyKey && trace.sessionId === sessionId) {
        return trace
      }
    }
    return null
  }

  list(options: ListBridgeTracesOptions = {}): BridgeToolTrace[] {
    const limit = normalizeTraceLimit(options.limit, this.traceLimit)
    const traces: BridgeToolTrace[] = []

    for (let index = this.orderedCallIds.length - 1; index >= 0 && traces.length < limit; index -= 1) {
      const trace = this.traces.get(this.orderedCallIds[index]!)
      if (!trace) continue
      if (options.sessionId && trace.sessionId !== options.sessionId) continue
      if (options.surface && trace.surface !== options.surface) continue
      if (options.tool && trace.tool !== options.tool) continue
      traces.push(trace)
    }

    return traces
  }

  private loadPersistedTraces(): void {
    if (!fs.existsSync(this.traceFilePath)) return

    try {
      const stat = fs.statSync(this.traceFilePath)
      const start = Math.max(0, stat.size - MAX_LOADED_TRACE_BYTES)
      const length = stat.size - start
      if (length <= 0) return

      const buffer = Buffer.alloc(length)
      const handle = fs.openSync(this.traceFilePath, 'r')
      try {
        fs.readSync(handle, buffer, 0, length, start)
      } finally {
        fs.closeSync(handle)
      }

      let text = buffer.toString('utf8')
      if (start > 0) {
        const firstNewline = text.indexOf('\n')
        text = firstNewline >= 0 ? text.slice(firstNewline + 1) : ''
      }

      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const trace = JSON.parse(line) as BridgeToolTrace
          if (trace?.callId && trace?.tool && trace?.startedAt) {
            this.remember(trace)
          }
        } catch {
          // A partial final line can be left behind if the dev server is killed.
        }
      }
    } catch {
      // Trace history is diagnostic-only and must never prevent the dev server from starting.
    }
  }

  private remember(trace: BridgeToolTrace): void {
    if (!this.traces.has(trace.callId)) {
      this.orderedCallIds.push(trace.callId)
    }
    this.traces.set(trace.callId, trace)

    while (this.orderedCallIds.length > this.traceLimit) {
      const oldest = this.orderedCallIds.shift()
      if (oldest) this.traces.delete(oldest)
    }
  }

  private store(trace: BridgeToolTrace): void {
    this.remember(trace)
    try {
      fs.appendFileSync(this.traceFilePath, `${JSON.stringify(trace)}\n`, 'utf8')
    } catch {
      // Keep in-memory history available even when the durable trace file is not writable.
    }
  }
}

export function sanitizeTraceValue(value: unknown, depth = 0, key = ''): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED_VALUE
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'undefined') {
    return value
  }
  if (typeof value === 'string') {
    if (DATA_URL_PATTERN.test(value)) return OMITTED_BINARY_VALUE
    return value.length > MAX_TRACE_STRING_LENGTH
      ? `${value.slice(0, MAX_TRACE_STRING_LENGTH)}… [${value.length - MAX_TRACE_STRING_LENGTH} chars omitted]`
      : value
  }
  if (depth >= MAX_TRACE_DEPTH) {
    return '[nested value omitted]'
  }
  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_TRACE_ARRAY_LENGTH)
      .map((entry) => sanitizeTraceValue(entry, depth + 1))
    if (value.length > MAX_TRACE_ARRAY_LENGTH) {
      result.push(`[${value.length - MAX_TRACE_ARRAY_LENGTH} entries omitted]`)
    }
    return result
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const result: Record<string, unknown> = {}
    for (const [nestedKey, nestedValue] of entries.slice(0, MAX_TRACE_OBJECT_KEYS)) {
      result[nestedKey] = sanitizeTraceValue(nestedValue, depth + 1, nestedKey)
    }
    if (entries.length > MAX_TRACE_OBJECT_KEYS) {
      result.__omittedKeys = entries.length - MAX_TRACE_OBJECT_KEYS
    }
    return result
  }
  return String(value)
}

function createBridgeCallId(): string {
  return `bridge-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 12)}`
}

function normalizeTraceLimit(value: number | undefined, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.min(100, maximum)
  return Math.max(1, Math.min(maximum, Math.round(value)))
}

function inferTraceStatus(result: unknown, error: string | undefined): Exclude<BridgeTraceStatus, 'running'> {
  if (error) return /timeout/i.test(error) ? 'timeout' : 'failed'
  if (
    result
    && typeof result === 'object'
    && 'success' in result
    && (result as { success?: unknown }).success === false
  ) {
    return 'failed'
  }
  return 'succeeded'
}
