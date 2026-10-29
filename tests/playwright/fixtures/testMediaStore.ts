import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { access, constants, mkdir, open, readFile, rename, rm, stat, statfs, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * One store for every generated test medium (frame-code clips, phone footage, Fast export and
 * nightly sources). A file is looked up in this order:
 *
 * 1. the shared local cache (MASTERSELECTS_TEST_MEDIA_DIR, default ~/.cache/masterselects-test-media),
 *    one folder for every worktree, on disk instead of a RAM tmpfs;
 * 2. the optional remote (MASTERSELECTS_TEST_MEDIA_REMOTE, else the first line of
 *    ~/.config/masterselects/test-media-remote; `off` disables it): `<ssh-host>:<path>` or a local
 *    directory, copied with rsync over ssh (BatchMode, short connect timeout) into a temporary name,
 *    checked against the `<file>.sha256` sidecar (size and SHA-256) and only then renamed into place;
 * 3. the generator, writing into a temporary name in the cache; the result gets its sidecar and is
 *    uploaded to the remote in the background (best effort: a failure is logged once and never
 *    fails a test; the upload survives the worker process).
 *
 * An unreachable remote costs one short probe per process and falls back to generation with a log
 * line. A lock file next to the target (heartbeat, taken over when its owner died) keeps two
 * workers or worktrees from generating the same file twice; every file appears by an atomic
 * rename, so a reader never sees a partial file either way.
 */

export const TEST_MEDIA_REMOTE_CONFIG = path.join(os.homedir(), '.config', 'masterselects', 'test-media-remote')

export function testMediaDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.MASTERSELECTS_TEST_MEDIA_DIR?.trim()
  return configured ? path.resolve(configured) : path.join(os.homedir(), '.cache', 'masterselects-test-media')
}

/**
 * The configured remote (`<ssh-host>:<path>` or a directory), or null when there is none or it is
 * `off`. Unit tests (vitest) use only the environment variable, never the host's config file.
 */
export function testMediaRemoteSpec(env: NodeJS.ProcessEnv = process.env, configFile = TEST_MEDIA_REMOTE_CONFIG): string | null {
  const configured = env.MASTERSELECTS_TEST_MEDIA_REMOTE?.trim()
  if (configured) return /^(off|none|false|0)$/i.test(configured) ? null : configured
  if (env.VITEST) return null
  try {
    return readFileSync(configFile, 'utf8').split(/\r?\n/)[0]?.trim() || null
  } catch {
    return null
  }
}

export type TestMediaRemote = { kind: 'ssh'; host: string; root: string } | { kind: 'local'; root: string }

export function parseTestMediaRemote(spec: string): TestMediaRemote {
  const match = /^([^/\\:]+):(.+)$/.exec(spec)
  // A single letter before the colon is a Windows drive, not a host.
  if (match && match[1].length > 1) return { kind: 'ssh', host: match[1], root: match[2].replace(/(.)\/+$/, '$1') }
  return { kind: 'local', root: path.resolve(spec) }
}

/** How files reach the remote. The rsync transport is the real one; tests inject others. */
export interface TestMediaTransport {
  /** Names the remote in log lines and in the `.uploaded` marker. */
  readonly label: string
  /** Null when the remote can be used, else the reason. The store calls it once per process. */
  probe(): Promise<string | null>
  /** Copies `<remote>/<key>` to `target`; false when the remote has no such file. Throws on transport errors. */
  download(key: string, target: string): Promise<boolean>
  /**
   * Copies `file` to `<remote>/<key>`, then its sidecar (sidecarPath) to `<remote>/<key>.sha256`, in this order: a sidecar
   * implies a complete file. A transport whose upload may outlive the process writes markerPath and removes uploadingPath itself.
   */
  upload(file: string, key: string): Promise<void>
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=4']

function runTool(command: string, args: string[], timeoutMs?: number): Promise<{ code: number; stderr: string }> {
  return new Promise(resolve => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
      resolve({ code, stderr: `${stderr}${error && code === -1 ? error.message : ''}` })
    })
  })
}

