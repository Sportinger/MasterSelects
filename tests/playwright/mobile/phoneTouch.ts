import type { CDPSession, Page } from '@playwright/test'
import type { PreviewProbe } from '../fixtures/previewProbe'
import type { FrameCodeReading } from '../assertions/frameCodeOracle'

/**
 * Real touch input for the phone journeys. Every gesture is sent through
 * Chrome's own input pipeline (`Input.dispatchTouchEvent` over DevTools), the
 * way a finger arrives: touchstart/touchmove/touchend with pointer events,
 * browser gesture arbitration (scroll, pinch-zoom, click synthesis) included.
 * Synthetic DOM events or `page.touchscreen.tap` alone would skip that.
 *
 * Gestures are paced by animation frames, not by timers: one move per frame,
 * so the app sees the same cadence in every run and nothing sleeps. A pan ends
 * with a few still moves so the release velocity is zero and the app cannot
 * start inertia scrolling that the test would then have to wait out.
 */
export interface Point { x: number; y: number }

interface TouchPoint extends Point { id: number }

export class PhoneTouch {
  private readonly cdp: CDPSession
  private readonly page: Page

  private constructor(cdp: CDPSession, page: Page) {
    this.cdp = cdp
    this.page = page
  }

  static async attach(page: Page): Promise<PhoneTouch> {
    return new PhoneTouch(await page.context().newCDPSession(page), page)
  }

  /** Resolves on the next animation frame of the page. */
  nextFrame(frames = 1): Promise<void> {
    return this.page.evaluate(async (count) => {
      for (let index = 0; index < count; index++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }, frames)
  }

  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: TouchPoint[]): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: touchPoints.map(point => ({ ...point, radiusX: 1, radiusY: 1, force: 1 })) })
  }

  /** One finger down and up on the same spot, a frame apart: a tap, never a drag. */
  async tap(point: Point): Promise<void> {
    await this.send('touchStart', [{ ...point, id: 0 }])
    await this.nextFrame(2)
    await this.send('touchEnd', [])
    await this.nextFrame()
  }

  /**
   * A tap whose down and up are sent back to back, with no page round trip in between. On the real
   * phone (device suite) the DevTools link over wireless adb stalls for seconds at times: `tap` then
   * holds the finger for that long, the browser makes a long press of it (no click), and a control
   * that moves meanwhile (a sheet lifted by the on-screen keyboard) is no longer under the finger at
   * the release, so the click goes to its parent. Both messages travel in order on one session, so a
   * stall delays them together and the tap stays a tap.
   */
  async tapAtOnce(point: Point): Promise<void> {
    await Promise.all([this.send('touchStart', [{ ...point, id: 0 }]), this.send('touchEnd', [])])
    await this.nextFrame()
  }

  /**
   * One finger from `from`, moved by (dx, dy) in `steps` equal moves, one per
   * frame. Positive dx drags the content to the right.
   */
  async pan(from: Point, delta: Point, { steps = 12, still = 3 }: { steps?: number; still?: number } = {}): Promise<void> {
    await this.send('touchStart', [{ ...from, id: 0 }])
    await this.nextFrame()
    for (let step = 1; step <= steps; step++) {
      await this.send('touchMove', [{ x: from.x + delta.x * step / steps, y: from.y + delta.y * step / steps, id: 0 }])
      await this.nextFrame()
    }
    const end = { x: from.x + delta.x, y: from.y + delta.y, id: 0 }
    for (let index = 0; index < still; index++) {
      await this.send('touchMove', [end])
      await this.nextFrame()
    }
    await this.send('touchEnd', [])
    await this.nextFrame()
  }

  /**
   * Two fingers placed horizontally around `center`, `startGap` px apart, moved
   * to `endGap` px apart (symmetrically around the midpoint). A larger end gap
   * zooms in.
   */
  async pinch(center: Point, startGap: number, endGap: number, { steps = 12, still = 3 }: { steps?: number; still?: number } = {}): Promise<void> {
    const fingers = (gap: number): TouchPoint[] => [
      { x: center.x - gap / 2, y: center.y, id: 0 },
      { x: center.x + gap / 2, y: center.y, id: 1 },
    ]
    await this.send('touchStart', fingers(startGap))
    await this.nextFrame()
    for (let step = 1; step <= steps; step++) {
      await this.send('touchMove', fingers(startGap + (endGap - startGap) * step / steps))
      await this.nextFrame()
    }
    for (let index = 0; index < still; index++) {
      await this.send('touchMove', fingers(endGap))
      await this.nextFrame()
    }
    await this.send('touchEnd', [])
    await this.nextFrame()
  }
}

/**
 * The frame code the preview shows right now, read from the preview canvas'
 * real pixels (see fixtures/previewProbe.ts). `null` when the preview shows no
 * valid code (black, flat, blended or not there yet).
 */
export async function readPreviewFrame(probe: PreviewProbe): Promise<{ frame: number | null; reading: FrameCodeReading }> {
  const { reading } = await probe.read()
  return { frame: reading.valid ? reading.frame : null, reading }
}

export interface LongTaskReport {
  count: number; worstMs: number; tasksMs: number[]; supported: boolean
  /** Longest gap between two animation frames while recording, and how many gaps exceeded 50 ms. */
  worstFrameGapMs: number; slowFrames: number; frames: number
}

interface LongTaskRecord {
  tasks: number[]; observer: PerformanceObserver | null; supported: boolean
  gaps: number[]; running: boolean
}

/** Starts a long-task observer (> 50 ms on the main thread) and a frame-gap recorder in the page. */
export async function startLongTaskRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as Window & { __phoneLongTasks?: LongTaskRecord }
    holder.__phoneLongTasks?.observer?.disconnect()
    if (holder.__phoneLongTasks) holder.__phoneLongTasks.running = false
    const record: LongTaskRecord = { tasks: [], observer: null, supported: false, gaps: [], running: true }
    try {
      record.supported = PerformanceObserver.supportedEntryTypes.includes('longtask')
      if (record.supported) {
        record.observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) record.tasks.push(entry.duration) })
        record.observer.observe({ type: 'longtask' })
      }
    } catch { record.supported = false }
    let last = performance.now()
    const tick = (now: number) => {
      record.gaps.push(now - last)
      last = now
      if (record.running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    holder.__phoneLongTasks = record
  })
}

/** Stops the recording and returns what the observer saw (pending deliveries are flushed first). */
export async function stopLongTaskRecording(page: Page): Promise<LongTaskReport> {
  return page.evaluate(() => {
    const record = (window as Window & { __phoneLongTasks?: LongTaskRecord }).__phoneLongTasks
    if (!record) return { count: 0, worstMs: 0, tasksMs: [], supported: false, worstFrameGapMs: 0, slowFrames: 0, frames: 0 }
    record.running = false
    for (const entry of record.observer?.takeRecords() ?? []) record.tasks.push(entry.duration)
    record.observer?.disconnect()
    const tasksMs = record.tasks.map(duration => Math.round(duration))
    // The first gap includes the time before the recorder's first frame; drop it.
    const gaps = record.gaps.slice(1)
    return {
      count: tasksMs.length, worstMs: Math.max(0, ...tasksMs), tasksMs, supported: record.supported,
      worstFrameGapMs: Math.round(Math.max(0, ...gaps)), slowFrames: gaps.filter(gap => gap > 50).length, frames: gaps.length,
    }
  })
}
