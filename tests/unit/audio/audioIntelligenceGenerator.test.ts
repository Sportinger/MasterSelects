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
  type AudioIntelligenceProsodyJobInput,
  type AudioIntelligenceSpeechMarkersJobInput,
} from '../../../src/services/audio/intelligence/audioIntelligenceTypes';
import { createTranscriptTimingFingerprint } from '../../../src/services/audio/transcriptTimingManifest';
import {
  decodeAudioSpanListPayload,
  float32ToSpans,
  type AudioSpan,
  type VoiceActivityManifest,
} from '../../../src/services/audio/voiceActivityManifest';
import type { TranscriptWord } from '../../../src/types/clipMetadata';

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

// Confidences are exactly representable in Float32 so payload round-trips
// through stored artifacts stay equality-comparable.
const CANNED_SEGMENTS: AudioSpan[] = [
  { start: 0.25, end: 1.5, confidence: 0.90625 },
  { start: 2.0, end: 2.75, confidence: 0.84375 },
];
const WORDS: TranscriptWord[] = [
  { id: 'word-1', text: 'hello', start: 0.3, end: 0.7, sourceProvider: 'deepgram' },
  { id: 'word-2', text: 'um', start: 0.8, end: 1.0, sourceProvider: 'deepgram' },
];
const TRANSCRIPT_HASH = 'transcript-hash-a';

function createStubRuntime(segments: AudioSpan[] = CANNED_SEGMENTS) {
  const loadPcm = vi.fn(async (pcm: Float32Array) => ({
    token: 'pcm-token-1',
    energy: { values: new Float32Array(Math.ceil(pcm.length / 160)), hopSeconds: 0.01, startSeconds: 0 },
  }));
  const releasePcm = vi.fn(async () => ({ released: true }));
  const runVad = vi.fn(async () => ({
    segments,
    probabilityHop: 512 / 16_000,
    probabilities: new Float32Array(10),
  }));
  const runAlignment = vi.fn(async () => [
    { wordId: 'word-1', alignedStart: 0.25, alignedEnd: 0.72, confidence: 0.9 },
    { wordId: 'word-2', alignedStart: 0.78, alignedEnd: 1.03, confidence: 0.8 },
  ]);
  const runSpeechMarkers = vi.fn(async (_input: AudioIntelligenceSpeechMarkersJobInput) => [{
    id: 'filler-word-2',
    type: 'filler' as const,
    start: 0.78,
    end: 1.03,
    confidence: 0.8,
    text: 'um',
    wordIds: ['word-2'],
  }]);
  const runProsody = vi.fn(async (input: AudioIntelligenceProsodyJobInput) => ({
    hopSeconds: input.hopSeconds,
    windowSeconds: 0.04,
    f0Hz: new Float32Array([120, 125]),
    voicing: new Float32Array([0.9, 0.8]),
    energyRmsDb: new Float32Array([-18, -17]),
    speechRateSps: new Float32Array([3, 3.2]),
    summary: { medianF0Hz: 122.5, meanSpeechRateSps: 3.1 },
  }));
  const runRoomTone = vi.fn(async () => ({
    candidates: [{ start: 1.5, end: 2, rmsDb: -48, variance: 0.4, score: 0.9 }],
    noiseFloor: { rmsDbMedian: -48, rmsDbP10: -52, rmsDbP90: -44 },
    bandCentersHz: [100, 200],
    bandAverageDb: [-50, -49],
  }));
  const runtime = {
    loadPcm,
    releasePcm,
    runVad,
    runAlignment,
    runSpeechMarkers,
    runProsody,
    runRoomTone,
  } as unknown as AudioIntelligenceRuntimeLike;
  return {
    runtime,
    loadPcm,
    releasePcm,
    runVad,
    runAlignment,
    runSpeechMarkers,
    runProsody,
    runRoomTone,
  };
}

function features(...values: AudioIntelligenceFeature[]): ReadonlySet<AudioIntelligenceFeature> {
  return new Set(values);
}

function fullRequest(buffer = createMockAudioBuffer(new Float32Array(48_000 * 3))) {
  return {
    mediaFileId: 'media-full',
    sourceFingerprint: 'sha256:source-full',
    buffer,
    features: features('vad', 'alignment', 'speech-markers', 'prosody', 'room-tone'),
    transcript: {
      words: WORDS,
      hash: TRANSCRIPT_HASH,
      language: 'en',
      wordSource: 'provider' as const,
    },
    profile: { hopSeconds: 0.05 },
    decoderId: 'mock.decode',
    decoderVersion: '1.0.0',
  };
}

