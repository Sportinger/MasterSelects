import type { TimelineWaveformPyramid } from '../../components/timeline/utils/waveformLod';
import type { AudioArtifactStore } from './AudioArtifactStore';
import { isAudioAnalysisArtifactStaleForInput } from './audioAnalysisManifestKeys';
import { createWaveformPyramidAnalyzerVersion } from './WaveformPyramidGenerator';
import { generateSourceWaveformPreview } from './sourceWaveformPreview';
import { runWaveformCacheWork } from './sourceWaveformJobQueue';
import type { WaveformPyramidManifest } from './waveformPyramidManifest';

/** Locate durable results before reading/decoding the entire source again.
 * The source ID and recorded file metadata must still identify the same input.
 */
export async function findSavedSourceWaveform(file: File, mediaFileId: string, clipAudioStateHash: string | undefined, store: AudioArtifactStore) {
  const candidates = await store.listAnalysisArtifacts(mediaFileId, 'waveform-pyramid');
  const analyzerVersion = createWaveformPyramidAnalyzerVersion();
  for (const artifact of candidates.toSorted((left, right) => right.createdAt - left.createdAt)) {
    if (artifact.metadata?.sourceFileName !== file.name || artifact.metadata?.sourceFileSize !== file.size
      || artifact.metadata?.sourceLastModified !== file.lastModified) continue;
    if (isAudioAnalysisArtifactStaleForInput(artifact, {
      mediaFileId, kind: 'waveform-pyramid', sourceFingerprint: artifact.sourceFingerprint,
      clipAudioStateHash, analyzerVersion, sampleRate: artifact.sampleRate,
      channelLayout: artifact.channelLayout, duration: artifact.duration,
    })) continue;
    const manifest = artifact.metadata?.waveformManifest as unknown as WaveformPyramidManifest | undefined;
    if (manifest) return { artifact, manifest };
  }
  return null;
}

/** A small preview can be reconstructed from saved peak buckets in the worker;
 * no source File read, PCM decode, or new analysis artifact is required.
 */
export async function previewSavedSourceWaveform(pyramid: TimelineWaveformPyramid, options: {
  samplesPerSecond: number; maxSamples?: number; signal?: AbortSignal;
}) {
  const sampleCount = Math.max(200, Math.min(options.maxSamples ?? 10000, Math.floor(pyramid.duration * options.samplesPerSecond)));
  const eligible = pyramid.levels.filter(level => level.bucketCount >= sampleCount);
  const level = eligible.at(-1) ?? pyramid.levels[0];
  if (!level?.channels.length) throw new Error('Saved waveform has no channel data');
  const peaks = level.channels.map(channel => channel.peak instanceof Float32Array
    ? channel.peak : Float32Array.from(channel.peak));
  return runWaveformCacheWork(() => generateSourceWaveformPreview({
    length: level.bucketCount, numberOfChannels: level.channels.length,
    sampleRate: level.bucketCount / Math.max(pyramid.duration, 1), duration: pyramid.duration,
    copyFromChannel: (destination, channel, offset) => destination.set(peaks[channel].subarray(offset, offset + destination.length)),
  }, options.samplesPerSecond, undefined, options.maxSamples, options.signal), options.signal);
}
