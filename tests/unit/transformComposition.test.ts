import { describe, it, expect } from 'vitest';
import { composeTransforms, wouldCreateCycle } from '../../src/utils/transformComposition';
import { createMockTransform } from '../helpers/mockData';

// ─── composeTransforms ─────────────────────────────────────────────────────

describe('composeTransforms', () => {
  it('identity parent → child unchanged', () => {
    const identity = createMockTransform();
    const child = createMockTransform({
      opacity: 0.5,
      position: { x: 10, y: 20, z: 5 },
      scale: { x: 2, y: 3 },
      rotation: { x: 10, y: 20, z: 30 },
      blendMode: 'multiply',
    });

    const result = composeTransforms(identity, child);
    expect(result.opacity).toBeCloseTo(0.5, 5);
    expect(result.position.x).toBeCloseTo(10, 5);
    expect(result.position.y).toBeCloseTo(20, 5);
    expect(result.position.z).toBeCloseTo(5, 5);
    expect(result.scale.x).toBeCloseTo(2, 5);
    expect(result.scale.y).toBeCloseTo(3, 5);
    expect(result.rotation.x).toBeCloseTo(10, 5);
    expect(result.rotation.y).toBeCloseTo(20, 5);
    expect(result.rotation.z).toBeCloseTo(30, 5);
    expect(result.blendMode).toBe('multiply');
  });

  it('position addition (no rotation)', () => {
    const parent = createMockTransform({ position: { x: 100, y: 200, z: 0 } });
    const child = createMockTransform({ position: { x: 10, y: 20, z: 5 } });

    const result = composeTransforms(parent, child);
    expect(result.position.x).toBeCloseTo(110, 5);
    expect(result.position.y).toBeCloseTo(220, 5);
    expect(result.position.z).toBeCloseTo(5, 5);
  });

  it('position with parent rotation (90° Z)', () => {
    const parent = createMockTransform({ rotation: { x: 0, y: 0, z: 90 } });
    const child = createMockTransform({ position: { x: 10, y: 0, z: 0 } });

    const result = composeTransforms(parent, child);
    // 90° rotation: (10, 0) → (0, 10)
    expect(result.position.x).toBeCloseTo(0, 3);
    expect(result.position.y).toBeCloseTo(10, 3);
  });

  it('position with parent rotation (180° Z)', () => {
    const parent = createMockTransform({ rotation: { x: 0, y: 0, z: 180 } });
    const child = createMockTransform({ position: { x: 10, y: 0, z: 0 } });

    const result = composeTransforms(parent, child);
    // 180° rotation: (10, 0) → (-10, 0)
    expect(result.position.x).toBeCloseTo(-10, 3);
    expect(result.position.y).toBeCloseTo(0, 3);
  });

  it('scale multiplication', () => {
    const parent = createMockTransform({ scale: { x: 2, y: 3 } });
    const child = createMockTransform({ scale: { x: 0.5, y: 2 } });

    const result = composeTransforms(parent, child);
    expect(result.scale.x).toBeCloseTo(1, 5);
    expect(result.scale.y).toBeCloseTo(6, 5);
  });

  it('rotation addition', () => {
    const parent = createMockTransform({ rotation: { x: 10, y: 20, z: 30 } });
    const child = createMockTransform({ rotation: { x: 5, y: 10, z: 15 } });

    const result = composeTransforms(parent, child);
    expect(result.rotation.x).toBeCloseTo(15, 5);
    expect(result.rotation.y).toBeCloseTo(30, 5);
    expect(result.rotation.z).toBeCloseTo(45, 5);
  });

  it('opacity multiplication', () => {
    const parent = createMockTransform({ opacity: 0.5 });
    const child = createMockTransform({ opacity: 0.6 });

    const result = composeTransforms(parent, child);
    expect(result.opacity).toBeCloseTo(0.3, 5);
  });

  it('blendMode: child takes precedence', () => {
    const parent = createMockTransform({ blendMode: 'screen' });
    const child = createMockTransform({ blendMode: 'multiply' });

    const result = composeTransforms(parent, child);
    expect(result.blendMode).toBe('multiply');
  });
});

// ─── wouldCreateCycle ──────────────────────────────────────────────────────

describe('wouldCreateCycle', () => {
  it('no parent → false', () => {
    const getParent = () => undefined;
    expect(wouldCreateCycle('A', 'B', getParent)).toBe(false);
  });

  it('direct cycle (A→B→A) → true', () => {
    const parents: Record<string, string | undefined> = { B: 'A' };
    const getParent = (id: string) => parents[id];
    expect(wouldCreateCycle('A', 'B', getParent)).toBe(true);
  });

  it('indirect cycle (A→B→C→A) → true', () => {
    const parents: Record<string, string | undefined> = { B: 'C', C: 'A' };
    const getParent = (id: string) => parents[id];
    expect(wouldCreateCycle('A', 'B', getParent)).toBe(true);
  });

  it('no cycle in valid chain (A→B→C, D is parent) → false', () => {
    const parents: Record<string, string | undefined> = { D: 'E', E: undefined };
    const getParent = (id: string) => parents[id];
    expect(wouldCreateCycle('A', 'D', getParent)).toBe(false);
  });

  it('self-reference (A setting parent to A): detected as cycle', () => {
    // wouldCreateCycle('A', 'A', ...) — parentId='A' equals clipId='A' on first check
    // So this correctly returns true (self-parenting is a cycle)
    const getParent = () => undefined;
    expect(wouldCreateCycle('A', 'A', getParent)).toBe(true);
  });
});
