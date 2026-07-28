import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter, blobToArrayBuffer } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  AUDIO_SPAN_LIST_PAYLOAD_MIME_TYPE,
  AudioIntelligenceGenerator,
  type AudioIntelligenceRuntimeLike,
} from '../../../src/services/audio/intelligence/AudioIntelligenceGenerator';
import {
  AudioIntelligenceError,
  type AudioIntelligenceFeature,
} from '../../../src/services/audio/intelligence/audioIntelligenceTypes';
import {
  decodeAudioSpanListPayload,
  float32ToSpans,
  type AudioSpan,
  type VoiceActivityManifest,
} from '../../../src/services/audio/voiceActivityManifest';

const FIXED_TIME = '2026-07-28T10:00:00.000Z';

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

const CANNED_SEGMENTS: AudioSpan[] = [
  { start: 0.25, end: 1.5, confidence: 0.91 },
  { start: 2.0, end: 2.75, confidence: 0.84 },
];

function createStubRuntime(segments: AudioSpan[] = CANNED_SEGMENTS) {
  const runVad = vi.fn(async (pcm: Float32Array) => ({
    segments,
    probabilityHop: 512 / 16_000,
    probabilities: new Float32Array(Math.ceil(pcm.length / 512)),
  }));
  return { runtime: { runVad } as AudioIntelligenceRuntimeLike, runVad };
}

function features(...values: AudioIntelligenceFeature[]): ReadonlySet<AudioIntelligenceFeature> {
  return new Set(values);
}

