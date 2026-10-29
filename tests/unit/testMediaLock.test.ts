import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  breakStaleLock, inspectFileLock, LOCK_SAME_HOST_STALE_MS, LOCK_STALE_MS, processStart, withFileLock, withFileLockIfFree,
} from '../playwright/fixtures/testMediaLock'

const LOCK_MODULE = path.resolve(__dirname, '../playwright/fixtures/testMediaLock.ts')
const hasProcessStart = processStart(process.pid) !== null

let root = ''
let lines: string[] = []
const log = (line: string) => { lines.push(line) }

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'test-media-lock-'))
  lines = []
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const record = (owner: { pid: number; host?: string; processStart?: string | null; token?: string }) =>
  JSON.stringify({ host: os.hostname(), started: '', ...owner })
const backdate = async (file: string, ms: number) => { const time = new Date(Date.now() - ms); await utimes(file, time, time) }
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid!

/** A live process of this user for the duration of `body`. */
async function withLiveProcess(body: (pid: number) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
  try {
    await body(child.pid!)
  } finally {
    child.kill()
  }
}

describe('test media lock: when a lock is stale', () => {
  it('takes over a lock of this host whose process died', async () => {
    const lock = path.join(root, 'dead.lock')
    await writeFile(lock, record({ pid: deadPid() }))
    expect((await inspectFileLock(lock))?.stale).toBe(true)
  })

  it.skipIf(!hasProcessStart)('tells a reused PID (another start time) from the live owner (the same start time)', async () => {
    const lock = path.join(root, 'reused.lock')
    await withLiveProcess(async pid => {
      await writeFile(lock, record({ pid, processStart: processStart(pid) }))
      expect((await inspectFileLock(lock))?.stale).toBe(false)
      await writeFile(lock, record({ pid, processStart: 'another-boot:1' }))
      expect((await inspectFileLock(lock))?.stale).toBe(true)
      // PID 1 belongs to another user (kill gives EPERM): only its start time tells it is not the owner.
      await writeFile(lock, record({ pid: 1, processStart: 'another-boot:1' }))
      expect((await inspectFileLock(lock))?.stale).toBe(true)
    })
  })

  it('takes over a live-looking owner without a start time once its heartbeat stopped for the generous same-host limit', async () => {
    const lock = path.join(root, 'old-format.lock')
    for (const pid of [process.pid, 1]) {
      await writeFile(lock, record({ pid }))
      await backdate(lock, LOCK_SAME_HOST_STALE_MS - 60_000)
      expect((await inspectFileLock(lock))?.stale, `pid ${pid}, heartbeat 9 min old`).toBe(false)
      await backdate(lock, LOCK_SAME_HOST_STALE_MS + 60_000)
      expect((await inspectFileLock(lock))?.stale, `pid ${pid}, heartbeat 11 min old`).toBe(true)
    }
  })

  it('takes over a lock of another host, or an unreadable one, when its heartbeat stopped for 30 s', async () => {
    const lock = path.join(root, 'other-host.lock')
    for (const text of [record({ pid: process.pid, host: 'other-host.invalid' }), '']) {
      await writeFile(lock, text)
      expect((await inspectFileLock(lock))?.stale).toBe(false)
      await backdate(lock, LOCK_STALE_MS + 5_000)
      expect((await inspectFileLock(lock))?.stale).toBe(true)
    }
  })
})

describe('test media lock: heartbeat and takeover', () => {
  it('keeps the heartbeat fresh from a separate process while the holder blocks its event loop (a spawnSync generator)', async () => {
    const lock = path.join(root, 'busy.lock')
    const script = `
      const { withFileLock } = await import(${JSON.stringify(pathToFileURL(LOCK_MODULE).href)})
      await withFileLock(${JSON.stringify(lock)}, async () => {
        console.log('locked')
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000)
      }, { heartbeatMs: 100, log: () => {} })
      console.log('released')`
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, NODE_NO_WARNINGS: '1' } })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    const exited = new Promise(resolve => child.on('exit', resolve))
    await vi.waitFor(() => expect(out).toContain('locked'), { timeout: 10_000, interval: 20 })
    const first = (await stat(lock)).mtimeMs
    await vi.waitFor(async () => expect((await stat(lock)).mtimeMs).toBeGreaterThan(first), { timeout: 2_000, interval: 50 })
    expect(out, 'the holder was still blocked').not.toContain('released')
    await exited
    expect(out).toContain('released')
    expect(existsSync(lock)).toBe(false)
  }, 20_000)

  it('puts back the fresh lock a second waiter moved while taking over the same stale lock', async () => {
    const lock = path.join(root, 'race.lock')
    await writeFile(lock, record({ pid: deadPid() }))
    const stale = (await inspectFileLock(lock))!
    expect(stale.stale).toBe(true)
    // Waiter A takes the stale lock over and holds it; waiter B acts on its earlier look at the stale one.
    let release!: () => void
    let held!: () => void
    const holding = new Promise<void>(resolve => { held = resolve })
    const first = withFileLock(lock, () => { held(); return new Promise<void>(resolve => { release = resolve }) }, { log })
    await holding
    const owner = (await inspectFileLock(lock))!.owner
    expect(JSON.parse(owner).pid).toBe(process.pid)
    expect(await breakStaleLock(lock, stale.identity, log)).toBe(false)
    expect((await inspectFileLock(lock))?.owner).toBe(owner)
    expect(await withFileLockIfFree(lock, async () => 'second holder', { log })).toBeNull()
    release()
    await first
    expect(existsSync(lock)).toBe(false)
    expect(lines).toEqual([])
  })

  it('lets exactly one of many waiters hold a stale lock at a time and leaves nothing behind', async () => {
    const lock = path.join(root, 'crowd.lock')
    await writeFile(lock, record({ pid: deadPid() }))
    let active = 0, most = 0, runs = 0
    await Promise.all(Array.from({ length: 8 }, () => withFileLock(lock, async () => {
      most = Math.max(most, ++active)
      await new Promise(resolve => setTimeout(resolve, 20))
      active--
      runs++
    }, { log })))
    expect(runs).toBe(8)
    expect(most).toBe(1)
    expect(await readdir(root)).toEqual([])
    expect(lines).toEqual([])
  })

  it('releases only its own lock: one taken over meanwhile stays with its new holder', async () => {
    const lock = path.join(root, 'taken.lock')
    const foreign = record({ pid: process.pid, host: 'other-host.invalid', token: 'not-mine' })
    await withFileLock(lock, async () => { await writeFile(lock, foreign) }, { log })
    expect(await readFile(lock, 'utf8')).toBe(foreign)
  })
})
