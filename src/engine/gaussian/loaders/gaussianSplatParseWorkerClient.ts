import type {
  GaussianSplatAsset,
  GaussianSplatFormat,
  GaussianSplatLoadOptions,
  GaussianSplatLoadProgress,
} from './types.ts';

type ParseWorkerResponse =
  | { type: 'progress'; progress: GaussianSplatLoadProgress }
  | { type: 'complete'; asset: GaussianSplatAsset }
  | { type: 'error'; message: string };

export class GaussianSplatParseWorkerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GaussianSplatParseWorkerUnavailableError';
  }
}

export function canUseGaussianSplatParseWorker(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined';
}

export function loadGaussianSplatAssetInWorker(
  file: File,
  format?: GaussianSplatFormat,
  options?: GaussianSplatLoadOptions,
): Promise<GaussianSplatAsset> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./gaussianSplatParseWorker.ts', import.meta.url), {
        type: 'module',
        name: `gaussian-splat-parser-${file.name}`,
      });
    } catch (error) {
      reject(new GaussianSplatParseWorkerUnavailableError(
        error instanceof Error ? error.message : String(error),
      ));
      return;
    }

    const finish = () => worker.terminate();
    worker.addEventListener('message', (event: MessageEvent<ParseWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        options?.onProgress?.(message.progress);
        return;
      }

      finish();
      if (message.type === 'error') {
        reject(new Error(message.message));
        return;
      }

      resolve({ ...message.asset, sourceFile: file });
    });
    worker.addEventListener('error', (event) => {
      finish();
      reject(new GaussianSplatParseWorkerUnavailableError(
        event.message || 'Gaussian splat parse worker failed to start',
      ));
    });
    worker.postMessage({
      type: 'parse',
      file,
      format,
      maxSplats: options?.maxSplats,
    });
  });
}
