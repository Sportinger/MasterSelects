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

  // ─── Additional position rotation tests ──────────────────────────────────

  it('position with parent rotation (270° Z)', () => {
    const parent = createMockTransform({ rotation: { x: 0, y: 0, z: 270 } });
    const child = createMockTransform({ position: { x: 10, y: 0, z: 0 } });

    const result = composeTransforms(parent, child);
    // 270° rotation: (10, 0) → (0, -10)
    expect(result.position.x).toBeCloseTo(0, 3);
    expect(result.position.y).toBeCloseTo(-10, 3);
  });

  it('position with parent rotation (45° Z)', () => {
    const parent = createMockTransform({ rotation: { x: 0, y: 0, z: 45 } });
    const child = createMockTransform({ position: { x: 10, y: 0, z: 0 } });

    const result = composeTransforms(parent, child);
    // 45° rotation: (10, 0) → (10*cos45, 10*sin45) ≈ (7.071, 7.071)
    const expected = 10 * Math.cos(Math.PI / 4);
    expect(result.position.x).toBeCloseTo(expected, 3);
    expect(result.position.y).toBeCloseTo(expected, 3);
  });

  it('position with parent rotation (-90° Z / negative rotation)', () => {
    const parent = createMockTransform({ rotation: { x: 0, y: 0, z: -90 } });
    const child = createMockTransform({ position: { x: 10, y: 0, z: 0 } });

    const result = composeTransforms(parent, child);
    // -90° rotation: (10, 0) → (0, -10)
    expect(result.position.x).toBeCloseTo(0, 3);
    expect(result.position.y).toBeCloseTo(-10, 3);
  });

  it('position with parent rotation (360° Z) equals no rotation', () => {
    const parent = createMockTransform({ rotation: { x: 0, y: 0, z: 360 } });
    const child = createMockTransform({ position: { x: 10, y: 5, z: 0 } });

    const result = composeTransforms(parent, child);
    // 360° = full circle, position should be unchanged
    expect(result.position.x).toBeCloseTo(10, 3);
    expect(result.position.y).toBeCloseTo(5, 3);
  });

  it('child position (x AND y) rotated by parent Z rotation', () => {
    const parent = createMockTransform({ rotation: { x: 0, y: 0, z: 90 } });
    const child = createMockTransform({ position: { x: 10, y: 5, z: 0 } });

    const result = composeTransforms(parent, child);
    // 90° rotation: (10, 5) → (-5, 10)
    expect(result.position.x).toBeCloseTo(-5, 3);
    expect(result.position.y).toBeCloseTo(10, 3);
  });

  // ─── Position with parent position + rotation combined ───────────────────

  it('parent position + parent rotation applied together', () => {
    const parent = createMockTransform({
      position: { x: 100, y: 200, z: 0 },
      rotation: { x: 0, y: 0, z: 90 },
    });
    const child = createMockTransform({ position: { x: 10, y: 0, z: 0 } });

    const result = composeTransforms(parent, child);
    // Rotated: (10, 0) → (0, 10), then add parent position (100, 200)
    expect(result.position.x).toBeCloseTo(100, 3);
    expect(result.position.y).toBeCloseTo(210, 3);
  });

  // ─── Z position tests ────────────────────────────────────────────────────

  it('Z position is additive (parent + child)', () => {
    const parent = createMockTransform({ position: { x: 0, y: 0, z: 3 } });
    const child = createMockTransform({ position: { x: 0, y: 0, z: 7 } });

    const result = composeTransforms(parent, child);
    expect(result.position.z).toBeCloseTo(10, 5);
  });

  it('Z position is NOT affected by parent Z rotation', () => {
    const parent = createMockTransform({
      position: { x: 0, y: 0, z: 5 },
      rotation: { x: 0, y: 0, z: 90 },
    });
    const child = createMockTransform({ position: { x: 0, y: 0, z: 3 } });

    const result = composeTransforms(parent, child);
    // Z is simple addition, not rotated
    expect(result.position.z).toBeCloseTo(8, 5);
  });

  // ─── Negative position tests ─────────────────────────────────────────────

  it('negative positions compose correctly', () => {
    const parent = createMockTransform({ position: { x: -50, y: -100, z: -2 } });
    const child = createMockTransform({ position: { x: 30, y: 60, z: 1 } });

    const result = composeTransforms(parent, child);
    expect(result.position.x).toBeCloseTo(-20, 5);
    expect(result.position.y).toBeCloseTo(-40, 5);
    expect(result.position.z).toBeCloseTo(-1, 5);
  });

  // ─── Scale edge cases ────────────────────────────────────────────────────

  it('scale with zero (parent) collapses child', () => {
    const parent = createMockTransform({ scale: { x: 0, y: 0 } });
    const child = createMockTransform({ scale: { x: 5, y: 10 } });

    const result = composeTransforms(parent, child);
    expect(result.scale.x).toBeCloseTo(0, 5);
    expect(result.scale.y).toBeCloseTo(0, 5);
  });

  it('scale with zero (child) results in zero', () => {
    const parent = createMockTransform({ scale: { x: 2, y: 3 } });
    const child = createMockTransform({ scale: { x: 0, y: 0 } });

    const result = composeTransforms(parent, child);
    expect(result.scale.x).toBeCloseTo(0, 5);
    expect(result.scale.y).toBeCloseTo(0, 5);
  });

  it('negative scale (mirroring)', () => {
    const parent = createMockTransform({ scale: { x: -1, y: 1 } });
    const child = createMockTransform({ scale: { x: 2, y: 3 } });

    const result = composeTransforms(parent, child);
    expect(result.scale.x).toBeCloseTo(-2, 5);
    expect(result.scale.y).toBeCloseTo(3, 5);
  });

  it('both parent and child negative scale (double mirror = no mirror)', () => {
    const parent = createMockTransform({ scale: { x: -1, y: -1 } });
    const child = createMockTransform({ scale: { x: -2, y: -3 } });

    const result = composeTransforms(parent, child);
    expect(result.scale.x).toBeCloseTo(2, 5);
    expect(result.scale.y).toBeCloseTo(3, 5);
  });

  it('fractional scale composition', () => {
    const parent = createMockTransform({ scale: { x: 0.1, y: 0.1 } });
    const child = createMockTransform({ scale: { x: 0.1, y: 0.1 } });

    const result = composeTransforms(parent, child);
    expect(result.scale.x).toBeCloseTo(0.01, 5);
    expect(result.scale.y).toBeCloseTo(0.01, 5);
  });

  // ─── Opacity edge cases ──────────────────────────────────────────────────

  it('opacity: zero parent makes result zero', () => {
    const parent = createMockTransform({ opacity: 0 });
    const child = createMockTransform({ opacity: 0.8 });

    const result = composeTransforms(parent, child);
    expect(result.opacity).toBeCloseTo(0, 5);
  });

  it('opacity: zero child makes result zero', () => {
    const parent = createMockTransform({ opacity: 0.8 });
    const child = createMockTransform({ opacity: 0 });

    const result = composeTransforms(parent, child);
    expect(result.opacity).toBeCloseTo(0, 5);
  });

  it('opacity: both fully opaque stays 1', () => {
    const parent = createMockTransform({ opacity: 1 });
    const child = createMockTransform({ opacity: 1 });

    const result = composeTransforms(parent, child);
    expect(result.opacity).toBeCloseTo(1, 5);
  });

  it('opacity: very small values compose correctly', () => {
    const parent = createMockTransform({ opacity: 0.01 });
    const child = createMockTransform({ opacity: 0.01 });

    const result = composeTransforms(parent, child);
    expect(result.opacity).toBeCloseTo(0.0001, 5);
  });

  // ─── Rotation edge cases ─────────────────────────────────────────────────

  it('rotation with negative values', () => {
    const parent = createMockTransform({ rotation: { x: -10, y: -20, z: -30 } });
    const child = createMockTransform({ rotation: { x: 5, y: 10, z: 15 } });

    const result = composeTransforms(parent, child);
    expect(result.rotation.x).toBeCloseTo(-5, 5);
    expect(result.rotation.y).toBeCloseTo(-10, 5);
    expect(result.rotation.z).toBeCloseTo(-15, 5);
  });

  it('rotation exceeding 360 degrees', () => {
    const parent = createMockTransform({ rotation: { x: 200, y: 300, z: 350 } });
    const child = createMockTransform({ rotation: { x: 200, y: 100, z: 50 } });

    const result = composeTransforms(parent, child);
    // Rotation addition can exceed 360; it is not clamped
    expect(result.rotation.x).toBeCloseTo(400, 5);
    expect(result.rotation.y).toBeCloseTo(400, 5);
    expect(result.rotation.z).toBeCloseTo(400, 5);
  });

  it('rotation with zero values passes through', () => {
    const parent = createMockTransform({ rotation: { x: 0, y: 0, z: 0 } });
    const child = createMockTransform({ rotation: { x: 45, y: 90, z: 180 } });

    const result = composeTransforms(parent, child);
    expect(result.rotation.x).toBeCloseTo(45, 5);
    expect(result.rotation.y).toBeCloseTo(90, 5);
    expect(result.rotation.z).toBeCloseTo(180, 5);
  });

  // ─── BlendMode edge cases ────────────────────────────────────────────────

  it('blendMode: child normal overrides parent non-normal', () => {
    const parent = createMockTransform({ blendMode: 'overlay' });
    const child = createMockTransform({ blendMode: 'normal' });

    const result = composeTransforms(parent, child);
    expect(result.blendMode).toBe('normal');
  });

  it('blendMode: both normal stays normal', () => {
    const parent = createMockTransform({ blendMode: 'normal' });
    const child = createMockTransform({ blendMode: 'normal' });

    const result = composeTransforms(parent, child);
    expect(result.blendMode).toBe('normal');
  });

  // ─── Position NOT affected by parent scale ────────────────────────────────

  it('child position is NOT multiplied by parent scale (shader handles scale in UV space)', () => {
    const parent = createMockTransform({ scale: { x: 2, y: 3 } });
    const child = createMockTransform({ position: { x: 100, y: 200, z: 0 } });

    const result = composeTransforms(parent, child);
    // Key behavior: position should be 100, 200 (NOT 200, 600)
    expect(result.position.x).toBeCloseTo(100, 5);
    expect(result.position.y).toBeCloseTo(200, 5);
  });

  it('child position not affected by parent scale even with rotation', () => {
    const parent = createMockTransform({
      scale: { x: 3, y: 3 },
      rotation: { x: 0, y: 0, z: 90 },
    });
    const child = createMockTransform({ position: { x: 10, y: 0, z: 0 } });

    const result = composeTransforms(parent, child);
    // Only rotation is applied to position, not scale
    // 90° rotation: (10, 0) → (0, 10) regardless of parent scale
    expect(result.position.x).toBeCloseTo(0, 3);
    expect(result.position.y).toBeCloseTo(10, 3);
  });

  // ─── Full combined transforms ─────────────────────────────────────────────

  it('all properties composed together', () => {
    const parent = createMockTransform({
      opacity: 0.8,
      blendMode: 'screen',
      position: { x: 50, y: 100, z: 1 },
      scale: { x: 2, y: 0.5 },
      rotation: { x: 10, y: 20, z: 90 },
    });
    const child = createMockTransform({
      opacity: 0.5,
      blendMode: 'overlay',
      position: { x: 20, y: 10, z: 2 },
      scale: { x: 0.5, y: 3 },
      rotation: { x: 5, y: 10, z: 45 },
    });

    const result = composeTransforms(parent, child);
    // Opacity: 0.8 * 0.5 = 0.4
    expect(result.opacity).toBeCloseTo(0.4, 5);
    // BlendMode: child wins
    expect(result.blendMode).toBe('overlay');
    // Scale: multiply
    expect(result.scale.x).toBeCloseTo(1, 5);
    expect(result.scale.y).toBeCloseTo(1.5, 5);
    // Rotation: add
    expect(result.rotation.x).toBeCloseTo(15, 5);
    expect(result.rotation.y).toBeCloseTo(30, 5);
    expect(result.rotation.z).toBeCloseTo(135, 5);
    // Position: parent pos + rotated child pos (90° rotation on child pos)
    // Rotated (20, 10) by 90°: (-10, 20)
    expect(result.position.x).toBeCloseTo(50 + (-10), 3);
    expect(result.position.y).toBeCloseTo(100 + 20, 3);
    expect(result.position.z).toBeCloseTo(3, 5);
  });

  // ─── Identity composition ────────────────────────────────────────────────

  it('identity child → result equals parent (except blendMode)', () => {
    const parent = createMockTransform({
      opacity: 0.7,
      blendMode: 'screen',
      position: { x: 50, y: 100, z: 2 },
      scale: { x: 2, y: 3 },
      rotation: { x: 10, y: 20, z: 30 },
    });
    const identity = createMockTransform();

    const result = composeTransforms(parent, identity);
    expect(result.opacity).toBeCloseTo(0.7, 5);
    // BlendMode: child (normal) takes precedence over parent
    expect(result.blendMode).toBe('normal');
    expect(result.position.x).toBeCloseTo(50, 5);
    expect(result.position.y).toBeCloseTo(100, 5);
    expect(result.position.z).toBeCloseTo(2, 5);
    expect(result.scale.x).toBeCloseTo(2, 5);
    expect(result.scale.y).toBeCloseTo(3, 5);
    expect(result.rotation.x).toBeCloseTo(10, 5);
    expect(result.rotation.y).toBeCloseTo(20, 5);
    expect(result.rotation.z).toBeCloseTo(30, 5);
  });

  it('two identity transforms → identity result', () => {
    const a = createMockTransform();
    const b = createMockTransform();

    const result = composeTransforms(a, b);
    expect(result.opacity).toBeCloseTo(1, 5);
    expect(result.blendMode).toBe('normal');
    expect(result.position.x).toBeCloseTo(0, 5);
    expect(result.position.y).toBeCloseTo(0, 5);
    expect(result.position.z).toBeCloseTo(0, 5);
    expect(result.scale.x).toBeCloseTo(1, 5);
    expect(result.scale.y).toBeCloseTo(1, 5);
    expect(result.rotation.x).toBeCloseTo(0, 5);
    expect(result.rotation.y).toBeCloseTo(0, 5);
    expect(result.rotation.z).toBeCloseTo(0, 5);
  });

  // ─── Only parent Z rotation affects position ─────────────────────────────

  it('parent X and Y rotation do NOT affect child position (only Z does)', () => {
    const parent = createMockTransform({ rotation: { x: 90, y: 90, z: 0 } });
    const child = createMockTransform({ position: { x: 10, y: 20, z: 0 } });

    const result = composeTransforms(parent, child);
    // Only Z rotation is used for position rotation; x and y rotation are ignored for position
    expect(result.position.x).toBeCloseTo(10, 5);
    expect(result.position.y).toBeCloseTo(20, 5);
  });

  // ─── Chained composition (grandparent → parent → child) ──────────────────

  it('triple composition (grandparent → parent → child)', () => {
    const grandparent = createMockTransform({
      position: { x: 100, y: 0, z: 0 },
      scale: { x: 2, y: 2 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 0.5,
    });
    const parent = createMockTransform({
      position: { x: 50, y: 0, z: 0 },
      scale: { x: 0.5, y: 0.5 },
      rotation: { x: 0, y: 0, z: 90 },
      opacity: 0.8,
    });
    const child = createMockTransform({
      position: { x: 10, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 1,
    });

    // Compose grandparent + parent first
    const intermediate = composeTransforms(grandparent, parent);
    // Then compose with child
    const result = composeTransforms(intermediate, child);

    // Scale: 2 * 0.5 * 1 = 1
    expect(result.scale.x).toBeCloseTo(1, 5);
    expect(result.scale.y).toBeCloseTo(1, 5);
    // Opacity: 0.5 * 0.8 * 1 = 0.4
    expect(result.opacity).toBeCloseTo(0.4, 5);
    // Rotation: 0 + 90 + 0 = 90
    expect(result.rotation.z).toBeCloseTo(90, 5);
    // Intermediate position: 100 + 50 = 150 (no rotation on gp)
    expect(intermediate.position.x).toBeCloseTo(150, 3);
    // Final position: 150 + rotated(10, 0) by 90° = 150 + (0, 10)
    expect(result.position.x).toBeCloseTo(150, 3);
    expect(result.position.y).toBeCloseTo(10, 3);
  });

  // ─── Large value stress test ──────────────────────────────────────────────

  it('large position values compose correctly', () => {
    const parent = createMockTransform({ position: { x: 10000, y: -10000, z: 500 } });
    const child = createMockTransform({ position: { x: 5000, y: 5000, z: 250 } });

    const result = composeTransforms(parent, child);
    expect(result.position.x).toBeCloseTo(15000, 0);
    expect(result.position.y).toBeCloseTo(-5000, 0);
    expect(result.position.z).toBeCloseTo(750, 0);
  });

  it('very small fractional values maintain precision', () => {
    const parent = createMockTransform({ opacity: 0.001 });
    const child = createMockTransform({ opacity: 0.001 });

    const result = composeTransforms(parent, child);
    expect(result.opacity).toBeCloseTo(0.000001, 8);
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

  // ─── Longer chains ────────────────────────────────────────────────────────

  it('deep cycle (A→B→C→D→A) → true', () => {
    const parents: Record<string, string | undefined> = { B: 'C', C: 'D', D: 'A' };
    const getParent = (id: string) => parents[id];
    expect(wouldCreateCycle('A', 'B', getParent)).toBe(true);
  });

  it('very deep cycle (A→B→C→D→E→F→A) → true', () => {
    const parents: Record<string, string | undefined> = {
      B: 'C', C: 'D', D: 'E', E: 'F', F: 'A',
    };
    const getParent = (id: string) => parents[id];
    expect(wouldCreateCycle('A', 'B', getParent)).toBe(true);
  });

  it('long chain without cycle → false', () => {
    const parents: Record<string, string | undefined> = {
      B: 'C', C: 'D', D: 'E', E: 'F', F: undefined,
    };
    const getParent = (id: string) => parents[id];
    expect(wouldCreateCycle('A', 'B', getParent)).toBe(false);
  });

  it('long chain ending at root without cycle → false', () => {
    const parents: Record<string, string | undefined> = {
      B: 'C', C: 'D', D: 'E', E: undefined,
    };
    const getParent = (id: string) => parents[id];
    // Setting B as parent of A: walk B→C→D→E→undefined, never hits A
    expect(wouldCreateCycle('A', 'B', getParent)).toBe(false);
  });

  // ─── Multiple separate chains ─────────────────────────────────────────────

  it('separate chains do not interfere → false', () => {
    // Chain 1: X→Y→Z   Chain 2: A→B→C
    const parents: Record<string, string | undefined> = {
      B: 'C', C: undefined,
      Y: 'Z', Z: undefined,
    };
    const getParent = (id: string) => parents[id];
    // Setting B as parent of X: walk B→C→undefined, never hits X
    expect(wouldCreateCycle('X', 'B', getParent)).toBe(false);
  });

  it('cycle only in unrelated chain does not affect check → false', () => {
    // We're checking A→B, where B→C→undefined (no cycle for A)
    // Separate unrelated chain that won't be visited
    const parents: Record<string, string | undefined> = {
      B: 'C', C: undefined,
    };
    const getParent = (id: string) => parents[id];
    expect(wouldCreateCycle('A', 'B', getParent)).toBe(false);
  });

  // ─── Edge cases with getParentId callback ────────────────────────────────

  it('getParentId always returns undefined → no cycle', () => {
    const getParent = (_id: string) => undefined;
    expect(wouldCreateCycle('A', 'B', getParent)).toBe(false);
    expect(wouldCreateCycle('X', 'Y', getParent)).toBe(false);
  });

  it('parentId itself has no parent but is not clipId → false', () => {
    const parents: Record<string, string | undefined> = { B: undefined };
    const getParent = (id: string) => parents[id];
    expect(wouldCreateCycle('A', 'B', getParent)).toBe(false);
  });

  it('cycle at depth 2 (A→B, B already parents C which parents A)', () => {
    // Setting B as parent of A: walk B→C→A → cycle!
    const parents: Record<string, string | undefined> = { B: 'C', C: 'A' };
    const getParent = (id: string) => parents[id];
    expect(wouldCreateCycle('A', 'B', getParent)).toBe(true);
  });

  it('parentId leads back to clipId through multiple nodes', () => {
    // A→D, D→E→F→G→A → cycle
    const parents: Record<string, string | undefined> = {
      D: 'E', E: 'F', F: 'G', G: 'A',
    };
    const getParent = (id: string) => parents[id];
    expect(wouldCreateCycle('A', 'D', getParent)).toBe(true);
  });

  it('parentId leads to a different node, not clipId → false', () => {
    // A→D, D→E→F→G→H→undefined
    const parents: Record<string, string | undefined> = {
      D: 'E', E: 'F', F: 'G', G: 'H', H: undefined,
    };
    const getParent = (id: string) => parents[id];
    expect(wouldCreateCycle('A', 'D', getParent)).toBe(false);
  });
});
