// ExportReadinessFacet — precise-export asset readiness for the
// RenderDispatcher. Walks visible (nested) export layers, initializes the
// shared scene renderer, and waits for native splat scenes and 3D model
// assets, caching per-resolution/per-asset readiness between export passes.
//
// All readiness work is routed back through the dispatcher host callbacks so
// the dispatcher's public methods (ensureSceneRendererInitialized,
// preloadSceneModelAsset, ensureGaussianSplatSceneLoaded) stay the single
// spy/override point for tests and instrumentation.

import type { Layer } from '../../core/types';
import type { ModelSequenceData } from '../../../types/mediaSequences';
import { useMediaStore } from '../../../stores/mediaStore';
import { buildSharedSplatRuntimeRequest } from '../../scene/runtime/SharedSplatRuntimeUtils';
import type { GaussianSplatSceneLoadRequest } from './gaussianSequenceFacet';
import type { FlockLayerSourceData } from '../../../services/flock/flockLayerSource';

const MAX_EXPORT_LAYER_NESTING_DEPTH = 8;

interface ExportReadinessHost {
  getResolution: () => { width: number; height: number } | null;
  ensureSceneRendererInitialized: (width: number, height: number) => Promise<boolean>;
  preloadSceneModelAsset: (url: string, fileName: string, modelSequence?: ModelSequenceData) => Promise<boolean>;
  ensureGaussianSplatSceneLoaded: (request: GaussianSplatSceneLoadRequest) => Promise<boolean>;
  /** Advances pinned flock export sessions; rejects invalid graphs or unsupported hosts. */
  ensureFlockLayersReady?: (layers: FlockLayerSourceData[]) => Promise<void>;
}

export class ExportReadinessFacet {
  private readonly host: ExportReadinessHost;
  private exportReadySceneRendererResolutions = new Set<string>();
  private exportReadyNativeSplatSceneKeys = new Set<string>();
  private exportReadyModelUrls = new Set<string>();

  constructor(host: ExportReadinessHost) {
    this.host = host;
  }

  clearExportReadinessCache(): void {
    this.exportReadySceneRendererResolutions.clear();
    this.exportReadyNativeSplatSceneKeys.clear();
    this.exportReadyModelUrls.clear();
  }

