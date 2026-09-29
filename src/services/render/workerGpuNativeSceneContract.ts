import type { SceneCamera, ScenePrimitiveLayer } from '../../engine/scene/types';
import type { FlockDefinition } from '../../types/flock';
import type { Keyframe } from '../../types/keyframes';
import type { LightClipSettings } from '../../types/light';
import { validateFlockDefinition } from '../flock/graph/flockGraphValidation';
import { isWorkerGpuNativeAudioInputs, type WorkerGpuNativeAudioInput } from './workerGpuNativeAudioContract';
import type { GeometryProgram } from '../operators/geometry/geometryProgram';
import { isGeometryProgram } from '../operators/geometry/geometryProgramValidation';

interface NativeLayerBase {
  readonly layerId: string;
  readonly clipId: string;
  readonly worldMatrix: readonly number[];
  readonly opacity: number;
}

export type WorkerGpuNativeSceneLayer =
  | (NativeLayerBase & { readonly kind: 'primitive'; readonly meshType: ScenePrimitiveLayer['meshType']; readonly wireframe?: boolean })
  | (NativeLayerBase & { readonly kind: 'light'; readonly lightSettings: Pick<LightClipSettings,
      'kind' | 'color' | 'intensity' | 'diameter' | 'castsShadows' | 'shadowStrength'> })
  | (NativeLayerBase & { readonly kind: 'flock'; readonly definition: FlockDefinition;
      readonly keyframes: Keyframe[]; readonly sourceTime: number; readonly audioInputs?: readonly WorkerGpuNativeAudioInput[] })
  | (NativeLayerBase & { readonly kind: 'strands'; readonly effectId: string; readonly program: GeometryProgram });

/** Runtime media references, never persisted with project scene data. */
export interface WorkerGpuNativeSceneAsset {
  readonly id: string;
  readonly kind: 'image' | 'model';
  readonly url: string;
  readonly fileName: string;
}

/** Frozen, value-only scene. Media/GPU handles use separate resource owners. */
export interface WorkerGpuNativeScenePayload {
  readonly kind: 'native-scene';
  readonly version: 1;
  readonly width: number;
  readonly height: number;
  readonly timelineTime: number;
  readonly camera: Omit<SceneCamera, 'viewMatrix' | 'projectionMatrix'> & {
    readonly viewMatrix: readonly number[];
    readonly projectionMatrix: readonly number[];
  };
  readonly layers: readonly WorkerGpuNativeSceneLayer[];
  readonly assets?: readonly WorkerGpuNativeSceneAsset[];
}

const meshes = new Set(['cube', 'sphere', 'plane', 'cylinder', 'torus', 'cone']);
const easings = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier']);
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: readonly string[]) => Object.keys(v).every(k => allowed.includes(k));
const vector = (v: unknown) => record(v) && keys(v, ['x', 'y', 'z']) && finite(v.x) && finite(v.y) && finite(v.z);
const matrix = (v: unknown) => Array.isArray(v) && v.length === 16 && v.every(n => finite(n) && Number.isFinite(Math.fround(n)));
const size = (v: unknown, w: number, h: number) => record(v) && keys(v, ['width', 'height']) && v.width === w && v.height === h;

