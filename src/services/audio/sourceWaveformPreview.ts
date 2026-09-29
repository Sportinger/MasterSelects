interface SourceWaveformPreview {
  waveform: number[];
  waveformChannels?: number[][];
}

const SAMPLE_YIELD_BUDGET = 65_536;
const PROGRESS_INTERVAL_MS = 100;

function yieldForUi(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise(resolve => globalThis.setTimeout(resolve, 0));
}

/** Peak previews for long sources yield between bounded PCM chunks. */
export async function generateSourceWaveformPreview(
  audioBuffer: AudioBuffer,
  samplesPerSecond: number,
  onProgress?: (progress: number, partialWaveform: number[]) => void,
  maxSamples = 10000,
  signal?: AbortSignal,
): Promise<SourceWaveformPreview> {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  const sampleCount = Math.max(200, Math.min(Math.max(200, maxSamples), Math.floor(audioBuffer.duration * samplesPerSecond)));
  const channelSamples: number[][] = Array.from({ length: channelCount }, () => []);
  const aggregateSamples: number[] = new Array(sampleCount).fill(0);
  let runningMax = 0;
  let completedSamples = 0;
  let samplesSinceYield = 0;
  let lastProgressAt = performance.now();
  const totalSamples = Math.max(1, sampleCount * channelCount);
  const checkCancellation = () => {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Waveform preview cancelled', 'AbortError');
  };
  checkCancellation();
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    const blockSize = Math.max(1, Math.floor(channelData.length / sampleCount));
    const samples = channelSamples[channelIndex];
    for (let index = 0; index < sampleCount; index += 1) {
      const start = index * blockSize;
      const end = Math.min(start + blockSize, channelData.length);
      let peak = 0;
      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        peak = Math.max(peak, Math.abs(channelData[sampleIndex] ?? 0));
        if (++samplesSinceYield >= SAMPLE_YIELD_BUDGET) {
          samplesSinceYield = 0;
          await yieldForUi();
          checkCancellation();
        }
      }
      samples.push(peak);
      aggregateSamples[index] = Math.max(aggregateSamples[index] ?? 0, peak);
      runningMax = Math.max(runningMax, peak);
      completedSamples += 1;
      const now = performance.now();
      if (onProgress && (now - lastProgressAt >= PROGRESS_INTERVAL_MS || completedSamples === totalSamples)) {
        lastProgressAt = now;
        onProgress(Math.round(completedSamples / totalSamples * 70), runningMax > 0
          ? aggregateSamples.map(sample => sample / runningMax) : [...aggregateSamples]);
      }
    }
  }
  if (runningMax <= 0) {
    return { waveform: aggregateSamples, ...(channelCount > 1 ? { waveformChannels: channelSamples } : {}) };
  }
  const normalized = (value: number) => {
    const ratio = value / runningMax;
    return Number.isFinite(ratio) ? Math.max(0, Math.min(1, Math.abs(ratio))) : 0;
  };
  return {
    waveform: aggregateSamples.map(normalized),
    ...(channelCount > 1 ? { waveformChannels: channelSamples.map(samples => samples.map(normalized)) } : {}),
  };
}
