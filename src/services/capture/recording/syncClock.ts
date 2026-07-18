export type CaptureClockStream = 'video' | 'audio';

export class CaptureSyncClock {
  private static readonly MAX_DRIFT_US = 100_000;
  private zeroTimestampUs: number | null = null;
  private pausedAtUs: number | null = null;
  private pausedDurationUs = 0;
  private readonly lastTimestampUs: Record<CaptureClockStream, number> = { video: -1, audio: -1 };

  start(sourceTimestampUs: number): void {
    if (!Number.isFinite(sourceTimestampUs)) throw new Error('Capture clock start must be finite.');
    this.zeroTimestampUs ??= sourceTimestampUs;
  }

  timestamp(stream: CaptureClockStream, sourceTimestampUs: number, observedAtUs = sourceTimestampUs): number {
    if (!Number.isFinite(sourceTimestampUs)) throw new Error('Capture timestamp must be finite.');
    if (!Number.isFinite(observedAtUs)) throw new Error('Capture observation timestamp must be finite.');
    this.zeroTimestampUs ??= sourceTimestampUs;
    const pausedNow = this.pausedAtUs === null ? 0 : Math.max(0, sourceTimestampUs - this.pausedAtUs);
    const normalized = Math.max(0, Math.round(sourceTimestampUs - this.zeroTimestampUs - this.pausedDurationUs - pausedNow));
    const observedPausedNow = this.pausedAtUs === null ? 0 : Math.max(0, observedAtUs - this.pausedAtUs);
    const observed = Math.max(0, Math.round(observedAtUs - this.zeroTimestampUs - this.pausedDurationUs - observedPausedNow));
    const driftGuarded = Math.abs(normalized - observed) > CaptureSyncClock.MAX_DRIFT_US ? observed : normalized;
    const monotonic = Math.max(driftGuarded, this.lastTimestampUs[stream] + 1);
    this.lastTimestampUs[stream] = monotonic;
    return monotonic;
  }

  pause(sourceTimestampUs: number): void {
    if (this.pausedAtUs === null) this.pausedAtUs = sourceTimestampUs;
  }

  resume(sourceTimestampUs: number): void {
    if (this.pausedAtUs === null) return;
    this.pausedDurationUs += Math.max(0, sourceTimestampUs - this.pausedAtUs);
    this.pausedAtUs = null;
  }

  get elapsedSeconds(): number {
    return Math.max(this.lastTimestampUs.video, this.lastTimestampUs.audio, 0) / 1_000_000;
  }
}
