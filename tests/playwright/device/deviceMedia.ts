import { randomBytes } from 'node:crypto'
import { mkdir, stat, statfs, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { transportFor, type DeviceEnv } from './deviceEnv'
import type { DeviceMediaServer } from './deviceMediaServer'

/**
 * Generated files into the phone page and exported files back to the PC.
 *
 * In: the page fetches the file, wraps it in a `File` and sets it on the phone's hidden media input
 * through a `DataTransfer` plus a `change` event: what `setInputFiles` does on an emulated phone and
 * what the native picker hands the page (the input is the same one the Media sheet opens). The bytes
 * come either from a Chrome route on a same-origin URL (`route`: no network, no permission prompt,
 * up to ROUTE_LIMIT_BYTES) or from the PC media server over adb reverse (`reverse`: any size, the
 * multi-GB phone recordings).
 *
 * Out: the export sheet's Share hands a `File` to `navigator.share`. The harness replaces share and
 * canShare in its own tab with a stub that keeps the File (the real share sheet would need a person,
 * Save would leave a file in the phone's Downloads), then copies the bytes to the PC: PUT to the
 * media server (`reverse`) or base64 chunks over DevTools (`route`).
 */

const ROUTE_PREFIX = '/__ms-device-media__/'

export interface InjectedFile { name: string; bytes: number; fetchMs: number; transport: 'route' | 'reverse' }

export interface InjectOptions {
  /** data-testid of the file input (phone-media-input-visual / -audio). */
  inputTestId: string
  contentType: string
  /** Name the File carries in the page (default: the file's own name). */
  name?: string
  /** File.lastModified in the page (phone recordings carry the recording time). */
  lastModified?: number
}

export async function injectFile(page: Page, env: Pick<DeviceEnv, 'transport' | 'baseURL'>, server: DeviceMediaServer | null,
  file: string, options: InjectOptions): Promise<InjectedFile> {
  const { size } = await stat(file)
  const transport = transportFor(env, size)
  const name = options.name ?? path.basename(file)
  let url: string
  if (transport === 'route') {
    url = `${new URL(page.url()).origin}${ROUTE_PREFIX}${randomBytes(12).toString('hex')}/${encodeURIComponent(name)}`
    await page.route(url, route => route.fulfill({ path: file, contentType: options.contentType, headers: { 'Cache-Control': 'no-store' } }), { times: 1 })
  } else {
    if (!server) throw new Error(`${name} (${size} bytes) needs the reverse media transport, but no media server is running`)
    url = server.serve(file, options.contentType)
  }
  const result = await page.evaluate(async ({ url, name, type, lastModified, testId }) => {
    const started = performance.now()
    let response: Response
    try {
      response = await fetch(url, { cache: 'no-store' })
    } catch (error) {
      return { error: `fetch failed: ${String(error)}` }
    }
    if (!response.ok) return { error: `HTTP ${response.status}` }
    const blob = await response.blob()
    const fetchMs = performance.now() - started
    const input = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)
    if (!input) return { error: `no input [data-testid="${testId}"] in the page` }
    const picked = new File([blob], name, { type, lastModified: lastModified ?? Date.now() })
    const transfer = new DataTransfer()
    transfer.items.add(picked)
    input.files = transfer.files
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return { bytes: picked.size, fetchMs }
  }, { url, name, type: options.contentType, lastModified: options.lastModified, testId: options.inputTestId })
  if ('error' in result) {
    const hint = transport === 'reverse'
      ? ' The page could not reach the PC media server over adb reverse; Chrome may block local network access from this origin (then allow it for the site once, or use MASTERSELECTS_DEVICE_MEDIA_TRANSPORT=route for files up to 64 MB).'
      : ''
    throw new Error(`Could not hand ${name} to the page (${transport}): ${result.error}.${hint}`)
  }
  if (result.bytes !== size) throw new Error(`${name} arrived with ${result.bytes} of ${size} bytes (${transport})`)
  return { name, bytes: result.bytes, fetchMs: Math.round(result.fetchMs ?? 0), transport }
}

// ---------------------------------------------------------------------------
// Export capture
// ---------------------------------------------------------------------------

interface SharedRecord { name: string; type: string; size: number; isFile: boolean; at: number }

type ShareWindow = Window & { __msDeviceShared?: File[]; __msDeviceSharedInfo?: SharedRecord[] }

