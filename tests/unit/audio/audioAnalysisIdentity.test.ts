import { describe, expect, it } from 'vitest';
import type { AudioAnalysisCacheKeyInput } from '../../../src/services/audio/audioAnalysisManifestKeys';
import type { ClipAudioStemState, SpectralImageLayer } from '../../../src/types/audio';
import {
  createAudioAnalysisManifestRef,
  createAudioAnalysisRefsManifest,
} from '../../../src/services/audio/audioAnalysisManifestKeys';
import {
  canonicalizeAudioAnalysisIdentity,
  createClipAudioStateHash,
  createProcessedWaveformAnalysisInput,
  getProcessedWaveformRefFreshnessForAudioState,
  isProcessedWaveformRefStaleForAudioState,
} from '../../../src/services/audio/audioAnalysisIdentity';
import { normalizeAudioEqParams } from '../../../src/engine/audio/eq/AudioEqLegacy';

const BASE_ANALYSIS_INPUT: Omit<AudioAnalysisCacheKeyInput, 'kind' | 'clipAudioStateHash'> = {
  mediaFileId: 'media-a',
  sourceFingerprint: 'sha256:source-a',
  analyzerVersion: 'processed-waveform@1.0.0',
  channelLayout: { kind: 'stereo', channelCount: 2, labels: ['L', 'R'] },
  sampleRate: 48_000,
  duration: 10,
};

const BASE_CLIP_STATE = {
  inPoint: 1,
  outPoint: 7,
  duration: 6,
  speed: 1,
  reversed: false,
  preservesPitch: true,
  trackGraphIdentity: 'track-graph:v1:eq',
  masterGraphIdentity: 'master-graph:v1:limiter',
  audioState: {
    sourceAudioRevisionId: 'rev-1',
    muted: false,
    soloSafe: true,
    editStack: [
      {
        id: 'edit-trim',
        type: 'trim' as const,
        enabled: true,
        params: { end: 7, start: 1 },
        timeRange: { start: 1, end: 7 },
        channelMask: [0, 1],
        createdAt: 111,
      },
    ],
    effectStack: [
      {
        id: 'effect-eq',
        descriptorId: 'audio-eq',
        enabled: true,
        params: { band31: 1, band1k: -3 },
        automationMode: 'clip' as const,
      },
    ],
    spectralLayers: [
      {
        id: 'spectral-1',
        imageMediaFileId: 'image-a',
        timeStart: 0.5,
        duration: 2,
        frequencyMin: 200,
        frequencyMax: 2_000,
        opacity: 0.8,
        blendMode: 'attenuate' as const,
        gainDb: -4,
        featherTime: 0.1,
        featherFrequency: 20,
      },
    ],
  },
};

const BASE_STEM_STATE: ClipAudioStemState = {
  activeSetId: 'stem-set-a',
  modelId: 'demucs-htdemucs-web',
  modelVersion: 'test-v1',
  createdAt: 1_770_000_000_000,
  sourceFingerprint: 'sha256:source-a',
  range: { start: 0, end: 6 },
  sampleRate: 48_000,
  channelCount: 2,
  mixMode: 'stems',
  stems: [
    {
      id: 'stem-vocals',
      kind: 'vocals',
      label: 'Vocals',
      analysisArtifactId: 'analysis-vocals',
      manifestArtifactId: 'manifest-vocals',
      payloadRef: {
        artifactId: 'payload-vocals',
        hash: 'sha256:vocals',
        size: 1024,
        mimeType: 'audio/vnd.masterselects.pcm-f32',
        encoding: 'raw',
      },
      enabled: true,
      gainDb: 0,
      phaseAligned: true,
      modelId: 'demucs-htdemucs-web',
      sourceFingerprint: 'sha256:source-a',
    },
    {
      id: 'stem-drums',
      kind: 'drums',
      label: 'Drums',
      analysisArtifactId: 'analysis-drums',
      manifestArtifactId: 'manifest-drums',
      payloadRef: {
        artifactId: 'payload-drums',
        hash: 'sha256:drums',
        size: 1024,
        mimeType: 'audio/vnd.masterselects.pcm-f32',
        encoding: 'raw',
      },
      enabled: true,
      gainDb: 0,
      phaseAligned: true,
      modelId: 'demucs-htdemucs-web',
      sourceFingerprint: 'sha256:source-a',
    },
  ],
};

