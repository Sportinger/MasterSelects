import { randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import { PHONE_M1_TEST_IDS, PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { BridgeClient } from '../fixtures/bridgeClient'
import { frameCodeClip } from '../fixtures/frameCodeMedia'
import { warmGpu } from '../fixtures/frameCodeProject'
import { installDeterministicStorage } from './phoneFixture'

/**
 * Fresh phone contexts for the M6 performance journeys (packet N5). A boot can only be measured
 * on a fresh page, so these cases do not share the Sammeltest page. Instruments installed before
 * any app code runs:
 * - long tasks (PerformanceObserver, buffered from navigation start) on window.__n5LongTasks;
 * - an optional GPU gate: navigator.gpu.requestAdapter waits until window.__n5ReleaseGpu() runs,
 *   so the engine is provably "still starting" while the test uses the UI;
 * - an optional React commit probe (the DevTools global hook, which react-refresh chains) that
 *   counts which components rendered while armed, to catch re-render storms.
 */

export interface PhonePerfOptions { gateGpu?: boolean; renderProbe?: boolean }

export interface PhonePerfWorld {
  context: BrowserContext
  page: Page
  baseURL: string
  tabId: string
}

export async function openPerfContext(browser: Browser, testInfo: TestInfo, options: PhonePerfOptions = {}): Promise<PhonePerfWorld> {
  const use = testInfo.project.use
  if (!use.baseURL || !use.viewport) throw new Error('Playwright baseURL and a phone viewport must be configured')
  const context = await browser.newContext({
    viewport: use.viewport, deviceScaleFactor: use.deviceScaleFactor,
    isMobile: true, hasTouch: true, userAgent: use.userAgent,
  })
  const page = await context.newPage()
  const tabId = randomUUID()
  await warmGpu(page, use.baseURL)
  await installDeterministicStorage(page, tabId)
  await page.addInitScript(installInstruments, { gateGpu: Boolean(options.gateGpu), renderProbe: Boolean(options.renderProbe) })
  return { context, page, baseURL: use.baseURL, tabId }
}

/** Runs in the page before any app script. */
function installInstruments(options: { gateGpu: boolean; renderProbe: boolean }): void {
  const holder = window as unknown as Record<string, unknown>
  // The default resource timing buffer holds 250 entries; the dev server serves far more modules.
  performance.setResourceTimingBufferSize(20_000)
  const longTasks: number[] = []
  holder.__n5LongTasks = longTasks
  try {
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) longTasks.push(entry.duration) })
      .observe({ type: 'longtask', buffered: true })
  } catch { holder.__n5LongTasksUnsupported = true }

  if (options.gateGpu) {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: (...args: unknown[]) => Promise<unknown> } }).gpu
    if (gpu) {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => { release = resolve })
      const original = gpu.requestAdapter.bind(gpu)
      holder.__n5GpuRequests = 0
      holder.__n5ReleaseGpu = () => release()
      gpu.requestAdapter = async (...args: unknown[]) => {
        holder.__n5GpuRequests = (holder.__n5GpuRequests as number) + 1
        await gate
        return original(...args)
      }
    }
  }

  if (options.renderProbe) {
    interface Fiber { tag: number; type: unknown; flags: number; child: Fiber | null; sibling: Fiber | null; alternate: Fiber | null }
    const counts: Record<string, number> = {}
    const probe = { armed: false, commits: 0, counts }
    holder.__n5Renders = probe
    const nameOf = (type: unknown): string | null => {
      if (typeof type === 'function') return (type as { displayName?: string; name?: string }).displayName || (type as { name?: string }).name || null
      if (type && typeof type === 'object') {
        const inner = (type as { type?: unknown; render?: unknown }).type ?? (type as { render?: unknown }).render
        return nameOf(inner)
      }
      return null
    }
    // Function (0), forwardRef (11), memo (14) and simple memo (15) components; PerformedWork = 1.
    const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15])
    const walk = (start: Fiber | null) => {
      const stack: Fiber[] = start ? [start] : []
      while (stack.length > 0) {
        const fiber = stack.pop()!
        if (COMPONENT_TAGS.has(fiber.tag) && (fiber.flags & 1) === 1) {
          const name = nameOf(fiber.type)
          if (name) counts[name] = (counts[name] ?? 0) + 1
        }
        if (fiber.sibling) stack.push(fiber.sibling)
        // Children that were not cloned in this render are the previous commit's fibers: skip them.
        if (fiber.child && (fiber.alternate === null || fiber.child !== fiber.alternate.child)) stack.push(fiber.child)
      }
    }
    const existing = (holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ ?? null) as Record<string, unknown> | null
    const hook = existing ?? {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer: unknown) { const id = (this.renderers as Map<number, unknown>).size + 1; (this.renderers as Map<number, unknown>).set(id, renderer); return id },
      onScheduleFiberRoot() {},
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
      isDisabled: false,
    }
    const previous = hook.onCommitFiberRoot as ((...args: unknown[]) => void) | undefined
    hook.onCommitFiberRoot = (...args: unknown[]) => {
      previous?.(...args)
      if (!probe.armed) return
      probe.commits++
      const root = args[1] as { current: Fiber }
      walk(root.current.child)
    }
    holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook
  }
}

