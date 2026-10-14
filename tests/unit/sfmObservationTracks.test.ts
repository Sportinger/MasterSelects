import { describe, expect, it } from 'vitest';
import { attachObservation, canAttachObservation, type FeatureAssignments } from '../../src/services/photogrammetry/sfm/observationTracks';
import { createColmapTextModel } from '../../src/services/photogrammetry/sfm/colmapText';
import type { CameraPose, FrameFeatures, SparsePoint } from '../../src/services/photogrammetry/sfm/types';

const pose: CameraPose = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: { x: 0, y: 0, z: 0 } };
const frame = (sourceIndex = 1): FrameFeatures => ({ sourceIndex, name: `${sourceIndex}.jpg`, width: 100, height: 100,
  solveWidth: 100, solveHeight: 100, points: new Float32Array([50, 50, 51, 50, 90, 80]), colors: new Uint8Array(9) });
const point = (): SparsePoint => ({ id: 1, position: { x: 0, y: 0, z: 5 }, color: [100, 100, 100], error: 0,
  observations: [{ frameIndex: 0, featureIndex: 0 }] });
const principal = { x: 50, y: 50 };

describe('geometrically consistent sparse tracks', () => {
  it('rejects descriptor matches far from the projected 3D point without changing either track direction', () => {
    const p = point(); const assignments: FeatureAssignments = new Map([[0, new Map([[0, 0]])]]);
    expect(attachObservation(p, 0, frame(), pose, 2, assignments, 100, principal)).toBe(false);
    expect(p.observations).toHaveLength(1); expect(assignments.has(1)).toBe(false);
    expect(attachObservation(p, 0, frame(), pose, 1, assignments, 100, principal)).toBe(true);
    expect(p.error).toBe(.5); expect(assignments.get(1)?.get(1)).toBe(0);
  });
  it('does not merge two already-owned points or attach two features in one view', () => {
    const p = point(); const assignments: FeatureAssignments = new Map([[1, new Map([[0, 9]])]]);
    expect(attachObservation(p, 0, frame(), pose, 0, assignments, 100, principal)).toBe(false);
    expect(assignments.get(1)?.get(0)).toBe(9);
    expect(attachObservation(p, 0, frame(), pose, 1, assignments, 100, principal)).toBe(true);
    expect(canAttachObservation(p, 0, frame(), pose, 0, new Map(), 100, principal)).toBe(false);
    expect(p.observations.filter(o => o.frameIndex === 1)).toEqual([{ frameIndex: 1, featureIndex: 1 }]);
  });
  it('rejects behind-camera and missing feature coordinates', () => {
    const p = point(); p.position.z = -5;
    expect(attachObservation(p, 0, frame(), pose, 0, new Map(), 100, principal)).toBe(false);
    p.position.z = 5;
    expect(attachObservation(p, 0, frame(), pose, 99, new Map(), 100, principal)).toBe(false);
  });
  it('fails explicitly instead of exporting conflicting COLMAP image/point references', () => {
    const p = point(); p.observations.push({ frameIndex: 1, featureIndex: 0 });
    const other = { ...p, id: 2 };
    const model = { frames: [frame(0), frame(1)], poses: new Map([[0, pose], [1, pose]]), points: [p, other], focalLength: 100, principalPoint: principal };
    expect(() => createColmapTextModel(model)).toThrow('conflicting observation tracks');
    model.points = [p];
    expect(createColmapTextModel(model).pointsText).toContain('1 0 0 5');
  });
});
