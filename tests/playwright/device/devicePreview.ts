import type { Page } from '@playwright/test'
import { PHONE_TEST_IDS } from '../../../src/components/mobileSkin/contracts'
import { readColorBars, type BarReading, type FrameCodeReading } from '../assertions/frameCodeOracle'
import { readPhoneFrameCode } from '../assertions/phoneFootageOracle'
import { PreviewProbe, type PreviewObservation } from '../fixtures/previewProbe'

/**
 * The preview probe of the real phone: a screenshot of the phone preview canvas (Page.captureScreenshot
 * on the device, what the compositor really showed) read with the phone footage oracle, which
 * decodes both code rows of the generated footage (24-bit frame numbers, so a 10-minute recording
 * reads past frame 4095). Everything else (observation log, waitForFrame, summary) is PreviewProbe.
 */
export class DevicePreviewProbe extends PreviewProbe {
  constructor(page: Page) {
    super(page)
    Object.defineProperty(this, 'canvas', { value: page.getByTestId(PHONE_TEST_IDS.previewRegion).getByTestId(PHONE_TEST_IDS.previewCanvas) })
  }

  override async read(): Promise<{ reading: FrameCodeReading; bars: BarReading[]; observation: PreviewObservation }> {
    if (!await this.canvas.isVisible().catch(() => false)) return super.read()
    const pixels = await this.capture()
    const phone = readPhoneFrameCode(pixels)
    const reading: FrameCodeReading = phone.valid ? { ...phone.low, frame: phone.frame, valid: true } : { ...phone.low, valid: false, frame: null, reason: phone.low.reason ?? phone.high.reason ?? 'flat' }
    const observation: PreviewObservation = { at: this.elapsed(), frame: reading.frame, inverted: reading.inverted, reason: reading.reason, contrast: Math.round(reading.contrast) }
    this.observations.push(observation)
    return { reading, bars: readColorBars(pixels), observation }
  }

  /** PreviewProbe keeps its own start mark private; this one runs alongside it. */
  private markedAt = Date.now()

  override mark(): void {
    super.mark()
    this.markedAt = Date.now()
  }

  private elapsed(): number {
    return Date.now() - this.markedAt
  }
}
