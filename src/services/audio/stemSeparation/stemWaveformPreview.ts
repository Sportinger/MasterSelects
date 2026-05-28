export const STEM_WAVEFORM_PREVIEW_SAMPLES = 1024;

export function createStemWaveformPreview(
  channels: readonly Float32Array[],
  maxPreviewSamples = STEM_WAVEFORM_PREVIEW_SAMPLES,
): number[] {
  const frameCount = channels[0]?.length ?? 0;
  if (frameCount <= 0 || channels.length === 0) return [];

  const sampleCount = Math.max(1, Math.min(maxPreviewSamples, frameCount));
  const bucketSize = Math.max(1, Math.ceil(frameCount / sampleCount));
  const waveform: number[] = [];
  let maxPeak = 0;

  for (let bucketIndex = 0; bucketIndex < sampleCount; bucketIndex += 1) {
    const start = bucketIndex * bucketSize;
    const end = Math.min(frameCount, start + bucketSize);
    if (start >= end) break;

    let peak = 0;
    for (let frameIndex = start; frameIndex < end; frameIndex += 1) {
      for (const channel of channels) {
        peak = Math.max(peak, Math.abs(channel[frameIndex] ?? 0));
      }
    }

    waveform.push(peak);
    maxPeak = Math.max(maxPeak, peak);
  }

  if (maxPeak <= 0) return waveform;
  return waveform.map(value => Math.max(0, Math.min(1, value / maxPeak)));
}
