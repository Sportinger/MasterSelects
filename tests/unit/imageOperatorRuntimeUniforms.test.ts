import { describe, expect, it } from 'vitest';
import { imageOperatorRuntimeUniformSize, packImageOperatorRuntimeUniforms } from '../../src/services/operators/imageOperatorRuntimeUniforms';
import type { ImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';

const plan = (capabilities: ImageOperatorPlan['capabilities'], values: number[] = []): ImageOperatorPlan =>
  ({ fusion: 'inline', capabilities, values, key: 'stable', wgsl: '', instructions: [], output: 0 });

describe('image operator runtime uniforms', () => {
  it('keeps parameter slots stable and packs time plus resolution into the aligned context tail', () => {
    const runtime = plan(['resolution', 'time', 'sample'], [0.25, 0.75]);
    expect(imageOperatorRuntimeUniformSize(runtime)).toBe(272);
    const packed = packImageOperatorRuntimeUniforms(runtime, 4.5, 1920, 1080)!;
    expect(packed).toHaveLength(68);
    expect([...packed.slice(0, 2)]).toEqual([0.25, 0.75]);
    expect([...packed.slice(64)]).toEqual([4.5, 0, 1920, 1080]);
  });

  it('validates only context capabilities that are actually required', () => {
    expect(packImageOperatorRuntimeUniforms(plan([]), Number.NaN, 0, 0)).toBeNull();
    expect(() => packImageOperatorRuntimeUniforms(plan(['resolution']), Number.NaN, 0, 1080)).toThrow(/positive and finite/);
    expect(() => packImageOperatorRuntimeUniforms(plan(['time']), Number.NaN, 0, 0)).toThrow(/time must be finite/);
  });

  it('appends slot-aligned uint resource metadata and rejects missing descriptors', () => {
    const runtime = { ...plan([], [0.5]), resourceInputs: ['color', 'memory'],
      resourceSampling: ['hardware-linear-clamp', 'exact-u32-pixel-load'] as const };
    expect(imageOperatorRuntimeUniformSize(runtime)).toBe(288);
    expect(() => packImageOperatorRuntimeUniforms(runtime, 0, 16, 9)).toThrow(/memory requires runtime metadata/);
    const packed = packImageOperatorRuntimeUniforms(runtime, 0, 16, 9,
      new Map([['memory', { width: 128, height: 72, available: true }]]))!;
    expect(packed).toHaveLength(72);
    expect([...packed.slice(64, 68)]).toEqual([0, 0, 0, 0]);
    expect([...packed.slice(68, 72)]).toEqual([1, 128, 72, 0]);
    expect(() => packImageOperatorRuntimeUniforms(runtime, 0, 16, 9,
      new Map([['memory', { width: 0, height: 72, available: false }]]))).toThrow(/positive and finite/);
  });
});
