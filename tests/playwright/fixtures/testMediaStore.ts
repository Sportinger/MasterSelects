import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { access, constants, lstat, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { processAlive, uniqueSuffix, withFileLock } from './testMediaLock.ts'

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
 * An unreachable remote (or a host without rsync or sh) costs one short probe per process and falls
 * back to generation with a log line. A lock file next to the target (fixtures/testMediaLock.ts)
 * keeps two workers, worktrees or hosts from generating the same file twice; every file appears by
 * an atomic rename, so a reader never sees a partial file either way. Under that lock, the
 * temporaries an interrupted run left behind (a killed generator or download) are removed first.
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

/** Download and upload run rsync and sh on this host: the remote is off when either is missing. */
async function missingLocalTool(): Promise<string | null> {
  const checks = await Promise.all([['rsync', ['--version']], ['sh', ['-c', 'exit 0']]].map(async ([command, args]) => {
    const result = await runTool(command as string, args as string[], 4_000)
    return result.code === 0 ? null : `${command} is not usable on this host: ${result.stderr.trim().split('\n').pop() || `exit ${result.code}`}`
  }))
  return checks.find(Boolean) ?? null
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
      const missing = await missingLocalTool()
      if (missing) return missing
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
  /** Names of further files the caller keeps next to the file; their interrupted temporaries are removed with the file's. */
  companions?: readonly string[]
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

export const testMediaLog = (line: string) => console.log(`[test-media] ${line}`)
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
const UPLOADING_STALE_MS = 2 * 60 * 60 * 1000
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
  const temporary = `${sidecarPath(file)}.${uniqueSuffix()}.part`
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

const LEFTOVER_GRACE_MS = 60_000
const LEFTOVER_MAX_AGE_MS = 60 * 60_000
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Removes what an interrupted run left in `directory` for the files named `bases` (names, or a
 * pattern for them): generator and download temporaries (`<file>.<pid>-<hex>.tmp…`, `.part`, the
 * sidecar's `.part`, rsync's hidden `.<file>.….part.XXXXXX`), lock leftovers and upload error logs.
 * Callers hold the file's lock, so no live run writes them any more; still, an entry is removed
 * only after its first minute, and only when the process in its name is gone from this host or it
 * was not written for an hour (a PID that came back). One log line per cleanup.
 */
export async function removeLeftovers(directory: string, bases: readonly string[] | RegExp, what: string, log: (line: string) => void = testMediaLog): Promise<number> {
  const names = await readdir(directory).catch(() => [] as string[])
  if (!names.length) return 0
  const base = bases instanceof RegExp ? bases.source : bases.map(escapeRegExp).join('|')
  const patterns = [
    new RegExp(`^\\.?(?<base>${base})\\.(?:sha256\\.)?(?<pid>\\d+)(?:-[0-9a-f]+)?\\.(?:tmp|part)(?:\\.|$)`),
    new RegExp(`^(?<base>${base})\\.lock\\.(?:stale-)?(?<pid>\\d+)-[0-9a-f]+(?:\\.(?:stale|release))?$`),
    new RegExp(`^(?<base>${base})\\.uploaded\\.(?<pid>\\d+)\\.log(?<log>)$`),
  ]
  const removed: string[] = []
  let bytes = 0
  for (const name of names) {
    const groups = patterns.map(pattern => pattern.exec(name)?.groups).find(Boolean)
    if (!groups) continue
    const entry = path.join(directory, name)
    const info = await lstat(entry).catch(() => null)
    const age = info ? Date.now() - info.mtimeMs : 0
    if (!info || age < LEFTOVER_GRACE_MS || (processAlive(Number(groups.pid)) && age < LEFTOVER_MAX_AGE_MS)) continue
    // The detached upload shell writes its error log while it runs and can outlive the PID in the name.
    const uploading = groups.log === undefined ? null : await stat(path.join(directory, uploadingPath(groups.base))).catch(() => null)
    if (uploading && Date.now() - uploading.mtimeMs < UPLOADING_STALE_MS) continue
    await rm(entry, { recursive: true, force: true })
    removed.push(name)
    bytes += info.isFile() ? info.size : 0
  }
  if (removed.length) {
    log(`removed ${removed.length} leftover${removed.length === 1 ? '' : 's'} of an interrupted run of ${what} (${megabytes(bytes)}): `
      + `${removed.slice(0, 4).join(', ')}${removed.length > 4 ? ', …' : ''}`)
  }
  return removed.length
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
  const log = options.log ?? testMediaLog
  const transport = options.transport === undefined ? defaultTransport() : options.transport
  const cached = async (): Promise<TestMedia | null> => {
    const bytes = await sizeOf(file)
    return bytes ? { path: file, source: 'local', bytes, generatedMs: 0, upload: transport ? uploadIfMissing(key, file, transport, log) : null } : null
  }
  const hit = await cached()
  if (hit) return hit
  await mkdir(path.dirname(file), { recursive: true })
  return withFileLock(`${file}.lock`, async () => {
    await removeLeftovers(path.dirname(file), [path.basename(file), ...options.companions ?? []], key, log)
    const again = await cached()
    if (again) return again
    const online = transport && await reachable(transport, log) ? transport : null
    if (online) {
      const bytes = await fetchFromRemote(key, file, online, log)
      if (bytes) return { path: file, source: 'remote', bytes, generatedMs: 0, upload: null }
    }
    const started = Date.now()
    const extension = path.extname(file)
    const temporary = `${file}.${uniqueSuffix()}.tmp${extension}`
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
  }, { onWait: owner => log(`waiting for ${key}, generated by ${owner}`), log })
}

/** Downloads `key` and its sidecar into temporary names; renames them into place only when size and hash match. */
async function fetchFromRemote(key: string, file: string, transport: TestMediaTransport, log: (line: string) => void): Promise<number> {
  const sidecarTemp = `${sidecarPath(file)}.${uniqueSuffix()}.part`
  const dataTemp = `${file}.${uniqueSuffix()}.part`
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
    // The remote trusts a file with a sidecar: only a cached file that still matches its sidecar goes up.
    const expected = parseSidecar(await readFile(sidecarPath(file), 'utf8').catch(() => ''))
    const digest = await digestFile(file)
    if (!expected) await writeSidecar(file, digest)
    else if (expected.bytes !== digest.bytes || expected.sha256 !== digest.sha256) {
      log(`the cached ${key} does not match its sidecar (${digest.bytes} of ${expected.bytes} bytes, sha256 ${digest.sha256.slice(0, 12)} instead of ${expected.sha256.slice(0, 12)}); `
        + `not uploaded. Delete ${file} to have it generated again`)
      return false
    }
    return startUpload(key, file, digest.bytes, transport, log)
  })().catch(() => false)
}
