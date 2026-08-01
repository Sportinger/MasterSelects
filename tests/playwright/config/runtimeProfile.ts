import type { ModuleGate } from './moduleGates'

export type ActiveGate = Exclude<ModuleGate, 'draft'> | 'all'

export interface PlaywrightRuntimeProfile {
  activeGate: ActiveGate
  baseURL: string
  browserChannel: string
  headless: boolean
  host: string
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
    port,
    reuseExistingServer: parseBoolean(env.MASTERSELECTS_E2E_REUSE_SERVER, false),
    startWebServer: !parseBoolean(env.MASTERSELECTS_E2E_SKIP_WEB_SERVER, false),
  }
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