describe('AudioIntelligenceGenerator', () => {
  it('stores a voice-activity artifact with manifest, payload, and compact ref', async () => {
    const store = createStore();
    const { runtime, runVad } = createStubRuntime();
    const generator = new AudioIntelligenceGenerator({
      artifactStore: store,
      runtime,
      now: () => FIXED_TIME,
      createJobId: () => 'audio-intel-job-1',
    });

    const result = await generator.generate({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      buffer: createMockAudioBuffer(new Float32Array(48_000 * 3)),
      features: features('vad'),
      decoderId: 'mock.decode',
      decoderVersion: '1.0.0',
    });

    expect(result.jobId).toBe('audio-intel-job-1');
    expect(result.skipped).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(runVad).toHaveBeenCalledTimes(1);
    // 48 kHz -> 16 kHz mono resample.
    expect(runVad.mock.calls[0][0]).toHaveLength(48_000);

    const artifact = result.artifacts.voiceActivity;
    expect(artifact).toBeDefined();
    expect(artifact).toMatchObject({
      kind: 'voice-activity',
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      decoderId: 'mock.decode',
      sampleRate: 48_000,
      duration: 3,
      channelLayout: { kind: 'mono', channelCount: 1, labels: ['Mix'] },
      stale: false,
    });
    expect(artifact!.analyzerVersion).toContain(
      'masterselects.audio-intelligence.vad@1.0.0+silero-v5.1.2',
    );
    expect(artifact!.analyzerVersion).toContain('model=silero-vad@v5.1.2');
    expect(result.refs.voiceActivity).toMatchObject({
      kind: 'voice-activity',
      artifactId: artifact!.id,
    });

    const manifest = artifact!.metadata?.voiceActivityManifest as unknown as VoiceActivityManifest;
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      mediaFileId: 'media-a',
      sampleRate: 48_000,
      analysisSampleRate: 16_000,
      model: { id: 'silero-vad', version: 'v5.1.2' },
      segmentCount: 2,
      summary: {
        segmentCount: 2,
        speechSeconds: 2,
        speechRatio: 2 / 3,
      },
    });
    expect(manifest.config).toMatchObject({
      threshold: 0.5,
      negThreshold: 0.35,
      minSpeechMs: 250,
      minSilenceMs: 100,
      padMs: 30,
      frameSamples: 512,
    });

    expect(manifest.segmentsPayloadRef.mimeType).toBe(AUDIO_SPAN_LIST_PAYLOAD_MIME_TYPE);
    const payload = await store.getPayload(manifest.segmentsPayloadRef.artifactId);
    expect(payload).not.toBeNull();
    const decoded = decodeAudioSpanListPayload(await blobToArrayBuffer(payload!));
    expect(decoded.header.spanCount).toBe(2);
    const spans = float32ToSpans(decoded.values);
    expect(spans[0].start).toBeCloseTo(0.25, 5);
    expect(spans[0].end).toBeCloseTo(1.5, 5);
    expect(spans[1].confidence).toBeCloseTo(0.84, 5);
  });

  it('skips regeneration when a fresh artifact already exists', async () => {
    const store = createStore();
    const { runtime, runVad } = createStubRuntime();
    const makeGenerator = () => new AudioIntelligenceGenerator({
      artifactStore: store,
      runtime,
      now: () => FIXED_TIME,
    });
    const request = {
      mediaFileId: 'media-b',
      sourceFingerprint: 'sha256:source-b',
      buffer: createMockAudioBuffer(new Float32Array(48_000)),
      features: features('vad'),
    };

    const first = await makeGenerator().generate(request);
    expect(first.skipped).toEqual([]);
    expect(runVad).toHaveBeenCalledTimes(1);

    const second = await makeGenerator().generate(request);
    expect(second.skipped).toEqual(['vad']);
    expect(second.artifacts.voiceActivity?.id).toBe(first.artifacts.voiceActivity?.id);
    expect(second.refs.voiceActivity?.cacheKey).toBe(first.refs.voiceActivity?.cacheKey);
    expect(runVad).toHaveBeenCalledTimes(1);
  });

  it('regenerates when the clip audio state hash changes', async () => {
    const store = createStore();
    const { runtime, runVad } = createStubRuntime();
    const generator = new AudioIntelligenceGenerator({
      artifactStore: store,
      runtime,
      now: () => FIXED_TIME,
    });
    const base = {
      mediaFileId: 'media-c',
      sourceFingerprint: 'sha256:source-c',
      buffer: createMockAudioBuffer(new Float32Array(48_000)),
      features: features('vad'),
    };

    await generator.generate(base);
    await generator.generate({ ...base, clipAudioStateHash: 'audio-state:v1:x' });

    expect(runVad).toHaveBeenCalledTimes(2);
  });

  it('propagates cancellation and stores no artifact', async () => {
    const store = createStore();
    const controller = new AbortController();
    const runVad = vi.fn(async () => {
      controller.abort();
      return { segments: CANNED_SEGMENTS, probabilityHop: 512 / 16_000 };
    });
    const generator = new AudioIntelligenceGenerator({
      artifactStore: store,
      runtime: { runVad } as AudioIntelligenceRuntimeLike,
    });

    await expect(generator.generate({
      mediaFileId: 'media-d',
      sourceFingerprint: 'sha256:source-d',
      buffer: createMockAudioBuffer(new Float32Array(48_000)),
      features: features('vad'),
    }, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AudioIntelligenceCancelledError',
      code: 'cancelled',
    });

    expect(await store.listAnalysisArtifacts('media-d', 'voice-activity')).toEqual([]);
  });

  it('rejects when cancellation is signalled while listing cached artifacts', async () => {
    const store = createStore();
    const controller = new AbortController();
    const { runtime, runVad } = createStubRuntime();
    const listArtifacts = vi.spyOn(store, 'listAnalysisArtifacts').mockImplementation(async () => {
      controller.abort('between stages');
      return [];
    });
    const generator = new AudioIntelligenceGenerator({ artifactStore: store, runtime });

    await expect(generator.generate({
      mediaFileId: 'media-cancel-between-stages',
      sourceFingerprint: 'sha256:source-cancel-between-stages',
      buffer: createMockAudioBuffer(new Float32Array(48_000)),
      features: features('vad'),
    }, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AudioIntelligenceCancelledError',
      code: 'cancelled',
      message: expect.stringContaining('between stages'),
    });

    expect(listArtifacts).toHaveBeenCalledTimes(1);
    expect(runVad).not.toHaveBeenCalled();
  });

  it('rejects a VAD frame size that Silero inference does not support', async () => {
    const store = createStore();
    const { runtime, runVad } = createStubRuntime();
    const generator = new AudioIntelligenceGenerator({ artifactStore: store, runtime });

    await expect(generator.generate({
      mediaFileId: 'media-invalid-frame-size',
      sourceFingerprint: 'sha256:source-invalid-frame-size',
      buffer: createMockAudioBuffer(new Float32Array(48_000)),
      features: features('vad'),
      vadConfig: { frameSamples: 256 },
    })).rejects.toMatchObject({
      code: 'invalid-input',
      message: expect.stringContaining('frameSamples=512'),
    });

    expect(runVad).not.toHaveBeenCalled();
  });

  it('lists unimplemented features as deferred', async () => {
    const store = createStore();
    const { runtime } = createStubRuntime();
    const generator = new AudioIntelligenceGenerator({
      artifactStore: store,
      runtime,
      now: () => FIXED_TIME,
    });

    const result = await generator.generate({
      mediaFileId: 'media-e',
      sourceFingerprint: 'sha256:source-e',
      buffer: createMockAudioBuffer(new Float32Array(48_000)),
      features: features('vad', 'prosody', 'room-tone'),
    });

    expect(result.deferred).toEqual(expect.arrayContaining(['prosody', 'room-tone']));
    expect(result.deferred).not.toContain('vad');
    expect(result.artifacts.voiceActivity).toBeDefined();

    const noVad = await generator.generate({
      mediaFileId: 'media-f',
      sourceFingerprint: 'sha256:source-f',
      buffer: createMockAudioBuffer(new Float32Array(48_000)),
      features: features('alignment'),
    });
    expect(noVad.deferred).toEqual(['alignment']);
    expect(noVad.artifacts.voiceActivity).toBeUndefined();
  });

  it('rejects an invalid AudioBuffer', async () => {
    const store = createStore();
    const { runtime } = createStubRuntime();
    const generator = new AudioIntelligenceGenerator({ artifactStore: store, runtime });

    await expect(generator.generate({
      mediaFileId: 'media-g',
      sourceFingerprint: 'sha256:source-g',
      buffer: {} as AudioBuffer,
      features: features('vad'),
    })).rejects.toBeInstanceOf(AudioIntelligenceError);
  });
});
