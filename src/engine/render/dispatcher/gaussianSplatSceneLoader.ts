// GaussianSplatSceneLoader — native gaussian splat scene loading facet for the
// RenderDispatcher. Owns the in-flight load set, cached scene bounds, the
// fetch/parse/upload pipeline, and engine-store load-progress reporting.

import { Logger } from '../../../services/logger';
import { NativeHelperClient } from '../../../services/nativeHelper/NativeHelperClient';
import { useEngineStore, type GaussianSplatLoadPhase } from '../../../stores/engineStore';
import { getGaussianSplatGpuRenderer } from '../../gaussian/core/GaussianSplatGpuRenderer';
import { getReplacedSplatSceneAsset, getSplatSceneReplacementRevision } from '../../gaussian/core/splatSceneReplacement';
import { loadGaussianSplatAssetCached, type GaussianSplatLoadProgress } from '../../gaussian/loaders';
import { openLodPackage } from '../../gaussian/lod/lodPackage';
import type { GaussianSplatSceneLoadRequest } from './gaussianSequenceFacet';

const log = Logger.create('RenderDispatcher');

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

interface GaussianSplatSceneLoaderDeps {
  getDevice: () => GPUDevice | null;
  requestRender: () => void;
}

export class GaussianSplatSceneLoader {
  private readonly deps: GaussianSplatSceneLoaderDeps;
  private splatLoadingClips = new Set<string>();
  private splatSceneBounds = new Map<string, { min: [number, number, number]; max: [number, number, number] }>();

  constructor(deps: GaussianSplatSceneLoaderDeps) {
    this.deps = deps;
  }

  isLoading(sceneKey: string): boolean {
    return this.splatLoadingClips.has(sceneKey);
  }

  getSceneBounds(clipId: string): { min: [number, number, number]; max: [number, number, number] } | undefined {
    return this.splatSceneBounds.get(clipId);
  }

  async ensureSceneLoaded(options: GaussianSplatSceneLoadRequest): Promise<boolean> {
    if (!options.url && !options.file) return false;

    const device = this.deps.getDevice();
    if (!device) return false;

    const renderer = getGaussianSplatGpuRenderer();
    if (!renderer.isInitialized) {
      renderer.initialize(device);
    }

    if (renderer.hasScene(options.sceneKey)) {
      this.clearGaussianSplatLoadProgress(options.sceneKey);
      return true;
    }

    if (this.splatLoadingClips.has(options.sceneKey)) {
      return this.waitForGaussianSplatScene(options.sceneKey, renderer);
    }

    await this.loadAndUploadSplatScene(options, renderer);
    return renderer.hasScene(options.sceneKey);
  }

