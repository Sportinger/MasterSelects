import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getEffectiveCameraScale, getEffectiveScale, getScaleAll } from '../../src/utils/transformScale';

const propertyConfig = { numRuns: 100, seed: 20260518 };
const finiteScale = fc.double({ min: -1_000, max: 1_000, noNaN: true, noDefaultInfinity: true });
const invalidNumber = fc.constantFrom<unknown>(NaN, Infinity, -Infinity, null, '2', {}, []);

type ScaleInput = {
  all?: unknown;
  x?: unknown;
  y?: unknown;
  z?: unknown;
};

type ScaleArg = Parameters<typeof getEffectiveScale>[0];

function fallbackNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asScaleArg(scale: ScaleInput): ScaleArg {
  return scale as ScaleArg;
}

describe('transformScale property invariants', () => {
  it('returns scale.all exactly for finite values and defaults absent or invalid values to 1', () => {
    fc.assert(
      fc.property(finiteScale, (all) => {
        expect(getScaleAll({ all })).toBe(all);
      }),
      propertyConfig,
    );

    fc.assert(
      fc.property(fc.option(invalidNumber, { nil: undefined }), (all) => {
        expect(getScaleAll(asScaleArg({ all }))).toBe(1);
      }),
      propertyConfig,
    );
  });

  it('multiplies finite axis scale by finite uniform scale and falls back per missing or invalid axis', () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            all: fc.oneof(finiteScale, invalidNumber),
            x: fc.oneof(finiteScale, invalidNumber),
            y: fc.oneof(finiteScale, invalidNumber),
            z: fc.option(fc.oneof(finiteScale, invalidNumber), { nil: undefined }),
          },
          { requiredKeys: [] },
        ),
        (scale) => {
          const all = fallbackNumber(scale.all, 1);
          const effective = getEffectiveScale(asScaleArg(scale));
          const expected = {
            x: fallbackNumber(scale.x, 1) * all,
            y: fallbackNumber(scale.y, 1) * all,
            ...(scale.z !== undefined || scale.all !== undefined
              ? { z: fallbackNumber(scale.z, 1) * all }
              : {}),
          };

          expect(effective).toEqual(expected);
          expect(Number.isFinite(effective.x)).toBe(true);
          expect(Number.isFinite(effective.y)).toBe(true);
          if (scale.z !== undefined) {
            expect(Number.isFinite(effective.z)).toBe(true);
          }
        },
      ),
      propertyConfig,
    );
  });

  it('keeps camera x/y consistent with effective scale while leaving camera z unscaled by all', () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            all: fc.oneof(finiteScale, invalidNumber),
            x: fc.oneof(finiteScale, invalidNumber),
            y: fc.oneof(finiteScale, invalidNumber),
            z: fc.option(fc.oneof(finiteScale, invalidNumber), { nil: undefined }),
          },
          { requiredKeys: [] },
        ),
        (scale) => {
          const effective = getEffectiveScale(asScaleArg(scale));
          const camera = getEffectiveCameraScale(asScaleArg(scale));

          expect(camera.x).toBe(effective.x);
          expect(camera.y).toBe(effective.y);
          expect('z' in camera).toBe(scale.z !== undefined);

          if (scale.z !== undefined) {
            expect(camera.z).toBe(fallbackNumber(scale.z, 0));
            expect(Number.isFinite(camera.z)).toBe(true);
          }
        },
      ),
      propertyConfig,
    );
  });

  it('treats uniform scale as equivalent x and y axis scale when axes are omitted', () => {
    fc.assert(
      fc.property(finiteScale, (all) => {
        expect(getEffectiveScale({ all })).toEqual({ x: all, y: all, z: all });
        expect(getEffectiveCameraScale({ all })).toEqual({ x: all, y: all });
      }),
      propertyConfig,
    );
  });
});
