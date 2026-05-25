import { describe, expect, it } from 'vitest';
import {
  createAudioGraphKey,
  renderAudioGraph,
} from '../../../src/engine/audio/AudioGraphRenderer';
import type {
  AudioEffectInstance,
  ClipAudioState,
  Effect,
  MasterAudioState,
  MediaFileAudioAnalysisRefs,
  TimelineClip,
  TimelineTrack,
  TrackAudioState,
} from '../../../src/types';
import { createMockClip, createMockTrack } from '../../helpers/mockData';

type EffectInput = AudioEffectInstance & {
  bypassed?: boolean;
  disabled?: boolean;
};

type PayloadProbe = {
  rawSamples?: Float32Array | number[];
  payloadBytes?: Uint8Array;
  renderedBuffer?: number[];
  sampleData?: number[];
  audioBuffer?: Float32Array | number[];
  rawBytes?: Uint8Array;
};

function effect(overrides: Partial<EffectInput> = {}): EffectInput {
  return {
    id: overrides.id ?? 'fx-volume',
    descriptorId: overrides.descriptorId ?? 'audio-volume',
    enabled: overrides.enabled ?? true,
    params: overrides.params ?? { volume: 1 },
    ...overrides,
  };
}

function legacyEffect(overrides: Partial<Effect> = {}): Effect {
  return {
    id: overrides.id ?? 'legacy-volume',
    name: overrides.name ?? 'Legacy Volume',
    type: overrides.type ?? 'audio-volume',
    enabled: overrides.enabled ?? true,
    params: overrides.params ?? { volume: 0.5 },
  };
}

function audioTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return createMockTrack({
    id: overrides.id ?? 'track-a',
    name: overrides.name ?? 'Audio Track',
    type: 'audio',
    ...overrides,
  });
}

function audioClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: overrides.id ?? 'clip-a',
    trackId: overrides.trackId ?? 'track-a',
    source: {
      type: 'audio',
      mediaFileId: overrides.mediaFileId ?? 'media-a',
    } as TimelineClip['source'],
    mediaFileId: overrides.mediaFileId ?? 'media-a',
    ...overrides,
  });
}

