import type { ClipTransform, Keyframe } from '../../types';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { getEffectiveScale } from '../../utils/transformScale';
import { getInterpolatedClipTransform } from '../../utils/keyframeInterpolation';
import { trackingPreviewTransform } from '../planarTracking/trackingPreviewTransform';
import { isStabilizationKey } from '../landmarkTracking/stabilizationProvenance';
import { cableSceneLayout, type CableSceneBake } from './cableSceneData';
import { cableSceneLocalPoint } from './cableSceneBake';
import { cableScenePhysicsPoint } from './cableDepthContact';
import { projectCableDepth } from './cableDepth';

interface MappingBinding {
  source: { width: number; height: number };
  width: number; height: number; transform: ClipTransform; keys: Keyframe[];
}
const bindings = new WeakMap<CableSceneBake, MappingBinding | null>();
function mappingBinding(bake: CableSceneBake): MappingBinding | null {
  if (bindings.has(bake)) return bindings.get(bake)!;
  let result: MappingBinding | null = null;
  try {
    const saved = JSON.parse(bake.mappingBinding ?? bake.depthBinding ?? 'null');
    const keys: Keyframe[] = saved?.transformKeys?.flat() ?? [];
    const t = saved?.transform;
    if (saved && [saved.source?.width, saved.source?.height, saved.width, saved.height].every(n => Number.isFinite(n) && n > 0)
      && t && [t.position?.x, t.position?.y, t.position?.z, t.rotation?.x, t.rotation?.y, t.rotation?.z, t.scale?.x, t.scale?.y].every(Number.isFinite)
      && !t.position.z && !t.rotation.x && !t.rotation.y
      && keys.every(k => typeof k.id === 'string' && typeof k.property === 'string' && Number.isFinite(k.time) && Number.isFinite(k.value))) result = { ...saved, keys };
  } catch { /* Older artifacts without mapping provenance keep their original geometry. */ }
  bindings.set(bake, result);
  return result;
}

/** Remove the recorded stabilization from one immutable bake frame, preserving
 * tracked motion and simulated cable shapes. Runtime Clip Transform still applies
 * once afterwards. Old depth bakes already contain the required mapping inputs. */
export function unstabilizedCableSceneFrame(bake: CableSceneBake, frame: number, clipTransformBypassed = false): Float32Array | null {
  if (!Number.isInteger(frame) || frame < 0 || frame >= bake.frames) return null;
  const binding = mappingBinding(bake);
  if (!binding || (!clipTransformBypassed && !binding.keys.some(isStabilizationKey))) return null;
  const time = Math.min(frame / bake.fps, bake.duration - 1e-6);
  let baked = getInterpolatedClipTransform(binding.keys, time, binding.transform);
  const unstabilized = getInterpolatedClipTransform(binding.keys, time, binding.transform, { stabilizationEnabled: false });
  const neutral = clipTransformBypassed ? DEFAULT_TRANSFORM : unstabilized;
  let oldMapping = trackingPreviewTransform(baked, binding.source, binding);
  const newMapping = trackingPreviewTransform(neutral, binding.source, binding);
  const aspect = binding.width / binding.height;
  const layout = cableSceneLayout(bake.cables, bake.depthGrid), base = frame * layout.stride;
  const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  // Prove that this frame was written with stabilization on. In particular, do
  // not compensate an artifact baked while bypassed, or mismatched legacy data.
  const matches = () => corners.every((corner, i) => {
    const uv = oldMapping.toComposition(corner);
    const p = cableSceneLocalPoint({ x: uv.x * aspect, y: uv.y, z: 0 }, baked, aspect);
    return [p.x, p.y, p.z].every((v, axis) => Number.isFinite(v) && Math.abs(v - bake.data[base + 1 + i * 5 + axis]) <= 1e-4);
  });
  if (!matches()) {
    if (!clipTransformBypassed) return null;
    baked = unstabilized; oldMapping = trackingPreviewTransform(baked, binding.source, binding);
    if (!matches()) return null;
  }
  if (JSON.stringify(baked) === JSON.stringify(neutral)) return null;
  const mappedWidth = (mapping: typeof oldMapping) => {
    const a = mapping.toComposition({ x: 0, y: 0 }), b = mapping.toComposition({ x: 1, y: 0 });
    return Math.hypot((b.x - a.x) * aspect, b.y - a.y);
  };
  const depthRatio = mappedWidth(newMapping) / mappedWidth(oldMapping);
  const data = bake.data.slice(base, base + layout.stride);
  const reproject = (offset: number) => {
    const point = cableScenePhysicsPoint(Array.from(data.subarray(offset, offset + 3)), baked, aspect);
    const projection = projectCableDepth(point, aspect);
    if (!projection) return;
    const uv = newMapping.toComposition(oldMapping.toSource(projection));
    const z = point.z * depthRatio, scale = projectCableDepth({ x: 0, y: 0, z }, aspect)?.scale;
    if (!scale) return;
    const local = cableSceneLocalPoint({ x: aspect * (0.5 + (uv.x - 0.5) / scale),
      y: 0.5 + (uv.y - 0.5) / scale, z }, neutral, aspect);
    data.set([local.x, local.y, local.z], offset);
  };
  for (let i = 0; i < 4; i++) reproject(1 + i * 5);
  if (data[0]) for (let i = 0; i < 468; i++) reproject(21 + i * 5);
  bake.cables.forEach((cable, index) => {
    const offset = layout.offsets[index];
    if (data[offset]) {
      data[offset + 1] *= Math.max(0.001, Math.abs(getEffectiveScale(baked.scale).y)) / Math.max(0.001, Math.abs(getEffectiveScale(neutral.scale).y));
      for (let i = 0; i <= (cable.segments ?? 24); i++) reproject(offset + 6 + i * 3);
    }
  });
  if (bake.depthGrid) {
    const origin = cableSceneLocalPoint({ x: aspect / 2, y: 0.5, z: 0 }, neutral, aspect);
    data.set([origin.x, origin.y, origin.z], layout.depthOffset);
    data[layout.depthOffset + 3] = 0.5 / Math.tan(25 * Math.PI / 180) / (getEffectiveScale(neutral.scale).z ?? 1);
    for (let i = layout.depthOffset + 4; i < data.length; i++) data[i] *= depthRatio;
  }
  return data.every(Number.isFinite) ? data : null;
}