describe('AudioIntelligenceGenerator', () => {
  it('stores a voice-activity artifact with manifest, payload, and compact ref', async () => {
    const store = createStore();
    const { runtime, runVad, loadPcm, releasePcm } = createStubRuntime();
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
    expect(loadPcm).toHaveBeenCalledTimes(1);
    expect(loadPcm.mock.calls[0][0]).toHaveLength(48_000);
    expect(runVad).toHaveBeenCalledWith('pcm-token-1', expect.any(Object), expect.any(Object));
    expect(releasePcm).toHaveBeenCalledWith('pcm-token-1');

    const artifact = result.artifacts.voiceActivity!;
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
    expect(artifact.analyzerVersion).toContain(
      'masterselects.audio-intelligence.vad@1.0.0+silero-v5.1.2',
    );
    expect(result.refs.voiceActivity).toMatchObject({
      kind: 'voice-activity',
      artifactId: artifact.id,
    });
    const manifest = artifact.metadata?.voiceActivityManifest as unknown as VoiceActivityManifest;
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      mediaFileId: 'media-a',
      analysisSampleRate: 16_000,
      segmentCount: 2,
      summary: { segmentCount: 2, speechSeconds: 2, speechRatio: 2 / 3 },
    });
    expect(manifest.segmentsPayloadRef.mimeType).toBe(AUDIO_SPAN_LIST_PAYLOAD_MIME_TYPE);
    const payload = await store.getPayload(manifest.segmentsPayloadRef.artifactId);
    const decoded = decodeAudioSpanListPayload(await blobToArrayBuffer(payload!));
    const spans = float32ToSpans(decoded.values);
    expect(spans[0].start).toBeCloseTo(0.25, 5);
    expect(spans[1].confidence).toBeCloseTo(0.84375, 5);
  });

  it('runs the full pipeline and persists all five kinds with stage fingerprints', async () => {
    const store = createStore();
    const stub = createStubRuntime();
    const generator = new AudioIntelligenceGenerator({ artifactStore: store, runtime: stub.runtime });
    const result = await generator.generate(fullRequest());
    const transcriptFingerprint = createTranscriptTimingFingerprint(
      'sha256:source-full',
      TRANSCRIPT_HASH,
    );

    expect(Object.values(result.artifacts).map(artifact => artifact?.kind)).toEqual(expect.arrayContaining([
      'voice-activity',
      'transcript-timing',
      'speech-markers',
      'prosody-contour',
      'room-tone-profile',
    ]));
    expect(result.artifacts.voiceActivity?.sourceFingerprint).toBe('sha256:source-full');
    expect(result.artifacts.roomToneProfile?.sourceFingerprint).toBe('sha256:source-full');
    expect(result.artifacts.transcriptTiming?.sourceFingerprint).toBe(transcriptFingerprint);
    expect(result.artifacts.speechMarkers?.sourceFingerprint).toBe(transcriptFingerprint);
    expect(result.artifacts.prosodyContour?.sourceFingerprint).toBe(transcriptFingerprint);
    expect(result.deferred).toEqual([]);
    expect(stub.runVad).toHaveBeenCalledTimes(1);
    expect(stub.runAlignment).toHaveBeenCalledTimes(1);
    expect(stub.runRoomTone).toHaveBeenCalledTimes(1);
    expect(stub.runSpeechMarkers).toHaveBeenCalledTimes(1);
    expect(stub.runProsody).toHaveBeenCalledTimes(1);
    expect(stub.runVad.mock.invocationCallOrder[0]).toBeLessThan(stub.runAlignment.mock.invocationCallOrder[0]);
    expect(stub.runAlignment.mock.invocationCallOrder[0]).toBeLessThan(stub.runRoomTone.mock.invocationCallOrder[0]);
    expect(stub.runRoomTone.mock.invocationCallOrder[0]).toBeLessThan(stub.runSpeechMarkers.mock.invocationCallOrder[0]);
    expect(stub.runSpeechMarkers.mock.invocationCallOrder[0]).toBeLessThan(stub.runProsody.mock.invocationCallOrder[0]);
  });

  it('reuses every fresh artifact without loading PCM or rerunning stages', async () => {
    const store = createStore();
    const stub = createStubRuntime();
    const generator = new AudioIntelligenceGenerator({ artifactStore: store, runtime: stub.runtime });
    const request = fullRequest();
    const first = await generator.generate(request);
    const second = await generator.generate(request);

    expect(second.skipped.map(item => item.feature)).toEqual(expect.arrayContaining([
      'vad', 'alignment', 'room-tone', 'speech-markers', 'prosody',
    ]));
    expect(second.artifacts.voiceActivity?.id).toBe(first.artifacts.voiceActivity?.id);
    expect(stub.loadPcm).toHaveBeenCalledTimes(1);
    expect(stub.runVad).toHaveBeenCalledTimes(1);
    expect(stub.runAlignment).toHaveBeenCalledTimes(1);
    expect(stub.runSpeechMarkers).toHaveBeenCalledTimes(1);
    expect(stub.runProsody).toHaveBeenCalledTimes(1);
    expect(stub.runRoomTone).toHaveBeenCalledTimes(1);
  });

  it('uses stored VAD segments for a prosody-only rerun', async () => {
    const store = createStore();
    const stub = createStubRuntime();
    const generator = new AudioIntelligenceGenerator({ artifactStore: store, runtime: stub.runtime });
    const buffer = createMockAudioBuffer(new Float32Array(48_000 * 3));
    await generator.generate({
      mediaFileId: 'media-prosody',
      sourceFingerprint: 'sha256:source-prosody',
      buffer,
      features: features('vad'),
    });
    const result = await generator.generate({
      mediaFileId: 'media-prosody',
      sourceFingerprint: 'sha256:source-prosody',
      buffer,
      features: features('prosody'),
      profile: { hopSeconds: 0.05 },
    });

    expect(await store.listAnalysisArtifacts('media-prosody', 'voice-activity')).toHaveLength(1);
    expect(stub.runVad).toHaveBeenCalledTimes(1);
    expect(stub.runProsody).toHaveBeenCalledTimes(1);
    expect(stub.runProsody.mock.calls[0][0].vadSegments).toEqual(CANNED_SEGMENTS);
    expect(result.artifacts.prosodyContour).toBeDefined();
  });

  it('keeps VAD and alignment artifacts when cancelled after alignment persistence', async () => {
    const store = createStore();
    const stub = createStubRuntime();
    const controller = new AbortController();
    const generator = new AudioIntelligenceGenerator({ artifactStore: store, runtime: stub.runtime });

    await expect(generator.generate(fullRequest(), {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.stage === 'alignment-stored') controller.abort('stop after alignment');
      },
    })).rejects.toMatchObject({ code: 'cancelled' });

    expect(await store.listAnalysisArtifacts('media-full', 'voice-activity')).toHaveLength(1);
    expect(await store.listAnalysisArtifacts('media-full', 'transcript-timing')).toHaveLength(1);
    expect(await store.listAnalysisArtifacts('media-full', 'room-tone-profile')).toHaveLength(0);
  });

  it('skips transcript-dependent alignment and fillers when transcript is missing', async () => {
    const store = createStore();
    const stub = createStubRuntime();
    const generator = new AudioIntelligenceGenerator({ artifactStore: store, runtime: stub.runtime });
    const result = await generator.generate({
      mediaFileId: 'media-no-transcript',
      sourceFingerprint: 'sha256:no-transcript',
      buffer: createMockAudioBuffer(new Float32Array(48_000 * 3)),
      features: features('alignment', 'speech-markers'),
    });

    expect(result.skipped).toEqual(expect.arrayContaining([
      { feature: 'alignment', reason: expect.stringContaining('Transcript unavailable') },
      { feature: 'speech-markers', reason: expect.stringContaining('filler detection skipped') },
    ]));
    expect(stub.runAlignment).not.toHaveBeenCalled();
    expect(stub.runSpeechMarkers.mock.calls[0][0].words).toBeUndefined();
    expect(result.artifacts.speechMarkers).toBeDefined();
  });

  it('does not persist VAD when cancellation arrives during inference', async () => {
    const store = createStore();
    const stub = createStubRuntime();
    const controller = new AbortController();
    stub.runVad.mockImplementationOnce(async () => {
      controller.abort();
      return { segments: CANNED_SEGMENTS, probabilityHop: 512 / 16_000 };
    });
    const generator = new AudioIntelligenceGenerator({ artifactStore: store, runtime: stub.runtime });

    await expect(generator.generate({
      mediaFileId: 'media-cancel-vad',
      sourceFingerprint: 'sha256:cancel-vad',
      buffer: createMockAudioBuffer(new Float32Array(48_000)),
      features: features('vad'),
    }, { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(await store.listAnalysisArtifacts('media-cancel-vad', 'voice-activity')).toEqual([]);
  });

  it('rejects a VAD frame size that Silero inference does not support', async () => {
    const store = createStore();
    const stub = createStubRuntime();
    const generator = new AudioIntelligenceGenerator({ artifactStore: store, runtime: stub.runtime });
    await expect(generator.generate({
      mediaFileId: 'media-invalid-frame-size',
      sourceFingerprint: 'sha256:source-invalid-frame-size',
      buffer: createMockAudioBuffer(new Float32Array(48_000)),
      features: features('vad'),
      vadConfig: { frameSamples: 256 },
    })).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringContaining('frameSamples=512') });
    expect(stub.runVad).not.toHaveBeenCalled();
  });

  it('rejects an invalid AudioBuffer', async () => {
    const store = createStore();
    const { runtime } = createStubRuntime();
    const generator = new AudioIntelligenceGenerator({ artifactStore: store, runtime });
    await expect(generator.generate({
      mediaFileId: 'media-invalid',
      sourceFingerprint: 'sha256:invalid',
      buffer: {} as AudioBuffer,
      features: features('vad'),
    })).rejects.toBeInstanceOf(AudioIntelligenceError);
  });
});
