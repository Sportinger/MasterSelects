import fs from 'fs'
import path from 'path'
import type { ViteDevServer } from 'vite'
import {
  allowedFileRoots,
  isPathInsideRoot,
  validateAllowedPath,
  validateBridgeRequest,
} from './auth.ts'

export function installLocalFileEndpoints(server: ViteDevServer): void {
  server.middlewares.use('/api/local-file', (req, res) => {
    if (!validateBridgeRequest(req, res)) return

    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }
    const url = new URL(req.url!, `http://${req.headers.host}`)
    const filePath = url.searchParams.get('path')
    if (!filePath) {
      res.statusCode = 400
      res.end('Missing path parameter')
      return
    }

    const validation = validateAllowedPath(filePath, 'file')
    if (!validation.allowed) {
      res.statusCode = validation.statusCode
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: validation.error }))
      return
    }

    const { resolved, stat } = validation
    const ext = path.extname(resolved).toLowerCase()
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
      '.obj': 'model/obj', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.fbx': 'application/octet-stream',
      '.ply': 'application/octet-stream', '.splat': 'application/octet-stream', '.ksplat': 'application/octet-stream',
      '.spz': 'application/octet-stream', '.sog': 'application/octet-stream', '.lcc': 'application/octet-stream',
      '.zip': 'application/zip',
    }
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')

    const range = req.headers.range
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      res.setHeader('Content-Length', end - start + 1)
      res.setHeader('Accept-Ranges', 'bytes')
      fs.createReadStream(resolved, { start, end }).pipe(res)
    } else {
      res.setHeader('Content-Length', stat.size)
      res.setHeader('Accept-Ranges', 'bytes')
      fs.createReadStream(resolved).pipe(res)
    }
  })

  server.middlewares.use('/api/local-files', (req, res) => {
    if (!validateBridgeRequest(req, res)) return

    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }
    const url = new URL(req.url!, `http://${req.headers.host}`)
    const dirPath = url.searchParams.get('dir')
    const extFilter = url.searchParams.get('ext')?.split(',') ||
      ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.mp3', '.wav', '.aac', '.ogg', '.m4a', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.obj', '.gltf', '.glb', '.fbx', '.ply', '.splat', '.ksplat', '.spz', '.sog', '.lcc', '.zip']

    if (!dirPath) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Missing dir parameter' }))
      return
    }

    const validation = validateAllowedPath(dirPath, 'directory')
    if (!validation.allowed) {
      res.statusCode = validation.statusCode
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: validation.error }))
      return
    }

    try {
      const resolved = validation.resolved
      const entries = fs.readdirSync(resolved)
      const files = entries
        .filter(f => extFilter.some(ext => f.toLowerCase().endsWith(ext)))
        .flatMap(f => {
          const fullPath = path.join(resolved, f)
          let realPath: string
          let stat: fs.Stats

          try {
            realPath = fs.realpathSync.native(fullPath)
            stat = fs.statSync(realPath)
          } catch {
            return []
          }

          if (!stat.isFile()) {
            return []
          }

          if (!allowedFileRoots.some(root => isPathInsideRoot(realPath, root))) {
            return []
          }

          return {
            name: f,
            path: realPath.replace(/\\/g, '/'),
            size: stat.size,
            modified: stat.mtime.toISOString(),
          }
        })
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ files }))
    } catch {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Failed to list directory' }))
    }
  })
}