/** Replaces navigator.share/canShare in this tab with a stub that keeps the shared File. Page-local; a reload removes it. */
export async function installShareCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as ShareWindow
    holder.__msDeviceShared = []
    holder.__msDeviceSharedInfo = []
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data?: ShareData) => Array.isArray(data?.files) && data.files.length > 0 })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        for (const file of data.files ?? []) {
          holder.__msDeviceShared!.push(file)
          holder.__msDeviceSharedInfo!.push({ name: file.name, type: file.type, size: file.size, isFile: file instanceof File, at: performance.now() })
        }
      },
    })
  })
}

/** Removes the stub again, so the tab's native share is back. */
export async function removeShareCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    Reflect.deleteProperty(navigator, 'share')
    Reflect.deleteProperty(navigator, 'canShare')
  }).catch(() => undefined)
}

export async function sharedFiles(page: Page): Promise<SharedRecord[]> {
  return page.evaluate(() => (window as ShareWindow).__msDeviceSharedInfo ?? [])
}

const CHUNK = 2 * 1024 * 1024
const HEADROOM_BYTES = 512 * 1024 * 1024

const TMPFS_MAGIC = 0x01021994

/**
 * Refuses a transfer that would fill the disk of `directory` (keeps 512 MB free). The default output
 * folder is on a tmpfs (RAM), so there the available memory must cover the file as well, like the
 * footage fixture's free-space check (fixtures/phoneFootage.ts assertFreeSpace).
 */
export async function assertRoomFor(directory: string, bytes: number, what: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  const info = await statfs(directory)
  const free = info.bavail * info.bsize
  if (free < bytes + HEADROOM_BYTES) {
    throw new Error(`${what} needs ${(bytes / 1e9).toFixed(2)} GB plus 0.5 GB headroom, but only ${(free / 1e9).toFixed(2)} GB are free in ${directory}. `
      + 'Free space there or point MASTERSELECTS_DEVICE_OUTPUT_DIR at a larger disk.')
  }
  if (info.type === TMPFS_MAGIC && os.freemem() < bytes + HEADROOM_BYTES) {
    throw new Error(`${what} needs ${(bytes / 1e9).toFixed(2)} GB in ${directory}, a tmpfs (RAM), but only ${(os.freemem() / 1e9).toFixed(2)} GB of memory are available. `
      + 'Point MASTERSELECTS_DEVICE_OUTPUT_DIR at a disk with enough space.')
  }
}

/** Copies the `index`-th shared File to `target` on the PC; returns the byte count and the transfer time. */
export async function pullSharedFile(page: Page, env: Pick<DeviceEnv, 'transport'>, server: DeviceMediaServer | null,
  index: number, target: string): Promise<{ bytes: number; transferMs: number; transport: 'route' | 'reverse' }> {
  const info = (await sharedFiles(page))[index]
  if (!info) throw new Error(`No shared file #${index} was captured`)
  const transport = transportFor(env, info.size)
  await assertRoomFor(path.dirname(target), info.size, `Pulling the ${info.name} export`)
  const started = Date.now()
  if (transport === 'reverse') {
    if (!server) throw new Error('The reverse transport needs the media server')
    const upload = server.expectUpload(target)
    const status = await page.evaluate(async ({ url, index }) => {
      const file = (window as ShareWindow).__msDeviceShared![index]
      try {
        const response = await fetch(url, { method: 'PUT', body: file, headers: { 'content-type': 'application/octet-stream' } })
        return response.status
      } catch (error) { return String(error) }
    }, { url: upload.url, index })
    if (status !== 201) throw new Error(`Uploading the export to the PC failed: ${status}`)
    const bytes = await upload.done
    return { bytes, transferMs: Date.now() - started, transport }
  }
  const parts: Buffer[] = []
  for (let offset = 0; offset < info.size; offset += CHUNK) {
    const base64 = await page.evaluate(async ({ index, offset, end }) => {
      const buffer = new Uint8Array(await (window as ShareWindow).__msDeviceShared![index].slice(offset, end).arrayBuffer())
      let binary = ''
      for (let at = 0; at < buffer.length; at += 0x8000) binary += String.fromCharCode(...buffer.subarray(at, at + 0x8000))
      return btoa(binary)
    }, { index, offset, end: Math.min(info.size, offset + CHUNK) })
    parts.push(Buffer.from(base64, 'base64'))
  }
  const data = Buffer.concat(parts)
  await writeFile(target, data)
  return { bytes: data.length, transferMs: Date.now() - started, transport }
}
