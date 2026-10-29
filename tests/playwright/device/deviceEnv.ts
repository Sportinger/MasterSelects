import os from 'node:os'
import path from 'node:path'

/**
 * Settings of the real-device run, all from environment variables (documented in
 * tests/playwright/README.md, "Real device"). Pure, so the config and the unit test share it.
 */

export const PRODUCTION_BASE_URL = 'https://www.masterselects.com'

export type MediaTransport = 'auto' | 'route' | 'reverse'

export interface DeviceEnv {
  /** MASTERSELECTS_DEVICE=1: nothing in this folder runs without it. */
  enabled: boolean
  /** adb serial (wireless "192.168.x.y:port"); empty: the only connected device. */
  serial: string
  adb: string
  /** PC port forwarded to the phone's chrome_devtools_remote socket. */
  cdpPort: number
  /** Origin of the editor the phone opens; the journeys open `${baseURL}/m`. */
  baseURL: string
  /** PC ports reversed to the phone (a dev server on the PC reached as http://localhost:<port>). */
  reversePorts: number[]
  /** Port of the tiny media server (reversed to the phone when the `reverse` transport is used). */
  mediaPort: number
  /**
   * How generated files reach the page and exports come back: `route` intercepts a same-origin URL
   * in Chrome (no network, files up to ROUTE_LIMIT_BYTES), `reverse` serves them over adb reverse
   * (any size), `auto` picks by size.
   */
  transport: MediaTransport
  /** Interval of the keep-awake wake key while a run is connected. */
  keepAwakeMs: number
  /** Phone footage profile the journeys import (fixtures/phoneFootageProfiles.ts, e.g. android-h264, android-h264-rotated, android-vfr). */
  footageProfile: string
  /** importMs: Done to the clip tile on the page clock, for the journeys' recording (budgets are soft checks). */
  budgets: { phaseMs: number; totalMs: number; firstFrameMs: number; bootMs: number; importMs: number }
  /**
   * Where exported files pulled from the phone land. Default: a folder under os.tmpdir() (a tmpfs on
   * the Linux test host), because a phone export can be gigabytes and the repo disk is often full.
   */
  outputDir: string
  /**
   * MASTERSELECTS_DEVICE_ALLOW_EDITOR_TABS=1: run although the owner has a MasterSelects tab open in
   * the phone's Chrome. Off by default, because the test tab restores the last project and two tabs
   * on one project compete for its storage.
   */
  allowEditorTabs: boolean
}

/**
 * Above this size `auto` serves a file over adb reverse instead of a Chrome route. A route body crosses
 * DevTools as one base64 message: over wireless adb the 30 MB Pixel recording took 24-38 s that way and
 * twice lost the DevTools target mid-transfer ("Target page ... has been closed"); adb reverse streams it.
 */
