import { describe, expect, it } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter, blobToArrayBuffer } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  AUDIO_ARTIFACT_SCHEMA_VERSION,
  createAudioArtifactId,
  type AudioChannelLayout,
} from '../../../src/services/audio/audioArtifactTypes';
import {
  createWaveformPyramidManifest,
  decodeWaveformStatPayload,
  encodeWaveformStatPayload,
  selectWaveformPyramidLevel,
  type WaveformChannelPayloadRefs,
} from '../../../src/services/audio/waveformPyramidManifest';

const FIXED_TIME = '2026-05-25T10:00:00.000Z';
const CREATED_AT_MS = Date.parse(FIXED_TIME);
const CHANNEL_LAYOUT: AudioChannelLayout = {
  kind: 'stereo',
  channelCount: 2,
  labels: ['L', 'R'],
};

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME),
  );
}

async function putStatPayload(
  store: AudioArtifactStore,
  channelIndex: number,
  statistic: 'min' | 'max' | 'rms' | 'peak',
  values: Float32Array,
) {
  return store.putPayload(encodeWaveformStatPayload({
    header: {
      schemaVersion: 1,
      statistic,
      samplesPerBucket: 128,
      channelIndex,
      bucketCount: values.length,
    },
    values,
  }), {
    mediaFileId: 'media-a',
    kind: 'waveform-pyramid',
    sourceFingerprint: 'sha256:source',
    mimeType: 'application/vnd.masterselects.waveform-stat',
    encoding: 'raw',
    analyzerVersion: 'waveform-test',
  });
}

describe('AudioArtifactStore', () => {
  it('stores waveform payloads and a typed analysis manifest through Signal artifacts', async () => {
    const store = createStore();
    const leftMin = await putStatPayload(store, 0, 'min', new Float32Array([-1, -0.5]));
    const leftMax = await putStatPayload(store, 0, 'max', new Float32Array([0.75, 1]));
    const leftRms = await putStatPayload(store, 0, 'rms', new Float32Array([0.25, 0.5]));
    const leftPeak = await putStatPayload(store, 0, 'peak', new Float32Array([1, 1]));
    const rightMin = await putStatPayload(store, 1, 'min', new Float32Array([-0.25, -0.125]));
    const rightMax = await putStatPayload(store, 1, 'max', new Float32Array([0.25, 0.5]));
    const rightRms = await putStatPayload(store, 1, 'rms', new Float32Array([0.1, 0.2]));
    const rightPeak = await putStatPayload(store, 1, 'peak', new Float32Array([0.25, 0.5]));

    const channels: WaveformChannelPayloadRefs[] = [
      { channelIndex: 0, min: leftMin, max: leftMax, rms: leftRms, peak: leftPeak },
      { channelIndex: 1, min: rightMin, max: rightMax, rms: rightRms, peak: rightPeak },
    ];
    const waveformManifest = createWaveformPyramidManifest({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source',
      sampleRate: 48_000,
      channelLayout: CHANNEL_LAYOUT,
      duration: 1,
      levels: [{
        samplesPerBucket: 128,
        bucketDuration: 128 / 48_000,
        bucketCount: 2,
        channels,
      }],
    });

    const id = createAudioArtifactId('waveform-pyramid', 'media-a', 'sha256:source');
    const result = await store.putAnalysisArtifact({
      id,
      kind: 'waveform-pyramid',
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source',
      decoderId: 'test-decoder',
      decoderVersion: '1.0.0',
      analyzerVersion: 'waveform-test',
      sampleRate: 48_000,
      channelLayout: CHANNEL_LAYOUT,
      duration: 1,
      payloadRefs: channels.flatMap((channel) => [channel.min, channel.max, channel.rms, channel.peak]),
      createdAt: CREATED_AT_MS,
      stale: false,
      metadata: { waveformManifest },
    });

    expect(result.deduplicated).toBe(false);
    expect(result.artifact).toMatchObject({
      schemaVersion: AUDIO_ARTIFACT_SCHEMA_VERSION,
      id,
      kind: 'waveform-pyramid',
      manifestRef: {
        mimeType: 'application/vnd.masterselects.audio-analysis+json',
        encoding: 'json',
      },
    });
    expect(result.artifact.payloadRefs).toHaveLength(8);

    const restored = await store.getAnalysisArtifact(result.artifact.manifestRef.artifactId);
    expect(restored?.id).toBe(id);
    expect(restored?.metadata?.waveformManifest).toMatchObject({
      mediaFileId: 'media-a',
      levels: [{ samplesPerBucket: 128, bucketCount: 2 }],
    });

    const listed = await store.listAnalysisArtifacts('media-a', 'waveform-pyramid');
    expect(listed.map((artifact) => artifact.id)).toEqual([id]);
  });

  it('round-trips typed waveform stat payloads', async () => {
    const values = new Float32Array([-1, -0.5, 0.25]);
    const encoded = encodeWaveformStatPayload({
      header: {
        schemaVersion: 1,
        statistic: 'min',
        samplesPerBucket: 512,
        channelIndex: 0,
        bucketCount: values.length,
      },
      values,
    });

    const decoded = decodeWaveformStatPayload(encoded);
    expect(decoded.header).toMatchObject({
      statistic: 'min',
      samplesPerBucket: 512,
      channelIndex: 0,
      bucketCount: 3,
    });
    expect([...decoded.values]).toEqual([...values]);
  });

  it('selects waveform pyramid LOD by pixels per second', () => {
    const ref = {
      artifactId: 'artifact:sha256:test',
      hash: 'test',
      size: 1,
      mimeType: 'application/octet-stream',
      encoding: 'raw' as const,
      storage: { kind: 'memory' as const },
      createdAt: FIXED_TIME,
    };
    const channel = { channelIndex: 0, min: ref, max: ref, rms: ref, peak: ref };
    const manifest = createWaveformPyramidManifest({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source',
      sampleRate: 48_000,
      channelLayout: { kind: 'mono', channelCount: 1 },
      duration: 10,
      levels: [128, 512, 2048, 8192].map((samplesPerBucket) => ({
        samplesPerBucket,
        bucketDuration: samplesPerBucket / 48_000,
        bucketCount: 10,
        channels: [channel],
      })),
    });

    expect(selectWaveformPyramidLevel(manifest, 400).samplesPerBucket).toBe(128);
    expect(selectWaveformPyramidLevel(manifest, 40).samplesPerBucket).toBe(2048);
  });

  it('can read stored payload bytes by ref', async () => {
    const store = createStore();
    const ref = await store.putPayload(new Uint8Array([1, 2, 3]).buffer, {
      mediaFileId: 'media-a',
      kind: 'waveform-pyramid',
      sourceFingerprint: 'sha256:source',
    });

    const payload = await store.getPayload(ref.artifactId);
    expect(payload ? [...new Uint8Array(await blobToArrayBuffer(payload))] : []).toEqual([1, 2, 3]);
  });
});
