import { describe, expect, it } from 'vitest';
import { packNativeSnapshot, PT_NATIVE_MAGIC } from '../../src/engine/native3d/pathtrace/native/ptNativeSnapshot';
import { comparePtImages } from '../../src/engine/native3d/pathtrace/native/ptImageComparison';

describe('native path tracing transport', () => {
  it('writes little-endian sized records and freezes views before asynchronous upload', async () => {
    const frame = new ArrayBuffer(416), lights = Float32Array.of(1, 2, 3, 4), materials = new Float32Array(20);
    const instance = new ArrayBuffer(128), fiber = new ArrayBuffer(48);
    new Uint32Array(instance)[24] = 0x80000001; new Float32Array(fiber).set([1, 2, 3, .001]);
    const blob = packNativeSnapshot(frame, lights, materials, [instance, fiber, new ArrayBuffer(0)]);
    lights.fill(0); materials.fill(1); new Float32Array(fiber).fill(0);
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
    }), header = new Uint32Array(buffer, 0, 16);
    expect(Array.from(header.subarray(0, 8))).toEqual([PT_NATIVE_MAGIC, 1, 416, 16, 80, 128, 48, 0]);
    expect(buffer.byteLength).toBe(64 + 416 + 16 + 80 + 128 + 48);
    expect(new Float32Array(buffer, 480, 4)[0]).toBe(1);
    expect(new Uint32Array(buffer, 576 + 96, 1)[0]).toBe(0x80000001);
    expect(new Float32Array(buffer, 704, 1)[0]).toBe(1);
  });
  it('rejects incompatible layouts before transport', () => {
    expect(() => packNativeSnapshot(new ArrayBuffer(400), new Float32Array(), new Float32Array(), [])).toThrow('Invalid');
  });
  it('detects radiance, coverage and non-finite errors before display tonemapping', () => {
    const reference = Float32Array.of(2, 0, 0, 1);
    expect(comparePtImages(reference, reference)).toMatchObject({ relativeRmse: 0, coverageMae: 0, nonFinite: 0 });
    expect(comparePtImages(reference, Float32Array.of(3, 0, 0, .5))).toMatchObject({ relativeRmse: .5, coverageMae: .5, nonFinite: 0 });
    expect(comparePtImages(reference, Float32Array.of(NaN, 0, 0, 1)).nonFinite).toBe(1);
  });
});