describe('AudioGraphRenderer', () => {
  it('computes deterministic graph keys from normalized JSON-safe state', () => {
    const tracks = [audioTrack()];
    const clipA = audioClip({
      audioState: {
        effectStack: [
          effect({
            id: 'clip-eq',
            descriptorId: 'audio-eq',
            params: { band1k: 3, band31: -1 },
          }),
        ],
      },
    });
    const clipB = audioClip({
      audioState: {
        effectStack: [
          effect({
            id: 'clip-eq',
            descriptorId: 'audio-eq',
            params: { band31: -1, band1k: 3 },
          }),
        ],
      },
    });

    const keyA = createAudioGraphKey({ clips: [clipA], tracks });
    const keyB = createAudioGraphKey({ clips: [clipB], tracks });
    const changedKey = createAudioGraphKey({
      clips: [
        audioClip({
          audioState: {
            effectStack: [
              effect({
                id: 'clip-eq',
                descriptorId: 'audio-eq',
                params: { band31: -1, band1k: 4 },
              }),
            ],
          },
        }),
      ],
      tracks,
    });

    expect(keyA).toBe(keyB);
    expect(renderAudioGraph({ clips: [clipA], tracks }).graphKey).toBe(keyA);
    expect(changedKey).not.toBe(keyA);
  });

  it('orders clip, track, and master stages deterministically', () => {
    const tracks = [
      audioTrack({
        id: 'track-a',
        audioState: {
          volumeDb: -3,
          pan: 0,
          muted: false,
          solo: false,
          recordArm: false,
          inputMonitor: false,
          meterMode: 'peak',
          effectStack: [effect({ id: 'track-eq', descriptorId: 'audio-eq' })],
        },
      }),
      audioTrack({ id: 'track-b' }),
    ];
    const clips = [
      audioClip({ id: 'clip-c', trackId: 'track-b', startTime: 0 }),
      audioClip({ id: 'clip-b', trackId: 'track-a', startTime: 2 }),
      audioClip({
        id: 'clip-a',
        trackId: 'track-a',
        startTime: 0,
        audioState: {
          effectStack: [effect({ id: 'clip-volume', descriptorId: 'audio-volume' })],
        },
      }),
    ];
    const masterAudioState: MasterAudioState = {
      volumeDb: -1,
      limiterEnabled: true,
      targetLufs: -14,
      truePeakCeilingDb: -1,
      effectStack: [effect({ id: 'master-volume', descriptorId: 'audio-volume' })],
    };

    const plan = renderAudioGraph({ clips, tracks, masterAudioState });

    expect(plan.renderSequence.map(step => step.nodeId)).toEqual([
      'clip:clip-a',
      'clip:clip-b',
      'clip:clip-c',
      'track:track-a',
      'track:track-b',
      'master:main',
    ]);
    expect(plan.clips.map(clip => clip.clipId)).toEqual(['clip-a', 'clip-b', 'clip-c']);
    expect(plan.tracks.map(track => track.trackId)).toEqual(['track-a', 'track-b']);
    expect(plan.clips[0].effectChain.map(step => step.effectId)).toEqual(['clip-volume']);
    expect(plan.tracks[0].effectChain.map(step => step.effectId)).toEqual(['track-eq']);
    expect(plan.master.effectChain.map(step => step.effectId)).toEqual(['master-volume']);
  });

  it('keeps disabled, bypassed, and invalid effects out of active effect plans', () => {
    const tracks = [audioTrack()];
    const clip = audioClip({
      audioState: {
        effectStack: [
          effect({ id: 'active-volume', descriptorId: 'audio-volume', enabled: true }),
          effect({ id: 'disabled-volume', descriptorId: 'audio-volume', enabled: false }),
          effect({ id: 'bypassed-eq', descriptorId: 'audio-eq', bypassed: true }),
          effect({ id: 'unknown-effect', descriptorId: 'not-registered' }),
        ],
      },
    });

    const plan = renderAudioGraph({ clips: [clip], tracks });

    expect(plan.clips[0].effectChain.map(step => step.effectId)).toEqual(['active-volume']);
    expect(plan.clips[0].skippedEffects).toEqual([
      { effectId: 'disabled-volume', descriptorId: 'audio-volume', order: 1, status: 'disabled' },
      { effectId: 'bypassed-eq', descriptorId: 'audio-eq', order: 2, status: 'bypassed' },
      { effectId: 'unknown-effect', descriptorId: 'not-registered', order: 3, status: 'invalid' },
    ]);
    expect(plan.descriptor.clips[0].effectChain.map(effectDescriptor => effectDescriptor.status)).toEqual([
      'active',
      'disabled',
      'bypassed',
      'invalid',
    ]);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({
      code: 'audio-graph-effect-descriptor-unknown',
      severity: 'error',
      refId: 'clip-a',
    }));
  });

  it('projects legacy clip audio effects into the graph while dropping visual effects', () => {
    const tracks = [audioTrack()];
    const clip = audioClip({
      effects: [
        legacyEffect({
          id: 'legacy-visual',
          name: 'Brightness',
          type: 'brightness',
          params: { amount: 0.2 },
        }),
        legacyEffect({
          id: 'legacy-eq',
          name: 'Legacy EQ',
          type: 'audio-eq',
          enabled: true,
          params: { band1k: 3 },
        }),
        legacyEffect({
          id: 'legacy-volume',
          name: 'Legacy Volume',
          type: 'audio-volume',
          enabled: false,
          params: { volume: 0.25 },
        }),
      ],
    });

    const plan = renderAudioGraph({ clips: [clip], tracks });

    expect(plan.descriptor.clips[0].effectChain.map(effectDescriptor => ({
      id: effectDescriptor.id,
      descriptorId: effectDescriptor.descriptorId,
      status: effectDescriptor.status,
      params: effectDescriptor.params,
    }))).toEqual([
      {
        id: 'legacy-eq',
        descriptorId: 'audio-eq',
        status: 'active',
        params: expect.objectContaining({ band1k: 3 }),
      },
      {
        id: 'legacy-volume',
        descriptorId: 'audio-volume',
        status: 'disabled',
        params: { volume: 0.25 },
      },
    ]);
    expect(plan.clips[0].effectChain.map(step => step.effectId)).toEqual(['legacy-eq']);
    expect(plan.clips[0].skippedEffects).toEqual([
      { effectId: 'legacy-volume', descriptorId: 'audio-volume', order: 1, status: 'disabled' },
    ]);
  });

  it('does not duplicate legacy audio effects already represented in audioState', () => {
    const tracks = [audioTrack()];
    const clip = audioClip({
      effects: [
        legacyEffect({
          id: 'shared-volume',
          type: 'audio-volume',
          params: { volume: 0.25 },
        }),
      ],
      audioState: {
        effectStack: [
          effect({
            id: 'shared-volume',
            descriptorId: 'audio-volume',
            params: { volume: 0.75 },
          }),
        ],
      },
    });

    const plan = renderAudioGraph({ clips: [clip], tracks });

    expect(plan.descriptor.clips[0].effectChain).toHaveLength(1);
    expect(plan.clips[0].effectChain).toEqual([
      expect.objectContaining({
        effectId: 'shared-volume',
        descriptorId: 'audio-volume',
        params: { volume: 0.75 },
      }),
    ]);
  });

  it('normalizes descriptors without carrying large audio payload fields', () => {
    const sourceAnalysisRefs = {
      waveformPyramidId: 'waveform-source',
      spectrogramTileSetIds: ['spectrogram-b', 'spectrogram-a'],
      rawBytes: new Uint8Array([1, 2, 3]),
    } as MediaFileAudioAnalysisRefs & PayloadProbe;
    const clipAudioState = {
      sourceAudioRevisionId: 'rev-1',
      sourceAnalysisRefs,
      effectStack: [
        effect({
          id: 'payload-probe',
          descriptorId: 'audio-volume',
          params: {
            volume: 0.75,
            rawSamples: [0.1, 0.2, 0.3],
            audioBuffer: [0, 1, 2],
          } as unknown as AudioEffectInstance['params'],
        }),
      ],
      rawSamples: new Float32Array([0.1, 0.2]),
      payloadBytes: new Uint8Array([4, 5, 6]),
    } as ClipAudioState & PayloadProbe;
    const trackAudioState = {
      volumeDb: -6,
      pan: 0.25,
      muted: false,
      solo: false,
      recordArm: false,
      inputMonitor: false,
      meterMode: 'peak',
      effectStack: [
        effect({
          id: 'track-payload-probe',
          descriptorId: 'audio-eq',
          params: {
            band31: 1,
            sampleData: [1, 2, 3],
          } as unknown as AudioEffectInstance['params'],
        }),
      ],
      renderedBuffer: [0, 1, 2],
    } as TrackAudioState & PayloadProbe;
    const masterAudioState = {
      volumeDb: 0,
      limiterEnabled: true,
      targetLufs: -16,
      truePeakCeilingDb: -1,
      effectStack: [
        effect({
          id: 'master-payload-probe',
          descriptorId: 'audio-volume',
          params: {
            volume: 1,
            payloadBytes: new Uint8Array([7, 8, 9]),
          } as unknown as AudioEffectInstance['params'],
        }),
      ],
      audioBuffer: new Float32Array([0.4, 0.5]),
    } as MasterAudioState & PayloadProbe;

    const plan = renderAudioGraph({
      clips: [audioClip({ audioState: clipAudioState })],
      tracks: [audioTrack({ audioState: trackAudioState })],
      masterAudioState,
    });
    const serialized = JSON.stringify(plan);

    expect(plan.descriptor.clips[0].source.sourceAnalysisRefs).toEqual({
      waveformPyramidId: 'waveform-source',
      spectrogramTileSetIds: ['spectrogram-a', 'spectrogram-b'],
    });
    expect(plan.clips[0].effectChain[0].params).toEqual({ volume: 0.75 });
    expect(serialized).not.toContain('rawSamples');
    expect(serialized).not.toContain('payloadBytes');
    expect(serialized).not.toContain('renderedBuffer');
    expect(serialized).not.toContain('sampleData');
    expect(serialized).not.toContain('audioBuffer');
    expect(serialized).not.toContain('rawBytes');
  });
});
