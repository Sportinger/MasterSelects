import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { composeTransforms, wouldCreateCycle } from '../../src/utils/transformComposition';
import type { BlendMode, ClipTransform } from '../../src/types';

const RUN_OPTIONS = { numRuns: 100, seed: 20260518 };
const EPSILON = 1e-8;

const blendModes: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'difference',
  'alpha-add',
];

const finiteNumber = fc.double({
  min: -1_000,
  max: 1_000,
  noNaN: true,
  noDefaultInfinity: true,
});

const rotationNumber = fc.double({
  min: -720,
  max: 720,
  noNaN: true,
  noDefaultInfinity: true,
});

const scaleNumber = fc.double({
  min: -10,
  max: 10,
  noNaN: true,
  noDefaultInfinity: true,
});

const optionalScaleNumber = fc.option(scaleNumber, { nil: undefined });

const transformArbitrary: fc.Arbitrary<ClipTransform> = fc.record({
  opacity: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  blendMode: fc.constantFrom(...blendModes),
  position: fc.record({
    x: finiteNumber,
    y: finiteNumber,
    z: finiteNumber,
  }),
  scale: fc.record({
    all: optionalScaleNumber,
    x: scaleNumber,
    y: scaleNumber,
    z: optionalScaleNumber,
  }),
  rotation: fc.record({
    x: rotationNumber,
    y: rotationNumber,
    z: rotationNumber,
  }),
});

function identityTransform(): ClipTransform {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function expectClose(actual: number, expected: number, epsilon = EPSILON) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
}

function expectTransformClose(actual: ClipTransform, expected: ClipTransform) {
  expectClose(actual.opacity, expected.opacity);
  expect(actual.blendMode).toBe(expected.blendMode);
  expectClose(actual.position.x, expected.position.x);
  expectClose(actual.position.y, expected.position.y);
  expectClose(actual.position.z, expected.position.z);
  expectClose(actual.scale.all ?? 1, expected.scale.all ?? 1);
  expectClose(actual.scale.x, expected.scale.x);
  expectClose(actual.scale.y, expected.scale.y);
  expectClose(actual.scale.z ?? 1, expected.scale.z ?? 1);
  expectClose(actual.rotation.x, expected.rotation.x);
  expectClose(actual.rotation.y, expected.rotation.y);
  expectClose(actual.rotation.z, expected.rotation.z);
}

function cloneTransform(transform: ClipTransform): ClipTransform {
  return {
    opacity: transform.opacity,
    blendMode: transform.blendMode,
    position: { ...transform.position },
    scale: { ...transform.scale },
    rotation: { ...transform.rotation },
  };
}

function numericFields(transform: ClipTransform) {
  return [
    transform.opacity,
    transform.position.x,
    transform.position.y,
    transform.position.z,
    transform.scale.all,
    transform.scale.x,
    transform.scale.y,
    transform.scale.z,
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
  ].filter((value): value is number => value !== undefined);
}

type ParentMapCase = {
  ids: string[];
  parents: Record<string, string | undefined>;
};

const parentMapArbitrary: fc.Arbitrary<ParentMapCase> = fc
  .integer({ min: 2, max: 8 })
  .chain((count) =>
    fc
      .array(fc.integer({ min: 0, max: 100 }), { minLength: count, maxLength: count })
      .map((rawParents) => {
        const ids = Array.from({ length: count }, (_, index) => `clip-${index}`);
        const parents: Record<string, string | undefined> = {};

        ids.forEach((id, index) => {
          const normalizedParentSlot = rawParents[index] % (index + 1);
          parents[id] =
            normalizedParentSlot === 0 ? undefined : ids[normalizedParentSlot - 1];
        });

        return { ids, parents };
      })
  );

function parentLookup(parents: Record<string, string | undefined>) {
  return (id: string) => parents[id];
}

function chainReaches(
  parents: Record<string, string | undefined>,
  startId: string,
  targetId: string
): boolean {
  let currentId: string | undefined = startId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    if (currentId === targetId) {
      return true;
    }
    visited.add(currentId);
    currentId = parents[currentId];
  }

  return false;
}

