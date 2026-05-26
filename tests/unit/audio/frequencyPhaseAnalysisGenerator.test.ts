import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter, blobToArrayBuffer } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  FREQUENCY_BAND_PAYLOAD_MIME_TYPE,
  FrequencyPhaseAnalysisGenerator,
  PHASE_CORRELATION_PAYLOAD_MIME_TYPE,
  createFrequencyPhaseAnalyzerVersion,
} from '../../../src/services/audio/FrequencyPhaseAnalysisGenerator';
import {
  decodeFrequencyBandPayload,
  decodePhaseCorrelationPayload,
  float32ToPhaseCorrelationPoints,
  type FrequencySummaryManifest,
  type PhaseCorrelationManifest,
} from '../../../src/services/audio/frequencyPhaseManifest';
import {
  getCachedTimelineFrequencySummary,
  getCachedTimelinePhaseCorrelation,
  primeTimelineFrequencySummaryCache,
  primeTimelinePhaseCorrelationCache,
  readTimelineFrequencySummary,
  readTimelinePhaseCorrelation,
} from '../../../src/services/audio/timelineFrequencyPhaseCache';

const FIXED_TIME = '2026-05-25T10:00:00.000Z';

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME),
  );
}

function createMockAudioBuffer(channels: Float32Array[], sampleRate = 48_000): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: vi.fn((channelIndex: number) => channels[channelIndex]),
  } as unknown as AudioBuffer;
}

function createStereoSineBuffer(frequency = 440, sampleRate = 48_000, durationSeconds = 1): AudioBuffer {
  const length = sampleRate * durationSeconds;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.5;
    left[index] = sample;
    right[index] = sample;
  }
  return createMockAudioBuffer([left, right], sampleRate);
}

function bandValue(values: Float32Array, bandIndex: number, offset: number): number {
  return values[bandIndex * 6 + offset] ?? 0;
}

