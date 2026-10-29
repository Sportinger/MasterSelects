import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { constants, copyFile, link, open, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * The lock file of the test media store (fixtures/testMediaStore.ts). It keeps two workers,
 * worktrees or hosts sharing the cache folder from generating the same file at once.
 *
 * - Taken by hard-linking a complete owner record into place, so the lock never exists half
 *   written; the record carries a random token that identifies this holder.
 * - Its heartbeat (the lock's mtime) comes from a small separate process, so a generator that
 *   blocks the event loop with spawnSync for minutes keeps it fresh; it ends with its parent.
 * - Taken over when stale: by rename to a unique name, then an identity check (inode and record)
 *   of what was moved. A waiter that moved a fresh lock instead (another waiter took the stale
 *   one first) puts it back, so two waiters never both hold it.
 * - Released only by its holder: the lock is moved aside, and put back when its token is foreign.
 */

/** Unique suffix for temporary names: `<pid>-<hex>` (fixtures/testMediaStore.ts reads the PID back). */
export const uniqueSuffix = () => `${process.pid}-${randomBytes(3).toString('hex')}`

/** Lock of another host, or one whose owner is unreadable: stale when the heartbeat stopped this long. */
export const LOCK_STALE_MS = 30_000
/** Lock of this host whose owner PID is alive but its start time unknown (no /proc): generous, a reused PID is rare. */
export const LOCK_SAME_HOST_STALE_MS = 10 * 60_000
const HEARTBEAT_MS = 5_000

interface LockOwner { pid: number; host: string; started: string; token?: string; processStart?: string | null }

/** True unless the process is certainly gone from this host (another user's process counts as alive). */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

let bootId: string | undefined

/** `<boot id>:<start tick>` of a process on Linux, so a reused PID is told from the owner; null where /proc is missing. */
export function processStart(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // The command name in parentheses may hold spaces; field 22 (start time) is the 20th after it.
    const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
    if (!start) return null
    bootId ??= (() => { try { return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() } catch { return '' } })()
    return `${bootId}:${start}`
  } catch {
    return null
  }
}

function parseOwner(text: string): LockOwner | null {
  try {
    const owner = JSON.parse(text) as LockOwner
    return typeof owner?.pid === 'number' && typeof owner.host === 'string' ? owner : null
  } catch {
    return null
  }
}

/**
 * A lock of this host is stale when its process is gone, or when the PID now belongs to another
 * process (a different start time). Without a start time to compare, an owner that looks alive
 * still loses the lock once its heartbeat stopped for LOCK_SAME_HOST_STALE_MS. A lock of another
 * host, or one whose owner is unreadable, is stale when its heartbeat stopped for LOCK_STALE_MS.
 */
function ownerIsStale(owner: LockOwner | null, heartbeatAgeMs: number): boolean {
  if (owner && owner.host === os.hostname()) {
    if (!processAlive(owner.pid)) return true
    const current = processStart(owner.pid)
    if (owner.processStart && current) return owner.processStart !== current
    return heartbeatAgeMs > LOCK_SAME_HOST_STALE_MS
  }
  return heartbeatAgeMs > LOCK_STALE_MS
}

/**
 * Identity (inode and record), record and heartbeat age of a lock file, read through one handle;
 * null when it is gone. An unreadable one has an empty record (its owner is unknown).
 */
async function readLock(lock: string): Promise<{ identity: string; text: string; ageMs: number } | null> {
  let handle
  try {
    handle = await open(lock, 'r')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    const info = await stat(lock).catch(() => null)
    return info ? { identity: `${info.ino}:`, text: '', ageMs: Date.now() - info.mtimeMs } : null
  }
  try {
    const info = await handle.stat()
    const text = await handle.readFile('utf8')
    return { identity: `${info.ino}:${text}`, text, ageMs: Date.now() - info.mtimeMs }
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

/** The lock's identity (for breakStaleLock), owner record and whether it may be taken over; null when there is none. */
export async function inspectFileLock(lock: string): Promise<{ identity: string; owner: string; stale: boolean } | null> {
  const current = await readLock(lock)
  return current ? { identity: current.identity, owner: current.text, stale: ownerIsStale(parseOwner(current.text), current.ageMs) } : null
}

/** Creates `target` from `source` only when it does not exist: a hard link, or an exclusive copy where links are unsupported. */
async function createExclusive(source: string, target: string): Promise<boolean> {
  try {
    await link(source, target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
  }
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

/**
 * Moves the stale lock with `identity` out of the way. When what was moved is another lock (a
 * second waiter took the stale one over and locked first), it is put back. Exported for tests.
 */
export async function breakStaleLock(lock: string, identity: string, log: (line: string) => void): Promise<boolean> {
  const moved = `${lock}.${uniqueSuffix()}.stale`
  if (!await rename(lock, moved).then(() => true, () => false)) return false
  try {
    if ((await readLock(moved))?.identity === identity) return true
    if (!await createExclusive(moved, lock)) {
      log(`lock ${path.basename(lock)} changed hands during a takeover and could not be put back; two processes may work on it at once (each still releases only its own lock)`)
    }
    return false
  } finally {
    await rm(moved, { force: true })
  }
}

async function releaseLock(lock: string, token: string, log: (line: string) => void): Promise<void> {
  const moved = `${lock}.${uniqueSuffix()}.release`
  if (!await rename(lock, moved).then(() => true, () => false)) return
  try {
    if (parseOwner(await readFile(moved, 'utf8').catch(() => ''))?.token === token) return
    // Taken over meanwhile (this holder was judged stale): the lock is someone else's now.
    if (!await createExclusive(moved, lock)) log(`lock ${path.basename(lock)} belonged to another process at release and could not be put back`)
  } finally {
    await rm(moved, { force: true })
  }
}

// Touches the lock while its record carries the token; ends when the parent's stdin pipe closes (the parent ended or released).
const HEARTBEAT_SCRIPT = `const { readFileSync, utimesSync } = require('node:fs')
const [lock, token, ms] = process.argv.slice(1)
setInterval(() => { try { if (readFileSync(lock, 'utf8').includes(token)) { const now = new Date(); utimesSync(lock, now, now) } } catch {} }, Number(ms))
process.stdin.on('end', () => process.exit(0)).on('error', () => process.exit(0)).resume()`

function startHeartbeat(lock: string, token: string, intervalMs: number, log: (line: string) => void): () => void {
  // In-process as well, in case the heartbeat process cannot be started.
  const timer = setInterval(() => {
    void readFile(lock, 'utf8').then(text => text.includes(token) ? utimes(lock, new Date(), new Date()) : undefined).catch(() => undefined)
  }, intervalMs)
  timer.unref()
  let child: ReturnType<typeof spawn> | null = null
  const failed = (error: Error) => log(`the heartbeat process of ${path.basename(lock)} could not start (${error.message}); a generator that blocks this process may lose the lock to a waiter`)
  try {
    child = spawn(process.execPath, ['-e', HEARTBEAT_SCRIPT, lock, token, String(intervalMs)], {
      stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, NODE_OPTIONS: '' }, windowsHide: true,
    })
    child.on('error', failed)
    child.stdin?.on('error', () => undefined)
    child.unref()
    ;(child.stdin as unknown as { unref?: () => void } | null)?.unref?.()
  } catch (error) {
    failed(error as Error)
  }
  return () => {
    clearInterval(timer)
    child?.stdin?.end()
    child?.kill()
  }
}

export interface FileLockOptions {
  /** Called once when the lock is busy, with its owner record. */
  onWait?: (owner: string) => void
  /** Rare lock anomalies (a takeover race that could not be undone). */
  log?: (line: string) => void
  /** Heartbeat interval; default 5 s. */
  heartbeatMs?: number
}

const defaultLog = (line: string) => console.log(`[test-media] ${line}`)

async function acquire(lock: string, wait: boolean, options: FileLockOptions): Promise<string | null> {
  const log = options.log ?? defaultLog
  const token = randomBytes(8).toString('hex')
  const record = `${lock}.${uniqueSuffix()}`
  await writeFile(record, JSON.stringify({ pid: process.pid, host: os.hostname(), started: new Date().toISOString(), token, processStart: processStart(process.pid) }))
  try {
    let announced = false
    for (;;) {
      if (await createExclusive(record, lock)) return token
      const current = await readLock(lock)
      if (current && ownerIsStale(parseOwner(current.text), current.ageMs)) {
        // A failed move (gone meanwhile, or another waiter's fresh lock put back) is retried after a short pause.
        if (!await breakStaleLock(lock, current.identity, log)) await new Promise(resolve => setTimeout(resolve, 20))
        continue
      }
      if (current && !wait) return null
      if (current && !announced && options.onWait) options.onWait(current.text || 'another process')
      announced ||= Boolean(current)
      await new Promise(resolve => setTimeout(resolve, current ? 200 + Math.random() * 300 : 20))
    }
  } finally {
    await rm(record, { force: true })
  }
}

async function hold<T>(lock: string, token: string, work: () => Promise<T>, options: FileLockOptions): Promise<T> {
  const log = options.log ?? defaultLog
  const stop = startHeartbeat(lock, token, options.heartbeatMs ?? HEARTBEAT_MS, log)
  try {
    return await work()
  } finally {
    stop()
    await releaseLock(lock, token, log)
  }
}

/** Runs `work` while holding `lock`, waiting for a live holder and taking over a stale one. */
export async function withFileLock<T>(lock: string, work: () => Promise<T>, options: FileLockOptions = {}): Promise<T> {
  return hold(lock, (await acquire(lock, true, options))!, work, options)
}

/** Like withFileLock, but returns null at once (without running `work`) when a live process holds the lock. */
export async function withFileLockIfFree<T>(lock: string, work: () => Promise<T>, options: FileLockOptions = {}): Promise<{ value: T } | null> {
  const token = await acquire(lock, false, options)
  return token ? { value: await hold(lock, token, work, options) } : null
}
