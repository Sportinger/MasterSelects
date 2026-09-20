import { describe, expect, it } from 'vitest';
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { createCableSceneBake, cableSceneLocalPoint } from '../../src/services/faceCables/cableSceneBake';
import { createCableDepthContact, cableScenePhysicsPoint } from '../../src/services/faceCables/cableDepthContact';
import { defaultFaceCable } from '../../src/services/faceCables/cableData';
import { cableFacePoints } from '../../src/services/faceCables/cableFaceSurface';
import { createCable, stepCable } from '../../src/services/faceCables/cablePhysics';

function fixture(withFace = false) {
  const writer = createCableSceneBake([defaultFaceCable()], 30, 1, 1, 1, { width: 3, height: 3 });
  const face = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.4, z: 0 }));
  const oval = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL;
  oval.forEach((edge, i) => { const angle = i / oval.length * Math.PI * 2; face[edge.start] = { x: 0.5 + Math.cos(angle) * 0.15, y: 0.4 + Math.sin(angle) * 0.2, z: 0 }; });
  const mapping = { toComposition: (p: { x: number; y: number }) => p };
  writer.writeFace(0, withFace ? face : undefined, withFace ? cableFacePoints(face, mapping, 1) : undefined, DEFAULT_TRANSFORM, mapping);
  writer.writeDepth(0, new Float32Array(9).fill(-0.2), DEFAULT_TRANSFORM);
  return createCableDepthContact(writer.scene, 0, DEFAULT_TRANSFORM, 1);
}
describe('cable collision with rendered scene depth', () => {
  it('stops penetration into the body/background, damps inward velocity and permits outward motion', () => {
    const contact = fixture(true), p = { x: 0.5, y: 0.85, z: -1 }, previous = { ...p, z: -0.9 };
    contact(p, previous, 0.005);
    expect(p.z).toBeCloseTo(-0.195); expect(previous.z).toBe(p.z);
    p.z = 0.5; contact(p, previous, 0.005); expect(p.z).toBe(0.5);
  });
  it('leaves the MediaPipe face interior and space beyond the image to their own collision policy', () => {
    const contact = fixture(true);
    for (const p of [{ x: 0.5, y: 0.4, z: -1 }, { x: 3, y: 3, z: -1 }]) {
      contact(p, { ...p }, 0.005); expect(p.z).toBe(-1);
    }
  });
  it('constrains rope nodes under inward wind without moving locked anchors', () => {
    const contact = fixture(), a = { x: 0.3, y: 0.8, z: -0.195 }, b = { x: 0.7, y: 0.8, z: -0.195 };
    const rope = createCable(a, b, 0.5, 16);
    for (let i = 0; i < 120; i++) stepCable(rope, a, b, 1 / 120, 0, 2, { windZ: -20, contact, radius: 0.005 });
    expect(rope.points.every(p => p.z! >= -0.19501)).toBe(true);
    expect(rope.points[0]).toEqual(a); expect(rope.points.at(-1)).toEqual(b);
  });
  it('round-trips nonuniform scale, rotation, translation and anchor in simulation coordinates', () => {
    const transform = { ...DEFAULT_TRANSFORM, position: { x: -0.2, y: 0.3, z: 0.1 },
      scale: { x: -0.8, y: 1.2, z: 0.9 }, rotation: { x: 0, y: 0, z: 34 }, anchor: { x: 0.1, y: -0.2, z: 0.05 } };
    const original = { x: 0.2, y: 0.8, z: -0.3 }, local = cableSceneLocalPoint(original, transform, 0.5625);
    const restored = cableScenePhysicsPoint([local.x, local.y, local.z], transform, 0.5625);
    for (const key of ['x', 'y', 'z'] as const) expect(restored[key]).toBeCloseTo(original[key]);
  });
});
