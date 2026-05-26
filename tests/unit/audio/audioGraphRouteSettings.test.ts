import { describe, expect, it } from 'vitest';
import {
  createLiveAudioRouteSettings,
  getTrackAudioMuted,
  getTrackAudioSolo,
} from '../../../src/services/audio/audioGraphRouteSettings';
import type { AudioEffectInstance, Effect, TimelineClip, TimelineTrack } from '../../../src/types';
import { createMockClip, createMockTrack } from '../../helpers/mockData';

function audioEffect(overrides: Partial<AudioEffectInstance> = {}): AudioEffectInstance {
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
    params: overrides.params ?? { volume: 1 },
  };
}

function audioTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return createMockTrack({
    id: overrides.id ?? 'track-a',
    type: 'audio',
    muted: false,
    solo: false,
    ...overrides,
  });
}

function audioClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: overrides.id ?? 'clip-a',
    trackId: overrides.trackId ?? 'track-a',
    source: { type: 'audio', mediaFileId: 'media-a' } as TimelineClip['source'],
    ...overrides,
  });
}

describe('audio graph route settings', () => {
  it('prefers advanced track mute and solo state over legacy track flags', () => {
    const track = audioTrack({
      muted: false,
      solo: false,
      audioState: {
        volumeDb: 0,
        pan: 0,
        muted: true,
        solo: true,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
      },
    });

    expect(getTrackAudioMuted(track)).toBe(true);
    expect(getTrackAudioSolo(track)).toBe(true);
  });

  it('combines clip, track, and master route settings for live playback', () => {
    const clip = audioClip({
      audioState: {
        effectStack: [
          audioEffect({
            id: 'clip-volume',
            descriptorId: 'audio-volume',
            params: { volume: 0.5 },
          }),
        ],
      },
    });
    const track = audioTrack({
      audioState: {
        volumeDb: -6,
        pan: 0.75,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
        effectStack: [
          audioEffect({
            id: 'track-eq',
            descriptorId: 'audio-eq',
            params: { band1k: 3 },
          }),
        ],
      },
    });
    const masterEffect = audioEffect({
      id: 'master-eq',
      descriptorId: 'audio-eq',
      params: { band1k: -1, band4k: 2 },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      track,
      masterAudioState: {
        volumeDb: -3,
        limiterEnabled: true,
        truePeakCeilingDb: -1,
        effectStack: [masterEffect],
      },
      interpolatedClipEffects: [
        legacyEffect({
          id: 'legacy-volume',
          params: { volume: 0.8 },
        }),
      ],
    });

    expect(route.volume).toBeCloseTo(0.5 * 0.8 * Math.pow(10, -6 / 20), 5);
    expect(route.master.volume).toBeCloseTo(Math.pow(10, -3 / 20), 5);
    expect(route.pan).toBe(0.75);
    expect(route.muted).toBe(false);
    expect(route.eqGains[5]).toBe(3);
    expect(route.master.eqGains[5]).toBe(-1);
    expect(route.master.eqGains[7]).toBe(2);
  });

  it('keeps live track gain independent from the master fader', () => {
    const clip = audioClip();
    const track = audioTrack({
      audioState: {
        volumeDb: -6,
        pan: 0,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
      },
    });

    const routeAtUnity = createLiveAudioRouteSettings({
      clip,
      track,
      masterAudioState: {
        volumeDb: 0,
        limiterEnabled: false,
        truePeakCeilingDb: -1,
      },
      interpolatedClipEffects: [],
    });
    const routeWithMasterPulledDown = createLiveAudioRouteSettings({
      clip,
      track,
      masterAudioState: {
        volumeDb: -18,
        limiterEnabled: false,
        truePeakCeilingDb: -1,
      },
      interpolatedClipEffects: [],
    });

    expect(routeWithMasterPulledDown.volume).toBeCloseTo(routeAtUnity.volume, 5);
    expect(routeWithMasterPulledDown.master.volume).toBeCloseTo(Math.pow(10, -18 / 20), 5);
  });

  it('projects flexible audio-eq bands into live biquad processors without duplicating legacy bands', () => {
    const clip = audioClip({
      audioState: {
        effectStack: [
          audioEffect({
            id: 'clip-flex-eq',
            descriptorId: 'audio-eq',
            params: {
              eq: {
                schemaVersion: 2,
                audible: {
                  presetKind: 'custom',
                  phaseMode: 'zero-latency',
                  characterMode: 'clean',
                  bands: [
                    {
                      id: 'band1k',
                      enabled: true,
                      type: 'bell',
                      frequencyHz: 1000,
                      gainDb: 2,
                      q: 1.4,
                      stereoMode: 'stereo',
                    },
                    {
                      id: 'presence',
                      enabled: true,
                      type: 'bell',
                      frequencyHz: 3200,
                      gainDb: -4,
                      q: 2,
                      stereoMode: 'stereo',
                    },
                    {
                      id: 'air',
                      enabled: true,
                      type: 'high-shelf',
                      frequencyHz: 12000,
                      gainDb: 3,
                      q: 0.8,
                      stereoMode: 'stereo',
                    },
                    {
                      id: 'rumble',
                      enabled: true,
                      type: 'low-cut',
                      frequencyHz: 35,
                      gainDb: 0,
                      q: 0.707,
                      stereoMode: 'stereo',
                    },
                    {
                      id: 'side-only',
                      enabled: true,
                      type: 'bell',
                      frequencyHz: 600,
                      gainDb: 6,
                      q: 1.2,
                      stereoMode: 'side',
                    },
                  ],
                },
                display: {
                  analyzerMode: 'off',
                  analyzerRangeDb: 12,
                  pianoDisplay: false,
                  graphRangeDb: 12,
                  selectedBandIds: [],
                },
              },
            },
          }),
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      interpolatedClipEffects: [],
    });

    expect(route.eqGains[5]).toBe(2);
    expect(route.processors).toEqual([
      {
        id: 'clip-flex-eq:band:presence',
        type: 'biquad-filter',
        filterType: 'peaking',
        frequencyHz: 3200,
        gainDb: -4,
        q: 2,
      },
      {
        id: 'clip-flex-eq:band:air',
        type: 'biquad-filter',
        filterType: 'highshelf',
        frequencyHz: 12000,
        gainDb: 3,
        q: 0.8,
      },
      {
        id: 'clip-flex-eq:band:rumble',
        type: 'biquad-filter',
        filterType: 'highpass',
        frequencyHz: 35,
        gainDb: 0,
        q: 0.707,
      },
    ]);
  });

  it('routes dynamic EQ bands through the sample-accurate dynamic processor', () => {
    const clip = audioClip({
      audioState: {
        effectStack: [
          audioEffect({
            id: 'clip-dynamic-eq',
            descriptorId: 'audio-eq',
            params: {
              eq: {
                schemaVersion: 2,
                audible: {
                  presetKind: 'custom',
                  phaseMode: 'zero-latency',
                  characterMode: 'clean',
                  bands: [
                    {
                      id: 'harsh-node',
                      enabled: true,
                      type: 'bell',
                      frequencyHz: 3200,
                      gainDb: -2,
                      q: 5,
                      stereoMode: 'stereo',
                      dynamic: {
                        enabled: true,
                        mode: 'compress',
                        thresholdDb: -28,
                        rangeDb: 6,
                        ratio: 3,
                        attackMs: 4,
                        releaseMs: 90,
                        sidechainMode: 'self',
                      },
                    },
                  ],
                },
                display: {
                  analyzerMode: 'off',
                  analyzerRangeDb: 12,
                  pianoDisplay: false,
                  graphRangeDb: 12,
                  selectedBandIds: [],
                },
              },
            },
          }),
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      interpolatedClipEffects: [],
    });

    expect(route.eqGains.every(gain => gain === 0)).toBe(true);
    expect(route.processors).toEqual([
      expect.objectContaining({
        id: 'clip-dynamic-eq:band:harsh-node',
        type: 'dynamic-eq-band',
        band: expect.objectContaining({
          id: 'harsh-node',
          dynamic: expect.objectContaining({ enabled: true, rangeDb: 6 }),
        }),
      }),
    ]);
  });

  it('uses display soloBandIds as live-only EQ band audition', () => {
    const clip = audioClip({
      audioState: {
        effectStack: [
          audioEffect({
            id: 'clip-solo-eq',
            descriptorId: 'audio-eq',
            params: {
              eq: {
                schemaVersion: 2,
                audible: {
                  presetKind: 'custom',
                  phaseMode: 'zero-latency',
                  characterMode: 'clean',
                  bands: [
                    {
                      id: 'band1k',
                      enabled: true,
                      type: 'bell',
                      frequencyHz: 1000,
                      gainDb: 6,
                      q: 1.4,
                      stereoMode: 'stereo',
                    },
                    {
                      id: 'presence',
                      enabled: true,
                      type: 'bell',
                      frequencyHz: 3200,
                      gainDb: -5,
                      q: 3,
                      stereoMode: 'stereo',
                    },
                  ],
                },
                display: {
                  analyzerMode: 'off',
                  analyzerRangeDb: 12,
                  pianoDisplay: false,
                  graphRangeDb: 12,
                  selectedBandIds: ['presence'],
                  soloBandIds: ['presence'],
                },
              },
            },
          }),
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      interpolatedClipEffects: [],
    });

    expect(route.eqGains.every(gain => gain === 0)).toBe(true);
    expect(route.processors).toEqual([
      {
        id: 'clip-solo-eq:band:presence',
        type: 'biquad-filter',
        filterType: 'peaking',
        frequencyHz: 3200,
        gainDb: -5,
        q: 3,
      },
    ]);
  });

  it('projects steep flexible EQ cuts as cascaded live biquad stages', () => {
    const clip = audioClip({
      audioState: {
        effectStack: [
          audioEffect({
            id: 'clip-steep-eq',
            descriptorId: 'audio-eq',
            params: {
              eq: {
                schemaVersion: 2,
                audible: {
                  presetKind: 'custom',
                  phaseMode: 'zero-latency',
                  characterMode: 'clean',
                  bands: [{
                    id: 'brickwall-low',
                    enabled: true,
                    type: 'low-cut',
                    frequencyHz: 45,
                    gainDb: 0,
                    q: 0.707,
                    slopeDbPerOct: 48,
                    stereoMode: 'stereo',
                  }],
                },
                display: {
                  analyzerMode: 'off',
                  analyzerRangeDb: 12,
                  pianoDisplay: false,
                  graphRangeDb: 12,
                  selectedBandIds: [],
                },
              },
            },
          }),
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      interpolatedClipEffects: [],
    });

    expect(route.processors).toHaveLength(4);
    expect(route.processors.map(processor => processor.id)).toEqual([
      'clip-steep-eq:band:brickwall-low:stage-1',
      'clip-steep-eq:band:brickwall-low:stage-2',
      'clip-steep-eq:band:brickwall-low:stage-3',
      'clip-steep-eq:band:brickwall-low:stage-4',
    ]);
  });

  it('adds enabled track sends to the live route as master-return gain', () => {
    const clip = audioClip();
    const track = audioTrack({
      audioState: {
        volumeDb: -6,
        pan: 0,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
        sends: [
          {
            id: 'send-a',
            targetBusId: 'bus-a',
            gainDb: -6,
            preFader: false,
            enabled: true,
          },
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      track,
      interpolatedClipEffects: [],
    });

    const trackGain = Math.pow(10, -6 / 20);
    expect(route.volume).toBeCloseTo(trackGain + (trackGain * trackGain), 5);
  });

  it('keeps pre-fader track sends independent from the track fader in the live route', () => {
    const clip = audioClip();
    const track = audioTrack({
      audioState: {
        volumeDb: -12,
        pan: 0,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
        sends: [
          {
            id: 'send-a',
            targetBusId: 'bus-a',
            gainDb: 0,
            preFader: true,
            enabled: true,
          },
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      track,
      interpolatedClipEffects: [],
    });

    expect(route.volume).toBeCloseTo(Math.pow(10, -12 / 20) + 1, 5);
  });

  it('ignores disabled track sends in the live route', () => {
    const clip = audioClip();
    const track = audioTrack({
      audioState: {
        volumeDb: -6,
        pan: 0,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
        sends: [
          {
            id: 'send-a',
            targetBusId: 'bus-a',
            gainDb: 12,
            preFader: false,
            enabled: false,
          },
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      track,
      interpolatedClipEffects: [],
    });

    expect(route.volume).toBeCloseTo(Math.pow(10, -6 / 20), 5);
  });

  it('projects browser-supported registry processors for live clip, track, and master routing', () => {
    const clip = audioClip({
      audioState: {
        effectStack: [
          audioEffect({
            id: 'clip-high-pass',
            descriptorId: 'audio-high-pass',
            params: { frequencyHz: 120, q: 0.9 },
          }),
          audioEffect({
            id: 'clip-pan',
            descriptorId: 'audio-pan',
            params: { pan: -0.35 },
          }),
          audioEffect({
            id: 'clip-parametric',
            descriptorId: 'audio-parametric-eq',
            params: { frequencyHz: 2400, gainDb: -3, q: 1.2 },
          }),
          audioEffect({
            id: 'clip-hum-notch',
            descriptorId: 'audio-hum-notch',
            params: { frequencyHz: 60, q: 25, harmonics: 3, mix: 0.8 },
          }),
          audioEffect({
            id: 'clip-de-click',
            descriptorId: 'audio-de-click',
            params: { threshold: 0.3, ratio: 5, mix: 0.75 },
          }),
          audioEffect({
            id: 'clip-noise-reduction',
            descriptorId: 'audio-noise-reduction',
            params: { thresholdDb: -58, reductionDb: 18, sensitivity: 1.6, attackMs: 6, releaseMs: 180, mix: 0.7 },
          }),
          audioEffect({
            id: 'clip-spectral-gate',
            descriptorId: 'audio-spectral-gate',
            params: {
              thresholdDb: -54,
              reductionDb: 24,
              lowFrequencyHz: 180,
              highFrequencyHz: 6200,
              attackMs: 9,
              releaseMs: 220,
              mix: 0.6,
            },
          }),
          audioEffect({
            id: 'clip-de-esser',
            descriptorId: 'audio-de-esser',
            params: { frequencyHz: 7200, thresholdDb: -22, ratio: 4, kneeDb: 6, attackMs: 1, releaseMs: 90, makeupGainDb: 0 },
          }),
          audioEffect({
            id: 'clip-gate',
            descriptorId: 'audio-noise-gate',
            params: { thresholdDb: -45, floorDb: -80, attackMs: 2, releaseMs: 80 },
          }),
          audioEffect({
            id: 'clip-expander',
            descriptorId: 'audio-expander',
            params: { thresholdDb: -38, ratio: 2.5, rangeDb: 18, attackMs: 3, releaseMs: 110 },
          }),
          audioEffect({
            id: 'clip-polarity',
            descriptorId: 'audio-polarity-invert',
            params: { channelMode: 'left' },
          }),
        ],
      },
    });
    const track = audioTrack({
      audioState: {
        volumeDb: 0,
        pan: 0,
        muted: false,
        solo: false,
        recordArm: false,
        inputMonitor: false,
        meterMode: 'peak',
        effectStack: [
          audioEffect({
            id: 'track-compressor',
            descriptorId: 'audio-compressor',
            params: { thresholdDb: -18, ratio: 3, kneeDb: 6, attackMs: 8, releaseMs: 140, makeupGainDb: 2 },
          }),
        ],
      },
    });

    const route = createLiveAudioRouteSettings({
      clip,
      track,
      masterAudioState: {
        volumeDb: 0,
        limiterEnabled: true,
        truePeakCeilingDb: -1,
        effectStack: [
          audioEffect({
            id: 'master-low-pass',
            descriptorId: 'audio-low-pass',
            params: { frequencyHz: 18000, q: 0.707 },
          }),
          audioEffect({
            id: 'master-limiter',
            descriptorId: 'audio-limiter',
            params: { ceilingDb: -1, inputGainDb: 2 },
          }),
          audioEffect({
            id: 'master-delay',
            descriptorId: 'audio-delay',
            params: { delayMs: 180, feedback: 0.25, mix: 0.3, toneHz: 9000 },
          }),
          audioEffect({
            id: 'master-reverb',
            descriptorId: 'audio-reverb',
            params: { roomSize: 0.55, decaySeconds: 1.8, damping: 0.4, mix: 0.2 },
          }),
          audioEffect({
            id: 'master-saturation',
            descriptorId: 'audio-saturation',
            params: { driveDb: 9, toneHz: 11000, mix: 0.35 },
          }),
          audioEffect({
            id: 'master-mono',
            descriptorId: 'audio-mono-sum',
            params: {},
          }),
          audioEffect({
            id: 'master-swap',
            descriptorId: 'audio-channel-swap',
            params: {},
          }),
          audioEffect({
            id: 'master-stereo-split',
            descriptorId: 'audio-stereo-split',
            params: { sourceChannel: 1 },
          }),
        ],
      },
      interpolatedClipEffects: [],
    });

    expect(route.processors).toEqual([
      { id: 'clip-high-pass', type: 'high-pass', frequencyHz: 120, q: 0.9 },
      { id: 'clip-pan', type: 'pan', pan: -0.35 },
      { id: 'clip-parametric', type: 'parametric-eq', frequencyHz: 2400, gainDb: -3, q: 1.2 },
      { id: 'clip-hum-notch', type: 'hum-notch', frequencyHz: 60, q: 25, harmonics: 3, mix: 0.8 },
      { id: 'clip-de-click', type: 'de-click', threshold: 0.3, ratio: 5, mix: 0.75 },
      {
        id: 'clip-noise-reduction',
        type: 'noise-reduction',
        thresholdDb: -58,
        reductionDb: 18,
        sensitivity: 1.6,
        attackMs: 6,
        releaseMs: 180,
        mix: 0.7,
      },
      {
        id: 'clip-spectral-gate',
        type: 'spectral-gate',
        thresholdDb: -54,
        reductionDb: 24,
        lowFrequencyHz: 180,
        highFrequencyHz: 6200,
        attackMs: 9,
        releaseMs: 220,
        mix: 0.6,
      },
      {
        id: 'clip-de-esser',
        type: 'de-esser',
        frequencyHz: 7200,
        thresholdDb: -22,
        ratio: 4,
        kneeDb: 6,
        attackMs: 1,
        releaseMs: 90,
        makeupGainDb: 0,
      },
      {
        id: 'clip-gate',
        type: 'noise-gate',
        thresholdDb: -45,
        floorDb: -80,
        attackMs: 2,
        releaseMs: 80,
      },
      {
        id: 'clip-expander',
        type: 'expander',
        thresholdDb: -38,
        ratio: 2.5,
        rangeDb: 18,
        attackMs: 3,
        releaseMs: 110,
      },
      { id: 'clip-polarity', type: 'polarity-invert', channelMode: 'left' },
      {
        id: 'track-compressor',
        type: 'compressor',
        thresholdDb: -18,
        ratio: 3,
        kneeDb: 6,
        attackMs: 8,
        releaseMs: 140,
        makeupGainDb: 2,
      },
    ]);

    expect(route.master.processors).toEqual([
      { id: 'master-low-pass', type: 'low-pass', frequencyHz: 18000, q: 0.707 },
      { id: 'master-limiter', type: 'limiter', ceilingDb: -1, inputGainDb: 2 },
      { id: 'master-delay', type: 'delay', delayMs: 180, feedback: 0.25, mix: 0.3, toneHz: 9000 },
      { id: 'master-reverb', type: 'reverb', roomSize: 0.55, decaySeconds: 1.8, damping: 0.4, mix: 0.2 },
      { id: 'master-saturation', type: 'saturation', driveDb: 9, toneHz: 11000, mix: 0.35 },
      { id: 'master-mono', type: 'mono-sum' },
      { id: 'master-swap', type: 'channel-swap' },
      { id: 'master-stereo-split', type: 'stereo-split', sourceChannel: 1 },
    ]);
  });
});