  async ensureExportLayersReady(layers: Layer[]): Promise<void> {
    const visibleLayers = this.collectVisibleExportLayers(layers);
    if (visibleLayers.length === 0) {
      return;
    }

    const nativeSplats = new Map<string, ReturnType<typeof buildSharedSplatRuntimeRequest>>();
    const modelAssets = new Map<string, { url: string; fileName: string; modelSequence?: ModelSequenceData }>();
    let needsSceneRenderer = false;

    for (const layer of visibleLayers) {
      const source = layer.source;
      if (!source) {
        continue;
      }

      if (
        layer.is3D === true &&
        source.type !== 'camera'
      ) {
        needsSceneRenderer = true;
      }

      if (source.type === 'model' && source.modelUrl) {
        const modelAssetKey = source.modelSequence
          ? `${source.modelUrl}|sequence|${source.modelSequence.sequenceName ?? ''}|${source.modelSequence.frameCount}|${source.modelSequence.fps}`
          : source.modelUrl;
        modelAssets.set(modelAssetKey, {
          url: source.modelUrl,
          fileName: source.file?.name ?? layer.name,
          ...(source.modelSequence ? { modelSequence: source.modelSequence } : {}),
        });
      }

      if (source.type !== 'gaussian-splat') {
        continue;
      }

      const mediaFileId = source.mediaFileId;
      const mediaFile = mediaFileId
        ? useMediaStore.getState().files.find((file) => file.id === mediaFileId) ?? null
        : null;
      const fileName =
        source.gaussianSplatFileName ??
        mediaFile?.file?.name ??
        source.file?.name ??
        mediaFile?.name ??
        layer.name;
      const file =
        source.file && (typeof source.file.size !== 'number' || source.file.size > 0)
          ? source.file
          : mediaFile?.file && (typeof mediaFile.file.size !== 'number' || mediaFile.file.size > 0)
            ? mediaFile.file
            : undefined;
      const gaussianSplatSequence = source.gaussianSplatSequence ?? mediaFile?.gaussianSplatSequence;
      const preferBaseRuntime = !!gaussianSplatSequence;
      const fileHash = preferBaseRuntime ? undefined : (source.gaussianSplatFileHash ?? mediaFile?.fileHash);
      const requestedMaxSplats = source.gaussianSplatSettings?.render.maxSplats ?? 0;
      const request = buildSharedSplatRuntimeRequest({
        clipId: layer.sourceClipId ?? layer.id,
        runtimeKey: source.gaussianSplatRuntimeKey,
        url: source.gaussianSplatUrl,
        file,
        fileName,
        fileHash,
        mediaFileId,
        gaussianSplatSequence,
        gaussianSplatSettings: source.gaussianSplatSettings,
        requestedMaxSplats,
      });

      if (!request.url && !request.file) {
        throw new Error(`Precise export cannot load gaussian splat "${layer.name}" without a URL or file`);
      }
      nativeSplats.set(request.sceneKey, request);
    }

    if (needsSceneRenderer || modelAssets.size > 0) {
      const resolution = this.host.getResolution() ?? { width: 1, height: 1 };
      const resolutionKey = `${resolution.width}x${resolution.height}`;
      if (!this.exportReadySceneRendererResolutions.has(resolutionKey)) {
        const initialized = await this.host.ensureSceneRendererInitialized(resolution.width, resolution.height);
        if (!initialized) {
          throw new Error('Precise export could not initialize the shared scene renderer');
        }
        this.exportReadySceneRendererResolutions.add(resolutionKey);
      }
    }

    const readinessChecks = [
      ...[...nativeSplats.values()].map(async (request) => {
        if (this.exportReadyNativeSplatSceneKeys.has(request.sceneKey)) {
          return;
        }
        const ready = await this.host.ensureGaussianSplatSceneLoaded({
          sceneKey: request.sceneKey,
          clipId: request.clipId,
          url: request.url,
          fileName: request.fileName,
          file: request.file,
          showProgress: false,
        });
        if (!ready) {
          throw new Error(`Native gaussian splat "${request.fileName}" was not ready in time`);
        }
        this.exportReadyNativeSplatSceneKeys.add(request.sceneKey);
      }),
      ...[...modelAssets.entries()].map(async ([assetKey, { url, fileName, modelSequence }]) => {
        if (this.exportReadyModelUrls.has(assetKey)) {
          return;
        }
        const ready = modelSequence
          ? await this.host.preloadSceneModelAsset(url, fileName, modelSequence)
          : await this.host.preloadSceneModelAsset(url, fileName);
        if (!ready) {
          throw new Error(`3D model "${fileName}" was not ready in time`);
        }
        this.exportReadyModelUrls.add(assetKey);
      }),
    ];

    const flockLayers = visibleLayers
      .map((layer) => (layer.source?.type === 'flock' ? layer.source.flock : undefined))
      .filter((flock): flock is FlockLayerSourceData => !!flock);
    if (flockLayers.length > 0) {
      if (!this.host.ensureFlockLayersReady) {
        throw new Error('Export cannot render flock clips: the flock runtime is not available on this render host');
      }
      await this.host.ensureFlockLayersReady(flockLayers);
    }

    if (readinessChecks.length === 0) {
      return;
    }

    const results = await Promise.allSettled(readinessChecks);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') {
      throw new Error(
        `Precise export asset wait failed: ${
          failed.reason instanceof Error ? failed.reason.message : String(failed.reason)
        }`,
      );
    }
  }

  private collectVisibleExportLayers(
    layers: Layer[],
    depth = 0,
    result: Layer[] = [],
  ): Layer[] {
    if (depth >= MAX_EXPORT_LAYER_NESTING_DEPTH) {
      return result;
    }

    for (const layer of layers) {
      if (!layer || layer.visible === false || layer.opacity === 0) {
        continue;
      }

      result.push(layer);

      const nestedLayers = layer.source?.nestedComposition?.layers;
      if (Array.isArray(nestedLayers) && nestedLayers.length > 0) {
        this.collectVisibleExportLayers(nestedLayers, depth + 1, result);
      }
    }

    return result;
  }
}
