import { describe, expect, it } from 'vitest';

import { chromaLeak } from '../../src/transitions/chromaLeak';
import { filmBurn } from '../../src/transitions/filmBurn';
import { filmRoll } from '../../src/transitions/filmRoll';
import { lensFlare } from '../../src/transitions/lensFlare';
import { lightLeak } from '../../src/transitions/lightLeak';
import { lightSweep } from '../../src/transitions/lightSweep';
import { projectorFlicker } from '../../src/transitions/projectorFlicker';
import { vignetteBloom } from '../../src/transitions/vignetteBloom';

describe('light and film transition definitions', () => {
  it('defines Projector Flicker with deterministic solid opacity pulses', () => {
    expect(projectorFlicker).toMatchObject({
      id: 'projector-flicker',
      name: 'Projector Flicker',
      category: 'light',
      defaultDuration: 0.9,
      minDuration: 0.1,
      maxDuration: 4,
      description: 'Deterministic projector-style exposure flicker over the cut',
    });
    expect(JSON.parse(JSON.stringify(projectorFlicker.recipe))).toEqual(projectorFlicker.recipe);
    expect(projectorFlicker.recipe).toContainEqual({ kind: 'solid', color: '#fff3c4' });
    expect(projectorFlicker.recipe).toContainEqual({
      kind: 'opacity',
      target: 'solid',
      from: 0.08,
      to: 0.46,
      startProgress: 0.36,
      endProgress: 0.5,
      curve: 'ease-out',
    });
  });

  it('defines Light Sweep with a deterministic generated overlay primitive', () => {
    expect(lightSweep).toMatchObject({
      id: 'light-sweep',
      name: 'Light Sweep',
      category: 'light',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'A deterministic diagonal highlight band sweeps across the cut',
    });
    expect(JSON.parse(JSON.stringify(lightSweep.recipe))).toEqual(lightSweep.recipe);
    expect(lightSweep.params?.color).toMatchObject({
      type: 'color',
      defaultValue: '#fff7d2',
    });
    expect(lightSweep.recipe).toContainEqual({
      kind: 'overlay',
      overlay: 'light-sweep',
      color: '#fff7d2',
      colorParam: 'color',
      blendMode: 'screen',
      opacity: { from: 0, to: 0.92 },
      centerX: { from: -0.28, to: 1.28 },
      width: 0.18,
      softness: 0.32,
      angle: -0.38,
      startProgress: 0.08,
      endProgress: 0.82,
      curve: 'ease-in-out',
    });
  });

  it('defines Light Leak with deterministic generated warm edge overlays', () => {
    expect(lightLeak).toMatchObject({
      id: 'light-leak',
      name: 'Light Leak',
      category: 'light',
      defaultDuration: 1.25,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'A warm analog edge leak washes across the cut',
    });
    expect(JSON.parse(JSON.stringify(lightLeak.recipe))).toEqual(lightLeak.recipe);
    expect(lightLeak.params?.color).toMatchObject({
      type: 'color',
      defaultValue: '#ffb36a',
    });
    expect(lightLeak.recipe).toContainEqual({
      kind: 'overlay',
      overlay: 'light-leak',
      color: '#ffb36a',
      colorParam: 'color',
      blendMode: 'screen',
      opacity: { from: 0, to: 0.86 },
      centerX: { from: -0.2, to: 0.42 },
      width: 0.44,
      softness: 0.42,
      angle: 0.12,
      startProgress: 0,
      endProgress: 0.58,
      curve: 'ease-out',
    });
  });

  it('defines Chroma Leak with deterministic generated color-split overlays', () => {
    expect(chromaLeak).toMatchObject({
      id: 'chroma-leak',
      name: 'Chroma Leak',
      category: 'light',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Chromatic color leak and split streaks wash across the cut',
    });
    expect(JSON.parse(JSON.stringify(chromaLeak.recipe))).toEqual(chromaLeak.recipe);
    expect(chromaLeak.params?.color).toMatchObject({
      type: 'color',
      defaultValue: '#ff3b8f',
    });
    expect(chromaLeak.recipe).toContainEqual({
      kind: 'overlay',
      overlay: 'chroma-leak',
      color: '#ff3b8f',
      colorParam: 'color',
      blendMode: 'normal',
      opacity: { from: 0, to: 0.58 },
      centerX: { from: -0.18, to: 0.48 },
      width: 0.42,
      softness: 0.3,
      angle: 0.16,
      startProgress: 0,
      endProgress: 0.6,
      curve: 'ease-out',
    });
  });

  it('defines Lens Flare with deterministic generated flare overlays', () => {
    expect(lensFlare).toMatchObject({
      id: 'lens-flare',
      name: 'Lens Flare',
      category: 'light',
      defaultDuration: 1.15,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Deterministic lens flare streak and ghosts pass over the cut',
    });
    expect(JSON.parse(JSON.stringify(lensFlare.recipe))).toEqual(lensFlare.recipe);
    expect(lensFlare.params?.color).toMatchObject({
      type: 'color',
      defaultValue: '#d7f0ff',
    });
    expect(lensFlare.recipe).toContainEqual({
      kind: 'overlay',
      overlay: 'lens-flare',
      color: '#d7f0ff',
      colorParam: 'color',
      blendMode: 'normal',
      opacity: { from: 0, to: 0.5 },
      centerX: { from: -0.22, to: 0.62 },
      width: 0.28,
      softness: 0.36,
      angle: -0.04,
      startProgress: 0.02,
      endProgress: 0.58,
      curve: 'ease-out',
    });
  });

  it('defines Film Burn with deterministic generated burn-edge overlays', () => {
    expect(filmBurn).toMatchObject({
      id: 'film-burn',
      name: 'Film Burn',
      category: 'light',
      defaultDuration: 1.2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Warm burn edge and exposure wash reveal the incoming clip',
    });
    expect(JSON.parse(JSON.stringify(filmBurn.recipe))).toEqual(filmBurn.recipe);
    expect(filmBurn.params?.color).toMatchObject({
      type: 'color',
      defaultValue: '#ff6a2e',
    });
    expect(filmBurn.recipe).toContainEqual({
      kind: 'overlay',
      overlay: 'film-burn',
      color: '#ff6a2e',
      colorParam: 'color',
      blendMode: 'normal',
      opacity: { from: 0, to: 0.62 },
      centerX: { from: -0.15, to: 0.56 },
      width: 0.34,
      softness: 0.24,
      angle: 0.06,
      startProgress: 0,
      endProgress: 0.56,
      curve: 'ease-out',
    });
  });

  it('defines Film Roll with vertical transform and motion blur primitives', () => {
    expect(filmRoll).toMatchObject({
      id: 'film-roll',
      name: 'Film Roll',
      category: 'light',
      defaultDuration: 0.9,
      minDuration: 0.1,
      maxDuration: 4,
      description: 'Vertical film-roll movement through the cut with motion blur',
    });
    expect(JSON.parse(JSON.stringify(filmRoll.recipe))).toEqual(filmRoll.recipe);
    expect(filmRoll.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      translateY: { from: 0, to: -0.18 },
      scaleX: { from: 1, to: 1.1 },
      scaleY: { from: 1, to: 1.28 },
      startProgress: 0,
      endProgress: 0.72,
      curve: 'ease-in',
    });
    expect(filmRoll.recipe).toContainEqual({
      kind: 'effect',
      target: 'incoming',
      effectType: 'motion-blur',
      effectName: 'Motion Blur',
      params: {
        amount: { from: 0.1, to: 0 },
        angle: 1.5708,
        samples: 32,
      },
      startProgress: 0.28,
      endProgress: 1,
      curve: 'ease-out',
    });
  });

  it('defines Vignette Bloom through registered Glow and Vignette effects', () => {
    expect(vignetteBloom).toMatchObject({
      id: 'vignette-bloom',
      name: 'Vignette Bloom',
      category: 'light',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Soft glow and edge vignette hide the cut',
    });
    expect(JSON.parse(JSON.stringify(vignetteBloom.recipe))).toEqual(vignetteBloom.recipe);
    expect(vignetteBloom.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'glow',
      effectName: 'Glow',
      params: {
        amount: { from: 0.2, to: 2.2 },
        threshold: { from: 0.78, to: 0.42 },
        radius: { from: 18, to: 44 },
        softness: 0.65,
        rings: 3,
        samplesPerRing: 10,
      },
      startProgress: 0,
      endProgress: 0.7,
      curve: 'ease-in',
    });
    expect(vignetteBloom.recipe).toContainEqual({
      kind: 'effect',
      target: 'incoming',
      effectType: 'vignette',
      effectName: 'Vignette',
      params: {
        amount: { from: 0.72, to: 0.12 },
        size: { from: 0.58, to: 0.82 },
        softness: 0.78,
        roundness: 1,
      },
      startProgress: 0.28,
      endProgress: 1,
      curve: 'ease-out',
    });
  });
});