/** rsync over ssh (or to a local directory): partial-safe on both sides, since rsync writes into a temporary name and renames. */
export function rsyncTransport(spec: string): TestMediaTransport {
  const remote = parseTestMediaRemote(spec)
  const args = remote.kind === 'ssh'
    ? ['--times', '--mkpath', '--timeout=60', '-e', ['ssh', ...SSH_OPTIONS].join(' ')]
    : ['--times', '--mkpath']
  const at = (key: string) => remote.kind === 'ssh' ? `${remote.host}:${remote.root}/${key}` : path.join(remote.root, key)
  return {
    label: spec,
    async probe() {
      if (remote.kind === 'local') {
        try {
          await mkdir(remote.root, { recursive: true })
          await access(remote.root, constants.W_OK)
          return null
        } catch (error) {
          return (error as Error).message
        }
      }
      const result = await runTool('ssh', [...SSH_OPTIONS, remote.host,
        `mkdir -p ${quote(remote.root)} && test -w ${quote(remote.root)} && command -v rsync >/dev/null`], 8_000)
      return result.code === 0 ? null : (result.stderr.trim().split('\n').pop() || `ssh exited with ${result.code}`)
    },
    async download(key, target) {
      const result = await runTool('rsync', [...args, at(key), target])
      if (result.code === 0) return true
      if (result.code === 23 && /No such file|not found/i.test(result.stderr)) return false
      throw new Error(`rsync exited with ${result.code}: ${result.stderr.trim().slice(-400)}`)
    },
    upload(file, key) {
      // A detached shell, so a large upload finishes even when the Playwright worker exits first.
      const marker = markerPath(file), errors = `${marker}.${process.pid}.log`
      const copy = (from: string, to: string) => ['rsync', ...args, from, to].map(quote).join(' ')
      const script = `( ${copy(file, at(key))} && ${copy(sidecarPath(file), at(`${key}.sha256`))} && printf '%s\\n' ${quote(spec)} > ${quote(marker)} ) 2>> ${quote(errors)}`
        + ` && rm -f ${quote(errors)}; status=$?; rm -f ${quote(uploadingPath(file))}; exit $status`
      return new Promise((resolve, reject) => {
        // Not unref'd: a process that ends on its own (a CLI) waits for the upload; one that is
        // ended (a Playwright worker) leaves the detached shell running until it is done.
        const child = spawn('sh', ['-c', script], { detached: true, stdio: 'ignore' })
        child.on('error', reject)
        child.on('exit', code => {
          if (code === 0) { resolve(); return }
          void readFile(errors, 'utf8').catch(() => '').then(async text => {
            await rm(errors, { force: true })
            reject(new Error(`rsync exited with ${code}: ${text.trim().slice(-400)}`))
          })
        })
      })
    },
  }
}

export interface EnsureTestMediaOptions {
  /** Keep the file in this folder instead of `<cache>/<folder of the key>`; the remote key stays the same. */
  directory?: string
  /** Remote transport; default from MASTERSELECTS_TEST_MEDIA_REMOTE / the config file; null disables it. */
  transport?: TestMediaTransport | null
  log?: (line: string) => void
}

export interface TestMedia {
  path: string
  source: 'local' | 'remote' | 'generated'
  bytes: number
  /** Wall time of the generation in ms; 0 for a cached or fetched file. */
  generatedMs: number
  /** The background upload (true when it reached the remote), or null when none was started. */
  upload: Promise<boolean> | null
}

const defaultLog = (line: string) => console.log(`[test-media] ${line}`)
const transports = new Map<string, TestMediaTransport>()
const probes = new WeakMap<TestMediaTransport, Promise<boolean>>()
const failedUploads = new WeakSet<TestMediaTransport>()
const uploadChecked = new Set<string>()
const inflight = new Map<string, Promise<TestMedia>>()

