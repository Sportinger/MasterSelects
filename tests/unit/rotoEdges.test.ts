import { describe, expect, it } from 'vitest';
import { refineRotoEdges } from '../../src/services/roto/rotoEdges';
import type { RotoMask } from '../../src/services/roto/rotoTypes';

const mask = (width: number, height: number, selected: (x: number, y: number) => boolean): RotoMask => ({
  width, height, time: 0, duration: .04,
  data: Uint8Array.from({ length: width * height }, (_, i) => selected(i % width, Math.floor(i / width)) ? 255 : 0),
});
describe('Roto geometric edges', () => {
  it('preserves the original mask when both controls are reset', () => {
    const source = mask(9, 7, (x, y) => x > 1 && x < 7 && y > 1 && y < 5);
    expect(refineRotoEdges(source, { offset: 0, softness: 0 })).toBe(source.data);
  });
  it('softens both sides of a boundary symmetrically without changing the source', () => {
    const source = mask(9, 7, x => x >= 4), before = source.data.slice();
    const result = refineRotoEdges(source, { offset: 0, softness: 1 });
    expect(Array.from(result.subarray(27, 36))).toEqual([0, 0, 0, 64, 191, 255, 255, 255, 255]);
    expect(source.data).toEqual(before);
  });
  it('expands and shrinks membership in source pixels', () => {
    const source = mask(9, 7, x => x >= 4);
    expect(refineRotoEdges(source, { offset: 1, softness: 0 })[3]).toBe(255);
    expect(refineRotoEdges(source, { offset: -1, softness: 0 })[4]).toBe(0);
    expect(refineRotoEdges(source, { offset: -1, softness: 0 })[5]).toBe(255);
  });
  it('retains holes, thin features and disconnected regions at a small softness', () => {
    const source = mask(11, 11, (x, y) => (x >= 2 && x <= 8 && y >= 2 && y <= 8 && !(x >= 4 && x <= 6 && y >= 4 && y <= 6)) || (x === 0 && y === 0));
    const result = refineRotoEdges(source, { offset: 0, softness: 1 });
    expect(result[5 * 11 + 5]).toBe(0);
    expect(result[0]).toBeGreaterThan(127);
    expect(result[2 * 11 + 5]).toBeGreaterThan(127);
  });
  it('does not create a border on fully empty or fully selected images', () => {
    for (const value of [false, true]) {
      const source = mask(5, 3, () => value);
      expect(refineRotoEdges(source, { offset: value ? -8 : 8, softness: 8 })).toEqual(source.data);
    }
  });
  it('matches a brute-force Euclidean reference on an asymmetric mask', () => {
    const source = mask(8, 6, (x, y) => (x + 2 * y) % 5 === 0);
    const output = refineRotoEdges(source, { offset: .2, softness: 1.5 });
    for (let i = 0; i < source.data.length; i++) {
      let distance = Infinity;
      for (let j = 0; j < source.data.length; j++) if (source.data[j] !== source.data[i]) {
        distance = Math.min(distance, Math.hypot(i % 8 - j % 8, Math.floor(i / 8) - Math.floor(j / 8)));
      }
      const signed = (source.data[i] ? 1 : -1) * (distance - .5);
      expect(output[i]).toBe(Math.round(255 * Math.max(0, Math.min(1, .5 + (signed + .2) / 3))));
    }
  });
});
