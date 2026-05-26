import { describe, expect, it } from 'vitest';
import type {
  AudioAnalysisArtifact,
  AudioArtifactRef,
  AudioChannelLayout,
} from '../../../src/services/audio/audioArtifactTypes';
import {
  AUDIO_ANALYSIS_REF_MANIFEST_VERSION,
  createAudioAnalysisCacheKey,
  createAudioAnalysisManifestRef,
  createAudioAnalysisManifestRefFromArtifact,
  createAudioAnalysisRefsManifest,
  createAudioAnalysisStaleKey,
  getAudioAnalysisRefFreshness,
  isAudioAnalysisArtifactStaleForInput,
  type AudioAnalysisCacheKeyInput,
} from '../../../src/services/audio/audioAnalysisManifestKeys';
import { createLoudnessEnvelopeManifest } from '../../../src/services/audio/loudnessEnvelopeManifest';
import { createSpectrogramTileSetManifest } from '../../../src/services/audio/spectrogramTileManifest';

const CHANNEL_LAYOUT: AudioChannelLayout = {
  kind: 'stereo',
  channelCount: 2,
  labels: ['L', 'R'],
};

const BASE_INPUT: AudioAnalysisCacheKeyInput = {
  mediaFileId: 'media-a',
  sourceFingerprint: 'sha256:source-a',
  kind: 'waveform-pyramid',
  analyzerVersion: 'waveform@2.0.0',
  channelLayout: CHANNEL_LAYOUT,
  sampleRate: 48_000,
  duration: 12.5,
};

const REF: AudioArtifactRef = {
  artifactId: 'artifact:payload',
  hash: 'sha256:payload',
  size: 128,
  mimeType: 'application/octet-stream',
  encoding: 'raw',
  storage: { kind: 'memory' },
  createdAt: '2026-05-25T10:00:00.000Z',
};

function createArtifact(
  overrides: Partial<AudioAnalysisArtifact> = {},
): AudioAnalysisArtifact {
  return {
    schemaVersion: 1,
    id: 'audio:waveform:media-a',
    kind: 'waveform-pyramid',
    mediaFileId: BASE_INPUT.mediaFileId,
    sourceFingerprint: BASE_INPUT.sourceFingerprint,
    decoderId: 'test-decoder',
    decoderVersion: '1.0.0',
    analyzerVersion: BASE_INPUT.analyzerVersion,
    sampleRate: BASE_INPUT.sampleRate,
    channelLayout: BASE_INPUT.channelLayout,
    duration: BASE_INPUT.duration,
    payloadRefs: [REF],
    manifestRef: {
      ...REF,
      artifactId: 'artifact:manifest',
      hash: 'sha256:manifest',
      encoding: 'json',
      mimeType: 'application/vnd.masterselects.audio-analysis+json',
    },
    createdAt: Date.parse('2026-05-25T10:00:00.000Z'),
    stale: false,
    ...overrides,
  };
}

