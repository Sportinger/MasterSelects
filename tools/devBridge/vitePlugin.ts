import crypto from 'crypto'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import type { Plugin, ViteDevServer } from 'vite'
import {
  allowedFileRoots,
  bridgeToken,
  sanitizeBridgeTimeoutMs,
  setCorsHeaders,
  tokenFilePath,
  validateBridgeRequest,
} from './auth.ts'
import { installLocalFileEndpoints } from './localFileEndpoints.ts'
import { installBlobStoreEndpoint, installBrowserLogEndpoint } from './supportEndpoints.ts'

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
  unresponsiveUntil?: number
}

export function createDevBridgePlugin(options: DevBridgePluginOptions = {}): Plugin {
  const enableAiToolsBridge = options.enableAiToolsBridge ?? true
  const pendingRequests = new Map<string, PendingRequest>()
  const pendingDebugRequests = new Map<string, PendingRequest>()
  const pendingDebugActionRequests = new Map<string, PendingRequest>()
  const clients = new Map<string, DevBridgeClient>()
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

      try {
        fs.writeFileSync(tokenFilePath, bridgeToken, 'utf-8')
      } catch { /* best effort */ }

      console.log('\n┌─────────────────────────────────────────────────────────┐')
      console.log('│  AI Bridge Token (required for /api/* endpoints):       │')
      console.log(`│  ${bridgeToken}  │`)
      console.log('│  Token written to .ai-bridge-token                      │')
      console.log('│  Use: Authorization: Bearer <token>                     │')
      console.log('└─────────────────────────────────────────────────────────┘\n')
      console.log(`[security] Allowed dev file roots: ${allowedFileRoots.join(', ')}`)

      server.hot.on('ai-tools:result', (data: { requestId: string; result: unknown }) => {
        const pending = pendingRequests.get(data.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          pendingRequests.delete(data.requestId)
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

      server.hot.on('ai-tools:presence', (data: { tabId: string; visibilityState?: string; hasFocus?: boolean }) => {
        if (!data?.tabId) return
        const previous = clients.get(data.tabId)
        clients.set(data.tabId, {
          tabId: data.tabId,
          visibilityState: data.visibilityState ?? 'hidden',
          hasFocus: Boolean(data.hasFocus),
          lastSeenAt: Date.now(),
          unresponsiveUntil: previous?.unresponsiveUntil,
        })
      })

      server.middlewares.use('/api/ai-tools', (req, res) => {
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
            const {
              tool,
              args = {},
              options,
              timeoutMs,
              targetTabId: requestedTargetTabId,
            } = JSON.parse(body)
            if (!tool) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: 'Missing "tool" field' }))
              return
            }

            const requestId = `r${++requestCounter}-${crypto.randomUUID().slice(0, 8)}`
            const explicitTargetTabId = typeof requestedTargetTabId === 'string' && clients.has(requestedTargetTabId)
              ? requestedTargetTabId
              : null
            const targetTabId = explicitTargetTabId ?? pickTargetTabId()
            const requestTimeoutMs = sanitizeBridgeTimeoutMs(timeoutMs, 30000)

            const resultPromise = new Promise((resolve) => {
              const timer = setTimeout(() => {
                pendingRequests.delete(requestId)
                markClientUnresponsive(targetTabId)
                resolve({ success: false, error: `Timeout: no browser tab responded within ${Math.round(requestTimeoutMs / 1000)}s` })
              }, requestTimeoutMs)

              pendingRequests.set(requestId, { resolve, timer })
              server.hot.send('ai-tools:execute', { requestId, tool, args, options, targetTabId })
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

        const targetTabId = pickTargetTabId()
        if (!targetTabId) {
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ success: false, error: 'No browser tab connected to the dev bridge' }))
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => body += chunk.toString())
        req.on('end', () => {
          try {
            const { action, args = {} } = JSON.parse(body)
            if (!action) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: 'Missing "action" field' }))
              return
            }

            const requestId = `debug-action-${++requestCounter}-${crypto.randomUUID().slice(0, 8)}`
            const resultPromise = new Promise((resolve) => {
              const timer = setTimeout(() => {
                pendingDebugActionRequests.delete(requestId)
                markClientUnresponsive(targetTabId)
                resolve({ success: false, error: 'Timeout: no browser tab responded within 30s' })
              }, 30000)

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
