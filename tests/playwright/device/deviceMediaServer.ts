import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

/**
 * A tiny HTTP server on the PC for the `reverse` media transport: the phone reaches it as
 * http://localhost:<port> through `adb reverse`. It serves only files registered for this run
 * (under an unguessable token, never a directory) and accepts uploads only to registered targets
 * (the exported file coming back). Cross-origin headers let the editor's origin fetch it, including
 * Chrome's private-network preflight (`Access-Control-Allow-Private-Network`).
 */
export class DeviceMediaServer {
  readonly port: number
  private server: Server | null = null
  private readonly files = new Map<string, { file: string; contentType: string }>()
  private readonly uploads = new Map<string, { file: string; resolve: (bytes: number) => void; reject: (error: Error) => void; done: Promise<number> }>()

  constructor(port: number) {
    this.port = port
  }

  get origin(): string {
    return `http://localhost:${this.port}`
  }

  async start(): Promise<void> {
    if (this.server) return
    const server = createServer((request, response) => { void this.handle(request, response) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => reject(error.code === 'EADDRINUSE'
        ? new Error(`Media server port ${this.port} is busy; set MASTERSELECTS_DEVICE_MEDIA_PORT.`) : error))
      server.listen(this.port, '127.0.0.1', () => resolve())
    })
    this.server = server
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  }

  /** Registers `file` and returns the URL the phone fetches it from. */
  serve(file: string, contentType: string): string {
    const token = randomBytes(12).toString('hex')
    this.files.set(token, { file, contentType })
    return `${this.origin}/media/${token}/${encodeURIComponent(path.basename(file))}`
  }

  /** Registers an upload target; the returned promise resolves with the byte count once the phone has sent it. */
  expectUpload(file: string): { url: string; done: Promise<number> } {
    const token = randomBytes(12).toString('hex')
    let resolve!: (bytes: number) => void, reject!: (error: Error) => void
    const done = new Promise<number>((ok, fail) => { resolve = ok; reject = fail })
    this.uploads.set(token, { file, resolve, reject, done })
    return { url: `${this.origin}/upload/${token}`, done }
  }

  private cors(request: IncomingMessage, response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin ?? '*')
    response.setHeader('Vary', 'Origin')
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'content-type')
    response.setHeader('Access-Control-Allow-Private-Network', 'true')
    response.setHeader('Access-Control-Expose-Headers', 'content-length')
    response.setHeader('Cache-Control', 'no-store')
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.cors(request, response)
    const [, kind, token] = (request.url ?? '').split('?')[0].split('/')
    try {
      if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
      if (request.method === 'GET' && kind === 'media' && this.files.has(token)) {
        const { file, contentType } = this.files.get(token)!
        const { size } = await stat(file)
        response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': String(size) })
        await pipeline(createReadStream(file), response)
        return
      }
      if (request.method === 'PUT' && kind === 'upload' && this.uploads.has(token)) {
        const upload = this.uploads.get(token)!
        this.uploads.delete(token)
        await mkdir(path.dirname(upload.file), { recursive: true })
        let bytes = 0
        request.on('data', (chunk: Buffer) => { bytes += chunk.length })
        await pipeline(request, createWriteStream(upload.file)).then(() => upload.resolve(bytes), (error: Error) => { upload.reject(error); throw error })
        response.writeHead(201, { 'Content-Type': 'text/plain' }).end(String(bytes))
        return
      }
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not registered')
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' })
      response.end(String(error).slice(0, 200))
    }
  }
}