describe('audio analysis manifest keys', () => {
  it('creates deterministic cache and stale keys from every invalidation field', () => {
    const key = createAudioAnalysisCacheKey(BASE_INPUT);

    expect(createAudioAnalysisCacheKey({ ...BASE_INPUT })).toBe(key);
    expect(createAudioAnalysisStaleKey(BASE_INPUT)).toBe(key);
    expect(key).toContain('audio-analysis:v1:waveform-pyramid');
    expect(key).toContain('media=media-a');
    expect(key).toContain('source=sha256%3Asource-a');
    expect(key).toContain('analyzer=waveform%402.0.0');
    expect(key).toContain('sampleRate=48000');
    expect(key).toContain('duration=12.5');
    expect(key).toContain('clip=source');

    const variants: AudioAnalysisCacheKeyInput[] = [
      { ...BASE_INPUT, mediaFileId: 'media-b' },
      { ...BASE_INPUT, sourceFingerprint: 'sha256:source-b' },
      { ...BASE_INPUT, kind: 'spectrogram-tiles' },
      { ...BASE_INPUT, analyzerVersion: 'waveform@2.0.1' },
      { ...BASE_INPUT, channelLayout: { kind: 'mono', channelCount: 1, labels: ['M'] } },
      { ...BASE_INPUT, sampleRate: 44_100 },
      { ...BASE_INPUT, duration: 13 },
      { ...BASE_INPUT, clipAudioStateHash: 'clip:state-a' },
    ];

    expect(variants.map((variant) => createAudioAnalysisCacheKey(variant))).not.toContain(key);
  });

  it('detects fresh and stale versioned refs', () => {
    const ref = createAudioAnalysisManifestRef({
      ...BASE_INPUT,
      kind: 'waveform-pyramid',
      artifactId: 'audio:waveform:media-a',
    });
    const refs = createAudioAnalysisRefsManifest([ref]);

    expect(refs.schemaVersion).toBe(AUDIO_ANALYSIS_REF_MANIFEST_VERSION);
    expect(getAudioAnalysisRefFreshness(refs, BASE_INPUT)).toMatchObject({
      stale: false,
      reason: 'fresh',
      artifactId: 'audio:waveform:media-a',
    });

    expect(getAudioAnalysisRefFreshness(refs, {
      ...BASE_INPUT,
      sourceFingerprint: 'sha256:new-source',
    })).toMatchObject({
      stale: true,
      reason: 'stale-key-mismatch',
      artifactId: 'audio:waveform:media-a',
    });
  });

  it('treats legacy or missing refs as stale without dropping their artifact ids', () => {
    expect(getAudioAnalysisRefFreshness(undefined, BASE_INPUT)).toMatchObject({
      stale: true,
      reason: 'missing-ref',
    });
    expect(getAudioAnalysisRefFreshness({}, BASE_INPUT)).toMatchObject({
      stale: true,
      reason: 'missing-ref',
    });
    expect(getAudioAnalysisRefFreshness({ waveformPyramidId: 'legacy-waveform-id' }, BASE_INPUT))
      .toMatchObject({
        stale: true,
        reason: 'missing-stale-key',
        artifactId: 'legacy-waveform-id',
      });
    expect(getAudioAnalysisRefFreshness(
      { spectrogramTileSetIds: ['legacy-spectrogram-id'] },
      { ...BASE_INPUT, kind: 'spectrogram-tiles' },
    )).toMatchObject({
      stale: true,
      reason: 'missing-stale-key',
      artifactId: 'legacy-spectrogram-id',
    });
  });

  it('detects stale artifacts from manifest identity and explicit stale flags', () => {
    const artifact = createArtifact();

    expect(isAudioAnalysisArtifactStaleForInput(artifact, BASE_INPUT)).toBe(false);
    expect(isAudioAnalysisArtifactStaleForInput({
      ...artifact,
      analyzerVersion: 'waveform@3.0.0',
    }, BASE_INPUT)).toBe(true);
    expect(isAudioAnalysisArtifactStaleForInput({
      ...artifact,
      stale: true,
    }, BASE_INPUT)).toBe(true);
  });

  it('serializes compact analysis refs without payload refs or large analysis bytes', () => {
    const artifact = createArtifact({
      id: 'audio:waveform:media-a:source',
      payloadRefs: [
        { ...REF, artifactId: 'artifact:large-waveform-payload' },
        { ...REF, artifactId: 'artifact:large-waveform-rms-payload' },
      ],
      metadata: {
        waveformPreview: [0.1, 0.2, 0.3],
      },
    });

    const refs = createAudioAnalysisRefsManifest([
      createAudioAnalysisManifestRefFromArtifact(artifact),
    ]);
    const serialized = JSON.stringify(refs);

    expect(serialized).toContain('audio:waveform:media-a:source');
    expect(serialized).toContain('cacheKey');
    expect(serialized).not.toContain('artifact:large-waveform-payload');
    expect(serialized).not.toContain('artifact:large-waveform-rms-payload');
    expect(serialized).not.toContain('waveformPreview');
  });

  it('creates versioned spectrogram and loudness manifests that reference payload artifacts', () => {
    const spectrogramManifest = createSpectrogramTileSetManifest({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      sampleRate: 48_000,
      channelLayout: CHANNEL_LAYOUT,
      duration: 12.5,
      fftSize: 2048,
      hopSize: 512,
      window: 'hann',
      frequencyScale: 'linear',
      minDb: -90,
      maxDb: 0,
      tileWidthFrames: 256,
      tileHeightBins: 512,
      tiles: [
        {
          tileIndex: 1,
          channelIndex: 1,
          frameStart: 256,
          frameCount: 128,
          frequencyBinStart: 0,
          frequencyBinCount: 512,
          payloadRef: { ...REF, artifactId: 'artifact:spectrogram-1' },
        },
        {
          tileIndex: 0,
          channelIndex: 0,
          frameStart: 0,
          frameCount: 256,
          frequencyBinStart: 0,
          frequencyBinCount: 512,
          payloadRef: { ...REF, artifactId: 'artifact:spectrogram-0' },
        },
      ],
    });
    const loudnessManifest = createLoudnessEnvelopeManifest({
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      sampleRate: 48_000,
      channelLayout: CHANNEL_LAYOUT,
      duration: 12.5,
      curves: [{
        metric: 'momentary-lufs',
        windowDuration: 0.4,
        hopDuration: 0.1,
        pointCount: 125,
        payloadRef: { ...REF, artifactId: 'artifact:loudness-momentary' },
      }],
      summary: { integratedLufs: -18, truePeakDbtp: -1 },
    });

    expect(spectrogramManifest).toMatchObject({
      schemaVersion: 1,
      fftSize: 2048,
      tiles: [
        { tileIndex: 0, payloadRef: { artifactId: 'artifact:spectrogram-0' } },
        { tileIndex: 1, payloadRef: { artifactId: 'artifact:spectrogram-1' } },
      ],
    });
    expect(loudnessManifest).toMatchObject({
      schemaVersion: 1,
      curves: [{ metric: 'momentary-lufs', payloadRef: { artifactId: 'artifact:loudness-momentary' } }],
      summary: { integratedLufs: -18, truePeakDbtp: -1 },
    });
  });
});
