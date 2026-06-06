import { describe, expect, it } from 'vitest';
import {
  MAX_SPECTROGRAM_DRAW_PIXELS,
  resolveSpectrogramCanvasPlan,
} from '../../src/components/timeline/utils/spectrogramRenderPlan';

describe('resolveSpectrogramCanvasPlan', () => {
  it('caps deep-zoom spectrogram draw pixels while preserving visible CSS span', () => {
    const plan = resolveSpectrogramCanvasPlan({
      clipWidth: 250_000,
      renderStartPx: 75_000,
      renderWidth: 120_000,
      height: 180,
      dpr: 2,
    });

    expect(plan.startPx).toBe(75_000);
    expect(plan.cssCanvasWidth).toBe(120_000);
    expect(plan.drawWidth * plan.drawHeight).toBeLessThanOrEqual(MAX_SPECTROGRAM_DRAW_PIXELS);
    expect(plan.drawHeight).toBe(360);
  });

  it('uses full device resolution for small visible spectrogram windows', () => {
    const plan = resolveSpectrogramCanvasPlan({
      clipWidth: 800,
      renderStartPx: 120,
      renderWidth: 360,
      height: 80,
      dpr: 2,
    });

    expect(plan.cssCanvasWidth).toBe(360);
    expect(plan.drawWidth).toBe(720);
    expect(plan.drawHeight).toBe(160);
    expect(plan.drawWidth * plan.drawHeight).toBeLessThanOrEqual(MAX_SPECTROGRAM_DRAW_PIXELS);
  });

  it('clamps invalid geometry to a drawable one-pixel fallback', () => {
    const plan = resolveSpectrogramCanvasPlan({
      clipWidth: Number.NaN,
      renderStartPx: Number.POSITIVE_INFINITY,
      renderWidth: 0,
      height: -1,
      dpr: 0,
    });

    expect(plan).toMatchObject({
      startPx: 0,
      cssCanvasWidth: 1,
      drawWidth: 1,
      drawHeight: 1,
      effectiveDpr: 1,
    });
  });
});
