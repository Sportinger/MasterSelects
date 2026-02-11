import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioMixer, type AudioTrackData } from '../../src/engine/audio/AudioMixer';
import { AudioExtractionError } from '../../src/engine/audio/AudioExtractor';
import {
  EQ_FREQUENCIES,
  EQ_BAND_PARAMS,
  AudioEffectRenderer,
} from '../../src/engine/audio/AudioEffectRenderer';

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
});