describe('composeTransforms properties', () => {
  it('identity parent preserves child transform semantics', () => {
    fc.assert(
      fc.property(transformArbitrary, (child) => {
        const result = composeTransforms(identityTransform(), child);

        expectClose(result.opacity, child.opacity);
        expect(result.blendMode).toBe(child.blendMode);
        expectClose(result.position.x, child.position.x);
        expectClose(result.position.y, child.position.y);
        expectClose(result.position.z, child.position.z);
        expectClose(result.scale.all ?? 1, child.scale.all ?? 1);
        expectClose(result.scale.x, child.scale.x);
        expectClose(result.scale.y, child.scale.y);
        expectClose(result.scale.z ?? 1, child.scale.z ?? 1);
        expectClose(result.rotation.x, child.rotation.x);
        expectClose(result.rotation.y, child.rotation.y);
        expectClose(result.rotation.z, child.rotation.z);
      }),
      RUN_OPTIONS
    );
  });

  it('finite input transforms compose to finite numeric fields', () => {
    fc.assert(
      fc.property(transformArbitrary, transformArbitrary, (parent, child) => {
        const result = composeTransforms(parent, child);

        expect(numericFields(result).every(Number.isFinite)).toBe(true);
      }),
      RUN_OPTIONS
    );
  });

  it('does not mutate parent or child transforms', () => {
    fc.assert(
      fc.property(transformArbitrary, transformArbitrary, (parent, child) => {
        const originalParent = cloneTransform(parent);
        const originalChild = cloneTransform(child);

        composeTransforms(parent, child);

        expect(parent).toEqual(originalParent);
        expect(child).toEqual(originalChild);
      }),
      RUN_OPTIONS
    );
  });

  it('is associative for the implemented parent-child composition semantics', () => {
    fc.assert(
      fc.property(transformArbitrary, transformArbitrary, transformArbitrary, (a, b, c) => {
        const left = composeTransforms(composeTransforms(a, b), c);
        const right = composeTransforms(a, composeTransforms(b, c));

        expectTransformClose(left, right);
      }),
      RUN_OPTIONS
    );
  });

  it('axis scale does not change position while Scale All stays finite', () => {
    fc.assert(
      fc.property(
        transformArbitrary,
        scaleNumber,
        scaleNumber,
        optionalScaleNumber,
        (parent, scaleX, scaleY, scaleAll) => {
          const axisScaledParent: ClipTransform = {
            ...parent,
            scale: { ...parent.scale, x: scaleX, y: scaleY },
          };
          const uniformlyScaledParent: ClipTransform = {
            ...axisScaledParent,
            scale: { ...axisScaledParent.scale, all: scaleAll },
          };

          const result = composeTransforms(parent, identityTransform());
          const axisScaledResult = composeTransforms(axisScaledParent, identityTransform());
          const uniformlyScaledResult = composeTransforms(uniformlyScaledParent, identityTransform());

          expectClose(axisScaledResult.position.x, result.position.x);
          expectClose(axisScaledResult.position.y, result.position.y);
          expectClose(axisScaledResult.position.z, result.position.z);
          expect(numericFields(uniformlyScaledResult).every(Number.isFinite)).toBe(true);
        }
      ),
      RUN_OPTIONS
    );
  });
});

describe('wouldCreateCycle properties', () => {
  it('returns false for safe parent assignments in generated acyclic parent maps', () => {
    fc.assert(
      fc.property(parentMapArbitrary, ({ ids, parents }) => {
        const getParentId = parentLookup(parents);

        ids.forEach((clipId) => {
          ids.forEach((parentId) => {
            if (parentId !== clipId && !chainReaches(parents, parentId, clipId)) {
              expect(wouldCreateCycle(clipId, parentId, getParentId)).toBe(false);
            }
          });
        });
      }),
      RUN_OPTIONS
    );
  });

  it('returns true when the candidate parent chain already reaches the clip', () => {
    fc.assert(
      fc.property(parentMapArbitrary, ({ ids, parents }) => {
        const getParentId = parentLookup(parents);

        ids.forEach((clipId) => {
          ids.forEach((parentId) => {
            if (parentId !== clipId && chainReaches(parents, parentId, clipId)) {
              expect(wouldCreateCycle(clipId, parentId, getParentId)).toBe(true);
            }
          });
        });
      }),
      RUN_OPTIONS
    );
  });

  it('ignores unrelated cycles when the queried parent chain does not reach the clip', () => {
    fc.assert(
      fc.property(parentMapArbitrary, ({ ids, parents }) => {
        const clipId = 'queried-clip';
        const unrelatedCycleA = 'unrelated-cycle-a';
        const unrelatedCycleB = 'unrelated-cycle-b';
        const parentsWithUnrelatedCycle: Record<string, string | undefined> = {
          ...parents,
          [clipId]: undefined,
          [unrelatedCycleA]: unrelatedCycleB,
          [unrelatedCycleB]: unrelatedCycleA,
        };
        const getParentId = parentLookup(parentsWithUnrelatedCycle);

        ids.forEach((parentId) => {
          expect(wouldCreateCycle(clipId, parentId, getParentId)).toBe(false);
        });
      }),
      RUN_OPTIONS
    );
  });
});
