import { describe, expect, it } from 'vitest';
import { compareFisheyeGpuBytes, type FisheyeRoundingContext } from '../helpers/fisheyeRoundingTolerance';

const rowPitch = 256, byte = 9 * rowPitch + 9 * 4 + 3;
const context: FisheyeRoundingContext = { caseName: 'orthographic-negative-edge-max', width: 47, height: 29, rowPitch,
  params: { projection: 'orthographic', strength: -.59, samples: 8, fieldOfView: 20, feather: .5, edgeFeather: .1, squeeze: .25 } };
const pair = (index = byte, expectedValue = 78, actualValue = 79) => {
  const expected = new Uint8Array(rowPitch * 29), actual = new Uint8Array(rowPitch * 29);
  expected[index] = expectedValue; actual[index] = actualValue; return { expected, actual };
};

describe('approved Fisheye GPU rounding fingerprint', () => {
  it('accepts only the exact known alpha byte', () => {
    const values = pair();
    expect(compareFisheyeGpuBytes(values.expected, values.actual, context)).toMatchObject({
      equal: true, acceptedKnownRounding: true, message: expect.stringContaining('pixel (9,9)'),
    });
  });

  it.each([
    ['other case', { ...context, caseName: 'orthographic-positive-repeat' }, pair()],
    ['other width', { ...context, width: 48 }, pair()],
    ['other height', { ...context, height: 30 }, pair()],
    ['other row pitch', { ...context, rowPitch: 260 }, pair()],
    ['other parameter', { ...context, params: { ...context.params, squeeze: .5 } }, pair()],
    ['RGB channel', context, pair(byte - 1)],
    ['other location', context, pair(byte + 4)],
    ['delta two', context, pair(byte, 78, 80)],
    ['reversed fingerprint', context, pair(byte, 79, 78)],
  ])('rejects %s', (_label, candidate, values) => {
    expect(compareFisheyeGpuBytes(values.expected, values.actual, candidate)).toEqual({ equal: false, acceptedKnownRounding: false });
  });

  it('remains strict when an additional byte differs', () => {
    const values = pair(); values.actual[byte + 4] = 1;
    expect(compareFisheyeGpuBytes(values.expected, values.actual, context)).toEqual({ equal: false, acceptedKnownRounding: false });
  });

  it('rejects a noncanonical fixture buffer length', () => {
    const values = pair();
    expect(compareFisheyeGpuBytes(values.expected.slice(0, -1), values.actual.slice(0, -1), context))
      .toEqual({ equal: false, acceptedKnownRounding: false });
  });
});
