import { describe, expect, it } from 'vitest';
import { solveFaceStabilization } from '../../src/services/landmarkTracking/faceStabilization';
import { trackingPreviewTransform } from '../../src/services/planarTracking/trackingPreviewTransform';
import type { ClipTransform } from '../../src/types/timelineCore';
import type { LandmarkPoint } from '../../src/services/landmarkTracking/types';

const base: ClipTransform = { opacity: 1, blendMode: 'normal', position: { x: -0.65, y: 0.3, z: 0 },
  scale: { x: 1.98684, y: 1.98684 }, rotation: { x: 0, y: 0, z: 12 }, anchor: { x: 0, y: 0, z: 0 } };
const source = { width: 2160, height: 3840 }, output = { width: 2160, height: 3840 };
function face(): LandmarkPoint[] {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  points[33] = { x: 0.55, y: 0.35, z: 0 }; points[263] = { x: 0.7, y: 0.38, z: 0 };
  points[1] = { x: 0.63, y: 0.42, z: 0 };
  points[61] = { x: 0.57, y: 0.48, z: 0 }; points[291] = { x: 0.67, y: 0.46, z: 0 };
  return points;
}
describe('face and lip stabilization geometry', () => {
  it.each(['face', 'lips'] as const)('levels %s in actual portrait pixel space and centers its anchor', target => {
    const points = face();
    const solved = solveFaceStabilization(points, target, base, source, output, true)!;
    const mapping = trackingPreviewTransform({ ...base, rotation: { ...base.rotation, z: solved.rotation },
      position: { ...base.position, x: solved.x, y: solved.y } }, source, output);
    const a = points[target === 'face' ? 33 : 61], b = points[target === 'face' ? 263 : 291];
    expect(mapping.toComposition(a).y).toBeCloseTo(mapping.toComposition(b).y, 8);
    const center = target === 'face' ? points[1] : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(mapping.toComposition(center).x).toBeCloseTo(0.5, 8);
    expect(mapping.toComposition(center).y).toBeCloseTo(0.5, 8);
  });
  it('can keep natural translation while leveling rotation', () => {
    const points = face();
    const solved = solveFaceStabilization(points, 'face', base, source, output, false)!;
    const before = trackingPreviewTransform(base, source, output).toComposition(points[1]);
    const after = trackingPreviewTransform({ ...base, rotation: { ...base.rotation, z: solved.rotation },
      position: { ...base.position, x: solved.x, y: solved.y } }, source, output).toComposition(points[1]);
    expect(after.x).toBeCloseTo(before.x, 8); expect(after.y).toBeCloseTo(before.y, 8);
  });
  it('rejects missing/degenerate landmarks and sudden flips', () => {
    expect(solveFaceStabilization([], 'lips', base, source, output, true)).toBeNull();
    const points = face(); points[291] = points[61];
    expect(solveFaceStabilization(points, 'lips', base, source, output, true)).toBeNull();
    expect(solveFaceStabilization(face(), 'face', base, source, output, true, 150)).toBeNull();
  });
});
