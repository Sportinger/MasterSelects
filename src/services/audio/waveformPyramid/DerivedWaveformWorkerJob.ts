import { deriveProcessedPyramidFromSource } from './derivedPyramidMath';
import { encodeWaveformPyramidPackedPayload } from '../waveformPyramidManifest';
import type { WaveformWorkerRequest, WaveformWorkerResponse, WaveformWorkerResult } from './waveformWorkerProtocol';
import type { WaveformLevelStats } from './waveformPyramidAnalysisTypes';

const statistics = ['min', 'max', 'rms', 'peak'] as const;

/** Read bounded copies of cached statistics. Cached source arrays stay owned
 * by the UI, while trimming and edit operations run entirely in the worker.
 */
export class DerivedWaveformWorkerJob {
  private readonly request: Extract<WaveformWorkerRequest, { type: 'derive-pyramid' }>;
  private readonly send: (message: WaveformWorkerResponse, transfers?: Transferable[]) => void;
  private readonly levels: WaveformLevelStats[];
  private levelIndex = 0;
  private channelIndex = 0;
  private statisticIndex = 0;
  private offset = 0;

  constructor(request: Extract<WaveformWorkerRequest, { type: 'derive-pyramid' }>,
    send: (message: WaveformWorkerResponse, transfers?: Transferable[]) => void) {
    this.request = request;
    this.send = send;
    this.levels = request.levels.map(({ channelIndexes, ...level }) => ({ ...level,
      channels: channelIndexes.map(channelIndex => ({ channelIndex,
        min: new Float32Array(level.bucketCount), max: new Float32Array(level.bucketCount),
        rms: new Float32Array(level.bucketCount), peak: new Float32Array(level.bucketCount),
      })),
    }));
  }

  append(message: Extract<WaveformWorkerRequest, { type: 'pyramid-chunk' }>): void {
    const values = this.levels[this.levelIndex]?.channels[this.channelIndex]?.[statistics[this.statisticIndex]];
    if (!values || message.levelIndex !== this.levelIndex || message.channelIndex !== this.channelIndex
      || message.statistic !== statistics[this.statisticIndex] || message.offset !== this.offset
      || message.samples.length === 0 || this.offset + message.samples.length > values.length) {
      throw new Error('Invalid derived waveform block');
    }
    values.set(message.samples, this.offset);
    this.offset += message.samples.length;
    this.readNext();
  }

  readNext(): void {
    while (this.levelIndex < this.levels.length) {
      const level = this.levels[this.levelIndex];
      if (this.channelIndex >= level.channels.length) { this.levelIndex++; this.channelIndex = 0; continue; }
      const statistic = statistics[this.statisticIndex];
      const values = level.channels[this.channelIndex][statistic];
      if (this.offset >= values.length) {
        this.offset = 0;
        if (++this.statisticIndex === statistics.length) { this.statisticIndex = 0; this.channelIndex++; }
        continue;
      }
      this.send({ type: 'read-pyramid', levelIndex: this.levelIndex, channelIndex: this.channelIndex,
        statistic, offset: this.offset, length: Math.min(262_144, values.length - this.offset) });
      return;
    }
    const pyramid = deriveProcessedPyramidFromSource({ sampleRate: this.request.sampleRate,
      duration: this.request.duration, levels: this.levels }, this.request.clip, this.request.operations);
    const levels = pyramid.levels as WaveformLevelStats[];
    const packedPayload = encodeWaveformPyramidPackedPayload(pyramid);
    const result: WaveformWorkerResult = { sampleRate: pyramid.sampleRate, duration: pyramid.duration, levels, packedPayload };
    const transfers = levels.flatMap(level => level.channels.flatMap(channel =>
      [channel.min.buffer, channel.max.buffer, channel.rms.buffer, channel.peak.buffer] as ArrayBuffer[]));
    this.send({ type: 'complete', result }, [...transfers, packedPayload]);
  }
}
