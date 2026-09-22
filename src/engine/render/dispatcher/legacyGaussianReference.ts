// Legacy gaussian-avatar / per-layer native splat reference bodies, moved out
// of RenderDispatcher. NOT wired into the render path — kept on disk for
// migration/reference only (see native-3d-shared-scene-plan.md). The live
// paths are SharedScene3DProcessor (shared-scene splats) and
// GaussianSplatSceneLoader (scene loading).

import type { Layer, LayerRenderData } from '../../core/types';
import { getGaussianSplatGpuRenderer } from '../../gaussian/core/GaussianSplatGpuRenderer';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../../gaussian/types';
import { collectScene3DLayers } from '../../scene/SceneLayerCollector';
import { resolveRenderableSharedSceneCamera } from '../../scene/SceneCameraUtils';
import type { SceneSplatEffectorRuntimeData } from '../../scene/types';
import { Logger } from '../../../services/logger';
import type { RenderDeps } from '../RenderDispatcher';
import type { GaussianSplatSceneLoadRequest } from './gaussianSequenceFacet';

const log = Logger.create('RenderDispatcher');
// The logger is only referenced from the commented gaussian-avatar reference
// body below; anchor it so the reference file typechecks standalone.
void log;
const GAUSSIAN_PLAYBACK_SORT_FREQUENCY = 6;

function isNativeGaussianSplatSource(source: Layer['source'] | undefined): boolean {
  return source?.type === 'gaussian-splat';
}

/**
 * Host surface the legacy per-layer splat bridge used on the dispatcher.
 * Mirrors the dispatcher members the reference body below reads.
 */
export interface LegacyGaussianSplatHost {
  deps: Pick<RenderDeps, 'renderLoop' | 'exportCanvasManager'>;
  getNativeGaussianSplatSceneKey: (clipId: string, runtimeKey?: string) => string;
  collectActiveSplatEffectors: (width: number, height: number) => SceneSplatEffectorRuntimeData[];
  getEffectiveTimelineTime: () => number;
  loadAndUploadSplatScene: (
    request: GaussianSplatSceneLoadRequest,
    renderer: ReturnType<typeof getGaussianSplatGpuRenderer>,
  ) => Promise<void> | void;
}

/**
 * Process Gaussian Splat avatar layers: grab the renderer's canvas,
 * import as GPU texture, replace with synthetic layer.
 * Unlike the old frame-on-demand shared-scene path, the Gaussian renderer runs its own rAF loop —
 * we simply capture the latest frame each compositor cycle.
 */
