import { aggregateChannelStats } from '../services/audio/waveformPyramid/bucketMath';
import { StreamingWaveformChannel } from '../services/audio/waveformPyramid/StreamingWaveformChannel';
import { DerivedWaveformWorkerJob } from '../services/audio/waveformPyramid/DerivedWaveformWorkerJob';
import { decodeWaveformPyramidPackedPayload, encodeWaveformPyramidPackedPayload } from '../services/audio/waveformPyramidManifest';
import type { WaveformLevelStats } from '../services/audio/waveformPyramid/waveformPyramidAnalysisTypes';
import type { WaveformWorkerRequest, WaveformWorkerResponse, WaveformWorkerResult } from '../services/audio/waveformPyramid/waveformWorkerProtocol';

const PCM_BLOCK_SAMPLES = 262_144;
let config: Extract<WaveformWorkerRequest, { type: 'start' }>;
let channelIndex = 0;
let offset = 0;
let rawLevels: Map<number, StreamingWaveformChannel>;
let levels: WaveformLevelStats[];
let channelPeaks: number[][];
let combinedPeaks: number[];
let peakMax = 0;
let lastPreviewProgressAt = 0;
let derivedJob: DerivedWaveformWorkerJob | undefined;

const workerScope = self as unknown as {
  postMessage(message: WaveformWorkerResponse, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<WaveformWorkerRequest>) => void) | null;
};
function send(message: WaveformWorkerResponse, transfer: Transferable[] = []): void { workerScope.postMessage(message, transfer); }
function normalize(value: number): number {
  const ratio = peakMax > 0 ? value / peakMax : 0;
  return Number.isFinite(ratio) ? Math.max(0, Math.min(1, Math.abs(ratio))) : 0;
}
function beginChannel(): void {
  offset = 0;
  rawLevels = new Map();
  for (let index = 0; index < levels.length; index++) {
    const size = levels[index].samplesPerBucket;
    if (index === 0 || size % levels[index - 1].samplesPerBucket !== 0) {
      rawLevels.set(index, new StreamingWaveformChannel(config.length, size, channelIndex));
    }
  }
}
function readNext(): void {
  send({ type: 'read', channelIndex, offset, length: Math.min(PCM_BLOCK_SAMPLES, config.length - offset) });
}
async function finishChannel(): Promise<void> {
  for (let index = 0; index < levels.length; index++) {
    const level = levels[index];
    send({ type: 'analysis-progress', percent: 5 + ((channelIndex * levels.length + index) / (config.channelCount * levels.length)) * 70,
      channelIndex, levelIndex: index, samplesPerBucket: level.samplesPerBucket });
    const raw = rawLevels.get(index);
    const stats = raw?.stats ?? await aggregateChannelStats(
      levels[index - 1].channels[channelIndex], levels[index - 1].samplesPerBucket,
      config.length, level.samplesPerBucket,
      { jobId: 'worker', mediaFileId: '', sourceFingerprint: '', cacheKey: '' }, () => undefined,
    );
    level.channels.push(stats);
  }
  channelIndex++;
  if (channelIndex < config.channelCount) {
    beginChannel();
    if (config.length === 0) await finishChannel(); else readNext();
    return;
  }
  const result: WaveformWorkerResult = { levels, ...(config.previewSamples === undefined ? {} : {
    preview: { waveform: combinedPeaks.map(normalize), ...(config.channelCount > 1 ? {
      waveformChannels: channelPeaks.map(peaks => peaks.map(normalize)),
    } : {}) },
  }) };
  const transfers = levels.flatMap(level => level.channels.flatMap(channel =>
    [channel.min.buffer, channel.max.buffer, channel.rms.buffer, channel.peak.buffer] as ArrayBuffer[]));
  if (levels.length > 0) {
    result.packedPayload = encodeWaveformPyramidPackedPayload({ sampleRate: config.sampleRate, duration: config.duration, levels });
    transfers.push(result.packedPayload);
  }
  send({ type: 'complete', result }, transfers);
}

workerScope.onmessage = (event: MessageEvent<WaveformWorkerRequest>) => {
  void (async () => {
    const message = event.data;
    if (message.type === 'derive-pyramid') {
      derivedJob = new DerivedWaveformWorkerJob(message, send);
      derivedJob.readNext();
      return;
    }
    if (message.type === 'pyramid-chunk') {
      if (!derivedJob) throw new Error('No derived waveform job is active');
      derivedJob.append(message);
      return;
    }
    if (message.type === 'decode-payload') {
      const decoded = decodeWaveformPyramidPackedPayload(message.bytes);
      const decodedLevels = decoded.levels as WaveformLevelStats[];
      const transfers = new Set(decodedLevels.flatMap(level => level.channels.flatMap(channel =>
        [channel.min.buffer, channel.max.buffer, channel.rms.buffer, channel.peak.buffer] as ArrayBuffer[])));
      send({ type: 'complete', result: { levels: decodedLevels } }, [...transfers]);
      return;
    }
    if (message.type === 'start') {
      config = message;
      channelIndex = 0;
      peakMax = 0;
      lastPreviewProgressAt = 0;
      levels = config.bucketSizes.map(samplesPerBucket => ({ samplesPerBucket,
        bucketDuration: samplesPerBucket / config.sampleRate, bucketCount: Math.ceil(config.length / samplesPerBucket), channels: [] }));
      combinedPeaks = new Array(config.previewSamples ?? 0).fill(0);
      channelPeaks = Array.from({ length: config.channelCount }, () => new Array(config.previewSamples ?? 0).fill(0));
      beginChannel();
      if (config.length === 0) await finishChannel(); else readNext();
      return;
    }
    if (!config || message.channelIndex !== channelIndex || message.offset !== offset || message.samples.length === 0
      || offset + message.samples.length > config.length) throw new Error('Invalid waveform PCM block');
    for (const channel of rawLevels.values()) channel.append(message.samples, offset);
    if (config.previewSamples !== undefined) {
      const blockSize = Math.max(1, Math.floor(config.length / config.previewSamples));
      for (let index = 0; index < message.samples.length; index++) {
        const bucket = Math.floor((offset + index) / blockSize);
        if (bucket >= config.previewSamples) break;
        const peak = Number.isFinite(message.samples[index]) ? Math.abs(message.samples[index]) : 0;
        channelPeaks[channelIndex][bucket] = Math.max(channelPeaks[channelIndex][bucket], peak);
        combinedPeaks[bucket] = Math.max(combinedPeaks[bucket], peak);
        peakMax = Math.max(peakMax, peak);
      }
    }
    offset += message.samples.length;
    if (config.reportPreviewProgress && performance.now() - lastPreviewProgressAt >= 100) {
      lastPreviewProgressAt = performance.now();
      send({ type: 'preview-progress', percent: Math.round((channelIndex * config.length + offset) / (config.channelCount * config.length) * 70),
        waveform: config.includePartialPreview ? combinedPeaks.map(normalize) : [] });
    }
    if (offset === config.length) await finishChannel(); else readNext();
  })().catch(error => send({ type: 'error', message: error instanceof Error ? error.message : String(error) }));
};
