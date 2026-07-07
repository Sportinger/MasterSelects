import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTROLLER_LANES,
  LANE_TYPES,
  clamp01,
  getLaneType,
  midiToVel01,
  vel01ToMidi,
  velocityToColor,
} from '../../src/components/pianoRoll/controllerLanes/pianoRollLaneTypes';

describe('pianoRollLaneTypes registry', () => {
  it('ships a single velocity lane as a per-note property on the 0–127 scale', () => {
    expect(LANE_TYPES).toHaveLength(1);
    const velocity = getLaneType('velocity');
    expect(velocity).toMatchObject({ id: 'velocity', kind: 'note-property', min: 0, max: 127 });
  });

  it('defaults the controller area to the velocity lane', () => {
    expect(DEFAULT_CONTROLLER_LANES).toEqual(['velocity']);
  });

  it('returns undefined for an unknown lane id', () => {
    expect(getLaneType('cc1')).toBeUndefined();
  });
});

describe('velocity scale helpers', () => {
  it('clamps the stored 0–1 range', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });

  it('maps stored velocity to the 0–127 MIDI scale at the rails and middle', () => {
    expect(vel01ToMidi(0)).toBe(0);
    expect(vel01ToMidi(1)).toBe(127);
    expect(vel01ToMidi(0.5)).toBe(64); // round(63.5)
  });

  it('clamps out-of-range velocities when converting to MIDI', () => {
    expect(vel01ToMidi(-1)).toBe(0);
    expect(vel01ToMidi(5)).toBe(127);
  });

  it('maps a MIDI value back into the stored 0–1 range', () => {
    expect(midiToVel01(0)).toBe(0);
    expect(midiToVel01(127)).toBe(1);
    expect(midiToVel01(254)).toBe(1); // clamped
  });

  it('round-trips every MIDI value through stored velocity', () => {
    for (let n = 0; n <= 127; n++) {
      expect(vel01ToMidi(midiToVel01(n))).toBe(n);
    }
  });
});

describe('velocityToColor ramp', () => {
  it('returns an hsl() solid fill (no gradient — Mesa tiling guard)', () => {
    expect(velocityToColor(0.5)).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });

  it('sweeps blue→violet→red, monotonic, never entering the green/yellow band', () => {
    const parse = (v: number) => {
      const m = velocityToColor(v).match(/^hsl\((\d+), (\d+)%, (\d+)%\)$/);
      if (!m) throw new Error(`unexpected color ${velocityToColor(v)}`);
      return { hue: Number(m[1]), light: Number(m[3]) };
    };
    const low = parse(0);
    const mid = parse(0.5);
    const high = parse(1);
    // Low end is blue, high end is red, midpoint is violet/magenta.
    expect(low.hue).toBeGreaterThanOrEqual(215);
    expect(low.hue).toBeLessThanOrEqual(245);
    expect(high.hue).toBe(360); // red
    expect(mid.hue).toBeGreaterThan(270);
    expect(mid.hue).toBeLessThan(315);
    // Hue increases monotonically, and the whole arc avoids the green/yellow
    // band (~40°–200°) so the amber selection ring keeps its contrast.
    for (let i = 0; i <= 10; i++) {
      const hue = parse(i / 10).hue;
      expect(hue).toBeGreaterThanOrEqual(225);
      expect(hue).toBeLessThanOrEqual(360);
    }
    expect(mid.hue).toBeGreaterThan(low.hue);
    expect(high.hue).toBeGreaterThan(mid.hue);
    // Slight low-dim→high-hot lightness lift.
    expect(high.light).toBeGreaterThan(low.light);
  });

  it('clamps out-of-range input', () => {
    expect(velocityToColor(-1)).toBe(velocityToColor(0));
    expect(velocityToColor(2)).toBe(velocityToColor(1));
  });
});
