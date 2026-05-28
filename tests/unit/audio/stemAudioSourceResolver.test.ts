import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  createStemPcmF32Metadata,
  encodeStemPcmF32Payload,
  StemAudioSourceResolver,
  STEM_PCM_F32_MIME_TYPE,
  type StemAudioBufferFactory,
} from '../../../src/services/audio/stemSeparation';
import type { AudioSignalArtifactRef, ClipAudioStemLayer, ClipAudioStemState } from '../../../src/types/audio';

const FIXED_TIME = '2026-05-28T12:00:00.000Z';

function createMockAudioBuffer(channels: number[][], sampleRate = 8): AudioBuffer {
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

function createBufferFactory(): StemAudioBufferFactory {
  return {
    createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
      return createMockAudioBuffer(
        Array.from({ length: numberOfChannels }, () => Array.from({ length }, () => 0)),
        sampleRate,
      );
    },
  };
}

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME),
  );
}

async function putStemPayload(
  store: AudioArtifactStore,
  kind: ClipAudioStemLayer['kind'],
  channels: readonly Float32Array[],
): Promise<AudioSignalArtifactRef> {
  const metadata = createStemPcmF32Metadata({ channels, sampleRate: 8 });
  return store.putPayload(encodeStemPcmF32Payload({ channels, sampleRate: 8 }), {
    mediaFileId: 'media-a',
    kind: 'stem-separation',
    sourceFingerprint: 'source-a',
    mimeType: STEM_PCM_F32_MIME_TYPE,
    encoding: 'raw',
    analyzerVersion: 'stem-test',
    metadata: {
      ...metadata,
      stemKind: kind,
    },
  });
}

function createStemLayer(
  id: string,
  kind: ClipAudioStemLayer['kind'],
  payloadRef: AudioSignalArtifactRef,
  options: Partial<ClipAudioStemLayer> = {},
): ClipAudioStemLayer {
  return {
    id,
    kind,
    label: kind,
    analysisArtifactId: `analysis-${id}`,
    manifestArtifactId: `manifest-${id}`,
    payloadRef,
    enabled: true,
    gainDb: 0,
    phaseAligned: true,
    modelId: 'test-model',
    sourceFingerprint: 'source-a',
    ...options,
  };
}

function createStemState(stems: ClipAudioStemLayer[], options: Partial<ClipAudioStemState> = {}): ClipAudioStemState {
  return {
    activeSetId: 'set-a',
    modelId: 'test-model',
    modelVersion: 'test-v1',
    createdAt: Date.parse(FIXED_TIME),
    sourceFingerprint: 'source-a',
    range: { start: 0, end: 0.25 },
    sampleRate: 8,
    channelCount: 1,
    stems,
    mixMode: 'stems',
    ...options,
  };
}

describe('stem PCM F32 payloads', () => {
  it('round-trips planar Float32 stem payloads with explicit metadata', () => {
    const channels = [
      Float32Array.from([0, 0.5, 1]),
      Float32Array.from([1, 0.5, 0]),
    ];
    const metadata = createStemPcmF32Metadata({ channels, sampleRate: 48_000 });
    const payload = encodeStemPcmF32Payload({ channels, sampleRate: 48_000 });

    expect(metadata).toMatchObject({
      stemPayloadEncoding: 'planar-f32',
      sampleRate: 48_000,
      channelCount: 2,
      frameCount: 3,
    });
    expect(payload.byteLength).toBe(2 * 3 * Float32Array.BYTES_PER_ELEMENT);
  });
});

