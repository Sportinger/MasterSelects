import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import type { Plugin, ViteDevServer } from 'vite'
import {
  allowedFileRoots,
  bridgeToken,
  bridgeTokenFileIsExplicit,
  sanitizeBridgeTimeoutMs,
  setCorsHeaders,
  tokenFilePath,
  validateBridgeRequest,
} from './auth.ts'
import {
  installAgentControlEndpoints,
  type AgentControlSession,
} from './agentControlEndpoints.ts'
import { installLocalFileEndpoints } from './localFileEndpoints.ts'
import { installBlobStoreEndpoint, installBrowserLogEndpoint } from './supportEndpoints.ts'
import { parseExplicitBridgeTarget } from './targetRouting.ts'
import { BridgeTraceStore } from './traceStore.ts'

export { allowedFileRoots, bridgeToken } from './auth.ts'

export interface DevBridgePluginOptions {
  enableAiToolsBridge?: boolean
}

type PendingRequest = {
  resolve: (value: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

type DevBridgeClient = {
  tabId: string
  visibilityState: string
  hasFocus: boolean
  lastSeenAt: number
  session: Record<string, unknown> | null
  unresponsiveUntil?: number
}

export function createDevBridgePlugin(options: DevBridgePluginOptions = {}): Plugin {
  const enableAiToolsBridge = options.enableAiToolsBridge ?? true
  const pendingRequests = new Map<string, PendingRequest>()
  const pendingAgentControlRequests = new Map<string, PendingRequest>()
  const pendingDebugRequests = new Map<string, PendingRequest>()
  const pendingDebugActionRequests = new Map<string, PendingRequest>()
  const clients = new Map<string, DevBridgeClient>()
  const traceStore = new BridgeTraceStore()
  let requestCounter = 0

  const pruneClients = () => {
    const now = Date.now()
    for (const [tabId, client] of clients) {
      if (now - client.lastSeenAt > 120000) {
        clients.delete(tabId)
      }
    }
  }

  const pickTargetTabId = (): string | null => {
    pruneClients()
    const now = Date.now()
    const liveClients = [...clients.values()].filter((client) =>
      !client.unresponsiveUntil || client.unresponsiveUntil <= now
    )
    if (liveClients.length === 0) {
      return null
    }

    liveClients.sort((a, b) => b.lastSeenAt - a.lastSeenAt)

    const focusedVisible = liveClients.find((client) => client.visibilityState === 'visible' && client.hasFocus)
    if (focusedVisible) return focusedVisible.tabId

    const visible = liveClients.find((client) => client.visibilityState === 'visible')
    if (visible) return visible.tabId

    return liveClients[0].tabId
  }

  const markClientUnresponsive = (tabId: string | null, durationMs = 60000) => {
    if (!tabId) return
    const client = clients.get(tabId)
    if (!client) return
    clients.set(tabId, {
      ...client,
      unresponsiveUntil: Date.now() + durationMs,
    })
  }

  const handleDebugStateRequest = (
    req: IncomingMessage,
    res: ServerResponse,
    defaultScope: string,
    hot: ViteDevServer['hot'],
  ) => {
    if (!validateBridgeRequest(req, res)) return

    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }

    const targetTabId = pickTargetTabId()
    if (!targetTabId) {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ success: false, error: 'No browser tab connected to the dev bridge' }))
      return
    }

    const url = new URL(req.url!, `http://${req.headers.host}`)
    const scope = url.searchParams.get('scope') || defaultScope
    const requestId = `debug-${++requestCounter}-${crypto.randomUUID().slice(0, 8)}`

    const resultPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingDebugRequests.delete(requestId)
        markClientUnresponsive(targetTabId)
        resolve({ success: false, error: 'Timeout: no browser tab responded within 30s' })
      }, 30000)

      pendingDebugRequests.set(requestId, { resolve, timer })
      hot.send('debug-state:request', { requestId, scope, targetTabId })
    })

    resultPromise.then((result) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(result))
    })
  }

  return {
    name: 'dev-bridge',
    apply: 'serve',
    configureServer(server) {
      installLocalFileEndpoints(server)
      installBlobStoreEndpoint(server)
      installBrowserLogEndpoint(server)

      if (!enableAiToolsBridge) {
        return
      }

      // Vitest boots Vite's dev-server plugins too; its ephemeral token must
      // not clobber the running dev server's token file (breaks MCP bridge).
      if (process.env.VITEST) {
        return
      }

      // The canonical dev server owns the default token file. Embedded servers
      // such as Playwright may opt into an isolated token file explicitly.
      const writeTokenIfCanonical = () => {
        const address = server.httpServer?.address()
        const port = typeof address === 'object' && address ? address.port : null
        if (!bridgeTokenFileIsExplicit && port !== null && port !== 5173) {
          return
        }
        try {
          fs.mkdirSync(path.dirname(tokenFilePath), { recursive: true })
          fs.writeFileSync(tokenFilePath, bridgeToken, 'utf-8')
        } catch { /* best effort */ }
      }
      if (server.httpServer?.listening) {
        writeTokenIfCanonical()
      } else {
        server.httpServer?.once('listening', writeTokenIfCanonical)
      }

      console.log('\n┌─────────────────────────────────────────────────────────┐')
      console.log('│  AI Bridge Token (required for /api/* endpoints):       │')
      console.log(`│  ${bridgeToken}  │`)
      console.log('│  Token written to .ai-bridge-token                      │')
      console.log('│  Use: Authorization: Bearer <token>                     │')
      console.log('└─────────────────────────────────────────────────────────┘\n')
      console.log(`[security] Dev bridge token file: ${tokenFilePath}`)
      console.log(`[security] Allowed dev file roots: ${allowedFileRoots.join(', ')}`)

      server.hot.on('ai-tools:result', (data: { requestId: string; result: unknown }) => {
        const pending = pendingRequests.get(data.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          pendingRequests.delete(data.requestId)
          pending.resolve(data.result)
        }
      })

      server.hot.on('agent-control:result', (data: { requestId: string; result: unknown }) => {
        const pending = pendingAgentControlRequests.get(data.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          pendingAgentControlRequests.delete(data.requestId)
          pending.resolve(data.result)
        }
      })

      server.hot.on('debug-state:result', (data: { requestId: string; result: unknown }) => {
        const pending = pendingDebugRequests.get(data.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          pendingDebugRequests.delete(data.requestId)
          pending.resolve(data.result)
        }
      })

      server.hot.on('debug-action:result', (data: { requestId: string; result: unknown }) => {
        const pending = pendingDebugActionRequests.get(data.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          pendingDebugActionRequests.delete(data.requestId)
          pending.resolve(data.result)
        }
      })

      server.hot.on('ai-tools:presence', (data: {
        tabId: string
        visibilityState?: string
        hasFocus?: boolean
        session?: Record<string, unknown>
      }) => {
        if (!data?.tabId) return
        const previous = clients.get(data.tabId)
        clients.set(data.tabId, {
          tabId: data.tabId,
          visibilityState: data.visibilityState ?? 'hidden',
          hasFocus: Boolean(data.hasFocus),
          lastSeenAt: Date.now(),
          session: data.session ?? previous?.session ?? null,
          unresponsiveUntil: previous?.unresponsiveUntil,
        })
      })

      const listAgentSessions = (): AgentControlSession[] => {
        pruneClients()
        return [...clients.values()].map((client) => ({
          hasFocus: client.hasFocus,
          lastSeenAt: client.lastSeenAt,
          session: client.session,
          sessionId: client.tabId,
          unresponsiveUntil: client.unresponsiveUntil,
          visibilityState: client.visibilityState,
        }))
      }
      const dispatchAgentRequest = ({
        operation,
        args = {},
        sessionId,
        timeoutMs,
      }: {
        operation: string
        args?: Record<string, unknown>
        sessionId?: string | null
        timeoutMs?: number
      }): Promise<{ result: unknown; sessionId: string }> => {
        pruneClients()
        if (sessionId && !clients.has(sessionId)) {
          return Promise.reject(new Error(`Unknown or stale bridge session: ${sessionId}`))
        }
        const targetTabId = sessionId ?? pickTargetTabId()
        if (!targetTabId) {
          return Promise.reject(new Error('No browser tab connected to the dev bridge'))
        }

        const requestId = `agent-${++requestCounter}-${crypto.randomUUID().slice(0, 8)}`
        const requestTimeoutMs = sanitizeBridgeTimeoutMs(timeoutMs, 30000)
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingAgentControlRequests.delete(requestId)
            markClientUnresponsive(targetTabId)
            reject(new Error(`Timeout: bridge session ${targetTabId} did not respond within ${Math.round(requestTimeoutMs / 1000)}s`))
          }, requestTimeoutMs)

          pendingAgentControlRequests.set(requestId, {
            resolve: (result) => resolve({ result, sessionId: targetTabId }),
            timer,
          })
          server.hot.send('agent-control:request', {
            args,
            operation,
            requestId,
            targetTabId,
          })
        })
      }

      installAgentControlEndpoints(server, {
        dispatch: dispatchAgentRequest,
        listSessions: listAgentSessions,
        traceStore,
      })

      server.middlewares.use('/api/ai-tools', (req, res) => {
        const requestPath = req.url?.split('?')[0] ?? '/'
        if (requestPath === '/auth-check') {
          if (!validateBridgeRequest(req, res)) return
          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('Method not allowed')
            return
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ status: 'ok' }))
          return
        }

        if (req.method === 'GET') {
          setCorsHeaders(req, res)
          res.setHeader('Content-Type', 'application/json')
          pruneClients()
          const now = Date.now()
          res.end(JSON.stringify({
            status: 'ready',
            pending: pendingRequests.size,
            clients: clients.size,
            clientTabs: [...clients.values()].map((client) => ({
              tabId: client.tabId,
              visibilityState: client.visibilityState,
              hasFocus: client.hasFocus,
              lastSeenAgoMs: now - client.lastSeenAt,
              unresponsiveForMs: client.unresponsiveUntil && client.unresponsiveUntil > now
                ? client.unresponsiveUntil - now
                : 0,
            })),
          }))
          return
        }

        if (!validateBridgeRequest(req, res)) return

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => body += chunk.toString())
        req.on('end', () => {
          try {
            const payload = JSON.parse(body)
            const {
              tool,
              args = {},
              options,
              timeoutMs,
            } = payload
            if (!tool) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: 'Missing "tool" field' }))
              return
            }

            const explicitTarget = parseExplicitBridgeTarget(payload)
            if (explicitTarget.provided && !explicitTarget.valid) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                success: false,
                error: explicitTarget.error,
              }))
              return
            }

            pruneClients()
            const requestId = `r${++requestCounter}-${crypto.randomUUID().slice(0, 8)}`
            const explicitTargetTabId = explicitTarget.provided
              ? explicitTarget.targetTabId
              : null
            if (explicitTargetTabId && !clients.has(explicitTargetTabId)) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                success: false,
                error: `Unknown or stale bridge session: ${explicitTargetTabId}`,
              }))
              return
            }
            const targetTabId = explicitTargetTabId ?? pickTargetTabId()
            if (!targetTabId) {
              res.statusCode = 503
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: 'No browser tab connected to the dev bridge' }))
              return
            }
            const requestTimeoutMs = sanitizeBridgeTimeoutMs(timeoutMs, 30000)
            const trace = traceStore.begin({
              args,
              options,
              requestId,
              sessionId: targetTabId,
              source: 'http',
              surface: 'devBridge',
              tool,
            })

            const resultPromise = new Promise((resolve) => {
              const timer = setTimeout(() => {
                pendingRequests.delete(requestId)
                markClientUnresponsive(targetTabId)
                const result = {
                  success: false,
                  error: `Timeout: no browser tab responded within ${Math.round(requestTimeoutMs / 1000)}s`,
                }
                traceStore.complete(trace.callId, {
                  error: result.error,
                  result,
                  status: 'timeout',
                })
                resolve(result)
              }, requestTimeoutMs)

              pendingRequests.set(requestId, { resolve, timer })
              server.hot.send('ai-tools:execute', { requestId, tool, args, options, targetTabId })
            })

            resultPromise.then((result) => {
              if (traceStore.get(trace.callId)?.status === 'running') {
                const error = result
                  && typeof result === 'object'
                  && 'error' in result
                  && typeof (result as { error?: unknown }).error === 'string'
                  ? (result as { error: string }).error
                  : undefined
                traceStore.complete(trace.callId, { error, result })
              }
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(result))
            })
          } catch {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }))
          }
        })
      })

      server.middlewares.use('/api/debug/state', (req, res) => {
        handleDebugStateRequest(req, res, 'all', server.hot)
      })

      server.middlewares.use('/api/debug/preview-state', (req, res) => {
        handleDebugStateRequest(req, res, 'preview', server.hot)
      })

      server.middlewares.use('/api/debug/slot-state', (req, res) => {
        handleDebugStateRequest(req, res, 'slots', server.hot)
      })

      server.middlewares.use('/api/debug/action', (req, res) => {
        if (!validateBridgeRequest(req, res)) return

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => body += chunk.toString())
        req.on('end', () => {
          try {
            const payload = JSON.parse(body)
            const {
              action,
              args = {},
              timeoutMs,
            } = payload
            if (!action) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: 'Missing "action" field' }))
              return
            }

            const explicitTarget = parseExplicitBridgeTarget(payload)
            if (explicitTarget.provided && !explicitTarget.valid) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                success: false,
                error: explicitTarget.error,
              }))
              return
            }

            pruneClients()
            const explicitTargetTabId = explicitTarget.provided
              ? explicitTarget.targetTabId
              : null
            if (explicitTargetTabId && !clients.has(explicitTargetTabId)) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                success: false,
                error: `Unknown or stale bridge session: ${explicitTargetTabId}`,
              }))
              return
            }
            const targetTabId = explicitTargetTabId ?? pickTargetTabId()
            if (!targetTabId) {
              res.statusCode = 503
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: 'No browser tab connected to the dev bridge' }))
              return
            }

            const requestId = `debug-action-${++requestCounter}-${crypto.randomUUID().slice(0, 8)}`
            const requestTimeoutMs = sanitizeBridgeTimeoutMs(timeoutMs, 30000)
            const resultPromise = new Promise((resolve) => {
              const timer = setTimeout(() => {
                pendingDebugActionRequests.delete(requestId)
                markClientUnresponsive(targetTabId)
                resolve({
                  success: false,
                  error: `Timeout: no browser tab responded within ${Math.round(requestTimeoutMs / 1000)}s`,
                })
              }, requestTimeoutMs)

              pendingDebugActionRequests.set(requestId, { resolve, timer })
              server.hot.send('debug-action:request', { requestId, action, args, targetTabId })
            })

            resultPromise.then((result) => {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(result))
            })
          } catch {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }))
          }
        })
      })
    },
  }
}
