import { describe, expect, it } from 'vitest';

import {
  applyShadowHighlightTone,
  shadowHighlightToneLuma,
} from '../../src/engine/color/shadowHighlightTone';
import { applyColorGradeThumbnailPreview } from '../../src/services/colorGrades/colorGradeThumbnailPreview';
import { DEFAULT_PRIMARY_COLOR_PARAMS } from '../../src/types/colorCorrection';

const STRENGTHS = [-1, -0.5, -0.2671, 0.2671, 0.5, 1];

describe('primary shadows / highlights tone', () => {
  it('keeps black pinned and leaves mid grey and above untouched by Shadows', () => {
    for (const shadows of STRENGTHS) {
      expect(shadowHighlightToneLuma(0, shadows, 0)).toBe(0);
      expect(shadowHighlightToneLuma(0.5, shadows, 0)).toBeCloseTo(0.5, 10);
      expect(shadowHighlightToneLuma(0.8, shadows, 0)).toBeCloseTo(0.8, 10);
      expect(applyShadowHighlightTone(0, 0, 0, shadows, 0)).toEqual([0, 0, 0]);
    }
  });

  it('lifts or darkens shadow detail in the direction of the control', () => {
    expect(shadowHighlightToneLuma(0.17, 0.2671, 0)).toBeGreaterThan(0.2);
    expect(shadowHighlightToneLuma(0.17, 0.2671, 0)).toBeLessThan(0.22);
    expect(shadowHighlightToneLuma(0.17, -0.5, 0)).toBeLessThan(0.17);
    expect(shadowHighlightToneLuma(0.17, -1, 0)).toBeGreaterThan(0);
  });

  it('stays monotonic across the complete control range', () => {
    for (const shadows of [...STRENGTHS, 0]) {
      for (const highlights of [...STRENGTHS, 0]) {
        let previous = shadowHighlightToneLuma(0, shadows, highlights);
        for (let step = 1; step <= 400; step += 1) {
          const value = shadowHighlightToneLuma(step / 200, shadows, highlights);
          expect(value).toBeGreaterThanOrEqual(previous);
          previous = value;
        }
      }
    }
  });

  it('rolls negative Highlights off below white instead of clipping', () => {
    expect(shadowHighlightToneLuma(0.5, 0, -1)).toBeCloseTo(0.5, 10);
    expect(shadowHighlightToneLuma(1, 0, -1)).toBeCloseTo(0.75, 10);
    expect(shadowHighlightToneLuma(4, 0, -1)).toBeLessThan(1);
    expect(shadowHighlightToneLuma(1, 0, 0.5)).toBeGreaterThan(1);
  });

  it('keeps colour ratios instead of adding grey', () => {
    const [red, green, blue] = applyShadowHighlightTone(0.3, 0.1, 0.05, 0.5, 0);
    expect(red / green).toBeCloseTo(3, 10);
    expect(red / blue).toBeCloseTo(6, 10);
    expect(red).toBeGreaterThan(0.3);
  });

  it('does not push a dark saturated channel past white', () => {
    const [red, green, blue] = applyShadowHighlightTone(0, 0, 0.6, 1, 0);
    expect(red).toBe(0);
    expect(green).toBe(0);
    expect(blue).toBeLessThanOrEqual(1 + 1e-12);
    expect(blue).toBeGreaterThan(0.6);
  });

  it('keeps black pixels black in the thumbnail preview path', () => {
    const result = applyColorGradeThumbnailPreview(
      new Uint8ClampedArray([0, 0, 0, 255, 40, 40, 40, 255]),
      {
        graphHash: 'shadows',
        primaryNodes: [{ ...DEFAULT_PRIMARY_COLOR_PARAMS, shadows: 0.2671 }],
        curvesByNode: [],
      },
    );
    expect(Array.from(result.slice(0, 3))).toEqual([0, 0, 0]);
    expect(result[4]).toBeGreaterThan(40);
  });
});