describe('StemAudioSourceResolver', () => {
  it('mixes enabled stems and applies per-stem gain', async () => {
    const store = createStore();
    const vocalsRef = await putStemPayload(store, 'vocals', [Float32Array.from([1, 1, 1])]);
    const drumsRef = await putStemPayload(store, 'drums', [Float32Array.from([0.5, 0.5, 0.5])]);
    const bassRef = await putStemPayload(store, 'bass', [Float32Array.from([9, 9, 9])]);
    const resolver = new StemAudioSourceResolver({
      artifactStore: store,
      audioBufferFactory: createBufferFactory(),
    });

    const resolution = await resolver.resolveStemMix(createStemState([
      createStemLayer('vocals', 'vocals', vocalsRef),
      createStemLayer('drums', 'drums', drumsRef, { gainDb: -6 }),
      createStemLayer('bass', 'bass', bassRef, { enabled: false }),
    ]));

    expect(resolution.mode).toBe('stems');
    expect(resolution.usedStemIds).toEqual(['vocals', 'drums']);
    expect(resolution.missingStems).toEqual([]);
    expect(Array.from(resolution.buffer!.getChannelData(0))).toEqual(
      expect.arrayContaining([
        expect.closeTo(1 + 0.5 * 10 ** (-6 / 20), 5),
      ]),
    );
  });

  it('uses only the solo stem when soloStemId is set', async () => {
    const store = createStore();
    const vocalsRef = await putStemPayload(store, 'vocals', [Float32Array.from([1, 1])]);
    const drumsRef = await putStemPayload(store, 'drums', [Float32Array.from([0.5, 0.5])]);
    const resolver = new StemAudioSourceResolver({
      artifactStore: store,
      audioBufferFactory: createBufferFactory(),
    });

    const resolution = await resolver.resolveStemMix(createStemState([
      createStemLayer('vocals', 'vocals', vocalsRef),
      createStemLayer('drums', 'drums', drumsRef),
    ], {
      soloStemId: 'drums',
    }));

    expect(resolution.usedStemIds).toEqual(['drums']);
    expect(Array.from(resolution.buffer!.getChannelData(0))).toEqual([0.5, 0.5]);
  });

  it('duplicates mono stems into the requested channel count', async () => {
    const store = createStore();
    const vocalsRef = await putStemPayload(store, 'vocals', [Float32Array.from([1, -1])]);
    const resolver = new StemAudioSourceResolver({
      artifactStore: store,
      audioBufferFactory: createBufferFactory(),
    });

    const resolution = await resolver.resolveStemMix(createStemState([
      createStemLayer('vocals', 'vocals', vocalsRef),
    ], {
      channelCount: 2,
    }));

    expect(resolution.buffer?.numberOfChannels).toBe(2);
    expect(Array.from(resolution.buffer!.getChannelData(0))).toEqual([1, -1]);
    expect(Array.from(resolution.buffer!.getChannelData(1))).toEqual([1, -1]);
  });

  it('reports missing stem artifacts without falling back to original audio', async () => {
    const store = createStore();
    const resolver = new StemAudioSourceResolver({
      artifactStore: store,
      audioBufferFactory: createBufferFactory(),
    });
    const missingRef: AudioSignalArtifactRef = {
      artifactId: 'missing-payload',
      mimeType: STEM_PCM_F32_MIME_TYPE,
      metadata: {
        stemPayloadEncoding: 'planar-f32',
        sampleRate: 8,
        channelCount: 1,
        frameCount: 2,
        duration: 0.25,
      },
    };

    const resolution = await resolver.resolveStemMix(createStemState([
      createStemLayer('vocals', 'vocals', missingRef),
    ]));

    expect(resolution.mode).toBe('stems');
    expect(resolution.buffer).toBeNull();
    expect(resolution.usedStemIds).toEqual([]);
    expect(resolution.missingStems.map((stem) => stem.id)).toEqual(['vocals']);
  });

  it('returns original mode when stem state explicitly requests the original source', async () => {
    const store = createStore();
    const resolver = new StemAudioSourceResolver({
      artifactStore: store,
      audioBufferFactory: createBufferFactory(),
    });

    const resolution = await resolver.resolveStemMix(createStemState([], {
      mixMode: 'original',
    }));

    expect(resolution).toEqual({
      mode: 'original',
      buffer: null,
      usedStemIds: [],
      missingStems: [],
    });
  });
});

