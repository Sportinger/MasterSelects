import type { ModuleGate } from './moduleGates'

export type ActiveGate = Exclude<ModuleGate, 'draft'> | 'all'

export interface PlaywrightRuntimeProfile {
  activeGate: ActiveGate
  baseURL: string
  browserChannel: string
  headless: boolean
  host: string
  /** Include the long-running `nightly/` journeys (excluded from every other run). */
  includeNightly: boolean
  port: number
  reuseExistingServer: boolean
  startWebServer: boolean
}

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 4173

export function resolveRuntimeProfile(
  env: NodeJS.ProcessEnv = process.env,
): PlaywrightRuntimeProfile {
  const host = env.MASTERSELECTS_E2E_HOST?.trim() || DEFAULT_HOST
  const port = parsePort(env.MASTERSELECTS_E2E_PORT)
  const baseURL = env.MASTERSELECTS_E2E_BASE_URL?.trim() || `http://${host}:${port}`

  return {
    activeGate: resolveActiveGate(env),
    baseURL,
    browserChannel: env.MASTERSELECTS_E2E_BROWSER_CHANNEL?.trim() || 'chrome',
    headless: parseBoolean(env.MASTERSELECTS_E2E_HEADLESS, false),
    host,
    includeNightly: env.npm_lifecycle_event === 'test:e2e:nightly'
      || parseBoolean(env.MASTERSELECTS_E2E_NIGHTLY, false),
    port,
    reuseExistingServer: parseBoolean(env.MASTERSELECTS_E2E_REUSE_SERVER, false),
    startWebServer: !parseBoolean(env.MASTERSELECTS_E2E_SKIP_WEB_SERVER, false),
  }
}

/**
 * Chrome flags for this host. Linux needs ANGLE on Vulkan for WebGPU (without it
 * the preview never renders, and a headless run has no GPU at all); a headed
 * window runs through XWayland like the owner's own Chrome, because Chrome's
 * native Wayland window does not get Vulkan. `--force-color-profile=srgb` keeps
 * pixel reads independent of the monitor profile on every platform.
 */
export function chromeLaunchArgs(platform: NodeJS.Platform, headless: boolean): string[] {
  const args = ['--window-size=1920,1080', '--force-color-profile=srgb']
  if (platform !== 'linux') return args
  args.push('--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
    '--enable-unsafe-webgpu', '--ignore-gpu-blocklist')
  if (headless) args.push('--disable-vulkan-surface')
  else args.push('--ozone-platform=x11')
  return args
}

function resolveActiveGate(env: NodeJS.ProcessEnv): ActiveGate {
  if (env.npm_lifecycle_event === 'test:e2e:canary') {
    return 'canary'
  }
  if (env.npm_lifecycle_event === 'test:e2e:release') {
    return 'required'
  }

  const explicitGate = env.MASTERSELECTS_E2E_GATE?.trim().toLowerCase()
  if (explicitGate === 'canary' || explicitGate === 'required' || explicitGate === 'all') {
    return explicitGate
  }
  if (explicitGate) {
    throw new Error(
      `Invalid MASTERSELECTS_E2E_GATE: ${env.MASTERSELECTS_E2E_GATE}. `
        + 'Expected canary, required, or all.',
    )
  }

  return 'all'
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  return /^(1|true|yes|on)$/i.test(value.trim())
}

function parsePort(value: string | undefined): number {
  if (!value?.trim()) {
    return DEFAULT_PORT
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid MASTERSELECTS_E2E_PORT: ${value}`)
  }

  return port
}
