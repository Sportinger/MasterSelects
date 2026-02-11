import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioMixer, type AudioTrackData, type MixerSettings } from '../../src/engine/audio/AudioMixer';
import { AudioExtractionError, AudioExtractor } from '../../src/engine/audio/AudioExtractor';
import {
  EQ_FREQUENCIES,
  EQ_BAND_PARAMS,
  AudioEffectRenderer,
} from '../../src/engine/audio/AudioEffectRenderer';
import { TimeStretchProcessor, type TimeStretchSettings } from '../../src/engine/audio/TimeStretchProcessor';

// ─── Helper: create a minimal AudioBuffer-like object for pure logic tests ─

function createMockAudioBuffer(options: {
  numberOfChannels?: number;
  sampleRate?: number;
  length?: number;
  duration?: number;
  channelData?: Float32Array[];
}): AudioBuffer {
  const channels = options.numberOfChannels ?? 2;
  const sampleRate = options.sampleRate ?? 48000;
  const length = options.length ?? (options.duration ? Math.ceil(options.duration * sampleRate) : 48000);
  const duration = options.duration ?? length / sampleRate;

  const channelData: Float32Array[] = options.channelData ??
    Array.from({ length: channels }, () => new Float32Array(length));

  return {
    numberOfChannels: channels,
    sampleRate,
    length,
    duration,
    getChannelData: (ch: number) => channelData[ch] ?? new Float32Array(length),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

// ─── AudioMixer: getActiveTracks (via mute/solo filtering) ─────────────────

describe('AudioMixer', () => {
  describe('constructor defaults', () => {
    it('creates mixer with default settings', () => {
      const mixer = new AudioMixer();
      const settings = mixer.getSettings();
      expect(settings.sampleRate).toBe(48000);
      expect(settings.numberOfChannels).toBe(2);
      expect(settings.normalize).toBe(false);
      expect(settings.headroom).toBe(-1);
    });

    it('accepts custom settings', () => {
      const mixer = new AudioMixer({
        sampleRate: 44100,
        numberOfChannels: 1,
        normalize: true,
        headroom: -3,
      });
      const settings = mixer.getSettings();
      expect(settings.sampleRate).toBe(44100);
      expect(settings.numberOfChannels).toBe(1);
      expect(settings.normalize).toBe(true);
      expect(settings.headroom).toBe(-3);
    });
  });

  describe('updateSettings', () => {
    it('merges partial settings without losing existing ones', () => {
      const mixer = new AudioMixer({ sampleRate: 44100, normalize: false });
      mixer.updateSettings({ normalize: true });
      const settings = mixer.getSettings();
      expect(settings.sampleRate).toBe(44100);
      expect(settings.normalize).toBe(true);
    });
  });

  describe('getPeakLevel (static)', () => {
    it('returns 0 dB for a buffer peaking at 1.0', () => {
      const data = new Float32Array([0, 0.5, 1.0, -0.5, 0]);
      const buffer = createMockAudioBuffer({
        numberOfChannels: 1,
        length: data.length,
        channelData: [data],
      });
      const peakDb = AudioMixer.getPeakLevel(buffer);
      expect(peakDb).toBeCloseTo(0, 1);
    });

    it('returns -6 dB for a buffer peaking at 0.5', () => {
      const data = new Float32Array([0.5, -0.25, 0.1]);
      const buffer = createMockAudioBuffer({
        numberOfChannels: 1,
        length: data.length,
        channelData: [data],
      });
      const peakDb = AudioMixer.getPeakLevel(buffer);
      // 20 * log10(0.5) = -6.02
      expect(peakDb).toBeCloseTo(-6.02, 1);
    });

    it('returns -Infinity for all-silent buffer', () => {
      const data = new Float32Array([0, 0, 0]);
      const buffer = createMockAudioBuffer({
        numberOfChannels: 1,
        length: data.length,
        channelData: [data],
      });
      expect(AudioMixer.getPeakLevel(buffer)).toBe(-Infinity);
    });

    it('finds peak across multiple channels', () => {
      const left = new Float32Array([0.2, 0.3]);
      const right = new Float32Array([0.8, 0.1]);
      const buffer = createMockAudioBuffer({
        numberOfChannels: 2,
        length: 2,
        channelData: [left, right],
      });
      const peakDb = AudioMixer.getPeakLevel(buffer);
      // Peak is 0.8 -> 20*log10(0.8) = -1.938
      expect(peakDb).toBeCloseTo(20 * Math.log10(0.8), 1);
    });
  });

  describe('getRMSLevel (static)', () => {
    it('computes RMS level correctly for a constant signal', () => {
      // Constant 0.5 signal -> RMS = 0.5 -> 20*log10(0.5) = -6.02 dB
      const data = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      const buffer = createMockAudioBuffer({
        numberOfChannels: 1,
        length: data.length,
        channelData: [data],
      });
      const rmsDb = AudioMixer.getRMSLevel(buffer);
      expect(rmsDb).toBeCloseTo(-6.02, 1);
    });

    it('returns -Infinity for silent buffer', () => {
      const data = new Float32Array([0, 0, 0]);
      const buffer = createMockAudioBuffer({
        numberOfChannels: 1,
        length: data.length,
        channelData: [data],
      });
      expect(AudioMixer.getRMSLevel(buffer)).toBe(-Infinity);
    });

    it('RMS is always less than or equal to peak for non-constant signals', () => {
      const data = new Float32Array([1.0, 0, -0.5, 0.3, 0]);
      const buffer = createMockAudioBuffer({
        numberOfChannels: 1,
        length: data.length,
        channelData: [data],
      });
      const peak = AudioMixer.getPeakLevel(buffer);
      const rms = AudioMixer.getRMSLevel(buffer);
      expect(rms).toBeLessThanOrEqual(peak);
    });
  });
});

// ─── AudioExtractionError ──────────────────────────────────────────────────

describe('AudioExtractionError', () => {
  it('stores fileName and recoverable flag', () => {
    const err = new AudioExtractionError('Failed', 'test.mp4', true);
    expect(err.message).toBe('Failed');
    expect(err.fileName).toBe('test.mp4');
    expect(err.recoverable).toBe(true);
    expect(err.name).toBe('AudioExtractionError');
  });

  it('defaults recoverable to false', () => {
    const err = new AudioExtractionError('Failed', 'bad.wav');
    expect(err.recoverable).toBe(false);
  });

  it('is an instance of Error', () => {
    const err = new AudioExtractionError('msg', 'file.mp3');
    expect(err).toBeInstanceOf(Error);
  });
});

// ─── EQ Configuration Constants ────────────────────────────────────────────

describe('EQ Configuration', () => {
  it('has 10 frequency bands', () => {
    expect(EQ_FREQUENCIES).toHaveLength(10);
  });

  it('frequencies are sorted in ascending order', () => {
    for (let i = 1; i < EQ_FREQUENCIES.length; i++) {
      expect(EQ_FREQUENCIES[i]).toBeGreaterThan(EQ_FREQUENCIES[i - 1]);
    }
  });

  it('covers sub-bass to air (31 Hz to 16 kHz)', () => {
    expect(EQ_FREQUENCIES[0]).toBe(31);
    expect(EQ_FREQUENCIES[EQ_FREQUENCIES.length - 1]).toBe(16000);
  });

  it('has matching parameter names for each band', () => {
    expect(EQ_BAND_PARAMS).toHaveLength(10);
    expect(EQ_BAND_PARAMS).toHaveLength(EQ_FREQUENCIES.length);
  });

  it('parameter names follow naming convention', () => {
    // Low bands use number prefix, high bands use 'k' suffix
    expect(EQ_BAND_PARAMS[0]).toBe('band31');
    expect(EQ_BAND_PARAMS[5]).toBe('band1k');
    expect(EQ_BAND_PARAMS[9]).toBe('band16k');
  });
});

// ─── AudioEffectRenderer: bezier interpolation (pure math) ─────────────────

describe('AudioEffectRenderer interpolation logic', () => {
  // Testing the pure bezierInterpolate method via the class.
  // Since it's private, we test it indirectly through public behavior
  // or by accessing via prototype for pure logic validation.

  const renderer = new AudioEffectRenderer();

  describe('hasNonDefaultEQ detection', () => {
    // Access via prototype to test pure logic
    const hasNonDefaultEQ = (renderer as any).hasNonDefaultEQ.bind(renderer);

    it('returns false when all EQ bands are zero', () => {
      const effect = {
        id: 'eq1',
        type: 'audio-eq',
        params: {
          band31: 0, band62: 0, band125: 0, band250: 0, band500: 0,
          band1k: 0, band2k: 0, band4k: 0, band8k: 0, band16k: 0,
        },
      };
      expect(hasNonDefaultEQ(effect)).toBe(false);
    });

    it('returns true when any EQ band is non-zero', () => {
      const effect = {
        id: 'eq1',
        type: 'audio-eq',
        params: {
          band31: 0, band62: 0, band125: 0, band250: 0, band500: 0,
          band1k: 3.5, band2k: 0, band4k: 0, band8k: 0, band16k: 0,
        },
      };
      expect(hasNonDefaultEQ(effect)).toBe(true);
    });

    it('treats very small values (< 0.01) as effectively zero', () => {
      const effect = {
        id: 'eq1',
        type: 'audio-eq',
        params: {
          band31: 0.005, band62: 0, band125: 0, band250: 0, band500: 0,
          band1k: 0, band2k: 0, band4k: 0, band8k: 0, band16k: 0,
        },
      };
      expect(hasNonDefaultEQ(effect)).toBe(false);
    });
  });

  describe('hasEffectKeyframes detection', () => {
    const hasEffectKeyframes = (renderer as any).hasEffectKeyframes.bind(renderer);

    it('returns true when keyframes exist for the given effect', () => {
      const keyframes = [
        { id: 'k1', property: 'effect.vol1.volume', time: 0, value: 1 },
      ];
      expect(hasEffectKeyframes(keyframes, 'vol1')).toBe(true);
    });

    it('returns false when no keyframes match the effect id', () => {
      const keyframes = [
        { id: 'k1', property: 'effect.eq1.band1k', time: 0, value: 3 },
      ];
      expect(hasEffectKeyframes(keyframes, 'vol1')).toBe(false);
    });

    it('returns false for empty keyframes array', () => {
      expect(hasEffectKeyframes([], 'vol1')).toBe(false);
    });
  });

  describe('interpolateValue (pure math)', () => {
    const interpolateValue = (renderer as any).interpolateValue.bind(renderer);

    it('returns default value for empty keyframes', () => {
      expect(interpolateValue([], 1.0, 0.75)).toBe(0.75);
    });

    it('returns first keyframe value when time is before all keyframes', () => {
      const kfs = [
        { time: 1.0, value: 0.5 },
        { time: 3.0, value: 1.0 },
      ];
      expect(interpolateValue(kfs, 0.0, 0)).toBe(0.5);
    });

    it('returns last keyframe value when time is after all keyframes', () => {
      const kfs = [
        { time: 1.0, value: 0.5 },
        { time: 3.0, value: 1.0 },
      ];
      expect(interpolateValue(kfs, 5.0, 0)).toBe(1.0);
    });

    it('linearly interpolates between two keyframes', () => {
      const kfs = [
        { time: 0, value: 0 },
        { time: 2, value: 1 },
      ];
      expect(interpolateValue(kfs, 1.0, 0)).toBeCloseTo(0.5, 5);
    });

    it('interpolates correctly at 25% position', () => {
      const kfs = [
        { time: 0, value: 0 },
        { time: 4, value: 8 },
      ];
      expect(interpolateValue(kfs, 1.0, 0)).toBeCloseTo(2.0, 5);
    });
  });

  describe('bezierInterpolate (pure math)', () => {
    const bezierInterpolate = (renderer as any).bezierInterpolate.bind(renderer);

    it('linear interpolation when no handles are provided', () => {
      const prevKf = { time: 0, value: 0 };
      const nextKf = { time: 1, value: 10 };
      expect(bezierInterpolate(prevKf, nextKf, 0.0)).toBeCloseTo(0, 5);
      expect(bezierInterpolate(prevKf, nextKf, 0.5)).toBeCloseTo(5, 5);
      expect(bezierInterpolate(prevKf, nextKf, 1.0)).toBeCloseTo(10, 5);
    });

    it('returns exact endpoints at t=0 and t=1', () => {
      const prevKf = { time: 0, value: 2, handleOut: { x: 0.33, y: 0.1 } };
      const nextKf = { time: 1, value: 8, handleIn: { x: -0.33, y: -0.1 } };
      expect(bezierInterpolate(prevKf, nextKf, 0.0)).toBeCloseTo(2, 5);
      expect(bezierInterpolate(prevKf, nextKf, 1.0)).toBeCloseTo(8, 5);
    });

    it('midpoint deviates from linear with non-zero handles', () => {
      const prevKf = { time: 0, value: 0, handleOut: { x: 0.33, y: 0.5 } };
      const nextKf = { time: 1, value: 10, handleIn: { x: -0.33, y: -0.5 } };
      const midValue = bezierInterpolate(prevKf, nextKf, 0.5);
      // With symmetric handles pushing up then down, midpoint should still be ~5
      // but may deviate depending on handle strength
      expect(midValue).toBeGreaterThan(0);
      expect(midValue).toBeLessThan(10);
    });
  });
});

// ─── Audio Time/Sample Calculations ────────────────────────────────────────

describe('Audio time and sample calculations', () => {
  it('samples = duration * sampleRate', () => {
    const sampleRate = 48000;
    const duration = 2.5;
    const expectedSamples = Math.ceil(duration * sampleRate);
    expect(expectedSamples).toBe(120000);
  });

  it('duration = samples / sampleRate', () => {
    const samples = 96000;
    const sampleRate = 48000;
    expect(samples / sampleRate).toBe(2.0);
  });

  it('sample offset for trim start', () => {
    const sampleRate = 44100;
    const startTime = 1.5; // seconds
    const startSample = Math.floor(startTime * sampleRate);
    expect(startSample).toBe(66150);
  });

  it('speed-adjusted duration calculation', () => {
    // A 10-second clip at 2x speed plays in 5 seconds on timeline
    const sourceDuration = 10;
    const speed = 2.0;
    const timelineDuration = sourceDuration / speed;
    expect(timelineDuration).toBe(5);
  });

  it('reverse speed-adjusted source time', () => {
    // For a reversed clip: sourceTime = outPoint - localTime
    const outPoint = 8.0;
    const clipLocalTime = 3.0;
    const sourceTime = outPoint - clipLocalTime;
    expect(sourceTime).toBe(5.0);
  });

  it('forward source time with inPoint offset', () => {
    // sourceTime = inPoint + localTime
    const inPoint = 2.0;
    const clipLocalTime = 3.0;
    const sourceTime = inPoint + clipLocalTime;
    expect(sourceTime).toBe(5.0);
  });
});

// ─── Volume/Gain Calculations ──────────────────────────────────────────────

describe('Volume and gain calculations', () => {
  it('dB to linear conversion', () => {
    // 0 dB = 1.0 linear
    expect(Math.pow(10, 0 / 20)).toBe(1.0);
    // -6 dB ~ 0.5
    expect(Math.pow(10, -6 / 20)).toBeCloseTo(0.5012, 3);
    // -20 dB = 0.1
    expect(Math.pow(10, -20 / 20)).toBeCloseTo(0.1, 5);
    // +6 dB ~ 2.0
    expect(Math.pow(10, 6 / 20)).toBeCloseTo(1.9953, 3);
  });

  it('linear to dB conversion', () => {
    expect(20 * Math.log10(1.0)).toBe(0);
    expect(20 * Math.log10(0.5)).toBeCloseTo(-6.02, 1);
    expect(20 * Math.log10(0.1)).toBeCloseTo(-20, 1);
  });

  it('headroom calculation matches AudioMixer logic', () => {
    // headroom of -1 dB -> linear
    const headroomDb = -1;
    const headroomLinear = Math.pow(10, headroomDb / 20);
    expect(headroomLinear).toBeCloseTo(0.891, 2);

    // If peak is 0.95, normalizeGain = headroomLinear / peak
    const peak = 0.95;
    const normalizeGain = headroomLinear / peak;
    expect(normalizeGain).toBeCloseTo(0.938, 2);
    // Gain < 1 means we reduce volume (good - prevents clipping)
    expect(normalizeGain).toBeLessThan(1);
  });

  it('normalization skips when peak is below headroom threshold', () => {
    const headroomDb = -1;
    const headroomLinear = Math.pow(10, headroomDb / 20);
    const peak = 0.5; // Low peak
    const normalizeGain = headroomLinear / peak;
    // normalizeGain > 1 means we'd amplify - AudioMixer skips this
    expect(normalizeGain).toBeGreaterThan(1);
  });

  it('clip volume clamping to 0-2 range', () => {
    // AudioMixer clamps clip volume: Math.max(0, Math.min(2, clipVolume))
    const clamp = (v: number) => Math.max(0, Math.min(2, v));
    expect(clamp(-0.5)).toBe(0);
    expect(clamp(0)).toBe(0);
    expect(clamp(1)).toBe(1);
    expect(clamp(1.5)).toBe(1.5);
    expect(clamp(2)).toBe(2);
    expect(clamp(3)).toBe(2);
  });

  it('extreme dB values', () => {
    // -60 dB is very quiet
    expect(Math.pow(10, -60 / 20)).toBeCloseTo(0.001, 4);
    // +20 dB = 10x linear gain
    expect(Math.pow(10, 20 / 20)).toBeCloseTo(10, 5);
    // -Infinity dB = silence
    expect(Math.pow(10, -Infinity / 20)).toBe(0);
  });

  it('round-trip dB to linear and back', () => {
    const originalDb = -12;
    const linear = Math.pow(10, originalDb / 20);
    const backToDb = 20 * Math.log10(linear);
    expect(backToDb).toBeCloseTo(originalDb, 10);
  });
});

// ─── AudioMixer: getActiveTracks mute/solo filtering ────────────────────────

describe('AudioMixer mute/solo filtering', () => {
  // Access private getActiveTracks via casting for direct logic testing
  const mixer = new AudioMixer();
  const getActiveTracks = (mixer as any).getActiveTracks.bind(mixer);

  function makeTrack(overrides: Partial<AudioTrackData>): AudioTrackData {
    return {
      clipId: overrides.clipId ?? 'clip1',
      buffer: createMockAudioBuffer({ length: 100 }),
      startTime: overrides.startTime ?? 0,
      trackId: overrides.trackId ?? 'track1',
      trackMuted: overrides.trackMuted ?? false,
      trackSolo: overrides.trackSolo ?? false,
      clipVolume: overrides.clipVolume,
    };
  }

  it('returns all tracks when none muted and none soloed', () => {
    const tracks = [
      makeTrack({ clipId: 'a', trackId: 't1' }),
      makeTrack({ clipId: 'b', trackId: 't2' }),
    ];
    expect(getActiveTracks(tracks)).toHaveLength(2);
  });

  it('excludes muted tracks', () => {
    const tracks = [
      makeTrack({ clipId: 'a', trackMuted: false }),
      makeTrack({ clipId: 'b', trackMuted: true }),
    ];
    const active = getActiveTracks(tracks);
    expect(active).toHaveLength(1);
    expect(active[0].clipId).toBe('a');
  });

  it('includes only soloed tracks when any track is soloed', () => {
    const tracks = [
      makeTrack({ clipId: 'a', trackSolo: false }),
      makeTrack({ clipId: 'b', trackSolo: true }),
      makeTrack({ clipId: 'c', trackSolo: false }),
    ];
    const active = getActiveTracks(tracks);
    expect(active).toHaveLength(1);
    expect(active[0].clipId).toBe('b');
  });

  it('muted track is excluded even if soloed', () => {
    const tracks = [
      makeTrack({ clipId: 'a', trackMuted: true, trackSolo: true }),
      makeTrack({ clipId: 'b', trackSolo: false }),
    ];
    // Mute check happens before solo check in getActiveTracks
    const active = getActiveTracks(tracks);
    expect(active).toHaveLength(0);
  });

  it('multiple soloed tracks are all included', () => {
    const tracks = [
      makeTrack({ clipId: 'a', trackSolo: true }),
      makeTrack({ clipId: 'b', trackSolo: false }),
      makeTrack({ clipId: 'c', trackSolo: true }),
    ];
    const active = getActiveTracks(tracks);
    expect(active).toHaveLength(2);
    expect(active.map((t: AudioTrackData) => t.clipId)).toEqual(['a', 'c']);
  });

  it('excludes tracks with empty buffers', () => {
    const emptyBuffer = createMockAudioBuffer({ length: 0 });
    const tracks = [
      makeTrack({ clipId: 'a' }),
      { ...makeTrack({ clipId: 'b' }), buffer: emptyBuffer },
    ];
    const active = getActiveTracks(tracks);
    expect(active).toHaveLength(1);
    expect(active[0].clipId).toBe('a');
  });

  it('excludes tracks with null buffer', () => {
    const tracks = [
      makeTrack({ clipId: 'a' }),
      { ...makeTrack({ clipId: 'b' }), buffer: null as any },
    ];
    const active = getActiveTracks(tracks);
    expect(active).toHaveLength(1);
  });

  it('returns empty array when all tracks are muted', () => {
    const tracks = [
      makeTrack({ trackMuted: true }),
      makeTrack({ trackMuted: true }),
    ];
    expect(getActiveTracks(tracks)).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(getActiveTracks([])).toHaveLength(0);
  });
});

// ─── AudioMixer: settings immutability ────────────────────────────────────────

describe('AudioMixer settings immutability', () => {
  it('getSettings returns a copy that cannot mutate internal state', () => {
    const mixer = new AudioMixer({ sampleRate: 48000 });
    const settings = mixer.getSettings();
    settings.sampleRate = 22050;
    // Internal state should not be affected
    expect(mixer.getSettings().sampleRate).toBe(48000);
  });

  it('updateSettings with all properties', () => {
    const mixer = new AudioMixer();
    mixer.updateSettings({
      sampleRate: 22050,
      numberOfChannels: 1,
      normalize: true,
      headroom: -6,
    });
    const s = mixer.getSettings();
    expect(s.sampleRate).toBe(22050);
    expect(s.numberOfChannels).toBe(1);
    expect(s.normalize).toBe(true);
    expect(s.headroom).toBe(-6);
  });

  it('updateSettings with empty object keeps all defaults', () => {
    const mixer = new AudioMixer();
    mixer.updateSettings({});
    const s = mixer.getSettings();
    expect(s.sampleRate).toBe(48000);
    expect(s.numberOfChannels).toBe(2);
    expect(s.normalize).toBe(false);
    expect(s.headroom).toBe(-1);
  });
});

// ─── AudioMixer: getPeakLevel edge cases ──────────────────────────────────────

describe('AudioMixer getPeakLevel edge cases', () => {
  it('detects peak from negative samples', () => {
    const data = new Float32Array([0, -0.9, 0.2, -0.1]);
    const buffer = createMockAudioBuffer({
      numberOfChannels: 1,
      length: data.length,
      channelData: [data],
    });
    // Peak absolute value is 0.9
    expect(AudioMixer.getPeakLevel(buffer)).toBeCloseTo(20 * Math.log10(0.9), 1);
  });

  it('handles buffer with single sample', () => {
    const data = new Float32Array([0.7]);
    const buffer = createMockAudioBuffer({
      numberOfChannels: 1,
      length: 1,
      channelData: [data],
    });
    expect(AudioMixer.getPeakLevel(buffer)).toBeCloseTo(20 * Math.log10(0.7), 1);
  });

  it('handles clipping signal (peak > 1.0)', () => {
    const data = new Float32Array([1.5, -1.2, 0.3]);
    const buffer = createMockAudioBuffer({
      numberOfChannels: 1,
      length: data.length,
      channelData: [data],
    });
    // Peak is 1.5 -> positive dB (clipping)
    const peakDb = AudioMixer.getPeakLevel(buffer);
    expect(peakDb).toBeGreaterThan(0);
    expect(peakDb).toBeCloseTo(20 * Math.log10(1.5), 1);
  });
});

// ─── AudioMixer: getRMSLevel edge cases ─────────────────────────────────────

describe('AudioMixer getRMSLevel edge cases', () => {
  it('computes RMS across stereo channels', () => {
    // Left: constant 0.5, Right: constant 0.5
    // RMS should be 0.5 -> -6.02 dB
    const left = new Float32Array([0.5, 0.5]);
    const right = new Float32Array([0.5, 0.5]);
    const buffer = createMockAudioBuffer({
      numberOfChannels: 2,
      length: 2,
      channelData: [left, right],
    });
    expect(AudioMixer.getRMSLevel(buffer)).toBeCloseTo(-6.02, 1);
  });

  it('RMS equals peak for constant signal', () => {
    const data = new Float32Array([0.4, 0.4, 0.4, 0.4]);
    const buffer = createMockAudioBuffer({
      numberOfChannels: 1,
      length: data.length,
      channelData: [data],
    });
    const peak = AudioMixer.getPeakLevel(buffer);
    const rms = AudioMixer.getRMSLevel(buffer);
    expect(rms).toBeCloseTo(peak, 5);
  });

  it('RMS handles stereo with different channel levels', () => {
    // Left: all 1.0, Right: all 0.0
    // sumSquares = 4*1 + 4*0 = 4, totalSamples = 8
    // rms = sqrt(4/8) = sqrt(0.5) = ~0.707
    const left = new Float32Array([1, 1, 1, 1]);
    const right = new Float32Array([0, 0, 0, 0]);
    const buffer = createMockAudioBuffer({
      numberOfChannels: 2,
      length: 4,
      channelData: [left, right],
    });
    const rmsDb = AudioMixer.getRMSLevel(buffer);
    expect(rmsDb).toBeCloseTo(20 * Math.log10(Math.sqrt(0.5)), 1);
  });
});

// ─── AudioExtractionError extended tests ──────────────────────────────────────

describe('AudioExtractionError extended', () => {
  it('has correct stack trace', () => {
    const err = new AudioExtractionError('test error', 'file.mp4');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('AudioExtractionError');
  });

  it('works with recoverable set to true', () => {
    const err = new AudioExtractionError('Recoverable error', 'audio.wav', true);
    expect(err.recoverable).toBe(true);
    expect(err.fileName).toBe('audio.wav');
  });

  it('can be caught as Error type', () => {
    try {
      throw new AudioExtractionError('thrown', 'test.mp3');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(AudioExtractionError);
      expect((e as AudioExtractionError).fileName).toBe('test.mp3');
    }
  });

  it('preserves message with special characters', () => {
    const msg = 'Failed to decode: file "test (1).mp4" [codec error]';
    const err = new AudioExtractionError(msg, 'test (1).mp4');
    expect(err.message).toBe(msg);
    expect(err.fileName).toBe('test (1).mp4');
  });
});

// ─── AudioExtractor cache management ──────────────────────────────────────────

describe('AudioExtractor cache management', () => {
  let extractor: AudioExtractor;

  beforeEach(() => {
    extractor = new AudioExtractor();
  });

  it('hasCached returns false for unknown keys', () => {
    expect(extractor.hasCached('nonexistent')).toBe(false);
  });

  it('getCached returns null for unknown keys', () => {
    expect(extractor.getCached('nonexistent')).toBeNull();
  });

  it('getCacheStats reports empty cache initially', () => {
    const stats = extractor.getCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.maxSize).toBe(5);
    expect(stats.keys).toEqual([]);
  });

  it('setMaxCacheSize clamps to at least 1', () => {
    extractor.setMaxCacheSize(0);
    expect(extractor.getCacheStats().maxSize).toBe(1);

    extractor.setMaxCacheSize(-5);
    expect(extractor.getCacheStats().maxSize).toBe(1);
  });

  it('setMaxCacheSize accepts valid values', () => {
    extractor.setMaxCacheSize(10);
    expect(extractor.getCacheStats().maxSize).toBe(10);
  });

  it('clearCache empties all cached items', () => {
    // Since we can't easily add to cache without decoding,
    // we at least verify clearCache does not throw on empty cache
    extractor.clearCache();
    expect(extractor.getCacheStats().size).toBe(0);
  });

  it('getBufferInfo extracts correct metadata', () => {
    const buffer = createMockAudioBuffer({
      numberOfChannels: 2,
      sampleRate: 44100,
      length: 44100,
      duration: 1.0,
    });
    const info = extractor.getBufferInfo(buffer);
    expect(info.buffer).toBe(buffer);
    expect(info.duration).toBe(1.0);
    expect(info.sampleRate).toBe(44100);
    expect(info.numberOfChannels).toBe(2);
  });

  it('getBufferInfo returns correct info for mono buffer', () => {
    const buffer = createMockAudioBuffer({
      numberOfChannels: 1,
      sampleRate: 48000,
      length: 96000,
      duration: 2.0,
    });
    const info = extractor.getBufferInfo(buffer);
    expect(info.numberOfChannels).toBe(1);
    expect(info.duration).toBe(2.0);
  });

  it('destroy can be called safely', () => {
    // Should not throw
    expect(() => extractor.destroy()).not.toThrow();
  });

  it('destroy can be called multiple times safely', () => {
    extractor.destroy();
    expect(() => extractor.destroy()).not.toThrow();
  });
});

// ─── EQ Configuration extended tests ────────────────────────────────────────

describe('EQ Configuration extended', () => {
  it('each frequency has a corresponding band parameter', () => {
    // EQ_FREQUENCIES and EQ_BAND_PARAMS must have 1:1 mapping
    for (let i = 0; i < EQ_FREQUENCIES.length; i++) {
      expect(EQ_BAND_PARAMS[i]).toBeDefined();
      // Each param name should contain a number related to the frequency
      const freq = EQ_FREQUENCIES[i];
      if (freq >= 1000) {
        // Should use 'k' suffix (e.g., 1000 -> '1k')
        expect(EQ_BAND_PARAMS[i]).toContain('k');
      } else {
        // Should contain the frequency as a number
        expect(EQ_BAND_PARAMS[i]).toContain(freq.toString());
      }
    }
  });

  it('all frequencies are positive', () => {
    EQ_FREQUENCIES.forEach(freq => {
      expect(freq).toBeGreaterThan(0);
    });
  });

  it('all frequencies are within audible range', () => {
    // Human hearing: ~20Hz to ~20kHz
    EQ_FREQUENCIES.forEach(freq => {
      expect(freq).toBeGreaterThanOrEqual(20);
      expect(freq).toBeLessThanOrEqual(20000);
    });
  });

  it('standard octave spacing pattern', () => {
    // Each consecutive pair roughly doubles (within factor of 2-3)
    for (let i = 1; i < EQ_FREQUENCIES.length; i++) {
      const ratio = EQ_FREQUENCIES[i] / EQ_FREQUENCIES[i - 1];
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThanOrEqual(3);
    }
  });

  it('all EQ_BAND_PARAMS start with "band"', () => {
    EQ_BAND_PARAMS.forEach(param => {
      expect(param.startsWith('band')).toBe(true);
    });
  });

  it('EQ_BAND_PARAMS are unique', () => {
    const unique = new Set(EQ_BAND_PARAMS);
    expect(unique.size).toBe(EQ_BAND_PARAMS.length);
  });
});

// ─── AudioEffectRenderer: hasNonDefaultEQ extended ──────────────────────────

describe('AudioEffectRenderer hasNonDefaultEQ extended', () => {
  const renderer = new AudioEffectRenderer();
  const hasNonDefaultEQ = (renderer as any).hasNonDefaultEQ.bind(renderer);

  it('returns true for negative EQ gain values', () => {
    const effect = {
      id: 'eq1',
      type: 'audio-eq',
      params: {
        band31: 0, band62: 0, band125: 0, band250: 0, band500: 0,
        band1k: 0, band2k: 0, band4k: -6, band8k: 0, band16k: 0,
      },
    };
    expect(hasNonDefaultEQ(effect)).toBe(true);
  });

  it('returns true when all bands are non-zero', () => {
    const effect = {
      id: 'eq1',
      type: 'audio-eq',
      params: {
        band31: 3, band62: 2, band125: -1, band250: 4, band500: -2,
        band1k: 5, band2k: -3, band4k: 1, band8k: 6, band16k: -4,
      },
    };
    expect(hasNonDefaultEQ(effect)).toBe(true);
  });

  it('returns false when all bands are below threshold (0.01)', () => {
    const effect = {
      id: 'eq1',
      type: 'audio-eq',
      params: {
        band31: 0.009, band62: -0.005, band125: 0.001, band250: 0, band500: -0.009,
        band1k: 0.003, band2k: 0, band4k: -0.008, band8k: 0.002, band16k: 0,
      },
    };
    expect(hasNonDefaultEQ(effect)).toBe(false);
  });

  it('returns true at exactly the boundary value 0.011', () => {
    const effect = {
      id: 'eq1',
      type: 'audio-eq',
      params: {
        band31: 0.011, band62: 0, band125: 0, band250: 0, band500: 0,
        band1k: 0, band2k: 0, band4k: 0, band8k: 0, band16k: 0,
      },
    };
    expect(hasNonDefaultEQ(effect)).toBe(true);
  });

  it('handles missing params gracefully', () => {
    const effect = { id: 'eq1', type: 'audio-eq', params: {} };
    expect(hasNonDefaultEQ(effect)).toBe(false);
  });

  it('handles undefined params gracefully', () => {
    const effect = { id: 'eq1', type: 'audio-eq' };
    expect(hasNonDefaultEQ(effect)).toBe(false);
  });

  it('returns true with max EQ gain (+12 dB)', () => {
    const effect = {
      id: 'eq1',
      type: 'audio-eq',
      params: {
        band31: 0, band62: 0, band125: 0, band250: 0, band500: 0,
        band1k: 0, band2k: 0, band4k: 0, band8k: 12, band16k: 0,
      },
    };
    expect(hasNonDefaultEQ(effect)).toBe(true);
  });

  it('returns true with min EQ gain (-12 dB)', () => {
    const effect = {
      id: 'eq1',
      type: 'audio-eq',
      params: {
        band31: -12, band62: 0, band125: 0, band250: 0, band500: 0,
        band1k: 0, band2k: 0, band4k: 0, band8k: 0, band16k: 0,
      },
    };
    expect(hasNonDefaultEQ(effect)).toBe(true);
  });
});

// ─── AudioEffectRenderer: hasEffectKeyframes extended ─────────────────────────

describe('AudioEffectRenderer hasEffectKeyframes extended', () => {
  const renderer = new AudioEffectRenderer();
  const hasEffectKeyframes = (renderer as any).hasEffectKeyframes.bind(renderer);

  it('detects keyframes across multiple params of the same effect', () => {
    const keyframes = [
      { id: 'k1', property: 'effect.eq1.band1k', time: 0, value: 3 },
      { id: 'k2', property: 'effect.eq1.band4k', time: 1, value: -2 },
    ];
    expect(hasEffectKeyframes(keyframes, 'eq1')).toBe(true);
  });

  it('does not match partial effect id prefix', () => {
    const keyframes = [
      { id: 'k1', property: 'effect.vol1.volume', time: 0, value: 1 },
    ];
    // 'vol' is a prefix of 'vol1', but the code checks for 'effect.vol.'
    // which should NOT match 'effect.vol1.volume'
    expect(hasEffectKeyframes(keyframes, 'vol')).toBe(false);
  });

  it('matches correct effect when multiple effects have keyframes', () => {
    const keyframes = [
      { id: 'k1', property: 'effect.eq1.band1k', time: 0, value: 3 },
      { id: 'k2', property: 'effect.vol1.volume', time: 0, value: 0.5 },
    ];
    expect(hasEffectKeyframes(keyframes, 'eq1')).toBe(true);
    expect(hasEffectKeyframes(keyframes, 'vol1')).toBe(true);
    expect(hasEffectKeyframes(keyframes, 'vol2')).toBe(false);
  });
});

// ─── AudioEffectRenderer: interpolateValue extended ─────────────────────────

describe('AudioEffectRenderer interpolateValue extended', () => {
  const renderer = new AudioEffectRenderer();
  const interpolateValue = (renderer as any).interpolateValue.bind(renderer);

  it('returns exact value at first keyframe time', () => {
    const kfs = [
      { time: 1.0, value: 0.5 },
      { time: 3.0, value: 1.0 },
    ];
    expect(interpolateValue(kfs, 1.0, 0)).toBe(0.5);
  });

  it('returns exact value at last keyframe time', () => {
    const kfs = [
      { time: 1.0, value: 0.5 },
      { time: 3.0, value: 1.0 },
    ];
    expect(interpolateValue(kfs, 3.0, 0)).toBe(1.0);
  });

  it('handles single keyframe: returns its value at any time', () => {
    const kfs = [{ time: 2.0, value: 0.8 }];
    expect(interpolateValue(kfs, 0, 0)).toBe(0.8);  // before
    expect(interpolateValue(kfs, 2.0, 0)).toBe(0.8); // at
    expect(interpolateValue(kfs, 5.0, 0)).toBe(0.8); // after
  });

  it('interpolates across three keyframes correctly', () => {
    const kfs = [
      { time: 0, value: 0 },
      { time: 2, value: 10 },
      { time: 4, value: 0 },
    ];
    // At t=1: between kf[0] and kf[1], half way -> 5
    expect(interpolateValue(kfs, 1.0, 0)).toBeCloseTo(5.0, 5);
    // At t=2: at kf[1] -> 10
    expect(interpolateValue(kfs, 2.0, 0)).toBe(10);
    // At t=3: between kf[1] and kf[2], half way -> 5
    expect(interpolateValue(kfs, 3.0, 0)).toBeCloseTo(5.0, 5);
  });

  it('handles unsorted keyframes (sorts internally)', () => {
    const kfs = [
      { time: 3.0, value: 1.0 },
      { time: 1.0, value: 0.0 },
    ];
    // At t=2: should interpolate between (1,0) and (3,1) -> 0.5
    expect(interpolateValue(kfs, 2.0, 0)).toBeCloseTo(0.5, 5);
  });

  it('interpolates with negative values', () => {
    const kfs = [
      { time: 0, value: -10 },
      { time: 4, value: 10 },
    ];
    // At t=2: midpoint -> 0
    expect(interpolateValue(kfs, 2.0, 0)).toBeCloseTo(0, 5);
  });
});

// ─── AudioEffectRenderer: bezierInterpolate extended ─────────────────────────

describe('AudioEffectRenderer bezierInterpolate extended', () => {
  const renderer = new AudioEffectRenderer();
  const bezierInterpolate = (renderer as any).bezierInterpolate.bind(renderer);

  it('handles only handleOut on previous keyframe', () => {
    const prevKf = { time: 0, value: 0, handleOut: { x: 0.33, y: 0.5 } };
    const nextKf = { time: 1, value: 10 }; // no handleIn
    // Should still produce valid interpolation
    const mid = bezierInterpolate(prevKf, nextKf, 0.5);
    expect(mid).toBeGreaterThanOrEqual(0);
    expect(mid).toBeLessThanOrEqual(10);
    // Endpoints must be exact
    expect(bezierInterpolate(prevKf, nextKf, 0)).toBeCloseTo(0, 5);
    expect(bezierInterpolate(prevKf, nextKf, 1)).toBeCloseTo(10, 5);
  });

  it('handles only handleIn on next keyframe', () => {
    const prevKf = { time: 0, value: 0 }; // no handleOut
    const nextKf = { time: 1, value: 10, handleIn: { x: -0.33, y: -0.5 } };
    const mid = bezierInterpolate(prevKf, nextKf, 0.5);
    expect(mid).toBeGreaterThanOrEqual(0);
    expect(mid).toBeLessThanOrEqual(10);
  });

  it('ease-in curve (handle pulls start flat)', () => {
    // Handle pushing start value up -> slow departure from start
    const prevKf = { time: 0, value: 0, handleOut: { x: 0.5, y: 0 } };
    const nextKf = { time: 1, value: 10, handleIn: { x: -0.5, y: 0 } };
    // With zero y handles, should behave linearly
    const mid = bezierInterpolate(prevKf, nextKf, 0.5);
    expect(mid).toBeCloseTo(5, 0);
  });

  it('S-curve with handles pulling values beyond range returns within bounds at endpoints', () => {
    const prevKf = { time: 0, value: 0, handleOut: { x: 0.33, y: 1.0 } };
    const nextKf = { time: 1, value: 10, handleIn: { x: -0.33, y: -1.0 } };
    // Endpoints should still be exact
    expect(bezierInterpolate(prevKf, nextKf, 0)).toBeCloseTo(0, 5);
    expect(bezierInterpolate(prevKf, nextKf, 1)).toBeCloseTo(10, 5);
  });

  it('handles identical start and end values', () => {
    const prevKf = { time: 0, value: 5 };
    const nextKf = { time: 1, value: 5 };
    // Linear with same values -> always 5
    expect(bezierInterpolate(prevKf, nextKf, 0)).toBeCloseTo(5, 5);
    expect(bezierInterpolate(prevKf, nextKf, 0.5)).toBeCloseTo(5, 5);
    expect(bezierInterpolate(prevKf, nextKf, 1)).toBeCloseTo(5, 5);
  });

  it('handles decreasing value range', () => {
    const prevKf = { time: 0, value: 10 };
    const nextKf = { time: 1, value: 0 };
    expect(bezierInterpolate(prevKf, nextKf, 0)).toBeCloseTo(10, 5);
    expect(bezierInterpolate(prevKf, nextKf, 0.5)).toBeCloseTo(5, 5);
    expect(bezierInterpolate(prevKf, nextKf, 1)).toBeCloseTo(0, 5);
  });

  it('bezier at quarter and three-quarter positions with handles', () => {
    const prevKf = { time: 0, value: 0, handleOut: { x: 0.33, y: 0.2 } };
    const nextKf = { time: 1, value: 100, handleIn: { x: -0.33, y: -0.2 } };
    const q1 = bezierInterpolate(prevKf, nextKf, 0.25);
    const q3 = bezierInterpolate(prevKf, nextKf, 0.75);
    // Quarter should be less than half, three-quarter should be more
    expect(q1).toBeGreaterThan(0);
    expect(q1).toBeLessThan(100);
    expect(q3).toBeGreaterThan(q1);
    expect(q3).toBeLessThan(100);
  });
});

// ─── TimeStretchProcessor constructor and settings ──────────────────────────

describe('TimeStretchProcessor', () => {
  describe('constructor defaults', () => {
    it('creates processor with default settings', () => {
      const proc = new TimeStretchProcessor();
      const settings = proc.getSettings();
      expect(settings.preservePitch).toBe(true);
      expect(settings.quality).toBe('normal');
    });

    it('accepts custom settings', () => {
      const proc = new TimeStretchProcessor({
        preservePitch: false,
        quality: 'high',
      });
      const settings = proc.getSettings();
      expect(settings.preservePitch).toBe(false);
      expect(settings.quality).toBe('high');
    });

    it('accepts partial custom settings', () => {
      const proc = new TimeStretchProcessor({ quality: 'fast' });
      const settings = proc.getSettings();
      expect(settings.preservePitch).toBe(true); // default
      expect(settings.quality).toBe('fast');
    });
  });

  describe('updateSettings', () => {
    it('merges partial settings', () => {
      const proc = new TimeStretchProcessor({ preservePitch: true, quality: 'normal' });
      proc.updateSettings({ quality: 'high' });
      const settings = proc.getSettings();
      expect(settings.preservePitch).toBe(true);
      expect(settings.quality).toBe('high');
    });

    it('can toggle preservePitch', () => {
      const proc = new TimeStretchProcessor();
      expect(proc.getSettings().preservePitch).toBe(true);
      proc.updateSettings({ preservePitch: false });
      expect(proc.getSettings().preservePitch).toBe(false);
    });
  });

  describe('getSettings returns a copy', () => {
    it('does not allow external mutation of internal state', () => {
      const proc = new TimeStretchProcessor();
      const settings = proc.getSettings();
      settings.preservePitch = false;
      settings.quality = 'fast';
      // Internal state should be unaffected
      expect(proc.getSettings().preservePitch).toBe(true);
      expect(proc.getSettings().quality).toBe('normal');
    });
  });
});

// ─── Audio time/sample extended calculations ────────────────────────────────

describe('Audio time and sample calculations extended', () => {
  it('half-speed doubles timeline duration', () => {
    const sourceDuration = 10;
    const speed = 0.5;
    expect(sourceDuration / speed).toBe(20);
  });

  it('quarter-speed quadruples timeline duration', () => {
    const sourceDuration = 4;
    const speed = 0.25;
    expect(sourceDuration / speed).toBe(16);
  });

  it('fractional sample rates handle conversion correctly', () => {
    const sampleRate = 44100;
    const duration = 1 / 3; // repeating decimal
    const samples = Math.ceil(duration * sampleRate);
    expect(samples).toBe(14700);
  });

  it('very short duration produces at least one sample', () => {
    const sampleRate = 48000;
    const duration = 0.00001; // 10 microseconds
    const samples = Math.max(1, Math.ceil(duration * sampleRate));
    expect(samples).toBeGreaterThanOrEqual(1);
  });

  it('zero duration produces zero samples before clamp', () => {
    const sampleRate = 48000;
    const duration = 0;
    expect(Math.ceil(duration * sampleRate)).toBe(0);
  });

  it('trim calculation: endSample clamped to buffer length', () => {
    const bufferLength = 48000;
    const sampleRate = 48000;
    const endTime = 2.0; // Would need 96000 samples but buffer only has 48000
    const endSample = Math.min(Math.ceil(endTime * sampleRate), bufferLength);
    expect(endSample).toBe(48000);
  });

  it('speed-adjusted source mapping with in-point', () => {
    // Clip starts at inPoint 5s, speed 1.5x, local time 2s
    // sourceTime = inPoint + localTime * speed
    const inPoint = 5.0;
    const localTime = 2.0;
    const speed = 1.5;
    const sourceTime = inPoint + localTime * speed;
    expect(sourceTime).toBe(8.0);
  });
});

// ─── Normalization logic tests ──────────────────────────────────────────────

describe('Normalization logic', () => {
  it('normalization gain formula: headroomLinear / peak', () => {
    // Various headroom and peak combinations
    const testCases = [
      { headroomDb: -1, peak: 0.95, expectedGainLt1: true },
      { headroomDb: -3, peak: 0.8, expectedGainLt1: true },
      { headroomDb: -1, peak: 0.3, expectedGainLt1: false }, // would amplify
      { headroomDb: 0, peak: 1.0, expectedGainLt1: false },  // exactly 1.0
    ];

    testCases.forEach(({ headroomDb, peak, expectedGainLt1 }) => {
      const headroomLinear = Math.pow(10, headroomDb / 20);
      const gain = headroomLinear / peak;
      if (expectedGainLt1) {
        expect(gain).toBeLessThan(1);
      } else {
        expect(gain).toBeGreaterThanOrEqual(1);
      }
    });
  });

  it('normalization never amplifies (gain >= 1 means skip)', () => {
    // This mirrors the AudioMixer logic: if (normalizeGain >= 1) return
    const headroomLinear = Math.pow(10, -1 / 20); // -1 dB

    // When peak is less than headroom target, gain > 1 -> skip
    expect(headroomLinear / 0.1).toBeGreaterThan(1);
    expect(headroomLinear / 0.5).toBeGreaterThan(1);
    expect(headroomLinear / 0.8).toBeGreaterThan(1);

    // When peak exceeds headroom target, gain < 1 -> normalize
    expect(headroomLinear / 0.95).toBeLessThan(1);
    expect(headroomLinear / 1.0).toBeLessThan(1);
  });

  it('normalization with 0 dB headroom targets peak at 1.0', () => {
    const headroomDb = 0;
    const headroomLinear = Math.pow(10, headroomDb / 20);
    expect(headroomLinear).toBe(1.0);

    // If peak is 1.0, gain is exactly 1.0 -> skip (>= 1)
    expect(headroomLinear / 1.0).toBe(1.0);

    // If peak is 1.5 (clipping), gain < 1 -> normalize to 1.0
    const gain = headroomLinear / 1.5;
    expect(gain).toBeCloseTo(0.667, 2);
    // After normalization: 1.5 * gain = 1.0
    expect(1.5 * gain).toBeCloseTo(1.0, 5);
  });

  it('normalization with -6 dB headroom targets peak at 0.5', () => {
    const headroomDb = -6;
    const headroomLinear = Math.pow(10, headroomDb / 20);
    expect(headroomLinear).toBeCloseTo(0.5012, 3);

    // Peak at 0.8 -> gain < 1 -> normalize
    const gain = headroomLinear / 0.8;
    expect(gain).toBeLessThan(1);
    // After: 0.8 * gain ≈ 0.5012
    expect(0.8 * gain).toBeCloseTo(headroomLinear, 3);
  });
});

// ─── AudioMixer constructor edge cases ────────────────────────────────────────

describe('AudioMixer partial constructor settings', () => {
  it('single property override keeps other defaults', () => {
    const mixer = new AudioMixer({ sampleRate: 22050 });
    const s = mixer.getSettings();
    expect(s.sampleRate).toBe(22050);
    expect(s.numberOfChannels).toBe(2); // default
    expect(s.normalize).toBe(false);    // default
    expect(s.headroom).toBe(-1);        // default
  });

  it('can set headroom to 0 dB', () => {
    const mixer = new AudioMixer({ headroom: 0 });
    expect(mixer.getSettings().headroom).toBe(0);
  });

  it('can set headroom to large negative value', () => {
    const mixer = new AudioMixer({ headroom: -20 });
    expect(mixer.getSettings().headroom).toBe(-20);
  });
});
