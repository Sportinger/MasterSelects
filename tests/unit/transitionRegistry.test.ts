import { describe, expect, it } from 'vitest';

import {
  getAllTransitions,
  getCategoriesWithTransitions,
  getDefaultTransitionParams,
  getRuntimeTransition,
  getTransition,
  getTransitionsByCategory,
  isTransitionRuntimeEnabled,
  isTransitionVisibleInRegistry,
  normalizeTransitionInstanceParams,
  normalizeTransitionParamsForDefinition,
  type TransitionDefinition,
  type TransitionPrimitive,
} from '../../src/transitions';

describe('transition registry', () => {
  it('registers the full first-pass transition suite with serializable recipes', () => {
    const transitions = getAllTransitions();

    expect(transitions.map((transition) => transition.id)).toEqual([
      'crossfade',
      'blur-dissolve',
      'additive-dissolve',
      'non-additive-dissolve',
      'dip-to-color',
      'dip-to-black',
      'dip-to-white',
      'wipe-left',
      'wipe-right',
      'wipe-up',
      'wipe-down',
      'circle-iris',
      'oval-iris',
      'diamond-iris',
      'square-iris',
      'triangle-iris',
      'cross-iris',
      'star-iris',
      'clock-wipe',
      'center-wipe',
      'barn-door-horizontal',
      'barn-door-vertical',
      'push-left',
      'push-right',
      'push-up',
      'push-down',
      'slide-left',
      'slide-right',
      'slide-up',
      'slide-down',
      'flash',
      'light-leak',
      'light-sweep',
      'chroma-leak',
      'lens-flare',
      'film-burn',
      'projector-flicker',
      'film-roll',
      'vignette-bloom',
      'noise-dissolve',
      'rotate-left',
      'rotate-right',
      'rotate-90',
      'water-drop',
      'swirl',
      'kaleidoscope',
      'block-glitch',
      'crt-collapse',
      'rgb-split-glitch',
      'mosaic-glitch',
      'scanline-glitch',
      'checker-wipe',
      'random-blocks',
      'paint-splatter',
      'polka-dot-curtain',
      'doom-bars',
      'venetian-blinds-horizontal',
      'venetian-blinds-vertical',
      'zig-zag-blocks',
      'puzzle-push',
      'magnetic-tiles',
      'flip-horizontal',
      'flip-vertical',
      'card-spin',
      'tumble-away',
      'roll-3d',
      'spinback-3d',
      'zoom-in',
      'zoom-out',
      'spin-zoom',
      'zoom-blur',
      'directional-blur',
      'whip-pan',
    ]);

    for (const transition of transitions) {
      expect(transition.defaultDuration).toBeGreaterThan(0);
      expect(transition.minDuration).toBeGreaterThan(0);
      if (transition.maxDuration !== undefined) {
        expect(transition.maxDuration).toBeGreaterThanOrEqual(transition.defaultDuration);
      }
      expect(transition.recipe.length).toBeGreaterThan(0);
      expect(transition.capability ?? 'stable').toBe('stable');
      expect(JSON.parse(JSON.stringify(transition.recipe)) as TransitionPrimitive[]).toEqual(transition.recipe);
    }
  });

  it('groups dissolve and wipe transitions by category', () => {
    expect(getTransitionsByCategory('dissolve').map((transition) => transition.id)).toEqual([
      'crossfade',
      'blur-dissolve',
      'additive-dissolve',
      'non-additive-dissolve',
      'dip-to-color',
      'dip-to-black',
      'dip-to-white',
    ]);
    expect(getTransitionsByCategory('wipe').map((transition) => transition.id)).toEqual([
      'wipe-left',
      'wipe-right',
      'wipe-up',
      'wipe-down',
      'circle-iris',
      'oval-iris',
      'diamond-iris',
      'square-iris',
      'triangle-iris',
      'cross-iris',
      'star-iris',
      'clock-wipe',
      'center-wipe',
      'barn-door-horizontal',
      'barn-door-vertical',
    ]);
    expect(getTransitionsByCategory('slide').map((transition) => transition.id)).toEqual([
      'push-left',
      'push-right',
      'push-up',
      'push-down',
      'slide-left',
      'slide-right',
      'slide-up',
      'slide-down',
    ]);
    expect(getTransitionsByCategory('light').map((transition) => transition.id)).toEqual([
      'flash',
      'light-leak',
      'light-sweep',
      'chroma-leak',
      'lens-flare',
      'film-burn',
      'projector-flicker',
      'film-roll',
      'vignette-bloom',
    ]);
    expect(getTransitionsByCategory('glitch').map((transition) => transition.id)).toEqual([
      'block-glitch',
      'crt-collapse',
      'rgb-split-glitch',
      'mosaic-glitch',
      'scanline-glitch',
    ]);
    expect(getTransitionsByCategory('pattern').map((transition) => transition.id)).toEqual([
      'checker-wipe',
      'random-blocks',
      'paint-splatter',
      'polka-dot-curtain',
      'doom-bars',
      'venetian-blinds-horizontal',
      'venetian-blinds-vertical',
      'zig-zag-blocks',
      'puzzle-push',
      'magnetic-tiles',
    ]);
    expect(getTransitionsByCategory('stylize').map((transition) => transition.id)).toEqual([
      'noise-dissolve',
      'water-drop',
      'swirl',
      'kaleidoscope',
    ]);
    expect(getTransitionsByCategory('rotate').map((transition) => transition.id)).toEqual([
      'rotate-left',
      'rotate-right',
      'rotate-90',
    ]);
    expect(getTransitionsByCategory('3d').map((transition) => transition.id)).toEqual([
      'flip-horizontal',
      'flip-vertical',
      'card-spin',
      'tumble-away',
      'roll-3d',
      'spinback-3d',
    ]);
    expect(getTransitionsByCategory('zoom').map((transition) => transition.id)).toEqual([
      'zoom-in',
      'zoom-out',
      'spin-zoom',
      'zoom-blur',
      'directional-blur',
      'whip-pan',
    ]);
    expect(getCategoriesWithTransitions().map((entry) => entry.category)).toEqual([
      'dissolve',
      'wipe',
      'slide',
      'light',
      'glitch',
      'pattern',
      'stylize',
      'rotate',
      '3d',
      'zoom',
    ]);
  });

  it('defines first-pass render models through primitive recipes', () => {
    expect(getTransition('crossfade')?.recipe).toEqual([
      expect.objectContaining({ kind: 'opacity', target: 'incoming', from: 0, to: 1 }),
    ]);
    expect(getTransition('dip-to-color')?.recipe).toContainEqual({ kind: 'solid', color: '#000000', colorParam: 'color' });
    expect(getTransition('dip-to-black')?.recipe).toContainEqual({ kind: 'solid', color: '#000000' });
    expect(getTransition('dip-to-white')?.recipe).toContainEqual({ kind: 'solid', color: '#ffffff' });
    expect(getTransition('noise-dissolve')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'procedural', procedural: 'noise' },
    ]);
    expect(getDefaultTransitionParams(getTransition('noise-dissolve'))).toEqual({ seed: 0 });
    expect(normalizeTransitionParamsForDefinition(getTransition('noise-dissolve'), { seed: 2_000_000 }))
      .toEqual({ seed: 1_000_000 });
    expect(getTransition('blur-dissolve')?.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'gaussian-blur',
      effectName: 'Gaussian Blur',
      params: {
        radius: { from: 0, to: 28 },
        samples: 11,
      },
      startProgress: 0,
      endProgress: 0.88,
      curve: 'ease-in',
    });
    expect(getTransition('additive-dissolve')?.recipe).toContainEqual({
      kind: 'blend',
      target: 'incoming',
      mode: 'add',
      startProgress: 0.04,
      endProgress: 0.92,
    });
    expect(getTransition('non-additive-dissolve')?.recipe).toContainEqual({
      kind: 'blend',
      target: 'incoming',
      mode: 'multiply',
      startProgress: 0.04,
      endProgress: 0.92,
    });
    expect(getTransition('rotate-left')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateZ: { from: 0, to: -0.42 },
      scaleX: { from: 1, to: 0.88 },
      scaleY: { from: 1, to: 0.88 },
      curve: 'ease-in',
    });
    expect(getTransition('rotate-right')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateZ: { from: 0, to: 0.42 },
      scaleX: { from: 1, to: 0.88 },
      scaleY: { from: 1, to: 0.88 },
      curve: 'ease-in',
    });
    expect(getTransition('rotate-90')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateZ: { from: 0, to: -Math.PI / 2 },
      scaleX: { from: 1, to: 0.92 },
      scaleY: { from: 1, to: 0.92 },
      curve: 'ease-in',
    });
    expect(getTransition('block-glitch')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'procedural', procedural: 'blocks' },
    ]);
    expect(getDefaultTransitionParams(getTransition('block-glitch'))).toEqual({ seed: 0 });
    expect(getTransition('crt-collapse')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      scaleX: { from: 1, to: 1.08 },
      scaleY: { from: 1, to: 0.045 },
      endProgress: 0.5,
      curve: 'ease-in',
    });
    expect(getTransition('rgb-split-glitch')?.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'rgb-split',
      effectName: 'RGB Split',
      params: {
        amount: { from: 0, to: 0.048 },
        angle: 0,
      },
      startProgress: 0,
      endProgress: 0.62,
      curve: 'ease-in',
    });
    expect(getTransition('mosaic-glitch')?.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'pixelate',
      effectName: 'Pixelate',
      params: {
        size: { from: 1, to: 44 },
      },
      startProgress: 0,
      endProgress: 0.66,
      curve: 'ease-in',
    });
    expect(getTransition('scanline-glitch')?.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'scanlines',
      effectName: 'Scanlines',
      params: {
        density: { from: 7, to: 16 },
        opacity: { from: 0.12, to: 0.58 },
        speed: 0,
      },
      startProgress: 0,
      endProgress: 0.7,
      curve: 'ease-in',
    });
    expect(getTransition('kaleidoscope')?.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'kaleidoscope',
      effectName: 'Kaleidoscope',
      params: {
        segments: { from: 5, to: 14 },
        rotation: { from: 0, to: Math.PI * 2 },
      },
      startProgress: 0,
      endProgress: 0.72,
      curve: 'ease-in',
    });
    expect(getTransition('checker-wipe')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'pattern', pattern: 'checker' },
    ]);
    expect(getTransition('random-blocks')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'pattern', pattern: 'random-blocks' },
    ]);
    expect(getTransition('paint-splatter')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'pattern', pattern: 'paint-splatter' },
    ]);
    expect(getTransition('polka-dot-curtain')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'pattern', pattern: 'polka-dot' },
    ]);
    expect(getTransition('doom-bars')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'pattern', pattern: 'doom-bars' },
    ]);
    expect(getTransition('venetian-blinds-horizontal')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'pattern', pattern: 'venetian-horizontal' },
    ]);
    expect(getTransition('venetian-blinds-vertical')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'pattern', pattern: 'venetian-vertical' },
    ]);
    expect(getTransition('zig-zag-blocks')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'pattern', pattern: 'zig-zag' },
    ]);
    expect(getTransition('puzzle-push')?.recipe).toContainEqual({
      kind: 'multi-panel',
      target: 'incoming',
      rows: 4,
      columns: 4,
      order: 'row-major',
      motion: 'puzzle',
      seed: 0,
      stagger: 0.32,
      curve: 'ease-out',
    });
    expect(getDefaultTransitionParams(getTransition('puzzle-push'))).toEqual({ seed: 0 });
    expect(getTransition('magnetic-tiles')?.recipe).toContainEqual({
      kind: 'multi-panel',
      target: 'incoming',
      rows: 4,
      columns: 5,
      order: 'magnetic',
      motion: 'magnetic',
      seed: 0,
      stagger: 0.24,
      curve: 'ease-in',
    });
    expect(getDefaultTransitionParams(getTransition('magnetic-tiles'))).toEqual({ seed: 0 });
    expect(getTransition('wipe-left')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'wipe', direction: 'left' },
    ]);
    expect(getTransition('wipe-right')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'wipe', direction: 'right' },
    ]);
    expect(getTransition('wipe-up')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'wipe', direction: 'up' },
    ]);
    expect(getTransition('wipe-down')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'wipe', direction: 'down' },
    ]);
    expect(getTransition('circle-iris')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'shape', shape: 'circle' },
    ]);
    expect(getTransition('oval-iris')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'shape', shape: 'oval' },
    ]);
    expect(getTransition('diamond-iris')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'shape', shape: 'diamond' },
    ]);
    expect(getTransition('square-iris')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'shape', shape: 'rect' },
    ]);
    expect(getTransition('triangle-iris')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'shape', shape: 'triangle' },
    ]);
    expect(getTransition('cross-iris')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'shape', shape: 'cross' },
    ]);
    expect(getTransition('star-iris')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'shape', shape: 'star' },
    ]);
    expect(getTransition('clock-wipe')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'clock', clockwise: true, angleOffset: 0 },
    ]);
    expect(getTransition('center-wipe')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'center', axis: 'x' },
    ]);
    expect(getTransition('barn-door-horizontal')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'center', axis: 'x' },
    ]);
    expect(getTransition('barn-door-vertical')?.recipe).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'center', axis: 'y' },
    ]);
    expect(getTransition('push-left')?.recipe).toEqual([
      { kind: 'transform', target: 'outgoing', translateX: { from: 0, to: -1 }, curve: 'linear' },
      { kind: 'transform', target: 'incoming', translateX: { from: 1, to: 0 }, curve: 'linear' },
    ]);
    expect(getTransition('slide-left')?.recipe).toEqual([
      { kind: 'transform', target: 'incoming', translateX: { from: 1, to: 0 }, curve: 'linear' },
    ]);
    expect(getTransition('flash')?.recipe).toContainEqual({ kind: 'solid', color: '#ffffff' });
    expect(getTransition('flash')?.recipe).toContainEqual({
      kind: 'opacity',
      target: 'solid',
      from: 0,
      to: 0.92,
      startProgress: 0,
      endProgress: 0.42,
      curve: 'ease-out',
    });
    expect(getTransition('light-leak')?.recipe).toContainEqual({
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
    expect(getTransition('light-sweep')?.recipe).toContainEqual({
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
    expect(getTransition('chroma-leak')?.recipe).toContainEqual({
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
    expect(getTransition('lens-flare')?.recipe).toContainEqual({
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
    expect(getTransition('film-burn')?.recipe).toContainEqual({
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
    expect(getTransition('projector-flicker')?.recipe).toContainEqual({
      kind: 'opacity',
      target: 'solid',
      from: 0.08,
      to: 0.46,
      startProgress: 0.36,
      endProgress: 0.5,
      curve: 'ease-out',
    });
    expect(getTransition('film-roll')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      translateY: { from: 0, to: -0.18 },
      scaleX: { from: 1, to: 1.1 },
      scaleY: { from: 1, to: 1.28 },
      startProgress: 0,
      endProgress: 0.72,
      curve: 'ease-in',
    });
    expect(getTransition('vignette-bloom')?.recipe).toContainEqual({
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
    expect(getTransition('flip-horizontal')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateY: { from: 0, to: -Math.PI / 2 },
      translateZ: { from: 0, to: -0.12 },
      endProgress: 0.5,
      curve: 'ease-in',
    });
    expect(getTransition('flip-horizontal')?.renderMode).toBe('scene-3d-panel');
    expect(getTransition('flip-vertical')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: Math.PI / 2 },
      translateZ: { from: 0, to: -0.12 },
      endProgress: 0.5,
      curve: 'ease-in',
    });
    expect(getTransition('flip-vertical')?.renderMode).toBe('scene-3d-panel');
    expect(getTransition('card-spin')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateY: { from: 0, to: Math.PI / 2 },
      rotateZ: { from: 0, to: 0.08 },
      scaleX: { from: 1, to: 0.94 },
      scaleY: { from: 1, to: 0.94 },
      translateZ: { from: 0, to: -0.18 },
      endProgress: 0.5,
      curve: 'ease-in',
    });
    expect(getTransition('card-spin')?.renderMode).toBe('scene-3d-panel');
    expect(getTransition('tumble-away')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: 0.92 },
      rotateY: { from: 0, to: -0.56 },
      rotateZ: { from: 0, to: -0.18 },
      translateY: { from: 0, to: 0.18 },
      translateZ: { from: 0, to: -0.28 },
      scaleX: { from: 1, to: 0.72 },
      scaleY: { from: 1, to: 0.72 },
      endProgress: 0.78,
      curve: 'ease-in',
    });
    expect(getTransition('tumble-away')?.renderMode).toBe('scene-3d-panel');
    expect(getTransition('roll-3d')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: -Math.PI / 2 },
      rotateZ: { from: 0, to: -0.1 },
      translateY: { from: 0, to: -0.06 },
      translateZ: { from: 0, to: -0.16 },
      scaleX: { from: 1, to: 0.96 },
      scaleY: { from: 1, to: 0.96 },
      endProgress: 0.52,
      curve: 'ease-in',
    });
    expect(getTransition('roll-3d')?.renderMode).toBe('scene-3d-panel');
    expect(getTransition('spinback-3d')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: 0.36 },
      rotateY: { from: 0, to: -0.74 },
      rotateZ: { from: 0, to: -0.92 },
      translateZ: { from: 0, to: -0.34 },
      scaleX: { from: 1, to: 0.62 },
      scaleY: { from: 1, to: 0.62 },
      endProgress: 0.68,
      curve: 'ease-in',
    });
    expect(getTransition('spinback-3d')?.renderMode).toBe('scene-3d-panel');
    expect(getTransition('zoom-in')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      scaleX: { from: 1.18, to: 1 },
      scaleY: { from: 1.18, to: 1 },
      curve: 'ease-out',
    });
    expect(getTransition('zoom-out')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      scaleX: { from: 1, to: 0.86 },
      scaleY: { from: 1, to: 0.86 },
      curve: 'ease-in',
    });
    expect(getTransition('spin-zoom')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      rotateZ: { from: -0.18, to: 0 },
      scaleX: { from: 1.14, to: 1 },
      scaleY: { from: 1.14, to: 1 },
      curve: 'ease-out',
    });
    expect(getTransition('zoom-blur')?.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'zoom-blur',
      effectName: 'Zoom Blur',
      params: {
        amount: { from: 0, to: 0.46 },
        centerX: 0.5,
        centerY: 0.5,
        samples: 32,
      },
      startProgress: 0,
      endProgress: 0.62,
      curve: 'ease-in',
    });
    expect(getTransition('directional-blur')?.recipe).toContainEqual({
      kind: 'effect',
      target: 'outgoing',
      effectType: 'motion-blur',
      effectName: 'Motion Blur',
      params: {
        amount: { from: 0, to: 0.11 },
        angle: 0,
        samples: 32,
      },
      startProgress: 0,
      endProgress: 0.66,
      curve: 'ease-in',
    });
    expect(getTransition('whip-pan')?.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      translateX: { from: 0, to: -0.1 },
      scaleX: { from: 1, to: 1.18 },
      scaleY: { from: 1, to: 1.18 },
      startProgress: 0,
      endProgress: 0.68,
      curve: 'ease-in',
    });
  });

  it('gates experimental and planned transitions separately from metadata lookups', () => {
    const experimental = {
      ...getTransition('crossfade')!,
      id: 'experimental-transition',
      capability: 'experimental',
    } as TransitionDefinition;
    const planned = {
      ...getTransition('crossfade')!,
      id: 'planned-transition',
      capability: 'planned',
    } as TransitionDefinition;

    expect(isTransitionRuntimeEnabled(experimental)).toBe(false);
    expect(isTransitionRuntimeEnabled(experimental, { includeExperimental: true })).toBe(true);
    expect(isTransitionRuntimeEnabled(planned, { includePlanned: true })).toBe(false);
    expect(isTransitionVisibleInRegistry(planned, { includePlanned: true })).toBe(true);
    expect(getRuntimeTransition('crossfade')?.id).toBe('crossfade');
    expect(getTransition('water-drop')?.capability).toBeUndefined();
    expect(getTransition('swirl')?.capability).toBeUndefined();
    expect(getRuntimeTransition('water-drop')?.id).toBe('water-drop');
    expect(getAllTransitions().map((transition) => transition.id))
      .toEqual(expect.arrayContaining(['water-drop', 'swirl']));
    expect(getAllTransitions({ runtimeOnly: false, includePlanned: true }).map((transition) => transition.id))
      .toEqual(expect.arrayContaining([
        'fly-eye',
        'hex-pixelize',
        'ink-bleed',
        'shatter-glass',
        'origami-fold',
      ]));
    expect(getTransition('puzzle-push')).toMatchObject({
      id: 'puzzle-push',
    });
    expect(getTransition('puzzle-push')?.capability).toBeUndefined();
    expect(getRuntimeTransition('puzzle-push')?.id).toBe('puzzle-push');
    expect(getTransition('magnetic-tiles')?.capability).toBeUndefined();
    expect(getRuntimeTransition('magnetic-tiles')?.id).toBe('magnetic-tiles');
    expect(getDefaultTransitionParams(getTransition('water-drop'))).toEqual({ seed: 0 });
    expect(normalizeTransitionParamsForDefinition(getTransition('swirl'), { seed: 2_000_000 }))
      .toEqual({ seed: 1_000_000 });
  });

  it('keeps deferred transition ids out of the stable runtime registry', () => {
    const deferredTransitionIds = [
      'page-peel',
      'datamosh',
      'smooth-cut',
      'flow',
      'luma-fade',
      'signal-tear',
      'data-corrupt',
      'cube-3d',
      'door-3d',
      'fold-3d',
      'shatter-glass',
      'origami-fold',
      'neural-dream',
    ];
    const stableTransitionIds = getAllTransitions().map((transition) => transition.id);

    for (const transitionId of deferredTransitionIds) {
      expect(stableTransitionIds).not.toContain(transitionId);
      expect(getRuntimeTransition(transitionId)).toBeUndefined();
    }
  });

  it('normalizes transition params against the definition schema', () => {
    const definition: TransitionDefinition = {
      id: 'crossfade',
      name: 'Param Test',
      category: 'dissolve',
      defaultDuration: 1,
      minDuration: 0.1,
      description: 'Param normalization test',
      params: {
        includeAudio: {
          type: 'boolean',
          label: 'Include audio',
          defaultValue: false,
        },
        enabledByDefault: {
          type: 'boolean',
          label: 'Enabled by default',
          defaultValue: true,
        },
        intensity: {
          type: 'number',
          label: 'Intensity',
          defaultValue: 0.5,
          min: 0,
          max: 1,
        },
        mode: {
          type: 'select',
          label: 'Mode',
          defaultValue: 'soft',
          options: [
            { label: 'Soft', value: 'soft' },
            { label: 'Hard', value: 'hard' },
          ],
        },
        tint: {
          type: 'color',
          label: 'Tint',
          defaultValue: '#ffffff',
        },
      },
      recipe: [{ kind: 'opacity', target: 'incoming', from: 0, to: 1 }],
    };

    expect(getDefaultTransitionParams(definition)).toEqual({
      includeAudio: false,
      enabledByDefault: true,
      intensity: 0.5,
      mode: 'soft',
      tint: '#ffffff',
    });
    expect(normalizeTransitionParamsForDefinition(definition, {
      includeAudio: 'true',
      intensity: 2,
      mode: 'hard',
      tint: 'not-a-color',
      unknown: true,
    })).toEqual({
      includeAudio: false,
      enabledByDefault: true,
      intensity: 1,
      mode: 'hard',
      tint: '#ffffff',
    });
  });

  it('preserves params for unknown future transition types during generic load/save normalization', () => {
    const futureTransition = {
      id: 'transition-future',
      type: 'future-transition',
      duration: 1,
      linkedClipId: 'clip-b',
      params: {
        futureSeed: 42,
        futureMode: 'soft',
      },
    };

    expect(normalizeTransitionInstanceParams(futureTransition)).toEqual(futureTransition);
  });
});
