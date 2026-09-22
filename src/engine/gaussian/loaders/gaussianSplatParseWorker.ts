import { loadGaussianSplatAssetOnCurrentThread } from './loadAssetCurrentThread.ts';
import type {
  GaussianSplatAsset,
  GaussianSplatFormat,
  GaussianSplatLoadProgress,
} from './types.ts';

interface ParseRequest {
  type: 'parse';
  file: File;
  format?: GaussianSplatFormat;
  maxSplats?: number;
}

type ParseWorkerResponse =
  | { type: 'progress'; progress: GaussianSplatLoadProgress }
  | { type: 'complete'; asset: GaussianSplatAsset }
  | { type: 'error'; message: string };

const workerSelf = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<ParseRequest>) => void) => void;
  postMessage: (message: ParseWorkerResponse, transfer?: Transferable[]) => void;
};

workerSelf.addEventListener('message', (event) => {
  if (event.data.type !== 'parse') return;

  const { file, format, maxSplats } = event.data;
  void loadGaussianSplatAssetOnCurrentThread(file, format, {
    maxSplats,
    onProgress: (progress) => workerSelf.postMessage({ type: 'progress', progress }),
  }).then((asset) => {
    const transferableAsset: GaussianSplatAsset = {
      metadata: asset.metadata,
      frames: asset.frames,
      sourceUrl: asset.sourceUrl,
    };
    const transfers = asset.frames.flatMap((frame) => [
      frame.buffer.data.buffer,
      ...(frame.buffer.shData ? [frame.buffer.shData.buffer] : []),
    ]);
    workerSelf.postMessage({ type: 'complete', asset: transferableAsset }, transfers);
  }).catch((error) => {
    workerSelf.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
});
