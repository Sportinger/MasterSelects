import type { WaveformChannelStats } from './waveformPyramidAnalysisTypes';

/** Carries bucket boundaries across transferred PCM blocks. Raw sums remain
 * doubles until a bucket is complete, matching the existing RMS calculation.
 */
export class StreamingWaveformChannel {
  readonly stats: WaveformChannelStats;
  private bucketIndex = 0;
  private count = 0;
  private min = Infinity;
  private max = -Infinity;
  private peak = 0;
  private squareSum = 0;
  private readonly length: number;
  private readonly bucketSize: number;

  constructor(length: number, bucketSize: number, channelIndex: number) {
    this.length = length;
    this.bucketSize = bucketSize;
    const buckets = Math.ceil(length / bucketSize);
    this.stats = { channelIndex, min: new Float32Array(buckets), max: new Float32Array(buckets),
      rms: new Float32Array(buckets), peak: new Float32Array(buckets) };
  }

  append(samples: Float32Array, offset: number): void {
    for (let index = 0; index < samples.length; index++) {
      const value = Number.isFinite(samples[index]) ? samples[index] : 0;
      this.min = Math.min(this.min, value);
      this.max = Math.max(this.max, value);
      this.peak = Math.max(this.peak, Math.abs(value));
      this.squareSum += value * value;
      this.count++;
      const position = offset + index + 1;
      if (this.count === this.bucketSize || position === this.length) {
        const bucket = this.bucketIndex++;
        this.stats.min[bucket] = this.min;
        this.stats.max[bucket] = this.max;
        this.stats.rms[bucket] = Math.sqrt(this.squareSum / this.count);
        this.stats.peak[bucket] = this.peak;
        this.count = 0; this.min = Infinity; this.max = -Infinity;
        this.peak = 0; this.squareSum = 0;
      }
    }
  }
}
