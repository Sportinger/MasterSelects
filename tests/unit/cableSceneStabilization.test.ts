import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import type { Keyframe } from '../../src/types/keyframes';
import { getInterpolatedClipTransform } from '../../src/utils/keyframeInterpolation';
import { trackingPreviewTransform } from '../../src/services/planarTracking/trackingPreviewTransform';
import { cableFacePoints } from '../../src/services/faceCables/cableFaceSurface';
import { createCableSceneBake } from '../../src/services/faceCables/cableSceneBake';
import { defaultFaceCable } from '../../src/services/faceCables/cableData';
import { cableSceneLayout, decodeCableScene, encodeCableScene } from '../../src/services/faceCables/cableSceneData';
import { unstabilizedCableSceneFrame } from '../../src/services/faceCables/cableSceneStabilization';
import { buildCableSceneGeometry } from '../../src/engine/native3d/passes/faceCablePass/geometry';
import { bindCableRenderTime } from '../../src/services/faceCables/cableRenderTime';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';

function fixture(depth: boolean, enabled = true, bypassTransform = false) {
  const source = { width: 2160, height: 3840 }, output = { width: 1080, height: 1920 };
  const base = { ...DEFAULT_TRANSFORM, position: { x: -0.65, y: 0.3, z: 0 }, scale: { x: 1.9, y: 1.9 } };
  const keys: Keyframe[] = [0, 1].flatMap(time => (['position.x', 'position.y', 'rotation.z'] as const).map((property, i) => ({
    id: `face-stabilize:${time}:${property}`, clipId: 'clip', property, time,
    value: time ? [-1.6, 0.5, -16][i] : [-0.65, 0.3, 0][i], easing: 'linear',
  })));
  const binding = JSON.stringify({ source, ...output, transform: base, transformKeys: [keys] });
  const cable = defaultFaceCable();
  const writer = createCableSceneBake([cable], 2, 3, 1.5, output.width / output.height,
    depth ? { width: 3, height: 3 } : undefined, depth ? binding : undefined, undefined, depth ? undefined : binding);
  const neutral = createCableSceneBake([cable], 2, 3, 1.5, output.width / output.height, depth ? { width: 3, height: 3 } : undefined);
  for (let frame = 0; frame < 3; frame++) {
    const face = Array.from({ length: 478 }, (_, i) => ({ x: 0.45 + frame * 0.015 + Math.cos(i) * 0.08,
      y: 0.4 + Math.sin(i) * 0.1, z: Math.sin(i) * 0.04 }));
    for (const [target, stabilizationEnabled] of [[writer, enabled], [neutral, false]] as const) {
      const transform = target === neutral && bypassTransform ? DEFAULT_TRANSFORM
        : getInterpolatedClipTransform(keys, frame / 2, base, { stabilizationEnabled });
      const mapping = trackingPreviewTransform(transform, source, output);
      const points = cableFacePoints(face, mapping, output.width / output.height);
      target.writeFace(frame, face, points, transform, mapping);
      target.writeCable(frame, 0, points.slice(0, 25), cable, transform);
      if (depth) target.writeDepth(frame, new Float32Array(9).fill(target === neutral && bypassTransform ? -0.2 / 1.9 : -0.2), transform);
    }
  }
  return { bake: decodeCableScene(encodeCableScene(writer.scene))!, neutral: neutral.scene };
}

describe('stabilization embedded in saved cable geometry', () => {
  it.each([false, true])('removes baked XY/rotation with depth=%s without freezing tracked motion or changing the artifact', depth => {
    const { bake, neutral } = fixture(depth), before = bake.data.slice();
    const { stride } = cableSceneLayout(bake.cables, bake.depthGrid);
    const fixed = unstabilizedCableSceneFrame(bake, 2)!;
    expect(fixed).not.toBeNull();
    const expected = neutral.data.subarray(2 * stride, 3 * stride);
    let error = 0;
    fixed.forEach((value, i) => { error = Math.max(error, Math.abs(value - expected[i])); });
    expect(error).toBeLessThan(1e-5); // Independently baked with stabilization disabled.
    const first = buildCableSceneGeometry(bake, 0, true)!, last = buildCableSceneGeometry(bake, 1, true)!;
    for (let i = 0; i < 4; i++) for (let axis = 0; axis < 3; axis++) {
      expect(last.vertices[i * 12 + axis]).toBeCloseTo(first.vertices[i * 12 + axis], 5);
    }
    expect(last.vertices[4 * 12]).not.toBeCloseTo(first.vertices[4 * 12], 3); // Real facial motion remains.
    expect(buildCableSceneGeometry(bake, 1, false)!.vertices[0]).not.toBeCloseTo(first.vertices[0], 3);
    expect(bake.data).toEqual(before);
  });

  it('does not compensate an already bypassed bake or guess missing/mismatched provenance', () => {
    expect(unstabilizedCableSceneFrame(fixture(true, false).bake, 2)).toBeNull();
    const { bake } = fixture(true);
    expect(unstabilizedCableSceneFrame({ ...bake, depthBinding: undefined }, 2)).toBeNull();
    expect(unstabilizedCableSceneFrame({ ...bake, depthBinding: '{broken' }, 2)).toBeNull();
    const changed = { ...bake, data: bake.data.slice() };
    changed.data[cableSceneLayout(bake.cables, bake.depthGrid).stride * 2 + 1] += 0.1;
    expect(unstabilizedCableSceneFrame(changed, 2)).toBeNull();
  });

  it.each([true, false])('bypasses the entire clip transform even if stabilization was enabled=%s during the bake', enabled => {
    const { bake, neutral } = fixture(true, enabled, true);
    const { stride } = cableSceneLayout(bake.cables, bake.depthGrid);
    const fixed = unstabilizedCableSceneFrame(bake, 2, true)!;
    expect(fixed).not.toBeNull();
    const expected = neutral.data.subarray(2 * stride, 3 * stride);
    let error = 0;
    fixed.forEach((value, i) => { error = Math.max(error, Math.abs(value - expected[i])); });
    expect(error).toBeLessThan(1e-5);
    const geometry = buildCableSceneGeometry(bake, 1, false, true)!;
    expect(geometry.vertices[0]).toBeCloseTo(expected[1], 5);
  });

  it('carries the same ephemeral bypass to preview and composition/export effects', () => {
    const effects = [{ id: 'cables', type: 'face-cables' as const, name: 'Cables', enabled: true, params: { scene3D: true } }];
    expect(bindCableRenderTime(effects, 1, false)[0].params).toMatchObject({ cableStabilizationBypassed: true, cableTime: 1 });
    const composed = evaluateCompositionClipEffects(effects, [], 1, { inPoint: 0, outPoint: 2, videoInspectorSections: { stabilization: false } });
    expect(composed[0].params.cableStabilizationBypassed).toBe(true);
    expect(bindCableRenderTime(effects, 1, true)[0].params.cableStabilizationBypassed).toBe(false);
    expect(effects[0].params).toEqual({ scene3D: true });
  });
});
