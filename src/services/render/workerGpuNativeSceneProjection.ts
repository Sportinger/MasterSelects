import type { Layer, LayerRenderData } from '../../engine/core/types';
import type { SceneCamera } from '../../engine/scene/types';
import type { SceneTimelineContext } from '../../engine/scene/SceneTimelineUtils';
import { collectScene3DLayers } from '../../engine/scene/SceneLayerCollector';
import { sceneCompositeStyle } from '../../engine/scene/sceneEffectRouting';
import { isFlockProperty } from '../../types/flock';
import type { WorkerGpuFrameStackIdentity } from './workerGpuFrameStackContract';
import type { WorkerGpuFrameStackHostSource } from './workerGpuFrameStackProjector';
import type { WorkerGpuNativeSceneLayer, WorkerGpuNativeScenePayload } from './workerGpuNativeSceneContract';

export interface WorkerGpuNativeSceneProjectionInput {
  readonly layers: readonly Layer[];
  readonly width: number;
  readonly height: number;
  readonly frame: WorkerGpuFrameStackIdentity;
  readonly sceneContext?: Partial<SceneTimelineContext>;
}
export interface WorkerGpuNativeSceneProjection {
  readonly layers: readonly Layer[];
  readonly source: Extract<WorkerGpuFrameStackHostSource, { kind: 'native-scene' }>;
}

/** Collapse shared 3D at its bottommost position in the host's top-to-bottom order. */
export function projectNativeSceneLayers(input: WorkerGpuNativeSceneProjectionInput, camera: SceneCamera): WorkerGpuNativeSceneProjection | null {
  const selected = input.layers.filter(layer => layer.visible && layer.opacity > 0 && layer.is3D);
  if (!selected.length) return null;
  if (selected.some(layer => layer.maskClipId || layer.masks?.length || layer.source?.type === 'gaussian-avatar')) {
    throw new Error('Worker native scene masks/avatar layers are not admitted yet');
  }
  const data: LayerRenderData[] = [...selected].reverse().map(layer => ({ layer, isVideo: false, externalTexture: null, textureView: null,
    sourceWidth: layer.source?.intrinsicWidth ?? input.width, sourceHeight: layer.source?.intrinsicHeight ?? input.height }));
  const scene = collectScene3DLayers(data, { width: input.width, height: input.height });
  if (!scene.length) throw new Error('Worker native scene contains no drawable layers');
  const layers: WorkerGpuNativeSceneLayer[] = scene.map(layer => {
    if (layer.layerSpaceEffects?.length || layer.surfacePlan) throw new Error('Worker native scene surface effects are not admitted yet');
    const base = { layerId: layer.layerId, clipId: layer.clipId, worldMatrix: Array.from(layer.worldMatrix), opacity: layer.opacity };
    if (layer.kind === 'primitive') return { ...base, kind: 'primitive', meshType: layer.meshType, wireframe: layer.wireframe };
    if (layer.kind === 'light') {
      const settings = layer.lightSettings;
      if (settings.environmentMapMediaFileId || settings.environmentMapUrl || settings.environmentMapFileName) {
        throw new Error('Worker native scene environment-map resources are not admitted yet');
      }
      const { kind, color, intensity, diameter, castsShadows, shadowStrength } = settings;
      return { ...base, kind: 'light', lightSettings: { kind, color, intensity, diameter, castsShadows, shadowStrength } };
    }
    if (layer.kind !== 'flock') throw new Error(`Worker native scene kind '${layer.kind}' is not admitted yet`);
    if (!layer.flock.program) throw new Error('Worker native scene cannot transport an invalid Flock graph');
    return { ...base, kind: 'flock', definition: structuredClone(layer.flock.definition), sourceTime: layer.flock.sourceTime,
      keyframes: layer.flock.keyframes.filter(key => isFlockProperty(key.property)).map(key => ({
        id: key.id, clipId: layer.clipId, property: key.property, value: key.value, time: key.time, easing: key.easing,
        ...(key.hold !== undefined ? { hold: key.hold } : {}),
        ...(key.handleIn ? { handleIn: { ...key.handleIn } } : {}), ...(key.handleOut ? { handleOut: { ...key.handleOut } } : {}),
      })) };
  });
  let id = '__worker_scene_3d__';
  while (input.layers.some(layer => layer.id === id)) id += '_';
  const synthetic: Layer = { id, name: '3D Scene', visible: true, ...sceneCompositeStyle(data, scene, false),
    source: { type: 'image', intrinsicWidth: input.width, intrinsicHeight: input.height },
    position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0 };
  const included = new Set(selected), last = input.layers.lastIndexOf(selected[selected.length - 1]);
  const projected = input.layers.flatMap((layer, index) => index === last ? [synthetic] : included.has(layer) ? [] : [layer]);
  const payload: WorkerGpuNativeScenePayload = { kind: 'native-scene', version: 1, width: input.width, height: input.height,
    timelineTime: input.frame.timelineTime, camera: { ...structuredClone(camera),
      viewMatrix: Array.from(camera.viewMatrix), projectionMatrix: Array.from(camera.projectionMatrix) }, layers };
  return { layers: projected, source: { kind: 'native-scene', runtimeSourceKind: 'nativeScene', layerId: id,
    sourceId: `native-scene:${input.frame.compositionId}`, payload } };
}
