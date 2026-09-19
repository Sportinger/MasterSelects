import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { ViteDevServer } from 'vite'
import { devBridgeRoot, validateBridgeRequest } from './auth.ts'

const BLOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function installBrowserLogEndpoint(server: ViteDevServer): void {
  const logFile = path.resolve(devBridgeRoot, '.browser-logs.json')

  server.middlewares.use('/api/logs', (req, res) => {
    if (!validateBridgeRequest(req, res)) return

    if (req.method === 'POST') {
      let body = ''
      req.on('data', (chunk: Buffer) => body += chunk.toString())
      req.on('end', () => {
        try {
          fs.writeFileSync(logFile, body)
          res.statusCode = 200
          res.end('ok')
        } catch {
          res.statusCode = 500
          res.end('write error')
        }
      })
    } else if (req.method === 'GET') {
      try {
        const logs = fs.existsSync(logFile)
          ? fs.readFileSync(logFile, 'utf-8')
          : '{"totalLogs":0,"errorCount":0,"warnCount":0,"recentErrors":[],"activeModules":[]}'
        res.setHeader('Content-Type', 'application/json')
        res.end(logs)
      } catch {
        res.statusCode = 500
        res.end('{}')
      }
    } else {
      res.statusCode = 405
      res.end('Method not allowed')
    }
  })
}

export function installBlobStoreEndpoint(server: ViteDevServer): void {
  const blobs = new Map<string, Buffer>()

  server.middlewares.use('/api/blob-store', (req, res) => {
    if (req.method === 'GET') {
      // Reads are deliberately token-free: the stored URL is handed to the
      // third-party avatar renderer, whose internal fetch cannot attach the
      // bridge header. The random UUID is the capability (unguessable, 10 min
      // TTL); cross-site page fetches are refused outright.
      const fetchSite = req.headers['sec-fetch-site']
      if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none') {
        res.statusCode = 403
        res.end('Forbidden')
        return
      }
      const urlPath = req.url?.replace(/^\//, '').split('?')[0] || ''
      const id = urlPath.split('/')[0]
      const data = BLOB_ID_PATTERN.test(id) ? blobs.get(id) : undefined
      if (!data) { res.statusCode = 404; res.end('Not found'); return }
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Length', data.length)
      res.end(data)
      return
    }

    // Uploads (and their preflights) require the bridge token like every other endpoint.
    if (!validateBridgeRequest(req, res)) return

    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const id = crypto.randomUUID()
        blobs.set(id, Buffer.concat(chunks))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ id, url: `/api/blob-store/${id}/avatar.zip` }))
        setTimeout(() => blobs.delete(id), 10 * 60 * 1000)
      })
      return
    }

    res.statusCode = 405
    res.end('Method not allowed')
  })
}
