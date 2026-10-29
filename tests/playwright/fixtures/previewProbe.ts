import type { Locator, Page } from '@playwright/test'
import sharp from 'sharp'
import { readColorBars, readFrameCode, type BarReading, type FrameCodeReading, type FramePixels } from '../assertions/frameCodeOracle'

/**
 * Reads what the preview really shows: a screenshot of the preview canvas as
 * the compositor put it on screen (no engine flag, no GPU readback that may be
 * a newer or older texture), decoded as a frame code. Every read is recorded
 * with its time, so a test can show and judge when something became visible.
 */
export interface PreviewObservation {
  /** Milliseconds since the probe's start mark. */
  at: number
  frame: number | null
  inverted: boolean
  reason?: FrameCodeReading['reason'] | 'no-preview'
  contrast: number
}

export class PreviewProbe {
  readonly canvas: Locator
  readonly observations: PreviewObservation[] = []
  private origin = Date.now()
  /**
   * Upper bound for one canvas screenshot. Locally a capture takes milliseconds; a real device behind a
   * slow wireless DevTools link can need many seconds for one frame (DevicePreviewProbe raises it). It is
   * a transport limit only: what the screenshot shows is still judged by waitForFrame, so a wrong frame
   * fails exactly as before.
   */
  protected screenshotTimeoutMs = 5_000

  constructor(page: Page) {
    this.canvas = page.getByRole('region', { name: 'Preview' }).getByTestId('preview-canvas')
  }

  /** Starts a new observation log; `at` counts from here. */
  mark(): void {
    this.origin = Date.now()
    this.observations.length = 0
  }

  async read(): Promise<{ reading: FrameCodeReading; bars: BarReading[]; observation: PreviewObservation }> {
    // While the editor (re)loads there is no preview yet: that is an observation too, not an error.
    if (!await this.canvas.isVisible().catch(() => false)) {
      const observation: PreviewObservation = { at: Date.now() - this.origin, frame: null, inverted: false, reason: 'no-preview', contrast: 0 }
      this.observations.push(observation)
      await new Promise(resolve => setTimeout(resolve, 50))
      return { reading: { frame: null, valid: false, inverted: false, contrast: 0, bits: [], reason: 'flat' }, bars: [], observation }
    }
    const pixels = await this.capture()
    const reading = readFrameCode(pixels)
    const observation: PreviewObservation = { at: Date.now() - this.origin, frame: reading.frame, inverted: reading.inverted,
      reason: reading.reason, contrast: Math.round(reading.contrast) }
    this.observations.push(observation)
    return { reading, bars: readColorBars(pixels), observation }
  }

  /**
   * The preview canvas as the compositor put it on screen, as raw RGB at css
   * scale (one pixel per css pixel). Composition coordinates map to it by
   * `width / compositionWidth`; callers that read regions (the mosaic) check
   * that both axes scale alike.
   */
  async capture(): Promise<FramePixels> {
    const png = await this.canvas.screenshot({ animations: 'allow', caret: 'initial', scale: 'css', timeout: this.screenshotTimeoutMs })
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    return { width: info.width, height: info.height, channels: 3, data }
  }

  /**
   * Reads until `frame` shows on `stable` consecutive reads. `allowed` decides
   * which other valid frames may show on the way (e.g. the previous frame, or
   * frames between start and target while stepping); any other valid frame
   * fails at once, because then the preview showed a wrong picture.
   */
  async waitForFrame(frame: number, { timeoutMs = 10_000, stable = 2, inverted = false, allowed = (_frame: number) => false }:
    { timeoutMs?: number; stable?: number; inverted?: boolean; allowed?: (frame: number) => boolean } = {}): Promise<PreviewObservation> {
    const deadline = Date.now() + timeoutMs
    let streak = 0
    // A target already seen gets its confirming reads even when a slow capture ran past the deadline;
    // any other frame still fails at once.
    while (Date.now() < deadline || (streak > 0 && streak < stable)) {
      const { reading, observation } = await this.read()
      if (reading.valid && reading.frame === frame && reading.inverted === inverted) {
        streak++
        if (streak >= stable) return this.observations[this.observations.length - stable]
        continue
      }
      streak = 0
      if (reading.valid && reading.frame !== frame && !allowed(reading.frame!)) {
        throw new Error(`The preview showed frame ${reading.frame}${reading.inverted ? ' (inverted)' : ''} at ${observation.at} ms while waiting for frame ${frame}. ${this.summary()}`)
      }
    }
    throw new Error(`The preview did not show frame ${frame}${inverted ? ' inverted' : ''} within ${timeoutMs} ms. ${this.summary()}`)
  }

  /** The observation log, compressed into runs: "0-412 ms black · 430-512 ms frame 0". */
  summary(): string {
    const runs: string[] = []
    let start: PreviewObservation | null = null, previous: PreviewObservation | null = null
    const label = (item: PreviewObservation) => item.frame !== null ? `frame ${item.frame}${item.inverted ? ' inverted' : ''}`
      : item.reason === 'flat' ? 'flat/black' : item.reason === 'no-preview' ? 'no preview yet' : item.reason ?? 'unreadable'
    for (const item of this.observations) {
      if (start && previous && label(item) === label(start)) { previous = item; continue }
      if (start && previous) runs.push(`${start.at}-${previous.at} ms ${label(start)}`)
      start = item; previous = item
    }
    if (start && previous) runs.push(`${start.at}-${previous.at} ms ${label(start)}`)
    return `Seen: ${runs.slice(-12).join(' · ') || 'nothing'}`
  }
}
