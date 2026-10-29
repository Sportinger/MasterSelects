import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  digestFile, ensureTestMedia, formatSidecar, parseSidecar, parseTestMediaRemote, rsyncTransport, testMediaDir, testMediaRemoteSpec,
  type TestMediaTransport,
} from '../playwright/fixtures/testMediaStore'

const STORE_MODULE = path.resolve(__dirname, '../playwright/fixtures/testMediaStore.ts')
const hasRsync = (() => { try { execFileSync('rsync', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

let root = ''
let cache = ''
let remote = ''
let lines: string[] = []
const log = (line: string) => { lines.push(line) }

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'test-media-store-'))
  cache = path.join(root, 'cache')
  remote = path.join(root, 'remote')
  lines = []
  vi.stubEnv('MASTERSELECTS_TEST_MEDIA_DIR', cache)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

/** Generator that writes `content` and counts its calls. */
function generator(content: string) {
  const calls: string[] = []
  return { calls, generate: async (target: string) => { calls.push(target); await writeFile(target, content) } }
}

async function seedRemote(key: string, content: string, sidecarContent = content): Promise<void> {
  const file = path.join(remote, key)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(`${file}.source`, sidecarContent)
  await writeFile(`${file}.sha256`, formatSidecar(path.basename(file), await digestFile(`${file}.source`)))
  await rm(`${file}.source`)
  await writeFile(file, content)
}

describe('test media store configuration', () => {
  it('uses ~/.cache/masterselects-test-media unless MASTERSELECTS_TEST_MEDIA_DIR is set', () => {
    expect(testMediaDir({})).toBe(path.join(os.homedir(), '.cache', 'masterselects-test-media'))
    expect(testMediaDir({ MASTERSELECTS_TEST_MEDIA_DIR: '/data/media' })).toBe(path.resolve('/data/media'))
  })

  it('reads the remote from the environment, then from the first line of the config file; off disables it', async () => {
    const config = path.join(root, 'test-media-remote')
    await writeFile(config, 'media-host:/srv/media\nignored second line\n')
    expect(testMediaRemoteSpec({}, config)).toBe('media-host:/srv/media')
    expect(testMediaRemoteSpec({ MASTERSELECTS_TEST_MEDIA_REMOTE: 'other:/x' }, config)).toBe('other:/x')
    expect(testMediaRemoteSpec({ MASTERSELECTS_TEST_MEDIA_REMOTE: 'off' }, config)).toBeNull()
    expect(testMediaRemoteSpec({}, path.join(root, 'missing'))).toBeNull()
    // Unit tests never pick up the host's config file.
    expect(testMediaRemoteSpec({ VITEST: 'true' }, config)).toBeNull()
  })

  it('tells an ssh remote from a local directory', () => {
    expect(parseTestMediaRemote('user@media-host:/srv/media/')).toEqual({ kind: 'ssh', host: 'user@media-host', root: '/srv/media' })
    expect(parseTestMediaRemote('/mnt/media')).toEqual({ kind: 'local', root: path.resolve('/mnt/media') })
    expect(parseTestMediaRemote('C:\\media').kind).toBe('local')
  })

  it('writes and reads the sha256 sidecar', () => {
    const digest = { sha256: 'a'.repeat(64), bytes: 1234 }
    expect(parseSidecar(formatSidecar('clip.mp4', digest))).toEqual(digest)
    expect(parseSidecar('garbage')).toBeNull()
  })
})

describe.skipIf(!hasRsync)('test media store with an rsync remote (local directory)', () => {
  it('generates a missing file once, writes its sidecar and uploads both', async () => {
    const { calls, generate } = generator('frame data v1')
    const media = await ensureTestMedia('clips/a.mp4', generate, { transport: rsyncTransport(remote), log })
    expect(media.source).toBe('generated')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/\.tmp\.mp4$/)
    expect(media.path).toBe(path.join(cache, 'clips/a.mp4'))
    expect(await readFile(media.path, 'utf8')).toBe('frame data v1')
    expect(parseSidecar(await readFile(`${media.path}.sha256`, 'utf8'))?.bytes).toBe(13)
    expect(await media.upload).toBe(true)
    expect((await readFile(`${media.path}.uploaded`, 'utf8')).trim()).toBe(remote)
    expect(existsSync(`${media.path}.uploading`)).toBe(false)
    expect(await readFile(path.join(remote, 'clips/a.mp4'), 'utf8')).toBe('frame data v1')
    expect(parseSidecar(await readFile(path.join(remote, 'clips/a.mp4.sha256'), 'utf8'))?.bytes).toBe(13)
  })

  it('returns a local hit without generating or touching the remote', async () => {
    const transport = rsyncTransport(remote)
    const first = generator('one')
    await ensureTestMedia('clips/b.wav', first.generate, { directory: cache, transport, log })
    const second = generator('two')
    const media = await ensureTestMedia('clips/b.wav', second.generate, { directory: cache, transport, log })
    expect(media.source).toBe('local')
    expect(second.calls).toHaveLength(0)
    expect(await readFile(media.path, 'utf8')).toBe('one')
  })

  it('fetches a remote hit, checks its sha256 and keeps the sidecar', async () => {
    await seedRemote('phone/c.mp4', 'remote bytes')
    const { calls, generate } = generator('generated bytes')
    const media = await ensureTestMedia('phone/c.mp4', generate, { directory: cache, transport: rsyncTransport(remote), log })
    expect(media.source).toBe('remote')
    expect(calls).toHaveLength(0)
    expect(await readFile(media.path, 'utf8')).toBe('remote bytes')
    expect(parseSidecar(await readFile(`${media.path}.sha256`, 'utf8'))?.bytes).toBe(12)
    expect(lines.some(line => line.startsWith('fetched phone/c.mp4 from the remote'))).toBe(true)
  })

  it.each([
    ['corrupt (same size, other bytes)', 'remote bytez'],
    ['partial (truncated)', 'remote by'],
  ])('rejects a %s remote file, generates instead and replaces the remote copy', async (_label, stored) => {
    await seedRemote('phone/d.mp4', stored, 'remote bytes')
    const { calls, generate } = generator('fresh bytes')
    const media = await ensureTestMedia('phone/d.mp4', generate, { directory: cache, transport: rsyncTransport(remote), log })
    expect(media.source).toBe('generated')
    expect(calls).toHaveLength(1)
    expect(lines.some(line => line.includes('corrupt or partial'))).toBe(true)
    expect(await readFile(media.path, 'utf8')).toBe('fresh bytes')
    expect(await media.upload).toBe(true)
    expect(await readFile(path.join(remote, 'phone/d.mp4'), 'utf8')).toBe('fresh bytes')
    expect(existsSync(path.join(cache, 'd.mp4.sha256'))).toBe(true)
  })

  it('uploads a cached file that never reached the remote (offline when it was made)', async () => {
    const { generate } = generator('made offline')
    await ensureTestMedia('clips/e.mp4', generate, { directory: cache, transport: null, log })
    const media = await ensureTestMedia('clips/e.mp4', generate, { directory: cache, transport: rsyncTransport(remote), log })
    expect(media.source).toBe('local')
    expect(await media.upload).toBe(true)
    expect(await readFile(path.join(remote, 'clips/e.mp4'), 'utf8')).toBe('made offline')
  })
})

describe('test media store fallbacks and locking', () => {
  it('falls back to generation within a few seconds when the ssh remote is unreachable, probing once per process', async () => {
    const transport = rsyncTransport('unreachable-host.invalid:/srv/media')
    const started = Date.now()
    const media = await ensureTestMedia('clips/f.mp4', generator('local only').generate, { directory: cache, transport, log })
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(media.source).toBe('generated')
    expect(media.upload).toBeNull()
    await ensureTestMedia('clips/g.mp4', generator('local only').generate, { directory: cache, transport, log })
    expect(lines.filter(line => line.includes('is unreachable'))).toHaveLength(1)
  }, 20_000)

  it('treats a transport error during download as a miss and logs it', async () => {
    let probes = 0
    const transport: TestMediaTransport = {
      label: 'flaky',
      probe: async () => { probes++; return null },
      download: async () => { throw new Error('connection reset') },
      upload: async () => { throw new Error('disk full') },
    }
    const media = await ensureTestMedia('clips/h.mp4', generator('ok').generate, { directory: cache, transport, log })
    expect(media.source).toBe('generated')
    expect(await media.upload).toBe(false)
    const second = await ensureTestMedia('clips/i.mp4', generator('ok').generate, { directory: cache, transport, log })
    expect(await second.upload).toBe(false)
    expect(probes).toBe(1)
    expect(lines.filter(line => line.includes('connection reset'))).toHaveLength(2)
    // A failed upload is logged once; later uploads from this process are skipped.
    expect(lines.filter(line => line.includes('failed (disk full)'))).toHaveLength(1)
  })

  it('leaves nothing behind when the generator fails or writes nothing', async () => {
    await expect(ensureTestMedia('clips/j.mp4', async () => undefined, { directory: cache, transport: null, log })).rejects.toThrow(/wrote no file/)
    await expect(ensureTestMedia('clips/j.mp4', async () => { throw new Error('ffmpeg missing') }, { directory: cache, transport: null, log }))
      .rejects.toThrow(/ffmpeg missing/)
    expect(existsSync(path.join(cache, 'j.mp4'))).toBe(false)
    expect(existsSync(path.join(cache, 'j.mp4.lock'))).toBe(false)
  })

  it('takes over a lock whose process died', async () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid!
    await mkdir(cache, { recursive: true })
    await writeFile(path.join(cache, 'k.mp4.lock'), JSON.stringify({ pid: dead, host: os.hostname(), started: '' }))
    const media = await ensureTestMedia('clips/k.mp4', generator('after takeover').generate, { directory: cache, transport: null, log })
    expect(media.source).toBe('generated')
  })

  it('lets only one of two processes generate the same file; the other waits and reuses it', async () => {
    const counter = path.join(root, 'generated.txt')
    const script = `
      import { appendFile, writeFile } from 'node:fs/promises'
      const { ensureTestMedia } = await import(${JSON.stringify(pathToFileURL(STORE_MODULE).href)})
      const media = await ensureTestMedia('clips/shared.mp4', async target => {
        await appendFile(${JSON.stringify(counter)}, process.pid + '\\n')
        await new Promise(resolve => setTimeout(resolve, 1500))
        await writeFile(target, 'x'.repeat(100000))
      }, { directory: ${JSON.stringify(cache)}, transport: null, log: () => {} })
      console.log(media.source + ' ' + media.bytes)`
    const runOne = () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, NODE_NO_WARNINGS: '1' } })
      let out = '', err = ''
      child.stdout.on('data', chunk => { out += chunk })
      child.stderr.on('data', chunk => { err += chunk })
      child.on('exit', code => code === 0 ? resolve(out.trim()) : reject(new Error(`child failed (${code}): ${err}`)))
    })
    const results = await Promise.all([runOne(), runOne()])
    expect(results.toSorted()).toEqual(['generated 100000', 'local 100000'])
    expect((await readFile(counter, 'utf8')).trim().split('\n')).toHaveLength(1)
    expect(await readFile(path.join(cache, 'shared.mp4'), 'utf8')).toBe('x'.repeat(100000))
  }, 30_000)
})