function defaultTransport(): TestMediaTransport | null {
  const spec = testMediaRemoteSpec()
  if (!spec) return null
  let transport = transports.get(spec)
  if (!transport) transports.set(spec, transport = rsyncTransport(spec))
  return transport
}

function reachable(transport: TestMediaTransport, log: (line: string) => void): Promise<boolean> {
  let probe = probes.get(transport)
  if (!probe) {
    const started = Date.now()
    probe = transport.probe().catch(error => (error as Error).message).then(reason => {
      if (reason) log(`remote ${transport.label} is unreachable (${reason}, ${Date.now() - started} ms); test media are generated locally in this process`)
      return !reason
    })
    probes.set(transport, probe)
  }
  return probe
}

function validateKey(key: string): void {
  if (!key || path.isAbsolute(key) || key.split(/[\\/]/).some(part => part === '..' || part === '')) throw new Error(`invalid test media key "${key}"`)
}

export const sidecarPath = (file: string) => `${file}.sha256`
/** Written once the file reached the remote named inside. */
export const markerPath = (file: string) => `${file}.uploaded`
/** Present while an upload runs, so other processes do not start a second one. */
export const uploadingPath = (file: string) => `${file}.uploading`
const unique = () => `${process.pid}-${randomBytes(3).toString('hex')}`
const sizeOf = (file: string) => stat(file).then(info => info.isFile() && info.size > 0 ? info.size : 0, () => 0)
const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`

export async function digestFile(file: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })) {
    hash.update(chunk as Buffer)
    bytes += (chunk as Buffer).length
  }
  return { sha256: hash.digest('hex'), bytes }
}

/** `sha256sum` line plus the size: `<hex>  <name>\nsize <bytes>\n`. */
export function formatSidecar(name: string, digest: { sha256: string; bytes: number }): string {
  return `${digest.sha256}  ${name}\nsize ${digest.bytes}\n`
}

export function parseSidecar(text: string): { sha256: string; bytes: number } | null {
  const sha = /^([0-9a-f]{64})\s/m.exec(text), size = /^size (\d+)$/m.exec(text)
  return sha && size ? { sha256: sha[1], bytes: Number(size[1]) } : null
}

async function writeSidecar(file: string, digest: { sha256: string; bytes: number }): Promise<void> {
  const temporary = `${sidecarPath(file)}.${unique()}.part`
  await writeFile(temporary, formatSidecar(path.basename(file), digest))
  await rename(temporary, sidecarPath(file))
}

/** Refuses a download or generation the cache disk cannot hold. */
export async function assertCacheSpace(directory: string, bytes: number, what: string): Promise<void> {
  const info = await statfs(directory)
  const free = info.bavail * info.bsize, margin = 512 * 1024 ** 2
  if (free < bytes + margin) {
    throw new Error(`${what} needs about ${(bytes / 1e9).toFixed(2)} GB plus 0.5 GB headroom, but only ${(free / 1e9).toFixed(2)} GB are free in ${directory}. `
      + 'Free disk space or point MASTERSELECTS_TEST_MEDIA_DIR at a larger disk.')
  }
}

const LOCK_STALE_MS = 30_000
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * A lock of this host is stale only when its process is gone (a generator that blocks the event
 * loop with spawnSync cannot refresh it); a lock of another host sharing the cache folder, or one
 * whose owner cannot be read, is stale when its heartbeat stopped.
 */
async function lockIsStale(lock: string): Promise<boolean> {
  const info = await stat(lock).catch(() => null)
  if (!info) return false
  const owner = await readFile(lock, 'utf8').then(text => JSON.parse(text) as { pid: number; host: string }, () => null)
  if (owner && owner.host === os.hostname()) {
    try {
      process.kill(owner.pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }
  return Date.now() - info.mtimeMs > LOCK_STALE_MS
}

/** Runs `work` while holding `lock` (created exclusively, refreshed every few seconds, taken over when stale). */
export async function withFileLock<T>(lock: string, work: () => Promise<T>, onWait?: (owner: string) => void): Promise<T> {
  let announced = false
  for (;;) {
    try {
      const handle = await open(lock, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, host: os.hostname(), started: new Date().toISOString() }))
      await handle.close()
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (await lockIsStale(lock)) {
      // Rename first: of two waiters that both saw the stale lock, only one removes it.
      const moved = `${lock}.stale-${unique()}`
      if (await rename(lock, moved).then(() => true, () => false)) await rm(moved, { force: true })
      continue
    }
    if (!announced && onWait) onWait(await readFile(lock, 'utf8').catch(() => 'another process'))
    announced = true
    await sleep(200 + Math.random() * 300)
  }
  const heartbeat = setInterval(() => { void utimes(lock, new Date(), new Date()).catch(() => undefined) }, LOCK_STALE_MS / 6)
  heartbeat.unref()
  try {
    return await work()
  } finally {
    clearInterval(heartbeat)
    await rm(lock, { force: true })
  }
}

/**
 * Returns the local path of the test medium `key` (a relative path such as
 * `frame-code-media/<name>.mp4`; its name must hold every generator parameter), fetching it from
 * the remote or generating it first. `generate` writes the complete file to the path it is given
 * (a temporary name with the same extension).
 */
export function ensureTestMedia(key: string, generate: (target: string) => Promise<void>, options: EnsureTestMediaOptions = {}): Promise<TestMedia> {
  validateKey(key)
  const file = options.directory ? path.join(path.resolve(options.directory), path.basename(key)) : path.join(testMediaDir(), key)
  let pending = inflight.get(file)
  if (!pending) {
    pending = resolveTestMedia(key, file, generate, options).finally(() => inflight.delete(file))
    inflight.set(file, pending)
  }
  return pending
}

async function resolveTestMedia(key: string, file: string, generate: (target: string) => Promise<void>, options: EnsureTestMediaOptions): Promise<TestMedia> {
  const log = options.log ?? defaultLog
  const transport = options.transport === undefined ? defaultTransport() : options.transport
  const cached = async (): Promise<TestMedia | null> => {
    const bytes = await sizeOf(file)
    return bytes ? { path: file, source: 'local', bytes, generatedMs: 0, upload: transport ? uploadIfMissing(key, file, transport, log) : null } : null
  }
  const hit = await cached()
  if (hit) return hit
  await mkdir(path.dirname(file), { recursive: true })
  return withFileLock(`${file}.lock`, async () => {
    const again = await cached()
    if (again) return again
    const online = transport && await reachable(transport, log) ? transport : null
    if (online) {
      const bytes = await fetchFromRemote(key, file, online, log)
      if (bytes) return { path: file, source: 'remote', bytes, generatedMs: 0, upload: null }
    }
    const started = Date.now()
    const extension = path.extname(file)
    const temporary = `${file}.${unique()}.tmp${extension}`
    try {
      await generate(temporary)
      const digest = await digestFile(temporary).catch(() => ({ sha256: '', bytes: 0 }))
      if (!digest.bytes) throw new Error(`the generator of ${key} wrote no file (or an empty one)`)
      await rename(temporary, file)
      await writeSidecar(file, digest)
      const generatedMs = Date.now() - started
      log(`generated ${key} (${megabytes(digest.bytes)}, ${(generatedMs / 1000).toFixed(1)} s)`)
      return { path: file, source: 'generated', bytes: digest.bytes, generatedMs, upload: online ? startUpload(key, file, digest.bytes, online, log) : null }
    } finally {
      await rm(temporary, { force: true })
    }
  }, owner => log(`waiting for ${key}, generated by ${owner}`))
}

/** Downloads `key` and its sidecar into temporary names; renames them into place only when size and hash match. */
async function fetchFromRemote(key: string, file: string, transport: TestMediaTransport, log: (line: string) => void): Promise<number> {
  const sidecarTemp = `${sidecarPath(file)}.${unique()}.part`
  const dataTemp = `${file}.${unique()}.part`
  try {
    let expected: { sha256: string; bytes: number } | null = null
    try {
      if (!await transport.download(`${key}.sha256`, sidecarTemp)) return 0
      expected = parseSidecar(await readFile(sidecarTemp, 'utf8'))
      if (!expected) { log(`the remote sidecar of ${key} is unreadable; generating instead`); return 0 }
      await assertCacheSpace(path.dirname(file), expected.bytes, key)
      const started = Date.now()
      if (!await transport.download(key, dataTemp)) { log(`the remote has the sidecar of ${key} but not the file; generating instead`); return 0 }
      const actual = await digestFile(dataTemp)
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
        log(`the remote copy of ${key} is corrupt or partial (${actual.bytes} of ${expected.bytes} bytes, sha256 ${actual.sha256.slice(0, 12)} instead of ${expected.sha256.slice(0, 12)}); discarded, generating instead`)
        return 0
      }
      log(`fetched ${key} from the remote (${megabytes(actual.bytes)}, ${((Date.now() - started) / 1000).toFixed(1)} s)`)
    } catch (error) {
      if (/needs about .* GB/.test((error as Error).message)) throw error
      log(`could not fetch ${key} from ${transport.label} (${(error as Error).message}); generating instead`)
      return 0
    }
    await rename(dataTemp, file)
    await rename(sidecarTemp, sidecarPath(file))
    await writeFile(markerPath(file), `${transport.label}\n`).catch(() => undefined)
    return expected.bytes
  } finally {
    await rm(sidecarTemp, { force: true })
    await rm(dataTemp, { force: true })
  }
}

function startUpload(key: string, file: string, bytes: number, transport: TestMediaTransport, log: (line: string) => void): Promise<boolean> {
  uploadChecked.add(file)
  if (failedUploads.has(transport)) return Promise.resolve(false)
  log(`uploading ${key} (${megabytes(bytes)}) to the remote in the background`)
  return (async () => {
    // Tells other processes that hit the cached file meanwhile not to start a second upload.
    await writeFile(uploadingPath(file), `${process.pid}\n`)
    await transport.upload(file, key)
    await writeFile(markerPath(file), `${transport.label}\n`)
    return true
  })().catch(error => {
    if (!failedUploads.has(transport)) {
      failedUploads.add(transport)
      log(`upload of ${key} to ${transport.label} failed (${(error as Error).message}); no further uploads from this process`)
    }
    return false
  }).finally(() => rm(uploadingPath(file), { force: true }))
}

const UPLOADING_STALE_MS = 2 * 60 * 60 * 1000

/** A cached file that never reached this remote (offline when it was made, or copied in by hand) is uploaded once per process. */
function uploadIfMissing(key: string, file: string, transport: TestMediaTransport, log: (line: string) => void): Promise<boolean> | null {
  if (uploadChecked.has(file)) return null
  uploadChecked.add(file)
  return (async () => {
    const marker = await readFile(markerPath(file), 'utf8').catch(() => '')
    if (marker.trim() === transport.label) return false
    const uploading = await stat(uploadingPath(file)).catch(() => null)
    if (uploading && Date.now() - uploading.mtimeMs < UPLOADING_STALE_MS) return false
    if (!await reachable(transport, log)) return false
    let bytes = parseSidecar(await readFile(sidecarPath(file), 'utf8').catch(() => ''))?.bytes
    if (!bytes) {
      const digest = await digestFile(file)
      await writeSidecar(file, digest)
      bytes = digest.bytes
    }
    return startUpload(key, file, bytes, transport, log)
  })().catch(() => false)
}
