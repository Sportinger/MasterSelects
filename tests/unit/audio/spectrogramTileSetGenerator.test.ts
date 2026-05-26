import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter, blobToArrayBuffer } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  SPECTROGRAM_TILE_PAYLOAD_MIME_TYPE,
  SpectrogramTileSetGenerator,
  createSpectrogramTileSetAnalyzerVersion,
} from '../../../src/services/audio/SpectrogramTileSetGenerator';
import {
  decodeSpectrogramTilePayload,
} from '../../../src/services/audio/spectrogramTileManifest';
import {
  getCachedTimelineSpectrogramTileSet,
  primeTimelineSpectrogramTileSetCache,
  readTimelineSpectrogramTileSet,
} from '../../../src/services/audio/timelineSpectrogramCache';

const FIXED_TIME = '2026-05-25T10:00:00.000Z';

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME),
  );
}

function createMockAudioBuffer(channels: number[][], sampleRate = 1024): AudioBuffer {
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

function createSineBuffer(bin = 8, length = 1024): AudioBuffer {
  return createMockAudioBuffer([
    Array.from({ length }, (_, index) => Math.sin((2 * Math.PI * bin * index) / length)),
  ]);
}

describe('SpectrogramTileSetGenerator', () => {
  it('stores real STFT spectrogram tiles as encoded Float32 payloads', async () => {
    const store = createStore();
    const generator = new SpectrogramTileSetGenerator({
      artifactStore: store,
      now: () => FIXED_TIME,
      createJobId: () => 'spectrogram-job-1',
    });

    const result = await generator.generate({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      buffer: createSineBuffer(8),
      fftSize: 1024,
      hopSize: 256,
      tileWidthFrames: 2,
      decoderId: 'mock.decode',
      decoderVersion: '1.0.0',
    });

    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      sampleRate: 1024,
      duration: 1,
      channelLayout: { kind: 'mono', channelCount: 1, labels: ['Mix'] },
      fftSize: 1024,
      hopSize: 256,
      window: 'hann',
      frequencyScale: 'linear',
      tileWidthFrames: 2,
      tileHeightBins: 512,
      tiles: [
        { tileIndex: 0, channelIndex: 0, frameStart: 0, frameCount: 2 },
        { tileIndex: 1, channelIndex: 0, frameStart: 2, frameCount: 2 },
      ],
    });
    expect(result.payloadRefs).toHaveLength(2);
    expect(result.payloadRefs.every(ref => ref.mimeType === SPECTROGRAM_TILE_PAYLOAD_MIME_TYPE)).toBe(true);
    const storedManifest = result.artifact.metadata?.spectrogramTileSetManifest as typeof result.manifest;
    expect(storedManifest).toMatchObject({
      schemaVersion: 1,
      fftSize: 1024,
    });
    expect(storedManifest.tiles[0]).toMatchObject({ tileIndex: 0 });

    const payload = await store.getPayload(result.manifest.tiles[0].payloadRef.artifactId);
    expect(payload).not.toBeNull();
    const decoded = decodeSpectrogramTilePayload(await blobToArrayBuffer(payload!));

    expect(decoded.header).toMatchObject({
      schemaVersion: 1,
      tileIndex: 0,
      channelIndex: 0,
      frameStart: 0,
      frameCount: 2,
      frequencyBinStart: 0,
      frequencyBinCount: 512,
      valueLayout: 'time-major',
      valueEncoding: 'normalized-db',
    });
    expect(decoded.values.length).toBe(1024);
    expect(decoded.values[8]).toBeGreaterThan(decoded.values[200]);
    expect(decoded.values[8]).toBeGreaterThan(0.55);
  });

  it('uses deterministic analyzer identity and primes timeline spectrogram cache', async () => {
    const store = createStore();
    const generator = new SpectrogramTileSetGenerator({
      artifactStore: store,
      now: () => FIXED_TIME,
      createJobId: () => 'spectrogram-job-cache',
    });

    const result = await generator.generate({
      mediaFileId: 'media-cache',
      sourceFingerprint: 'sha256:cache-source',
      buffer: createSineBuffer(12, 2048),
      clipAudioStateHash: 'audio-state:v1:processed:123',
      fftSize: 1024,
      hopSize: 512,
      tileWidthFrames: 4,
    });
    const tileSet = await readTimelineSpectrogramTileSet(result.manifest, store);

    expect(result.artifact.analyzerVersion).toBe(createSpectrogramTileSetAnalyzerVersion({
      fftSize: 1024,
      hopSize: 512,
      tileWidthFrames: 4,
      minDb: -96,
      maxDb: 0,
    }));
    expect(result.analysisRef).toMatchObject({
      kind: 'spectrogram-tiles',
      artifactId: result.artifact.id,
      cacheKey: result.cacheKey,
    });
    expect(tileSet).toMatchObject({
      sampleRate: 1024,
      duration: 2,
      fftSize: 1024,
      hopSize: 512,
      frameCount: 4,
      frequencyBinCount: 512,
      channels: [{ channelIndex: 0 }],
    });
    expect(tileSet.channels[0].values.length).toBe(2048);

    primeTimelineSpectrogramTileSetCache([
      result.artifact.id,
      result.artifact.manifestRef.artifactId,
    ], tileSet);
    expect(getCachedTimelineSpectrogramTileSet(result.artifact.manifestRef.artifactId)).toBe(tileSet);
    expect(result.artifact.metadata?.sourceChannelLayout).toMatchObject({
      kind: 'mono',
      channelCount: 1,
    });
  });
});
