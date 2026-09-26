// exportSourceStride - predicts the source frames FAST export will request.
// Speed-ramped clips advance several source samples per output frame. Tracking
// that stride lets the decoder work ahead in the background and lets export
// close decoded frames it will skip, so hardware decoders keep free surfaces.

export interface StridedDecodePlan {
  /** Exclusive sample index the background window should decode through. */
  endIndexExclusive: number;
  /** Predicted CTS (us) of the next requested frame. */
  nextTargetCtsUs: number;
}

export class ExportSourceStride {
  // Beyond this stride a request is treated as a cut, not as sped-up playback.
  private static readonly MAX_STRIDE_SAMPLES = 64;
  private static readonly REORDER_SLACK_SAMPLES = 4;
  private static readonly DISCARD_HISTORY = 256;

  private lastSampleIndex = -1;
  private lastCtsUs = 0;
  private previousDelta = 0;
  private previousDeltaUs = 0;
  private strideSamples = 1;
  private strideUs = 0;
  private discardedCtsUs: number[] = [];

  reset(): void {
    this.lastSampleIndex = -1;
    this.previousDelta = 0;
    this.previousDeltaUs = 0;
    this.strideSamples = 1;
    this.strideUs = 0;
    this.discardedCtsUs = [];
  }

  observe(sampleIndex: number, ctsUs: number): void {
    if (this.lastSampleIndex >= 0) {
      const delta = sampleIndex - this.lastSampleIndex;
      const deltaUs = ctsUs - this.lastCtsUs;
      // Compare presentation-time strides: variable-frame-rate sources make
      // sample index strides jitter even when the requested speed is smooth.
      // Two similar consecutive strides are required so a single cut does not
      // look like a fast ramp.
      const consistent = delta > 1 && deltaUs > 0 &&
        Math.abs(deltaUs - this.previousDeltaUs) <= this.previousDeltaUs * 0.5 &&
        delta <= ExportSourceStride.MAX_STRIDE_SAMPLES;
      if (consistent) {
        this.strideSamples = Math.max(delta, this.previousDelta);
        this.strideUs = deltaUs;
      } else if (delta !== 0) {
        this.strideSamples = 1;
        this.strideUs = 0;
      }
      if (delta !== 0) {
        this.previousDelta = delta;
        this.previousDeltaUs = deltaUs;
      }
    }
    this.lastSampleIndex = sampleIndex;
    this.lastCtsUs = ctsUs;
  }

  get isStrided(): boolean {
    return this.strideSamples > 1 && this.strideUs > 0;
  }

  /**
   * Whether a decoded frame lies near a predicted future request. Frames
   * between predicted requests are never shown and would otherwise hold
   * decoder surfaces until the export passes them.
   */
  shouldRetain(ctsUs: number, frameDurationUs: number): boolean {
    if (!this.isStrided) return true;
    const offsetUs = ctsUs - this.lastCtsUs;
    if (offsetUs <= 0) return true;
    const steps = Math.max(1, Math.round(offsetUs / this.strideUs));
    const marginUs = Math.max(frameDurationUs, this.strideUs * 0.15);
    return Math.abs(offsetUs - steps * this.strideUs) <= marginUs;
  }

  noteDiscarded(ctsUs: number): void {
    if (ctsUs <= this.lastCtsUs) return;
    this.discardedCtsUs.push(ctsUs);
    if (this.discardedCtsUs.length > ExportSourceStride.DISCARD_HISTORY) {
      this.discardedCtsUs.shift();
    }
  }

  /** Whether the requested frame was already decoded and closed as skipped. */
  wasDiscarded(targetCtsUs: number): boolean {
    return this.discardedCtsUs.some(cts => Math.abs(cts - targetCtsUs) <= 1);
  }

  clearDiscarded(): void {
    this.discardedCtsUs = [];
  }

  /**
   * Plans the next background decode window, or returns null when the decoder
   * already covers the predicted request.
   */
  plan(
    targetSampleIndex: number,
    targetCtsUs: number,
    decodeCursorIndex: number,
    sampleCount: number,
  ): StridedDecodePlan | null {
    if (!this.isStrided) return null;
    // Small strides keep two output frames in flight; larger ones keep one so
    // queued decoder work stays bounded.
    const aheadFrames = this.strideSamples <= 4 ? 2 : 1;
    const endIndexExclusive = Math.min(
      sampleCount,
      targetSampleIndex + this.strideSamples * aheadFrames + ExportSourceStride.REORDER_SLACK_SAMPLES,
    );
    if (decodeCursorIndex >= endIndexExclusive) return null;
    return { endIndexExclusive, nextTargetCtsUs: targetCtsUs + this.strideUs };
  }
}