/** For contexts without the phone instruments (the desktop comparison page). */
export async function widenResourceBuffer(page: Page): Promise<void> {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(20_000))
}

export async function readLongTasks(page: Page): Promise<{ count: number; totalMs: number; worstMs: number }> {
  return page.evaluate(() => {
    const tasks = ((window as unknown as { __n5LongTasks?: number[] }).__n5LongTasks ?? [])
    return { count: tasks.length, totalMs: Math.round(tasks.reduce((sum, value) => sum + value, 0)), worstMs: Math.round(Math.max(0, ...tasks)) }
  })
}

/** Script bytes the page loaded so far (decoded body sizes of script resources and the document's modules). */
export async function scriptBytes(page: Page): Promise<{ bytes: number; files: number }> {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const scripts = entries.filter(entry => entry.initiatorType === 'script' || /\.(m?js|tsx?|jsx)(\?|$)/.test(new URL(entry.name).pathname))
    return { bytes: scripts.reduce((sum, entry) => sum + (entry.decodedBodySize || entry.encodedBodySize || 0), 0), files: scripts.length }
  })
}

export interface PhoneBootMarks { [phase: string]: number }

export async function bootMarks(page: Page): Promise<PhoneBootMarks> {
  return page.evaluate(() => {
    const marks = (window as unknown as { __MS_PHONE_BOOT__?: { marks: Array<{ phase: string; at: number }> } }).__MS_PHONE_BOOT__?.marks ?? []
    return Object.fromEntries(marks.map(mark => [mark.phase, Math.round(mark.at)]))
  })
}

/** Creates a project from the phone home (setup, plain clicks) and waits for the timeline. */
export async function createPhoneProject(page: Page, name: string): Promise<void> {
  const create = page.getByTestId(PHONE_M1_TEST_IDS.createProject)
  if (!await create.isVisible()) await page.getByTestId(PHONE_M1_TEST_IDS.newProject).click()
  await page.getByTestId(PHONE_M1_TEST_IDS.projectNameInput).fill(name)
  await create.click()
  await expect(page.getByTestId(PHONE_TEST_IDS.timeline)).toBeVisible({ timeout: 60_000 })
}

/** Three frame-code clips on the main track through the dev bridge (arrangement, not under test). */
export async function addFrameCodeClips(world: PhonePerfWorld): Promise<BridgeClient> {
  const bridge = new BridgeClient({ baseURL: world.baseURL, targetTabId: world.tabId })
  await bridge.waitForTarget({ timeoutMs: 30_000, requireVisible: true })
  await bridge.authenticate()
  const clips = await Promise.all([4, 3, 2].map(seconds => frameCodeClip({ width: 360, height: 640, fps: 30, seconds })))
  await bridge.toolData('createComposition', { name: `Perf ${world.tabId.slice(0, 6)}`, width: 360, height: 640, frameRate: 30, duration: 9, open: true })
  await bridge.toolData('importLocalFiles', { paths: clips.map(clip => clip.path.replaceAll('\\', '/')), addToTimeline: true, startTime: 0 }, { timeoutMs: 180_000 })
  await expect(world.page.getByTestId(PHONE_TEST_IDS.clip), 'the clips did not reach the phone timeline').toHaveCount(3, { timeout: 60_000 })
  return bridge
}
