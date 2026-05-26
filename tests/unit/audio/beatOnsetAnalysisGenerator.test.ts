import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter, blobToArrayBuffer } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  AUDIO_EVENT_LIST_PAYLOAD_MIME_TYPE,
  BeatOnsetAnalysisGenerator,
} from '../../../src/services/audio/BeatOnsetAnalysisGenerator';
import {
  decodeAudioEventListPayload,
  float32ToEvents,
  type BeatGridManifest,
  type OnsetMapManifest,
} from '../../../src/services/audio/beatOnsetManifest';

const FIXED_TIME = '2026-05-25T10:00:00.000Z';

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME),
  );
}

function createMockAudioBuffer(samples: Float32Array, sampleRate = 48_000): AudioBuffer {
  return {
    numberOfChannels: 1,
    sampleRate,
    length: samples.length,
    duration: samples.length / sampleRate,
    getChannelData: vi.fn(() => samples),
  } as unknown as AudioBuffer;
}

function createPulseTrainBuffer(sampleRate = 48_000, durationSeconds = 4, tempoBpm = 120): AudioBuffer {
  const length = sampleRate * durationSeconds;
  const samples = new Float32Array(length);
  const beatInterval = 60 / tempoBpm;
  const pulseLength = Math.floor(sampleRate * 0.018);

  for (let beatTime = 0.5; beatTime < durationSeconds; beatTime += beatInterval) {
    const start = Math.floor(beatTime * sampleRate);
    for (let offset = 0; offset < pulseLength && start + offset < length; offset += 1) {
      const envelope = 1 - offset / pulseLength;
      samples[start + offset] += envelope * 0.9;
    }
  }

  return createMockAudioBuffer(samples, sampleRate);
}

describe('BeatOnsetAnalysisGenerator', () => {
  it('stores onset-map and beat-grid artifacts from spectral flux', async () => {
    const store = createStore();
    const generator = new BeatOnsetAnalysisGenerator({
      artifactStore: store,
      now: () => FIXED_TIME,
      createJobId: () => 'beat-onset-job-1',
    });

    const result = await generator.generate({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      buffer: createPulseTrainBuffer(),
      fftSize: 1024,
      hopSize: 512,
      decoderId: 'mock.decode',
      decoderVersion: '1.0.0',
    });

    expect(result.onsetManifest).toMatchObject({
      schemaVersion: 1,
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      sampleRate: 48_000,
      duration: 4,
      channelLayout: { kind: 'mono', channelCount: 1, labels: ['Mix'] },
      fftSize: 1024,
      hopSize: 512,
      detectionFunction: 'spectral-flux',
    });
    expect(result.onsetManifest.eventCount).toBeGreaterThanOrEqual(5);
    expect(result.beatManifest.tempoBpm).toBeGreaterThanOrEqual(115);
    expect(result.beatManifest.tempoBpm).toBeLessThanOrEqual(125);
    expect(result.beatManifest.beatCount).toBeGreaterThanOrEqual(6);
    expect(result.onsetPayloadRef.mimeType).toBe(AUDIO_EVENT_LIST_PAYLOAD_MIME_TYPE);
    expect(result.beatPayloadRef.mimeType).toBe(AUDIO_EVENT_LIST_PAYLOAD_MIME_TYPE);

    const onsetPayload = await store.getPayload(result.onsetManifest.eventsPayloadRef.artifactId);
    const beatPayload = await store.getPayload(result.beatManifest.beatsPayloadRef.artifactId);
    expect(onsetPayload).not.toBeNull();
    expect(beatPayload).not.toBeNull();

    const decodedOnsets = decodeAudioEventListPayload(await blobToArrayBuffer(onsetPayload!));
    const decodedBeats = decodeAudioEventListPayload(await blobToArrayBuffer(beatPayload!));
    expect(decodedOnsets.header).toMatchObject({
      schemaVersion: 1,
      kind: 'onset-map',
      eventCount: result.onsetManifest.eventCount,
      valueLayout: 'event-major',
      valueEncoding: 'time-strength-confidence-f32',
      timeUnit: 'seconds',
    });
    expect(decodedBeats.header.kind).toBe('beat-grid');
    expect(float32ToEvents(decodedOnsets.values)[0]?.time).toBeGreaterThan(0.45);
    expect(float32ToEvents(decodedOnsets.values)[0]?.time).toBeLessThan(0.55);

    const storedOnsetManifest = result.onsetArtifact.metadata?.onsetMapManifest as OnsetMapManifest;
    const storedBeatManifest = result.beatArtifact.metadata?.beatGridManifest as BeatGridManifest;
    expect(storedOnsetManifest.summary.eventCount).toBe(result.onsetManifest.eventCount);
    expect(storedBeatManifest.summary.tempoBpm).toBe(result.beatManifest.tempoBpm);
    expect(storedBeatManifest.sourceOnsetMapArtifactId).toBe(result.onsetArtifact.manifestRef.artifactId);
  });

  it('creates compact analysis refs for both event artifacts', async () => {
    const store = createStore();
    const generator = new BeatOnsetAnalysisGenerator({
      artifactStore: store,
      now: () => FIXED_TIME,
      createJobId: () => 'beat-onset-job-refs',
    });

    const result = await generator.generate({
      mediaFileId: 'media-b',
      sourceFingerprint: 'sha256:source-b',
      buffer: createPulseTrainBuffer(48_000, 3, 90),
      clipAudioStateHash: 'audio-state:v1:processed:events',
    });

    expect(result.onsetAnalysisRef).toMatchObject({
      kind: 'onset-map',
      artifactId: result.onsetArtifact.id,
      cacheKey: result.onsetCacheKey,
    });
    expect(result.beatAnalysisRef).toMatchObject({
      kind: 'beat-grid',
      artifactId: result.beatArtifact.id,
      cacheKey: result.beatCacheKey,
    });
    expect(result.beatArtifact.analyzerVersion).toContain('onset=spectral-flux-adaptive');
    expect(result.beatArtifact.clipAudioStateHash).toBe('audio-state:v1:processed:events');
  });
});
