import { describe, expect, it, vi } from 'vitest';
import { colorToRgba } from '../../src/effects/_shared/catalogColor';
import { createCatalogEffect } from '../../src/effects/_shared/catalogEffect';
import shader from '../../src/effects/pixel/shader.wgsl?raw';
import { blockMosaic } from '../../src/effects/pixel';
import commonShader from '../../src/effects/_shared/commonShader';
import hash2d from '../../src/effects/_shared/hash2d.wgsl?raw';

describe('catalog color and clock reuse', () => {
  it('parses six/eight-digit colors and resolves invalid input through the exact fallback', () => {
    expect(colorToRgba('#ff8000', '#000000')).toEqual([1, 128 / 255, 0, 1]);
    expect(colorToRgba('ff8000', '#000000')).toEqual([1, 128 / 255, 0, 1]);
    expect(colorToRgba('#10203080', '#000000')).toEqual([16 / 255, 32 / 255, 48 / 255, 128 / 255]);
    expect(colorToRgba('invalid', '#f8fafc')).toEqual([248 / 255, 250 / 255, 252 / 255, 1]);
  });

  it('keeps every catalog look on the timeline clock, never on the wall clock', () => {
    expect(blockMosaic.requiresContinuousRender).toBe(false);
    // Block Mosaic's WGSL reference: resolution, scale, amount, levels, grout, then the timeline time.
    expect(blockMosaic.packUniforms({}, 640, 360, 2.75)?.[6]).toBe(2.75);
    vi.spyOn(performance, 'now').mockReturnValue(4_000);
    // Catalog looks render through graphs that read the timeline time: animated ones hold still while paused.
    const animated = createCatalogEffect({ id: 'timeline-clock', name: 'Animated', category: 'pixel', shader, entryPoint: 'blockifyFragment', animated: true });
    expect(animated.requiresContinuousRender).toBe(false);
    expect('timelineAnimated' in animated && animated.timelineAnimated).toBe(true);
    expect(animated.packUniforms({}, 640, 360, 2.75)?.[5]).toBe(2.75);
  });

  it('assembles the shared hash source exactly once into the common effect shader', () => {
    expect(hash2d).toContain('fn hash(p: vec2f) -> f32');
    expect(commonShader.match(/fn hash\(p: vec2f\)/g)).toHaveLength(1);
  });
});
