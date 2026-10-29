import type { Page } from '@playwright/test'

/**
 * A model of Android's hardware video decoder (MediaCodec behind Chrome's VideoDecoder) for desktop
 * runs: the decoder owns `surfaces` output surfaces, every VideoFrame the page has not closed yet
 * keeps one, and a sample is decoded only while a surface is free. The page sees what a phone shows:
 * samples stay queued (decodeQueueSize) and no frame comes out until the page closes one. The desktop
 * decoder alone has a large pool, so FAST export regressions that only a phone shows (2-9 s per
 * frame on a Pixel 10 Pro, docs/Features/Export.md) stay invisible without this model.
 *
 * Installed by replacing window.VideoDecoder, so only decoders created afterwards use it (install it
 * right before the export to leave the preview's decoders alone); `removeAndroidDecoderModel` puts
 * the browser's decoder back.
 */
export interface AndroidDecoderModelStats {
  decoders: number
  samples: number
  outputs: number
  /** Most frames the page held open at once (per decoder). */
  maxOpenFrames: number
  /** Time a decoder had samples queued while every surface was held by the page. */
  starvedMs: number
  /** How often a decoder entered that state. */
  starvedIntervals: number
}

export async function installAndroidDecoderModel(page: Page, surfaces: number): Promise<void> {
  await page.evaluate((surfaces) => {
    type Stats = { decoders: number; samples: number; outputs: number; maxOpenFrames: number; starvedMs: number; starvedIntervals: number }
    const holder = window as unknown as { __msAndroidDecoderModel?: { native: typeof VideoDecoder; stats: Stats } }
    if (holder.__msAndroidDecoderModel) return
    const native = window.VideoDecoder
    const stats: Stats = { decoders: 0, samples: 0, outputs: 0, maxOpenFrames: 0, starvedMs: 0, starvedIntervals: 0 }

    class SurfacePoolDecoder extends EventTarget {
      private readonly inner: VideoDecoder
      private readonly waiting: EncodedVideoChunk[] = []
      private inFlight = 0
      private open = 0
      private generation = 0
      private starvedSince: number | null = null
      ondequeue: ((event: Event) => void) | null = null

      constructor(init: VideoDecoderInit) {
        super()
        stats.decoders += 1
        this.inner = new native({
          output: frame => this.deliver(frame, this.generation),
          error: init.error,
        })
        this.output = init.output
      }

      private readonly output: VideoFrameOutputCallback

      static isConfigSupported(config: VideoDecoderConfig) { return native.isConfigSupported(config) }

      get state(): CodecState { return this.inner.state }
      get decodeQueueSize(): number { return this.waiting.length + this.inFlight }

      configure(config: VideoDecoderConfig): void { this.inner.configure(config) }

      decode(chunk: EncodedVideoChunk): void {
        if (this.inner.state !== 'configured') { this.inner.decode(chunk); return }
        stats.samples += 1
        this.waiting.push(chunk)
        this.pump()
      }

      async flush(): Promise<void> {
        while (this.waiting.length > 0 && this.inner.state === 'configured') await new Promise(resolve => setTimeout(resolve, 5))
        await this.inner.flush()
      }

      reset(): void {
        this.generation += 1
        this.waiting.length = 0
        this.inFlight = 0
        this.noteStarved()
        this.inner.reset()
      }

      close(): void {
        this.generation += 1
        this.waiting.length = 0
        this.inFlight = 0
        this.noteStarved()
        this.inner.close()
      }

      private pump(): void {
        let fed = false
        while (this.waiting.length > 0 && this.open + this.inFlight < surfaces && this.inner.state === 'configured') {
          this.inFlight += 1
          this.inner.decode(this.waiting.shift()!)
          fed = true
        }
        this.noteStarved()
        if (fed) {
          const event = new Event('dequeue')
          this.dispatchEvent(event)
          this.ondequeue?.(event)
        }
      }

      /** Starved: samples wait and every surface is held by the page. */
      private noteStarved(): void {
        const starved = this.waiting.length > 0 && this.open >= surfaces
        const now = performance.now()
        if (starved && this.starvedSince === null) {
          this.starvedSince = now
          stats.starvedIntervals += 1
        } else if (!starved && this.starvedSince !== null) {
          stats.starvedMs += now - this.starvedSince
          this.starvedSince = null
        }
      }

      private deliver(frame: VideoFrame, generation: number): void {
        if (generation !== this.generation) { frame.close(); return }
        this.inFlight = Math.max(0, this.inFlight - 1)
        this.open += 1
        stats.outputs += 1
        stats.maxOpenFrames = Math.max(stats.maxOpenFrames, this.open)
        const close = frame.close.bind(frame)
        let closed = false
        Object.defineProperty(frame, 'close', {
          configurable: true,
          value: () => {
            if (!closed) {
              closed = true
              // A frame from before a reset still held its surface until now.
              this.open -= 1
              queueMicrotask(() => this.pump())
            }
            close()
          },
        })
        this.noteStarved()
        this.output(frame)
      }
    }

    holder.__msAndroidDecoderModel = { native, stats }
    window.VideoDecoder = SurfacePoolDecoder as unknown as typeof VideoDecoder
  }, surfaces)
}

/** Puts the browser's decoder back and returns what the model saw. */
export async function removeAndroidDecoderModel(page: Page): Promise<AndroidDecoderModelStats | null> {
  return page.evaluate(() => {
    const holder = window as unknown as { __msAndroidDecoderModel?: { native: typeof VideoDecoder; stats: AndroidDecoderModelStats } }
    const model = holder.__msAndroidDecoderModel
    if (!model) return null
    window.VideoDecoder = model.native
    delete holder.__msAndroidDecoderModel
    return { ...model.stats, starvedMs: Math.round(model.stats.starvedMs) }
  })
}
