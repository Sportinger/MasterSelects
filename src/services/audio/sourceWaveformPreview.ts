import { analyzeWaveformInWorker, type WaveformPcmSource } from './waveformPyramid/WaveformWorkerClient';
import type { WaveformPreviewResult } from './waveformPyramid/waveformWorkerProtocol';

/** Raw PCM scans and preview normalization run outside the UI thread. */
export async function generateSourceWaveformPreview(
  audioBuffer: WaveformPcmSource,
  samplesPerSecond: number,
  onProgress?: (progress: number, partialWaveform: number[]) => void,
  maxSamples = 10000,
  signal?: AbortSignal,
  includePartialPreview = true,
): Promise<WaveformPreviewResult> {
  const sampleCount = Math.max(200, Math.min(Math.max(200, maxSamples), Math.floor(audioBuffer.duration * samplesPerSecond)));
  const result = await analyzeWaveformInWorker(audioBuffer, {
    previewSamples: sampleCount, signal, onPreviewProgress: onProgress, includePartialPreview,
  });
  if (!result.preview) throw new Error('Waveform worker did not return a preview');
  onProgress?.(70, result.preview.waveform);
  return result.preview;
}
