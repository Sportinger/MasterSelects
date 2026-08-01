import { randomUUID } from 'node:crypto'
import type { TestInfo } from '@playwright/test'
import type { BridgeClient, BridgeToolResult } from './bridgeClient'
import type { TrackedMediaFixture } from './mediaFixture'

export interface StressFixtureOptions {
  projectName?: string
  durationSeconds?: number
  width?: number
  height?: number
  frameRate?: number
  timeoutMs?: number
  primaryMediaOnly?: boolean
}

export interface StressFixtureImportedMedia {
  id: string
  name: string
  type: string
  duration?: number
  path: string
}

export interface StressFixtureTimelineSummary {
  duration: number
  trackCount: number
  clipCount: number
  clips: unknown[]
  markers: unknown[]
}

export interface StressTestProjectData {
  projectName: string
  elapsedMs: number
  activeCompositionId: string
  activeCompositionName: string
  imported: StressFixtureImportedMedia[]
  importErrors?: Array<{ path: string; error: string }>
  mediaRoles: {
    primaryMotion: string
    blendMask: string
    detailNested: string
  }
  compositionSummaries: unknown[]
  timeline: StressFixtureTimelineSummary
}

/**
 * Creates only in-memory/browser-context test projects through the existing
 * deterministic bridge fixture. It never opens a saved project and never
 * accepts a caller-controlled resetProject value.
 */
export class IsolatedProjectFixture {
  readonly projectName: string
  private readonly bridge: BridgeClient
  private readonly media: TrackedMediaFixture

  constructor(
    bridge: BridgeClient,
    media: TrackedMediaFixture,
    testInfo: TestInfo,
  ) {
    this.bridge = bridge
    this.media = media
    this.projectName = buildIsolatedProjectName(testInfo)
  }

  async createStressTestProjectFixture(
    options: StressFixtureOptions = {},
  ): Promise<BridgeToolResult<StressTestProjectData>> {
    const paths = options.primaryMediaOnly
      ? [
          this.media.primaryMotion.absolutePath,
          this.media.primaryMotion.absolutePath,
          this.media.primaryMotion.absolutePath,
        ]
      : [...this.media.paths]
    return this.bridge.tool<StressTestProjectData>('createStressTestProjectFixture', {
      paths,
      resetProject: true,
      projectName: options.projectName?.trim() || this.projectName,
      durationSeconds: options.durationSeconds ?? 6.2,
      width: options.width ?? 1920,
      height: options.height ?? 1080,
      frameRate: options.frameRate ?? 24,
    }, {
      timeoutMs: options.timeoutMs ?? 90_000,
      fetchTimeoutMs: (options.timeoutMs ?? 90_000) + 10_000,
    })
  }

  async createStressTestProjectData(
    options: StressFixtureOptions = {},
  ): Promise<StressTestProjectData> {
    const result = await this.createStressTestProjectFixture(options)
    if (!result.success || !result.data) {
      throw new Error(
        `createStressTestProjectFixture: ${result.error ?? 'fixture returned no project data'}`,
      )
    }
    return result.data
  }
}

function buildIsolatedProjectName(testInfo: TestInfo): string {
  const title = testInfo.title
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'test'
  const suffix = randomUUID().slice(0, 8)
  return `Playwright-${testInfo.workerIndex}-${testInfo.parallelIndex}-${title}-${suffix}`
}