describe('FrequencyPhaseAnalysisGenerator', () => {
  it('stores frequency-summary and phase-correlation artifacts from one analysis pass', async () => {
    const store = createStore();
    const generator = new FrequencyPhaseAnalysisGenerator({
      artifactStore: store,
      now: () => FIXED_TIME,
      createJobId: () => 'frequency-phase-job-1',
    });

    const result = await generator.generate({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      buffer: createStereoSineBuffer(440),
      fftSize: 2048,
      hopSize: 1024,
      phaseWindowDuration: 0.1,
      phaseHopDuration: 0.05,
      decoderId: 'mock.decode',
      decoderVersion: '1.0.0',
    });

    expect(result.frequencyManifest).toMatchObject({
      schemaVersion: 1,
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      sampleRate: 48_000,
      duration: 1,
      channelLayout: { kind: 'mono', channelCount: 1, labels: ['Mix'] },
      fftSize: 2048,
      hopSize: 1024,
      window: 'hann',
    });
    expect(result.phaseManifest).toMatchObject({
      schemaVersion: 1,
      channelLayout: { kind: 'stereo', channelCount: 2, labels: ['L', 'R'] },
      windowDuration: 0.1,
      hopDuration: 0.05,
    });
    expect(result.frequencyPayloadRef.mimeType).toBe(FREQUENCY_BAND_PAYLOAD_MIME_TYPE);
    expect(result.phasePayloadRef.mimeType).toBe(PHASE_CORRELATION_PAYLOAD_MIME_TYPE);

    const dominantBand = result.frequencyManifest.bands.toSorted((a, b) => b.energyShare - a.energyShare)[0];
    expect(dominantBand?.bandId).toBe('low-mid');
    expect(result.frequencyManifest.summary.dominantBandId).toBe('low-mid');
    expect(result.frequencyManifest.summary.spectralCentroidHz).toBeGreaterThan(400);
    expect(result.frequencyManifest.summary.spectralCentroidHz).toBeLessThan(480);

    expect(result.phaseManifest.summary.averageCorrelation).toBeGreaterThan(0.99);
    expect(result.phaseManifest.summary.minimumCorrelation).toBeGreaterThan(0.95);
    expect(result.phaseManifest.summary.monoCompatible).toBe(true);
    expect(result.phaseManifest.pointCount).toBeGreaterThan(10);

    const frequencyPayload = await store.getPayload(result.frequencyManifest.bandsPayloadRef.artifactId);
    const phasePayload = await store.getPayload(result.phaseManifest.correlationPayloadRef.artifactId);
    expect(frequencyPayload).not.toBeNull();
    expect(phasePayload).not.toBeNull();

    const decodedFrequency = decodeFrequencyBandPayload(await blobToArrayBuffer(frequencyPayload!));
    const decodedPhase = decodePhaseCorrelationPayload(await blobToArrayBuffer(phasePayload!));
    expect(decodedFrequency.header).toMatchObject({
      schemaVersion: 1,
      bandCount: result.frequencyManifest.bands.length,
      valueLayout: 'band-major',
      valueEncoding: 'minHz-maxHz-rmsDb-peakDb-energyShare-centroidHz-f32',
    });
    expect(decodedPhase.header).toMatchObject({
      schemaVersion: 1,
      pointCount: result.phaseManifest.pointCount,
      valueLayout: 'time-major',
      valueEncoding: 'time-correlation-midSideRatioDb-f32',
    });

    const lowMidIndex = result.frequencyManifest.bands.findIndex((band) => band.bandId === 'low-mid');
    expect(lowMidIndex).toBeGreaterThanOrEqual(0);
    expect(bandValue(decodedFrequency.values, lowMidIndex, 4)).toBeGreaterThan(0.8);
    expect(float32ToPhaseCorrelationPoints(decodedPhase.values)[0]?.correlation).toBeGreaterThan(0.99);

    const storedFrequencyManifest = result.frequencyArtifact.metadata?.frequencySummaryManifest as FrequencySummaryManifest;
    const storedPhaseManifest = result.phaseArtifact.metadata?.phaseCorrelationManifest as PhaseCorrelationManifest;
    expect(storedFrequencyManifest.summary.dominantBandId).toBe('low-mid');
    expect(storedPhaseManifest.summary.monoCompatible).toBe(true);

    const timelineFrequency = await readTimelineFrequencySummary(result.frequencyManifest, store);
    const timelinePhase = await readTimelinePhaseCorrelation(result.phaseManifest, store);
    primeTimelineFrequencySummaryCache([result.frequencyArtifact.manifestRef.artifactId], timelineFrequency);
    primeTimelinePhaseCorrelationCache([result.phaseArtifact.manifestRef.artifactId], timelinePhase);
    expect(getCachedTimelineFrequencySummary(result.frequencyArtifact.manifestRef.artifactId)?.summary.dominantBandId)
      .toBe('low-mid');
    expect(getCachedTimelinePhaseCorrelation(result.phaseArtifact.manifestRef.artifactId)?.summary.averageCorrelation)
      .toBeGreaterThan(0.99);
  });

  it('creates compact analysis refs for processed frequency and phase artifacts', async () => {
    const store = createStore();
    const generator = new FrequencyPhaseAnalysisGenerator({
      artifactStore: store,
      now: () => FIXED_TIME,
      createJobId: () => 'frequency-phase-job-refs',
    });

    const result = await generator.generate({
      mediaFileId: 'media-b',
      sourceFingerprint: 'sha256:source-b',
      buffer: createStereoSineBuffer(1200),
      clipAudioStateHash: 'audio-state:v1:processed:frequency-phase',
      fftSize: 1024,
      hopSize: 512,
    });

    expect(result.frequencyAnalysisRef).toMatchObject({
      kind: 'frequency-summary',
      artifactId: result.frequencyArtifact.id,
      cacheKey: result.frequencyCacheKey,
    });
    expect(result.phaseAnalysisRef).toMatchObject({
      kind: 'phase-correlation',
      artifactId: result.phaseArtifact.id,
      cacheKey: result.phaseCacheKey,
    });
    expect(result.frequencyArtifact.analyzerVersion).toBe(createFrequencyPhaseAnalyzerVersion({
      fftSize: 1024,
      hopSize: 512,
      phaseWindowDuration: 0.1,
      phaseHopDuration: 0.05,
    }));
    expect(result.phaseArtifact.clipAudioStateHash).toBe('audio-state:v1:processed:frequency-phase');
  });
});
