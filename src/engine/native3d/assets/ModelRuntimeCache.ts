import { Logger } from '../../../services/logger';
import { loadModelRuntime } from './modelRuntimeCache/loadRuntime';
import type {
  ModelRuntimeBounds,
  ModelRuntimeData,
  ModelRuntimePreloadOptions,
  ModelRuntimeRequest,
} from './modelRuntimeCache/types';

export type {
  ModelRuntimeBounds,
  ModelRuntimeData,
  ModelRuntimePreloadOptions,
  ModelRuntimePrimitive,
  ModelRuntimeRequest,
  ModelRuntimeTexture,
} from './modelRuntimeCache/types';

const log = Logger.create('ModelRuntimeCache');

export class ModelRuntimeCache {
  private requests = new Map<string, ModelRuntimeRequest>();
  private runtimes = new Map<string, ModelRuntimeData>();
  private loading = new Map<string, Promise<ModelRuntimeData | null>>();
  private normalizationBounds = new Map<string, ModelRuntimeBounds>();

  touch(url: string, fileName?: string): void {
    if (!url) {
      return;
    }
    this.requests.set(url, { url, fileName });
  }

  has(url: string): boolean {
    return this.requests.has(url) || this.runtimes.has(url);
  }

  isLoaded(url: string, options: ModelRuntimePreloadOptions = {}): boolean {
    const runtime = this.runtimes.get(url);
    if (!runtime) {
      return false;
    }
    return !options.normalizationKey || runtime.normalizationKey === options.normalizationKey;
  }

  isLoading(url: string): boolean {
    return this.loading.has(url);
  }

  loadingCount(): number {
    return this.loading.size;
  }

  get(url: string): ModelRuntimeData | undefined {
    return this.runtimes.get(url);
  }

  values(): ModelRuntimeRequest[] {
    return [...this.requests.values()];
  }

  async preload(
    url: string,
    fileName?: string,
    options: ModelRuntimePreloadOptions = {},
  ): Promise<boolean> {
    if (!url) {
      return false;
    }
    this.touch(url, fileName);
    const cached = this.runtimes.get(url);
    if (cached && (!options.normalizationKey || cached.normalizationKey === options.normalizationKey)) {
      return true;
    }
    if (cached && options.normalizationKey && cached.normalizationKey !== options.normalizationKey) {
      this.runtimes.delete(url);
    }

    const pending = this.loading.get(url);
    if (pending) {
      const runtime = await pending;
      if (!runtime) {
        return false;
      }
      if (!options.normalizationKey || runtime.normalizationKey === options.normalizationKey) {
        return true;
      }
      this.runtimes.delete(url);
      return this.preload(url, fileName, options);
    }

    const loadPromise = this.resolveNormalizationBounds(url, fileName, options)
      .then((normalizationBounds) =>
        loadModelRuntime(
          url,
          fileName ?? this.requests.get(url)?.fileName ?? url,
          normalizationBounds,
          options.normalizationKey,
        ),
      )
      .then((runtime) => {
        if (runtime) {
          this.runtimes.set(url, runtime);
          if (options.normalizationKey && runtime.sourceBounds && !this.normalizationBounds.has(options.normalizationKey)) {
            this.normalizationBounds.set(options.normalizationKey, runtime.sourceBounds);
          }
        }
        return runtime;
      })
      .catch((error) => {
        log.error('Failed to preload native model runtime', {
          url,
          fileName,
          error,
        });
        return null;
      })
      .finally(() => {
        this.loading.delete(url);
      });

    this.loading.set(url, loadPromise);
    return !!(await loadPromise);
  }

  clear(): void {
    this.requests.clear();
    this.runtimes.clear();
    this.loading.clear();
    this.normalizationBounds.clear();
  }

  private async resolveNormalizationBounds(
    url: string,
    fileName: string | undefined,
    options: ModelRuntimePreloadOptions,
  ): Promise<ModelRuntimeBounds | undefined> {
    const key = options.normalizationKey;
    if (!key) {
      return undefined;
    }

    const existing = this.normalizationBounds.get(key);
    if (existing) {
      return existing;
    }

    const anchorUrl = options.anchorUrl;
    if (!anchorUrl || anchorUrl === url) {
      return undefined;
    }

    await this.preload(anchorUrl, options.anchorFileName ?? fileName, {
      normalizationKey: key,
      anchorUrl,
      anchorFileName: options.anchorFileName ?? fileName,
    });
    return this.normalizationBounds.get(key);
  }
}