/** Called only after the enclosing frame stack's bounded plain-data check. */
export function isWorkerGpuNativeScenePayload(value: unknown): value is WorkerGpuNativeScenePayload {
  if (!record(value) || !keys(value, ['kind', 'version', 'width', 'height', 'timelineTime', 'camera', 'layers', 'assets'])
    || value.kind !== 'native-scene' || value.version !== 1 || !finite(value.timelineTime)
    || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
    || (value.width as number) < 1 || (value.height as number) < 1) return false;
  if (value.assets !== undefined) {
    if (!Array.isArray(value.assets) || value.assets.length > 256) return false;
    const ids = new Set<string>();
    for (const asset of value.assets) {
      if (!record(asset) || !keys(asset, ['id', 'kind', 'url', 'fileName']) || !id(asset.id)
        || ids.has(asset.id) || (asset.kind !== 'image' && asset.kind !== 'model')
        || typeof asset.fileName !== 'string' || asset.fileName.length > 1024
        || typeof asset.url !== 'string' || asset.url.length > 8192) return false;
      try { if (!['blob:', 'https:', 'http:'].includes(new URL(asset.url).protocol)) return false; }
      catch { return false; }
      ids.add(asset.id);
    }
  }
  const c = value.camera;
  if (!record(c) || !keys(c, ['viewMatrix', 'projectionMatrix', 'cameraPosition', 'cameraTarget', 'cameraUp',
    'fov', 'near', 'far', 'viewport', 'referenceSize', 'applyDefaultDistance', 'projection', 'orthographicScale'])
    || !matrix(c.viewMatrix) || !matrix(c.projectionMatrix) || !vector(c.cameraPosition)
    || !vector(c.cameraTarget) || !vector(c.cameraUp) || !finite(c.fov) || c.fov <= 0 || c.fov >= 180
    || !finite(c.near) || c.near <= 0 || !finite(c.far) || c.far <= c.near
    || !size(c.viewport, value.width as number, value.height as number)
    || (c.projection !== 'perspective' && c.projection !== 'orthographic')
    || (c.orthographicScale !== undefined && (!finite(c.orthographicScale) || c.orthographicScale <= 0))
    || (c.applyDefaultDistance !== undefined && typeof c.applyDefaultDistance !== 'boolean')) return false;
  if (c.referenceSize !== undefined && (!record(c.referenceSize)
    || !keys(c.referenceSize, ['width', 'height']) || !finite(c.referenceSize.width) || c.referenceSize.width <= 0
    || !finite(c.referenceSize.height) || c.referenceSize.height <= 0)) return false;
  if (!Array.isArray(value.layers) || !value.layers.length || value.layers.length > 256) return false;
  const layerIds = new Set<string>(), clipIds = new Set<string>();
  for (const layer of value.layers) {
    if (!record(layer) || !id(layer.layerId) || !id(layer.clipId) || !matrix(layer.worldMatrix)
      || !finite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || layerIds.has(layer.layerId)) return false;
    layerIds.add(layer.layerId);
    const common = ['kind', 'layerId', 'clipId', 'worldMatrix', 'opacity'];
    if (layer.kind === 'primitive') {
      if (!keys(layer, [...common, 'meshType', 'wireframe']) || !meshes.has(layer.meshType as string)
        || (layer.wireframe !== undefined && typeof layer.wireframe !== 'boolean')) return false;
    } else if (layer.kind === 'light') {
      const light = layer.lightSettings;
      if (!keys(layer, [...common, 'lightSettings']) || !record(light)
        || !keys(light, ['kind', 'color', 'intensity', 'diameter', 'castsShadows', 'shadowStrength'])
        || !['point', 'panel', 'environment'].includes(light.kind as string)
        || typeof light.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(light.color)
        || !finite(light.intensity) || light.intensity < 0 || !Number.isFinite(Math.fround(light.intensity))
        || !finite(light.diameter) || light.diameter < 0.01 || !Number.isFinite(Math.fround(light.diameter))
        || typeof light.castsShadows !== 'boolean' || !finite(light.shadowStrength)
        || light.shadowStrength < 0 || light.shadowStrength > 1) return false;
    } else if (layer.kind === 'flock') {
      if (!keys(layer, [...common, 'definition', 'keyframes', 'sourceTime', 'audioInputs']) || !finite(layer.sourceTime)
        || clipIds.has(layer.clipId) || !Array.isArray(layer.keyframes) || layer.keyframes.length > 4096) return false;
      if (layer.audioInputs !== undefined && !isWorkerGpuNativeAudioInputs(layer.audioInputs)) return false;
      clipIds.add(layer.clipId);
      for (const key of layer.keyframes) {
        if (!record(key) || !keys(key, ['id', 'clipId', 'time', 'property', 'value', 'easing', 'hold', 'handleIn', 'handleOut'])
          || !id(key.id) || key.clipId !== layer.clipId || !finite(key.time) || !finite(key.value)
          || typeof key.property !== 'string' || !key.property.startsWith('flock.') || !easings.has(key.easing as string)
          || (key.hold !== undefined && typeof key.hold !== 'boolean')) return false;
        for (const handle of [key.handleIn, key.handleOut]) if (handle !== undefined
          && (!record(handle) || !keys(handle, ['x', 'y']) || !finite(handle.x) || !finite(handle.y))) return false;
      }
      try { if (!validateFlockDefinition(layer.definition as FlockDefinition).valid) return false; }
      catch { return false; }
    } else if (layer.kind === 'strands') {
      if (!keys(layer, [...common, 'effectId', 'program']) || !id(layer.effectId) || !isGeometryProgram(layer.program)) return false;
    } else return false;
  }
  return true;
}
