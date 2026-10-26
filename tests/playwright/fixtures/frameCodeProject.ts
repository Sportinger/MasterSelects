import { randomUUID } from 'node:crypto'
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { BridgeClient } from './bridgeClient'
import { EditorPage } from './editorPage'
import { frameCodeClip, type FrameCodeClip, type FrameCodeClipOptions } from './frameCodeMedia'
import { PreviewProbe } from './previewProbe'

/**
 * The shared start of a frame-code Sammeltest: a fresh browser context with a
 * warm GPU, the editor with a new browser project, a composition of the clip's
 * size and rate (the clip fills the preview, one composition frame is one source
 * frame) and, unless `placeClip` is false, the clip on the timeline at 0.
 */
export interface FrameCodeProject {
  context: BrowserContext
  page: Page
  editor: EditorPage
  bridge: BridgeClient
  clip: FrameCodeClip
  probe: PreviewProbe
}

export interface CompositionSize { width: number; height: number; fps: number; seconds: number }

export async function openFrameCodeProject(browser: Browser, baseURL: string | undefined,
  { composition, clip: clipOptions = {}, placeClip = true, size, viewport = { width: 1920, height: 1080 } }: {
    composition: string
    clip?: FrameCodeClipOptions
    placeClip?: boolean
    /** Composition settings when they differ from the clip's (a composition holding many clips, e.g. the mosaic). */
    size?: CompositionSize
    viewport?: { width: number; height: number }
  }): Promise<FrameCodeProject> {
  if (!baseURL) throw new Error('Playwright baseURL must be configured')
  const context = await browser.newContext({ viewport, acceptDownloads: true })
  const page = await context.newPage()
  await warmGpu(page, baseURL)
  const editor = await EditorPage.bootstrap(page, { baseURL, tabId: randomUUID() })
  const clip = await frameCodeClip({ width: 640, height: 360, fps: 30, seconds: 4, ...clipOptions })
  const settings = size ?? { width: clip.width, height: clip.height, fps: clip.fps, seconds: clip.frames / clip.fps }
  await editor.bridge.toolData('createComposition', { name: composition, width: settings.width, height: settings.height,
    frameRate: settings.fps, duration: settings.seconds, open: true })
  if (placeClip) {
    await editor.bridge.toolData('importLocalFiles', { paths: [clip.path.replaceAll('\\', '/')], addToTimeline: true, startTime: 0 }, { timeoutMs: 60_000 })
  }
  await editor.waitForProjectIdle(30_000)
  return { context, page, editor, bridge: editor.bridge, clip, probe: new PreviewProbe(page) }
}

// A fresh Chrome on Linux/Vulkan reports no WebGPU adapter for about a second;
// the editor must not initialise before the GPU answers.
export async function warmGpu(page: Page, baseURL: string): Promise<void> {
  await page.goto(new URL('/favicon.png', baseURL).toString())
  await expect.poll(() => page.evaluate(async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return gpu ? Boolean(await gpu.requestAdapter()) : 'no-webgpu-api'
  }), { timeout: 15_000, message: 'Chrome never offered a WebGPU adapter' }).not.toBe(false)
}