export function legacyProcessGaussianLayers(layerData: LayerRenderData[], device: GPUDevice, width: number, height: number): void {
  void layerData;
  void device;
  void width;
  void height;
  return;
  /*
  // Find gaussian-avatar layers
  const indices: number[] = [];
  for (let i = 0; i < layerData.length; i++) {
    if (layerData[i].layer.source?.type === 'gaussian-avatar') {
      indices.push(i);
    }
  }
  if (indices.length === 0) return;

  const d = this.deps;
  const renderer = d.gaussianSplatRenderer;

  // Capture avatar URL before any async work (layerData may be mutated)
  const firstLayerData = layerData[indices[0]];
  const avatarUrl = firstLayerData.layer.source?.gaussianAvatarUrl;

  if (!renderer || !renderer.isInitialized) {
    // Lazy init — trigger on first frame with gaussian layers
    if (!this.gaussianInitializing) {
      this.gaussianInitializing = true;
      // Capture URL now — layerData will be stale by the time the promise resolves
      const capturedAvatarUrl = avatarUrl;
      import('../gaussian/GaussianSplatSceneRenderer').then(({ getGaussianSplatSceneRenderer }) => {
        const r = getGaussianSplatSceneRenderer();
        r.initialize().then((ok) => {
          if (ok) {
            d.gaussianSplatRenderer = r;
            if (capturedAvatarUrl) {
              r.loadAvatar(capturedAvatarUrl);
            }
            log.info('Gaussian Splat renderer initialized lazily');
          }
          this.gaussianInitializing = false;
        });
      });
    }
    // Remove gaussian layers while loading
    for (let i = indices.length - 1; i >= 0; i--) {
      layerData.splice(indices[i], 1);
    }
    return;
  }

  // Ensure avatar is loaded for the current layer (guard against concurrent loads)
  if (avatarUrl && !renderer.isAvatarLoaded && !renderer.isLoading) {
    renderer.loadAvatar(avatarUrl);
    // Remove layers while loading
    for (let i = indices.length - 1; i >= 0; i--) {
      layerData.splice(indices[i], 1);
    }
    return;
  }

  // Still loading — skip rendering but don't call loadAvatar again
  if (renderer.isLoading || !renderer.isAvatarLoaded) {
    for (let i = indices.length - 1; i >= 0; i--) {
      layerData.splice(indices[i], 1);
    }
    return;
  }

  // Update blendshapes from layer source
  const blendshapes = firstLayerData.layer.source?.gaussianBlendshapes;
  if (blendshapes) {
    renderer.setBlendshapes(blendshapes);
  }

  // Resize renderer to match compositor resolution
  renderer.resize(width, height);

  // Get the renderer's canvas (already rendered by its own rAF loop)
  const canvas = renderer.getCanvas();
  if (!canvas || canvas.width === 0 || canvas.height === 0) {
    // Canvas not ready yet — remove layers
    for (let i = indices.length - 1; i >= 0; i--) {
      layerData.splice(indices[i], 1);
    }
    return;
  }

  // Create/resize GPU texture
  if (!this.gaussianTexture || this.gaussianTexture.width !== width || this.gaussianTexture.height !== height) {
    this.gaussianTexture?.destroy();
    this.gaussianTexture = device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.gaussianTextureView = this.gaussianTexture.createView();
  }

  // Copy canvas to GPU texture — guard against canvas without rendering context
  try {
    device.queue.copyExternalImageToTexture(
      { source: canvas },
      { texture: this.gaussianTexture },
      { width, height },
    );
    this.gaussianErrorLogged = false; // reset on success
  } catch (err) {
    if (!this.gaussianErrorLogged) {
      log.error('Gaussian canvas copy failed (logging once)', err);
      this.gaussianErrorLogged = true;
    }
    // Remove gaussian layers — canvas is not usable
    for (let i = indices.length - 1; i >= 0; i--) {
      layerData.splice(indices[i], 1);
    }
    return;
  }

  // Create synthetic layer for the bridged renderer output.
  const insertIdx = indices[0];
  const firstLayer = layerData[indices[0]].layer;
  const isSingle = indices.length === 1;

  const syntheticLayer: Layer = {
    id: '__gaussian_splat__',
    name: 'Gaussian Avatar',
    visible: true,
    opacity: isSingle ? firstLayer.opacity : 1,
    blendMode: isSingle ? firstLayer.blendMode : 'normal',
    source: { type: 'image' },
    effects: isSingle ? firstLayer.effects : [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };

  const syntheticData: LayerRenderData = {
    layer: syntheticLayer,
    isVideo: false,
    externalTexture: null,
    textureView: this.gaussianTextureView,
    sourceWidth: width,
    sourceHeight: height,
  };

  // Remove gaussian layers (reverse order) and insert synthetic
  for (let i = indices.length - 1; i >= 0; i--) {
    layerData.splice(indices[i], 1);
  }
  layerData.splice(insertIdx, 0, syntheticData);
  */
}

/**
 * Process gaussian-splat layers (native WebGPU path).
 * Each layer is rendered individually into its own texture — NO merging.
 * The original layer object is preserved for compositor semantics.
 */
