import { describe, it, expect } from 'vitest';
import {
  decodeBase64ToFloat32,
  decodeBase64ToInt16,
  selectZone,
  selectZoneIndex,
  computePlaybackRate,
} from '../../src/engine/audio/GmSampleBank';
import type { GmZone } from '../../src/types/gmAsset';

function floatsToBase64(values: number[]): string {
  const f32 = new Float32Array(values);
  const bytes = new Uint8Array(f32.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function int16ToBase64(values: number[]): string {
  const i16 = new Int16Array(values);
  const bytes = new Uint8Array(i16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function zone(partial: Partial<GmZone>): GmZone {
  return {
    loKey: 0, hiKey: 127, rootKey: 60,
    loopStart: -1, loopEnd: -1,
    envelope: { attack: 0, decay: 0, sustain: 1, release: 0.2 },
    pcm: '',
    ...partial,
  };
}

describe('decodeBase64ToFloat32', () => {
  it('round-trips Float32 PCM through base64', () => {
    const samples = [0, 1, -1, 0.5, -0.25, 0.123456];
    const decoded = decodeBase64ToFloat32(floatsToBase64(samples));
    expect(decoded.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i++) {
      expect(decoded[i]).toBeCloseTo(samples[i], 6);
    }
  });

  it('drops a trailing partial float (length not a multiple of 4 bytes)', () => {
    const clean = floatsToBase64([1, 2]); // 8 bytes
    // Append two raw bytes -> 10 bytes -> only 2 full floats should decode.
    const decoded = decodeBase64ToFloat32(btoa(atob(clean) + 'ab'));
    expect(decoded.length).toBe(2);
    expect(decoded[0]).toBeCloseTo(1, 6);
    expect(decoded[1]).toBeCloseTo(2, 6);
  });
});

describe('decodeBase64ToInt16', () => {
  it('decodes Int16 PCM to normalized Float32 (value/32768)', () => {
    const raw = [0, 32767, -32768, 16384, -16384];
    const decoded = decodeBase64ToInt16(int16ToBase64(raw));
    expect(decoded.length).toBe(raw.length);
    expect(decoded[0]).toBeCloseTo(0, 6);
    expect(decoded[1]).toBeCloseTo(32767 / 32768, 6);
    expect(decoded[2]).toBeCloseTo(-1, 6);     // -32768/32768 = full-scale -1
    expect(decoded[3]).toBeCloseTo(0.5, 6);
    expect(decoded[4]).toBeCloseTo(-0.5, 6);
  });

  it('drops a trailing odd byte (length not a multiple of 2)', () => {
    const clean = int16ToBase64([100, -200]); // 4 bytes
    const decoded = decodeBase64ToInt16(btoa(atob(clean) + 'z'));
    expect(decoded.length).toBe(2);
    expect(decoded[0]).toBeCloseTo(100 / 32768, 6);
    expect(decoded[1]).toBeCloseTo(-200 / 32768, 6);
  });
});

describe('selectZone', () => {
  it('returns null for an empty zone list', () => {
    expect(selectZone([], 60)).toBeNull();
  });

  it('picks the zone whose key range covers the pitch', () => {
    const lo = zone({ loKey: 0, hiKey: 59, rootKey: 40 });
    const hi = zone({ loKey: 60, hiKey: 127, rootKey: 72 });
    expect(selectZone([lo, hi], 64)).toBe(hi);
    expect(selectZone([lo, hi], 30)).toBe(lo);
  });

  it('falls back to the nearest zone by rootKey when none covers the pitch', () => {
    const a = zone({ loKey: 0, hiKey: 10, rootKey: 5 });
    const b = zone({ loKey: 20, hiKey: 30, rootKey: 25 });
    expect(selectZone([a, b], 23)).toBe(b); // 23 uncovered, nearer b's root 25
    expect(selectZone([a, b], 7)).toBe(a);
  });

  it('always resolves a single full-range zone', () => {
    const only = zone({ loKey: 0, hiKey: 127, rootKey: 69 });
    expect(selectZone([only], 0)).toBe(only);
    expect(selectZone([only], 127)).toBe(only);
  });
});

describe('selectZoneIndex (drums vs melodic)', () => {
  const kick = zone({ loKey: 36, hiKey: 36, rootKey: 36 });
  const snare = zone({ loKey: 38, hiKey: 38, rootKey: 38 });
  const kit = [kick, snare];

  it('returns the index of the covering zone', () => {
    expect(selectZoneIndex(kit, 36, true)).toBe(0);
    expect(selectZoneIndex(kit, 38, true)).toBe(1);
  });

  it('returns -1 for an unmapped drum note (no wrong-sample substitution)', () => {
    expect(selectZoneIndex(kit, 40, true)).toBe(-1);
    expect(selectZone(kit, 40, true)).toBeNull();
  });

  it('melodic falls back to the nearest zone by rootKey when uncovered', () => {
    expect(selectZoneIndex(kit, 40, false)).toBe(1); // nearer snare root 38 than kick 36
    expect(selectZoneIndex(kit, 36, false)).toBe(0);
  });

  it('returns -1 for an empty zone list either way', () => {
    expect(selectZoneIndex([], 36, true)).toBe(-1);
    expect(selectZoneIndex([], 60, false)).toBe(-1);
  });
});

describe('computePlaybackRate', () => {
  it('is 1 at the root key', () => {
    expect(computePlaybackRate(69, 69, false)).toBeCloseTo(1, 6);
  });

  it('doubles one octave up and halves one octave down', () => {
    expect(computePlaybackRate(81, 69, false)).toBeCloseTo(2, 6);
    expect(computePlaybackRate(57, 69, false)).toBeCloseTo(0.5, 6);
  });

  it('is always 1 for drums regardless of pitch', () => {
    expect(computePlaybackRate(36, 60, true)).toBe(1);
    expect(computePlaybackRate(84, 60, true)).toBe(1);
  });
});
