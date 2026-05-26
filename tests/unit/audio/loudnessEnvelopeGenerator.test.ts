import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter, blobToArrayBuffer } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  LOUDNESS_CURVE_PAYLOAD_MIME_TYPE,
  LoudnessEnvelopeGenerator,
} from '../../../src/services/audio/LoudnessEnvelopeGenerator';
import {
  decodeLoudnessCurvePayload,
  type LoudnessEnvelopeManifest,
  type LoudnessEnvelopeMetric,
} from '../../../src/services/audio/loudnessEnvelopeManifest';
import {
  getCachedTimelineLoudnessEnvelope,
  primeTimelineLoudnessEnvelopeCache,
  readTimelineLoudnessEnvelope,
} from '../../../src/services/audio/timelineLoudnessEnvelopeCache';

const FIXED_TIME = '2026-05-25T10:00:00.000Z';

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME),
  );
}

function createMockAudioBuffer(channels: number[][], sampleRate = 48_000): AudioBuffer {
  const channelData = channels.map(samples => Float32Array.from(samples));
  const length = channelData[0]?.length ?? 0;

  return {
    numberOfChannels: channelData.length,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: vi.fn((channelIndex: number) => channelData[channelIndex]),
  } as unknown as AudioBuffer;
}

function createSineBuffer(amplitude = 0.5, sampleRate = 48_000, durationSeconds = 1): AudioBuffer {
  const length = sampleRate * durationSeconds;
  return createMockAudioBuffer([
    Array.from({ length }, (_, index) => amplitude * Math.sin((2 * Math.PI * 440 * index) / sampleRate)),
  ], sampleRate);
}

function findCurve(manifest: LoudnessEnvelopeManifest, metric: LoudnessEnvelopeMetric) {
  const curve = manifest.curves.find(candidate => candidate.metric === metric);
  expect(curve).toBeDefined();
  return curve!;
}

describe('LoudnessEnvelopeGenerator', () => {
  it('stores loudness curves and summary metrics as encoded Float32 payloads', async () => {
    const store = createStore();
    const generator = new LoudnessEnvelopeGenerator({
      artifactStore: store,
      now: () => FIXED_TIME,
      createJobId: () => 'loudness-job-1',
    });

    const result = await generator.generate({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      buffer: createSineBuffer(),
      metrics: ['momentary-lufs', 'short-term-lufs', 'rms-dbfs', 'sample-peak-dbfs', 'integrated-lufs', 'true-peak-dbtp'],
      windowDuration: 0.4,
      hopDuration: 0.1,
      decoderId: 'mock.decode',
      decoderVersion: '1.0.0',
    });

    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      sampleRate: 48_000,
      duration: 1,
      channelLayout: { kind: 'mono', channelCount: 1, labels: ['Mix'] },
    });
    expect(result.manifest.curves.map(curve => curve.metric)).toEqual([
      'integrated-lufs',
      'momentary-lufs',
      'rms-dbfs',
      'sample-peak-dbfs',
      'short-term-lufs',
      'true-peak-dbtp',
    ]);
    expect(result.payloadRefs).toHaveLength(6);
    expect(result.payloadRefs.every(ref => ref.mimeType === LOUDNESS_CURVE_PAYLOAD_MIME_TYPE)).toBe(true);
    expect(result.manifest.summary?.rmsDbfs).toBeCloseTo(-9.03, 1);
    expect(result.manifest.summary?.samplePeakDbfs).toBeCloseTo(-6.02, 1);
    expect(result.manifest.summary?.truePeakDbtp).toBeGreaterThan(-6.5);
    expect(result.manifest.summary?.integratedLufs).toBeLessThan(-6);

    const rmsCurve = findCurve(result.manifest, 'rms-dbfs');
    const payload = await store.getPayload(rmsCurve.payloadRef.artifactId);
    expect(payload).not.toBeNull();
    const decoded = decodeLoudnessCurvePayload(await blobToArrayBuffer(payload!));

    expect(decoded.header).toMatchObject({
      schemaVersion: 1,
      metric: 'rms-dbfs',
      channelIndex: 0,
      windowDuration: 0.4,
      hopDuration: 0.1,
      pointCount: 10,
      valueLayout: 'time-series',
      valueEncoding: 'db',
    });
    expect(decoded.values.length).toBe(10);
    expect(decoded.values[0]).toBeCloseTo(-9.03, 1);

    const storedManifest = result.artifact.metadata?.loudnessEnvelopeManifest as LoudnessEnvelopeManifest;
    expect(storedManifest.summary?.samplePeakDbfs).toBeCloseTo(-6.02, 1);
    expect(result.artifact.metadata?.truePeakMode).toBe('4x-cubic-interpolated-preview');
  });

  it('uses deterministic analysis refs and primes timeline loudness cache', async () => {
    const store = createStore();
    const generator = new LoudnessEnvelopeGenerator({
      artifactStore: store,
      now: () => FIXED_TIME,
      createJobId: () => 'loudness-job-cache',
    });

    const result = await generator.generate({
      mediaFileId: 'media-cache',
      sourceFingerprint: 'sha256:cache-source',
      buffer: createSineBuffer(0.25, 48_000, 2),
      clipAudioStateHash: 'audio-state:v1:processed:123',
      metrics: ['momentary-lufs', 'rms-dbfs'],
      windowDuration: 0.5,
      hopDuration: 0.25,
    });
    const envelope = await readTimelineLoudnessEnvelope(result.manifest, store);

    expect(result.artifact.analyzerVersion).toContain('masterselects.loudness-envelope-generator@1.0.0');
    expect(result.artifact.analyzerVersion).toContain('lufs=bs1770-k-weighted-gated-integrated');
    expect(result.analysisRef).toMatchObject({
      kind: 'loudness-envelope',
      artifactId: result.artifact.id,
      cacheKey: result.cacheKey,
    });
    expect(envelope).toMatchObject({
      sampleRate: 48_000,
      duration: 2,
      curves: [
        { metric: 'momentary-lufs', pointCount: 8 },
        { metric: 'rms-dbfs', pointCount: 8 },
      ],
    });
    expect(envelope.summary?.rmsDbfs).toBeCloseTo(-15.05, 1);

    primeTimelineLoudnessEnvelopeCache([
      result.artifact.id,
      result.artifact.manifestRef.artifactId,
    ], envelope);
    expect(getCachedTimelineLoudnessEnvelope(result.artifact.manifestRef.artifactId)).toBe(envelope);
    expect(result.artifact.metadata?.sourceChannelLayout).toMatchObject({
      kind: 'mono',
      channelCount: 1,
    });
  });
});