describe('audio analysis identity', () => {
  it('creates stable audio-state ids under object key order changes', () => {
    const first = createClipAudioStateHash(BASE_CLIP_STATE);
    const second = createClipAudioStateHash({
      ...BASE_CLIP_STATE,
      audioState: {
        ...BASE_CLIP_STATE.audioState,
        effectStack: [
          {
            descriptorId: 'audio-eq',
            automationMode: 'clip',
            params: { band1k: -3, band31: 1 },
            enabled: true,
            id: 'effect-eq',
          },
        ],
      },
    });

    expect(first).toMatch(/^audio-state:v1:[0-9a-f]{16}:\d+$/);
    expect(second).toBe(first);
  });

  it('changes when effect params or timeline playback fields change', () => {
    const baseline = createClipAudioStateHash(BASE_CLIP_STATE);
    const eq = normalizeAudioEqParams(BASE_CLIP_STATE.audioState.effectStack[0].params);

    expect(createClipAudioStateHash({
      ...BASE_CLIP_STATE,
      audioState: {
        ...BASE_CLIP_STATE.audioState,
        effectStack: [{
          ...BASE_CLIP_STATE.audioState.effectStack[0],
          params: { band31: 1, band1k: -2 },
        }],
      },
    })).not.toBe(baseline);

    expect(createClipAudioStateHash({
      ...BASE_CLIP_STATE,
      audioState: {
        ...BASE_CLIP_STATE.audioState,
        effectStack: [{
          ...BASE_CLIP_STATE.audioState.effectStack[0],
          params: {
            eq: {
              ...eq,
              audible: {
                ...eq.audible,
                bands: eq.audible.bands.map(band => band.id === 'band1k'
                  ? {
                      ...band,
                      spectralDynamics: {
                        enabled: true,
                        mode: 'compress' as const,
                        thresholdDb: -36,
                        rangeDb: 8,
                        ratio: 4,
                        attackMs: 4,
                        releaseMs: 120,
                        resolution: 'balanced' as const,
                      },
                    }
                  : band),
              },
            },
          },
        }],
      },
    })).not.toBe(baseline);

    expect(createClipAudioStateHash({ ...BASE_CLIP_STATE, speed: 0.5 })).not.toBe(baseline);
    expect(createClipAudioStateHash({ ...BASE_CLIP_STATE, reversed: true })).not.toBe(baseline);
    expect(createClipAudioStateHash({ ...BASE_CLIP_STATE, inPoint: 2 })).not.toBe(baseline);
    expect(createClipAudioStateHash({ ...BASE_CLIP_STATE, outPoint: 8 })).not.toBe(baseline);
  });

  it('does not change processed identity for audio-eq display-only state', () => {
    const baseline = createClipAudioStateHash(BASE_CLIP_STATE);
    const eq = normalizeAudioEqParams(BASE_CLIP_STATE.audioState.effectStack[0].params);

    expect(createClipAudioStateHash({
      ...BASE_CLIP_STATE,
      audioState: {
        ...BASE_CLIP_STATE.audioState,
        effectStack: [{
          ...BASE_CLIP_STATE.audioState.effectStack[0],
          params: {
            eq: {
              ...eq,
              display: {
                ...eq.display,
                analyzerMode: 'pre-post',
                analyzerRangeDb: 30,
                graphRangeDb: 30,
                selectedBandIds: ['band1k'],
              },
            },
          },
        }],
      },
    })).toBe(baseline);
  });

  it('ignores disabled operations while keeping enabled invalidators', () => {
    const baseline = createClipAudioStateHash(BASE_CLIP_STATE);

    expect(createClipAudioStateHash({
      ...BASE_CLIP_STATE,
      audioState: {
        ...BASE_CLIP_STATE.audioState,
        editStack: [
          ...BASE_CLIP_STATE.audioState.editStack,
          {
            id: 'disabled-cut',
            type: 'cut',
            enabled: false,
            params: { start: 2, end: 3 },
            timeRange: { start: 2, end: 3 },
            createdAt: 222,
          },
        ],
        effectStack: [
          ...BASE_CLIP_STATE.audioState.effectStack,
          {
            id: 'disabled-compressor',
            descriptorId: 'audio-compressor',
            enabled: false,
            params: { thresholdDb: -18 },
          },
        ],
        spectralLayers: [
          ...BASE_CLIP_STATE.audioState.spectralLayers,
          {
            id: 'disabled-spectral',
            enabled: false,
            imageMediaFileId: 'image-disabled',
            timeStart: 0,
            duration: 4,
            frequencyMin: 100,
            frequencyMax: 800,
            opacity: 1,
            blendMode: 'replace',
            gainDb: 3,
            featherTime: 0,
            featherFrequency: 0,
          } as SpectralImageLayer & { enabled: false },
        ],
      },
    })).toBe(baseline);

    expect(createClipAudioStateHash({
      ...BASE_CLIP_STATE,
      audioState: { ...BASE_CLIP_STATE.audioState, muted: true },
    })).not.toBe(baseline);
  });

  it('includes audible stem separation state in processed identity', () => {
    const withStems = {
      ...BASE_CLIP_STATE,
      audioState: {
        ...BASE_CLIP_STATE.audioState,
        stemSeparation: BASE_STEM_STATE,
      },
    };
    const baseline = createClipAudioStateHash(withStems);

    expect(createClipAudioStateHash({
      ...withStems,
      audioState: {
        ...withStems.audioState,
        stemSeparation: {
          ...BASE_STEM_STATE,
          soloStemId: 'stem-vocals',
        },
      },
    })).not.toBe(baseline);

    expect(createClipAudioStateHash({
      ...withStems,
      audioState: {
        ...withStems.audioState,
        stemSeparation: {
          ...BASE_STEM_STATE,
          stems: BASE_STEM_STATE.stems.map(stem => stem.id === 'stem-drums'
            ? { ...stem, gainDb: -6, enabled: false }
            : stem),
        },
      },
    })).not.toBe(baseline);

    expect(createClipAudioStateHash({
      ...withStems,
      audioState: {
        ...withStems.audioState,
        stemSeparation: {
          ...BASE_STEM_STATE,
          stems: BASE_STEM_STATE.stems.map(stem => stem.id === 'stem-vocals'
            ? {
                ...stem,
                payloadRef: {
                  ...stem.payloadRef,
                  artifactId: 'payload-vocals-new',
                  hash: 'sha256:vocals-new',
                },
              }
            : stem),
        },
      },
    })).not.toBe(baseline);

    expect(createClipAudioStateHash({
      ...withStems,
      audioState: {
        ...withStems.audioState,
        stemSeparation: {
          ...BASE_STEM_STATE,
          mixMode: 'original',
        },
      },
    })).not.toBe(baseline);
  });

  it('never includes raw payload-like fields in the canonical identity', () => {
    const canonical = canonicalizeAudioAnalysisIdentity({
      ...BASE_CLIP_STATE,
      audioState: {
        ...BASE_CLIP_STATE.audioState,
        effectStack: [{
          ...BASE_CLIP_STATE.audioState.effectStack[0],
          params: {
            band31: 1,
            band1k: -3,
            waveform: [0.1, 0.2, 0.3],
            rawBuffer: [1, 2, 3],
            sourceFile: 'large.wav',
          },
        }],
      },
    });

    expect(canonical).toContain('effect-eq');
    expect(canonical).not.toContain('waveform');
    expect(canonical).not.toContain('rawBuffer');
    expect(canonical).not.toContain('sourceFile');
    expect(createClipAudioStateHash({
      ...BASE_CLIP_STATE,
      audioState: {
        ...BASE_CLIP_STATE.audioState,
        effectStack: [{
          ...BASE_CLIP_STATE.audioState.effectStack[0],
          params: {
            band31: 1,
            band1k: -3,
            waveform: [9, 9, 9],
            rawBuffer: [9, 9, 9],
          },
        }],
      },
    })).toBe(createClipAudioStateHash(BASE_CLIP_STATE));
  });

  it('computes processed waveform cache inputs and detects stale refs when the hash changes', () => {
    const processedInput = createProcessedWaveformAnalysisInput({
      ...BASE_ANALYSIS_INPUT,
      clipAudioState: BASE_CLIP_STATE,
    });
    const ref = createAudioAnalysisManifestRef({
      ...processedInput,
      artifactId: 'audio:processed-waveform:media-a:clip-a',
    });
    const refs = createAudioAnalysisRefsManifest([ref]);

    expect(processedInput.kind).toBe('processed-waveform-pyramid');
    expect(processedInput.clipAudioStateHash).toBe(createClipAudioStateHash(BASE_CLIP_STATE));
    expect(getProcessedWaveformRefFreshnessForAudioState(refs, {
      ...BASE_ANALYSIS_INPUT,
      clipAudioState: BASE_CLIP_STATE,
    })).toMatchObject({
      stale: false,
      reason: 'fresh',
      artifactId: 'audio:processed-waveform:media-a:clip-a',
    });
    expect(isProcessedWaveformRefStaleForAudioState(refs, {
      ...BASE_ANALYSIS_INPUT,
      clipAudioState: { ...BASE_CLIP_STATE, speed: 2 },
    })).toBe(true);
  });
});
