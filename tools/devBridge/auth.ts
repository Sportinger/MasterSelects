import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import type { IncomingMessage, ServerResponse } from 'http'

export const devBridgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Follow-up: keep the existing per Vite server/config start token rotation;
// coordinated overlap handling for concurrent dev servers is tracked separately.
export const bridgeToken = crypto.randomUUID()
export const tokenFilePath = path.resolve(devBridgeRoot, '.ai-bridge-token')
export const allowedFileRoots = buildAllowedFileRoots()

type AllowedPathKind = 'file' | 'directory'

type AllowedPathResult =
  | { allowed: true; resolved: string; stat: fs.Stats }
  | { allowed: false; statusCode: number; error: string }

function normalizeAllowedRoot(root: string): string | null {
  const trimmed = root.trim()
  if (!trimmed || !path.isAbsolute(trimmed)) {
    return null
  }

  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    return null
  }

  const resolved = path.resolve(trimmed)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

function uniqueRoots(roots: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const root of roots) {
    const normalized = normalizeAllowedRoot(root)
    if (!normalized) {
      continue
    }

    const key = process.platform === 'win32'
      ? normalized.toLowerCase()
      : normalized

    if (!seen.has(key)) {
      seen.add(key)
      unique.push(normalized)
    }
  }

  return unique
}

function parseExtraAllowedRoots(): string[] {
  const configured = process.env.MASTERSELECTS_ALLOWED_FILE_ROOTS
  if (!configured) {
    return []
  }

  return configured
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean)
}

function buildAllowedFileRoots(): string[] {
  const home = os.homedir()
  const defaults = [
    devBridgeRoot,
    process.env.MASTERSELECTS_PROJECT_ROOT ?? '',
    os.tmpdir(),
    home ? path.join(home, 'Desktop') : '',
    home ? path.join(home, 'Documents') : '',
    home ? path.join(home, 'Downloads') : '',
    home ? path.join(home, 'Videos') : '',
    ...parseExtraAllowedRoots(),
  ]

  return uniqueRoots(defaults)
}

export function isPathInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function validateAllowedPath(rawPath: string, kind: AllowedPathKind): AllowedPathResult {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    return { allowed: false, statusCode: 400, error: `Missing ${kind} path` }
  }

  if (!path.isAbsolute(trimmed)) {
    return { allowed: false, statusCode: 400, error: 'Path must be absolute' }
  }

  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    return { allowed: false, statusCode: 403, error: 'UNC paths are not allowed' }
  }

  const resolved = path.resolve(trimmed)
  let realPath: string
  let stat: fs.Stats

  try {
    realPath = fs.realpathSync.native(resolved)
    stat = fs.statSync(realPath)
  } catch {
    return {
      allowed: false,
      statusCode: 404,
      error: kind === 'file' ? 'File not found' : 'Directory not found',
    }
  }

  if (kind === 'file' && stat.isDirectory()) {
    return { allowed: false, statusCode: 404, error: 'File not found' }
  }

  if (kind === 'directory' && !stat.isDirectory()) {
    return { allowed: false, statusCode: 404, error: 'Directory not found' }
  }

  if (!allowedFileRoots.some(root => isPathInsideRoot(realPath, root))) {
    return { allowed: false, statusCode: 403, error: 'Path is outside allowed roots' }
  }

  return { allowed: true, resolved: realPath, stat }
}

function getLocalhostOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin
  if (!origin) return null
  try {
    const url = new URL(origin)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return origin
    }
  } catch { /* invalid origin */ }
  return null
}

export function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = getLocalhostOrigin(req)
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export function validateBridgeRequest(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res)
    res.statusCode = 204
    res.end()
    return false
  }

  setCorsHeaders(req, res)

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Missing or invalid Authorization header' }))
    return false
  }

  const token = authHeader.slice(7)
  if (token !== bridgeToken) {
    res.statusCode = 401
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Invalid bridge token' }))
    return false
  }

  const origin = req.headers.origin
  if (origin) {
    const localhostOrigin = getLocalhostOrigin(req)
    if (!localhostOrigin) {
      res.statusCode = 403
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Non-localhost origin rejected' }))
      return false
    }
  }

  return true
}

export function sanitizeBridgeTimeoutMs(value: unknown, fallbackMs: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallbackMs
  }
  return Math.max(1000, Math.min(300000, Math.round(value)))
}