export const ROUTE_LIMIT_BYTES = 8 * 1024 * 1024

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer, got "${value}"`)
  return parsed
}

export function resolveDeviceEnv(env: Record<string, string | undefined> = process.env): DeviceEnv {
  const baseURL = (env.MASTERSELECTS_DEVICE_BASE_URL?.trim() || PRODUCTION_BASE_URL).replace(/\/+$/, '')
  let parsed: URL
  try { parsed = new URL(baseURL) } catch { throw new Error(`MASTERSELECTS_DEVICE_BASE_URL is not a URL: "${baseURL}"`) }
  const reversePorts = (env.MASTERSELECTS_DEVICE_REVERSE_PORTS ?? '').split(',').map(part => part.trim()).filter(Boolean)
    .map(part => int(part, 0, 'MASTERSELECTS_DEVICE_REVERSE_PORTS'))
  // A dev server on the PC addressed as localhost from the phone needs its port reversed.
  if (/^(localhost|127\.0\.0\.1)$/.test(parsed.hostname)) {
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
    if (!reversePorts.includes(port)) reversePorts.push(port)
  }
  const transport = (env.MASTERSELECTS_DEVICE_MEDIA_TRANSPORT?.trim() || 'auto') as MediaTransport
  if (!['auto', 'route', 'reverse'].includes(transport)) throw new Error(`MASTERSELECTS_DEVICE_MEDIA_TRANSPORT must be auto, route or reverse, got "${transport}"`)
  return {
    enabled: env.MASTERSELECTS_DEVICE === '1',
    serial: env.MASTERSELECTS_DEVICE_SERIAL?.trim() ?? '',
    adb: env.MASTERSELECTS_DEVICE_ADB?.trim() || 'adb',
    cdpPort: int(env.MASTERSELECTS_DEVICE_CDP_PORT, 9333, 'MASTERSELECTS_DEVICE_CDP_PORT'),
    baseURL,
    reversePorts,
    mediaPort: int(env.MASTERSELECTS_DEVICE_MEDIA_PORT, 8099, 'MASTERSELECTS_DEVICE_MEDIA_PORT'),
    transport,
    keepAwakeMs: int(env.MASTERSELECTS_DEVICE_KEEP_AWAKE_MS, 20_000, 'MASTERSELECTS_DEVICE_KEEP_AWAKE_MS'),
    footageProfile: env.MASTERSELECTS_DEVICE_FOOTAGE_PROFILE?.trim() || 'android-h264',
    budgets: {
      phaseMs: int(env.MASTERSELECTS_DEVICE_PHASE_BUDGET_MS, 3_000, 'MASTERSELECTS_DEVICE_PHASE_BUDGET_MS'),
      totalMs: int(env.MASTERSELECTS_DEVICE_TOTAL_BUDGET_MS, 6_000, 'MASTERSELECTS_DEVICE_TOTAL_BUDGET_MS'),
      firstFrameMs: int(env.MASTERSELECTS_DEVICE_FIRST_FRAME_BUDGET_MS, 3_000, 'MASTERSELECTS_DEVICE_FIRST_FRAME_BUDGET_MS'),
      bootMs: int(env.MASTERSELECTS_DEVICE_BOOT_BUDGET_MS, 8_000, 'MASTERSELECTS_DEVICE_BOOT_BUDGET_MS'),
      importMs: int(env.MASTERSELECTS_DEVICE_IMPORT_BUDGET_MS, 10_000, 'MASTERSELECTS_DEVICE_IMPORT_BUDGET_MS'),
    },
    outputDir: path.resolve(env.MASTERSELECTS_DEVICE_OUTPUT_DIR?.trim() || path.join(os.tmpdir(), 'masterselects-device')),
    allowEditorTabs: env.MASTERSELECTS_DEVICE_ALLOW_EDITOR_TABS === '1',
  }
}

/** The transport one file of `bytes` uses. */
export function transportFor(env: Pick<DeviceEnv, 'transport'>, bytes: number): 'route' | 'reverse' {
  if (env.transport !== 'auto') return env.transport
  return bytes <= ROUTE_LIMIT_BYTES ? 'route' : 'reverse'
}

/**
 * Wait for a UI reaction to a tap (a sheet opening, a handle showing). Generous on purpose: the
 * wireless adb DevTools link to the Pixel stalls for 12-15 s at times while the page is idle
 * (2026-10-28), and a 15 s wait then failed a journey for a stall the product never saw. The
 * product's own speed is judged on the page clock (deviceTelemetry.installActionTimeline).
 */
export const UI_WAIT_MS = 45_000

/** Every test project the harness creates is named like this, so it is recognisable on the phone. */
export const DEVICE_PROJECT_PREFIX = 'Device test'

export function deviceProjectName(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', ' ').slice(0, 15)
  return `${DEVICE_PROJECT_PREFIX} ${stamp}`
}

export function isDeviceProjectName(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.trim().startsWith(DEVICE_PROJECT_PREFIX)
}
