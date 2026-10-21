import { describe, expect, it } from 'vitest';

import { mosaicGlitch } from '../../src/transitions/mosaicGlitch';
import { isNeutralMirrorPixelEffect } from '../../src/services/operators/mirrorPixelGraphUpgrade';
import { rgbSplitGlitch } from '../../src/transitions/rgbSplitGlitch';
import { scanlineGlitch } from '../../src/transitions/scanlineGlitch';

describe('effect-driven glitch transition definitions', () => {
  it('defines RGB Split Glitch through registered RGB Split effects', () => {
    expect(rgbSplitGlitch).toMatchObject({
      id: 'rgb-split-glitch',
      name: 'RGB Split Glitch',
      category: 'glitch',
      defaultDuration: 0.8,
      minDuration: 0.1,
      maxDuration: 3,
      description: 'Chromatic split through the cut using registered RGB Split passes',
    });
    expect(JSON.parse(JSON.stringify(rgbSplitGlitch.recipe))).toEqual(rgbSplitGlitch.recipe);
    expect(rgbSplitGlitch.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'rgb-split',
      effectName: 'RGB Split',
      params: {
        amount: { from: 0, to: 0.048 },
        angle: 0,
        edges: 'mirror',
      },
      startProgress: 0,
      endProgress: 0.62,
      curve: 'ease-in',
    });
    expect(rgbSplitGlitch.recipe).toContainEqual({
      kind: 'effect',
      target: 'incoming',
      effectType: 'rgb-split',
      effectName: 'RGB Split',
      params: {
        amount: { from: 0.048, to: 0 },
        angle: 3.14159,
        edges: 'mirror',
      },
      startProgress: 0.34,
      endProgress: 1,
      curve: 'ease-out',
    });
  });

  it('defines Mosaic Glitch through registered Pixelate effects', () => {
    expect(mosaicGlitch).toMatchObject({
      id: 'mosaic-glitch',
      name: 'Mosaic Glitch',
      category: 'glitch',
      defaultDuration: 0.9,
      minDuration: 0.1,
      maxDuration: 4,
      description: 'Pixelated mosaic breakup through the cut using registered Pixelate passes',
    });
    expect(JSON.parse(JSON.stringify(mosaicGlitch.recipe))).toEqual(mosaicGlitch.recipe);
    expect(mosaicGlitch.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'pixelate',
      effectName: 'Pixelate',
      params: {
        size: { from: 0, to: 44 },
      },
      startProgress: 0,
      endProgress: 0.66,
      curve: 'ease-in',
    });
  });

  it('starts and ends Mosaic Glitch on the clean picture at any composition size', () => {
    const sizes = mosaicGlitch.recipe.flatMap(step => step.kind === 'effect' && step.effectType === 'pixelate' ? [step.params.size] : []);
    expect(sizes).toEqual([{ from: 0, to: 44 }, { from: 44, to: 0 }]);
    // Pixel Size is in 1080p pixels: the cut ends are neutral (skipped) even at 4K, where size 1 would be 2-pixel cells.
    for (const [width, height] of [[3840, 2160], [1920, 1080], [1280, 720]]) {
      expect(isNeutralMirrorPixelEffect({ type: 'pixelate', params: { size: 0 } }, width, height)).toBe(true);
    }
    expect(isNeutralMirrorPixelEffect({ type: 'pixelate', params: { size: 1 } }, 3840, 2160)).toBe(false);
  });

  it('defines Scanline Glitch with static registered Scanlines effects', () => {
    expect(scanlineGlitch).toMatchObject({
      id: 'scanline-glitch',
      name: 'Scanline Glitch',
      category: 'glitch',
      defaultDuration: 0.85,
      minDuration: 0.1,
      maxDuration: 4,
      description: 'CRT scanline interference through the cut using registered Scanlines passes',
    });
    expect(JSON.parse(JSON.stringify(scanlineGlitch.recipe))).toEqual(scanlineGlitch.recipe);
    expect(scanlineGlitch.recipe).toContainEqual({
      kind: 'effect',
      target: 'incoming',
      effectType: 'scanlines',
      effectName: 'Scanlines',
      params: {
        density: { from: 16, to: 7 },
        opacity: { from: 0.58, to: 0.12 },
        speed: 0,
      },
      startProgress: 0.3,
      endProgress: 1,
      curve: 'ease-out',
    });
  });
});