export function legacyProcessGaussianSplatLayers(
  host: LegacyGaussianSplatHost,
  layerData: LayerRenderData[],
  device: GPUDevice,
  width: number,
  height: number,
): {
  gaussianCandidates: number;
  rendered: number;
  pendingLoad: number;
  missingUrl: number;
  noTextureView: number;
} {
  let gaussianCandidates = 0;
  for (let i = 0; i < layerData.length; i++) {
    if (isNativeGaussianSplatSource(layerData[i].layer.source)) {
      gaussianCandidates++;
    }
  }
  const summary = {
    gaussianCandidates,
    rendered: 0,
    pendingLoad: 0,
    missingUrl: 0,
    noTextureView: 0,
  };
  if (gaussianCandidates === 0) return summary;

  // Get or lazy-init the native WebGPU renderer
  const renderer = getGaussianSplatGpuRenderer();
  if (!renderer.isInitialized) {
    renderer.initialize(device);
  }
  renderer.beginFrame();
  const isRealtimePlayback = (host.deps.renderLoop?.getIsPlaying() ?? false)
    && !host.deps.exportCanvasManager.getIsExporting();
  const preciseSplatSorting = host.deps.exportCanvasManager.getIsExporting();
  const activeSplatEffectors = host.collectActiveSplatEffectors(width, height);
  const sceneCamera = resolveRenderableSharedSceneCamera(
    { width, height },
    host.getEffectiveTimelineTime(),
  );
  const sceneSplatLayers = new Map(
    collectScene3DLayers(layerData, {
      width,
      height,
      preciseSplatSorting,
      includeLayer: (candidate) => isNativeGaussianSplatSource(candidate.layer.source),
    })
      .filter((layer) => layer.kind === 'splat')
      .map((layer) => [layer.layerId, layer] as const),
  );

  // Process each gaussian-splat layer individually (reverse iteration for safe splice)
  for (let i = layerData.length - 1; i >= 0; i--) {
    const data = layerData[i];
    const source = data.layer.source;
    if (source?.type !== 'gaussian-splat' || !isNativeGaussianSplatSource(source)) continue;

    const clipId = data.layer.sourceClipId || data.layer.id;
    const sceneKey = host.getNativeGaussianSplatSceneKey(clipId, source.gaussianSplatRuntimeKey);
    const splatUrl = source.gaussianSplatUrl;
    const settings = source.gaussianSplatSettings;
    const renderSettings = settings?.render ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render;
    const liveSortFrequency = isRealtimePlayback
      ? (renderSettings.sortFrequency === 0
        ? 0
        : Math.max(renderSettings.sortFrequency, GAUSSIAN_PLAYBACK_SORT_FREQUENCY))
      : renderSettings.sortFrequency;
    const sceneLayer = sceneSplatLayers.get(data.layer.id);

    // No URL — remove layer
    if (!splatUrl) {
      summary.missingUrl++;
      layerData.splice(i, 1);
      continue;
    }

    if (!sceneLayer) {
      summary.noTextureView++;
      layerData.splice(i, 1);
      continue;
    }

    // Upload scene if not cached — trigger async load, skip this frame
    if (!renderer.hasScene(sceneKey)) {
      host.loadAndUploadSplatScene({
        sceneKey,
        clipId,
        url: splatUrl,
        fileName: source.gaussianSplatFileName ?? data.layer.name,
        file: source.file,
      }, renderer);
      summary.pendingLoad++;
      layerData.splice(i, 1);
      continue;
    }

    // Render this splat layer as a shared-scene object with its own world transform.
    const gaussianCommandEncoder = device.createCommandEncoder();
    const textureView = renderer.renderToTexture(
      sceneKey, sceneCamera, { width, height }, gaussianCommandEncoder,
      {
        clipLocalTime: source.mediaTime,
        backgroundColor: renderSettings.backgroundColor,
        splatScale: renderSettings.splatScale,
        nearPlane: renderSettings.nearPlane,
        farPlane: renderSettings.farPlane,
        effectors: sceneLayer.threeDEffectorsEnabled === false ? [] : activeSplatEffectors,
        worldMatrix: sceneLayer.worldMatrix,
        maxSplats: renderSettings.maxSplats,
        particleSettings: settings?.particle,
        precise: preciseSplatSorting,
        sortFrequency: liveSortFrequency,
        temporalSettings: settings?.temporal,
      },
    );
    device.queue.submit([gaussianCommandEncoder.finish()]);

    if (textureView) {
      summary.rendered++;
      const compositeLayer = {
        ...data.layer,
        position: { x: 0, y: 0, z: 0 },
        scale: {
          x: 1,
          y: 1,
          ...(data.layer.scale.z !== undefined ? { z: 1 } : {}),
        },
        rotation: typeof data.layer.rotation === 'number'
          ? 0
          : { x: 0, y: 0, z: 0 },
      };
      // In-place replacement — keep the SAME layer (preserving opacity, blend, masks, effects)
      layerData[i] = {
        layer: compositeLayer,
        isVideo: false,
        externalTexture: null,
        textureView,
        sourceWidth: width,
        sourceHeight: height,
      };
    } else {
      summary.noTextureView++;
      layerData.splice(i, 1);
    }
  }

  return summary;
}