  private async waitForGaussianSplatScene(
    sceneKey: string,
    renderer: ReturnType<typeof getGaussianSplatGpuRenderer>,
    timeoutMs = 15000,
  ): Promise<boolean> {
    const startedAt = performance.now();

    while (this.splatLoadingClips.has(sceneKey)) {
      if (renderer.hasScene(sceneKey)) {
        return true;
      }
      if (performance.now() - startedAt >= timeoutMs) {
        break;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    }

    return renderer.hasScene(sceneKey);
  }

  private setGaussianSplatLoadProgress(
    request: GaussianSplatSceneLoadRequest,
    progress: {
      phase: GaussianSplatLoadPhase;
      percent?: number;
      loadedBytes?: number;
      totalBytes?: number;
      message?: string;
    },
  ): void {
    if (request.showProgress === false) {
      return;
    }

    useEngineStore.getState().setGaussianSplatLoadProgress({
      sceneKey: request.sceneKey,
      clipId: request.clipId,
      fileName: request.file?.name || request.fileName || 'splat.ply',
      ...progress,
    });
  }

  private clearGaussianSplatLoadProgress(sceneKey: string, delayMs = 0): void {
    const clear = () => {
      useEngineStore.getState().clearGaussianSplatLoadProgress(sceneKey);
    };
    if (delayMs > 0) globalThis.setTimeout(clear, delayMs);
    else clear();
  }

  private mapGaussianAssetLoadProgress(
    progress: GaussianSplatLoadProgress,
    startPercent: number,
    endPercent: number,
  ): number {
    const bytePercent = progress.totalBytes && progress.totalBytes > 0
      ? (progress.loadedBytes ?? 0) / progress.totalBytes
      : 0;
    const rawPercent = clampUnitInterval(progress.percent ?? bytePercent);
    return startPercent + (endPercent - startPercent) * rawPercent;
  }

  private async fetchGaussianSplatFile(request: GaussianSplatSceneLoadRequest): Promise<File> {
    if (!request.url) {
      throw new Error('Cannot fetch gaussian splat without a URL.');
    }

    this.setGaussianSplatLoadProgress(request, {
      phase: 'fetching',
      percent: 0.02,
      loadedBytes: 0,
      message: 'Fetching splat file',
    });

    const nativePath = NativeHelperClient.parseFileReferenceUrl(request.url);
    if (nativePath) {
      const arrayBuffer = await NativeHelperClient.getDownloadedFile(nativePath);
      if (!arrayBuffer) {
        throw new Error(`Failed to fetch native gaussian splat: ${nativePath}`);
      }

      this.setGaussianSplatLoadProgress(request, {
        phase: 'fetching',
        percent: 0.35,
        loadedBytes: arrayBuffer.byteLength,
        totalBytes: arrayBuffer.byteLength,
        message: 'Fetched splat file',
      });
      return new File([arrayBuffer], request.fileName || nativePath.split(/[\\/]/).pop() || 'splat.ply');
    }

    const response = await fetch(request.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch gaussian splat: ${response.status} ${response.statusText}`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    const parsedTotalBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
    const totalBytes = Number.isFinite(parsedTotalBytes) && parsedTotalBytes > 0
      ? parsedTotalBytes
      : undefined;

    if (!response.body) {
      const arrayBuffer = await response.arrayBuffer();
      this.setGaussianSplatLoadProgress(request, {
        phase: 'fetching',
        percent: 0.35,
        loadedBytes: arrayBuffer.byteLength,
        totalBytes: totalBytes ?? arrayBuffer.byteLength,
        message: 'Fetched splat file',
      });
      return new File([arrayBuffer], request.fileName || 'splat.ply');
    }

    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let loadedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      chunks.push(value.slice());
      loadedBytes += value.byteLength;
      const rawPercent = totalBytes
        ? loadedBytes / totalBytes
        : Math.min(0.95, loadedBytes / (64 * 1024 * 1024));

      this.setGaussianSplatLoadProgress(request, {
        phase: 'fetching',
        percent: 0.02 + clampUnitInterval(rawPercent) * 0.33,
        loadedBytes,
        totalBytes,
        message: 'Fetching splat file',
      });
    }

    this.setGaussianSplatLoadProgress(request, {
      phase: 'fetching',
      percent: 0.35,
      loadedBytes,
      totalBytes: totalBytes ?? loadedBytes,
      message: 'Fetched splat file',
    });

    return new File(chunks, request.fileName || 'splat.ply');
  }

  /** Async helper: fetch splat file, parse, and upload to GPU renderer */
  async loadAndUploadSplatScene(
    request: GaussianSplatSceneLoadRequest,
    renderer: ReturnType<typeof getGaussianSplatGpuRenderer>,
  ): Promise<void> {
    if (this.splatLoadingClips.has(request.sceneKey)) return;
    this.splatLoadingClips.add(request.sceneKey);
    const replacementRevision = getSplatSceneReplacementRevision(request.sceneKey);

    try {
      const replaced = getReplacedSplatSceneAsset(request.sceneKey);
      if (replaced?.frames[0]?.buffer) {
        // Live-replaced scenes (e.g. running training) outrank their stale media file.
        renderer.uploadScene(request.sceneKey, {
          splatCount: replaced.frames[0].buffer.splatCount,
          data: replaced.frames[0].buffer.data,
        });
        this.clearGaussianSplatLoadProgress(request.sceneKey);
        this.deps.requestRender();
        return;
      }
      let file = request.file;
      let loadStartPercent = 0.02;
      if (!file) {
        if (!request.url) {
          return;
        }
        file = await this.fetchGaussianSplatFile(request);
        loadStartPercent = 0.35;
      } else {
        this.setGaussianSplatLoadProgress(request, {
          phase: 'reading',
          percent: loadStartPercent,
          loadedBytes: 0,
          totalBytes: file.size,
          message: 'Reading splat file',
        });
      }

      const loadFile = file;
      const lodPackage = /\.zip$/i.test(loadFile.name) ? await openLodPackage(loadFile) : null;
      if (lodPackage) {
        // Streamed LOD package: upload the coarsest level now, the renderer streams finer levels per view.
        this.setGaussianSplatLoadProgress(request, { phase: 'uploading', percent: 0.5, totalBytes: loadFile.size, message: 'Streaming splat LOD' });
        this.splatSceneBounds.set(request.sceneKey, lodPackage.bounds);
        if (request.clipId && request.clipId !== request.sceneKey) this.splatSceneBounds.set(request.clipId, lodPackage.bounds);
        await renderer.uploadLodScene(request.sceneKey, lodPackage, () => this.deps.requestRender());
        this.setGaussianSplatLoadProgress(request, { phase: 'complete', percent: 1, totalBytes: loadFile.size, message: 'Splat LOD ready' });
        this.clearGaussianSplatLoadProgress(request.sceneKey, 350);
        log.info('Gaussian splat LOD scene ready', { sceneKey: request.sceneKey, levels: lodPackage.counts });
        this.deps.requestRender();
        return;
      }
      const asset = await loadGaussianSplatAssetCached(request.sceneKey, loadFile, undefined, {
        maxSplats: request.maxSplats,
        onProgress: (progress) => {
          this.setGaussianSplatLoadProgress(request, {
            phase: progress.phase,
            percent: this.mapGaussianAssetLoadProgress(progress, loadStartPercent, 0.9),
            loadedBytes: progress.loadedBytes,
            totalBytes: progress.totalBytes ?? loadFile.size,
            message: progress.message,
          });
        },
      });

      if (getSplatSceneReplacementRevision(request.sceneKey) !== replacementRevision) {
        log.info('Skipped stale gaussian splat load; the scene was replaced while parsing', {
          sceneKey: request.sceneKey,
        });
        this.clearGaussianSplatLoadProgress(request.sceneKey);
        return;
      }
      if (asset?.frames[0]?.buffer) {
        if (asset.metadata?.boundingBox) {
          this.splatSceneBounds.set(request.sceneKey, asset.metadata.boundingBox);
          if (request.clipId && request.clipId !== request.sceneKey) {
            this.splatSceneBounds.set(request.clipId, asset.metadata.boundingBox);
          }
        }
        this.setGaussianSplatLoadProgress(request, {
          phase: 'uploading',
          percent: 0.94,
          loadedBytes: loadFile.size,
          totalBytes: loadFile.size,
          message: 'Uploading splat scene',
        });
        const loaded = asset.frames[0].buffer;
        renderer.uploadScene(request.sceneKey, {
          splatCount: loaded.splatCount,
          data: loaded.data,
          ...(loaded.shData && loaded.shCoeffsPerChannel ? { sh: { data: loaded.shData, coeffsPerChannel: loaded.shCoeffsPerChannel } } : {}),
        });
        this.setGaussianSplatLoadProgress(request, {
          phase: 'complete',
          percent: 1,
          loadedBytes: loadFile.size,
          totalBytes: loadFile.size,
          message: 'Splat scene loaded',
        });
        this.clearGaussianSplatLoadProgress(request.sceneKey, 350);
        log.info('Gaussian splat scene uploaded', {
          clipId: request.clipId ?? request.sceneKey,
          sceneKey: request.sceneKey,
          splatCount: asset.frames[0].buffer.splatCount,
        });
        this.deps.requestRender();
      }
    } catch (err) {
      log.error('Failed to load gaussian splat scene', {
        clipId: request.clipId ?? request.sceneKey,
        sceneKey: request.sceneKey,
        err,
      });
      this.setGaussianSplatLoadProgress(request, {
        phase: 'error',
        percent: 1,
        message: err instanceof Error ? err.message : 'Failed to load gaussian splat scene',
      });
      this.clearGaussianSplatLoadProgress(request.sceneKey, 1500);
    } finally {
      this.splatLoadingClips.delete(request.sceneKey);
    }
  }
}
