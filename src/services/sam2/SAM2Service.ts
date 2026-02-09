// SAM 2 Service — orchestrates model management, worker, and store updates
//
// This is the main entry point for SAM2 functionality.
// Uses a Web Worker for inference to keep the main thread responsive.

import { Logger } from '../logger';
import { getSAM2ModelManager } from './SAM2ModelManager';
import { useSAM2Store, compressMaskToRLE } from '../../stores/sam2Store';
import type { SAM2WorkerResponse, SAM2Point, SAM2Box } from './types';

const log = Logger.create('SAM2Service');

export class SAM2Service {
  private worker: Worker | null = null;
  private modelManager = getSAM2ModelManager();
  private pendingCallbacks: Map<string, (data: any) => void> = new Map();

  /** Download models to OPFS (with progress updates to store) */
  async downloadModel(): Promise<void> {
    const store = useSAM2Store.getState();
    if (store.modelStatus === 'downloading' || store.modelStatus === 'ready') return;

    store.setModelStatus('downloading');
    store.setDownloadProgress(0);

    try {
      await this.modelManager.downloadModels((progress) => {
        useSAM2Store.getState().setDownloadProgress(progress);
      });
      useSAM2Store.getState().setModelStatus('downloaded');
      log.info('Model download complete');

      // Auto-load after download
      await this.loadModel();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Model download failed', e);
      useSAM2Store.getState().setErrorMessage(msg);
      useSAM2Store.getState().setModelStatus('error');
    }
  }

  /** Load models from OPFS cache into ONNX sessions (in worker) */
  async loadModel(): Promise<void> {
    const store = useSAM2Store.getState();
    if (store.modelStatus === 'ready' || store.modelStatus === 'loading') return;

    store.setModelStatus('loading');

    try {
      // Check cache first
      const cached = await this.modelManager.isModelCached();
      if (!cached) {
        log.info('Models not cached, triggering download');
        store.setModelStatus('not-downloaded');
        return;
      }

      // Load buffers from OPFS
      const { encoderBuffer, decoderBuffer } = await this.modelManager.loadModelBuffers();

      // Create worker and load model
      await this.ensureWorker();
      await this.sendAndWait('model-ready', {
        type: 'load-model',
        encoderBuffer,
        decoderBuffer,
      }, [encoderBuffer, decoderBuffer]);

      useSAM2Store.getState().setModelStatus('ready');
      log.info('SAM2 model loaded and ready');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('Model load failed', e);
      useSAM2Store.getState().setErrorMessage(msg);
      useSAM2Store.getState().setModelStatus('error');
    }
  }

  /** Check if model is cached and try to auto-load */
  async checkAndAutoLoad(): Promise<void> {
    try {
      const cached = await this.modelManager.isModelCached();
      if (cached) {
        useSAM2Store.getState().setModelStatus('downloaded');
        await this.loadModel();
      } else {
        useSAM2Store.getState().setModelStatus('not-downloaded');
      }
    } catch {
      useSAM2Store.getState().setModelStatus('not-downloaded');
    }
  }

  /** Encode the current frame — must be called before decodePrompt */
  async encodeFrame(imageData: ImageData, frameIndex: number): Promise<void> {
    await this.ensureReady();
    useSAM2Store.getState().setProcessing(true);

    try {
      await this.sendAndWait('embedding-ready', {
        type: 'encode-frame',
        imageData,
        frameIndex,
      });
    } finally {
      useSAM2Store.getState().setProcessing(false);
    }
  }

  /** Decode prompts against the current embedding → returns mask */
  async decodePrompt(
    points: SAM2Point[],
    boxes: SAM2Box[],
    imageWidth: number,
    imageHeight: number
  ): Promise<void> {
    await this.ensureReady();

    try {
      const result = await this.sendAndWait<{
        maskData: Uint8Array;
        width: number;
        height: number;
        scores: number[];
      }>('mask-result', {
        type: 'decode-prompt',
        points,
        boxes,
        imageWidth,
        imageHeight,
      });

      // Update live mask for preview overlay
      useSAM2Store.getState().setLiveMask({
        frameIndex: -1, // live mask, not frame-specific
        maskData: result.maskData,
        width: result.width,
        height: result.height,
      });
    } catch (e) {
      log.error('Decode failed', e);
    }
  }

  /** Run auto-detect — encode frame, then decode with center point */
  async autoDetect(imageData: ImageData, frameIndex: number): Promise<void> {
    const store = useSAM2Store.getState();
    store.setProcessing(true);
    store.clearPoints();

    try {
      await this.encodeFrame(imageData, frameIndex);

      // Auto-detect: use center point as foreground
      const centerPoint: SAM2Point = { x: 0.5, y: 0.5, label: 1 };
      store.addPoint(centerPoint);

      await this.decodePrompt(
        [centerPoint],
        [],
        imageData.width,
        imageData.height
      );
    } finally {
      useSAM2Store.getState().setProcessing(false);
    }
  }

  /** Propagate mask across a range of frames */
  async propagateToRange(
    captureFrame: (frameIndex: number) => Promise<ImageData | null>,
    startFrame: number,
    endFrame: number,
  ): Promise<void> {
    const store = useSAM2Store.getState();
    if (store.isPropagating) return;

    store.setIsPropagating(true);
    store.setPropagationProgress(0);
    store.setPropagationRange({ start: startFrame, end: endFrame });

    try {
      await this.ensureReady();

      // Reset memory for fresh propagation
      this.worker!.postMessage({ type: 'reset-memory' });

      const totalFrames = Math.abs(endFrame - startFrame);
      const direction = endFrame > startFrame ? 1 : -1;

      // First, encode the keyframe (current frame should already be encoded)
      // Then store current mask as the first propagation mask
      const liveMask = store.liveMask;
      if (liveMask) {
        const rle = compressMaskToRLE(liveMask.maskData, liveMask.width, liveMask.height);
        useSAM2Store.getState().setFrameMask(startFrame, rle);
      }

      // Propagate frame by frame
      for (let i = 1; i <= totalFrames; i++) {
        if (!useSAM2Store.getState().isPropagating) break; // cancelled

        const frameIdx = startFrame + i * direction;
        const imageData = await captureFrame(frameIdx);

        if (!imageData) {
          log.warn(`Failed to capture frame ${frameIdx}, stopping propagation`);
          break;
        }

        const result = await this.sendAndWait<{
          frameIndex: number;
          maskData: Uint8Array;
          width: number;
          height: number;
        }>('propagation-mask', {
          type: 'propagate-frame',
          imageData,
          frameIndex: frameIdx,
        });

        // Store compressed mask
        const rle = compressMaskToRLE(result.maskData, result.width, result.height);
        useSAM2Store.getState().setFrameMask(frameIdx, rle);

        // Update progress
        const progress = (i / totalFrames) * 100;
        useSAM2Store.getState().setPropagationProgress(progress);
      }

      log.info(`Propagation complete: ${totalFrames} frames`);
    } catch (e) {
      log.error('Propagation failed', e);
    } finally {
      useSAM2Store.getState().setIsPropagating(false);
      useSAM2Store.getState().setPropagationProgress(100);
    }
  }

  /** Stop ongoing propagation */
  stopPropagation(): void {
    useSAM2Store.getState().setIsPropagating(false);
  }

  /** Clear all state and dispose worker */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pendingCallbacks.clear();
    useSAM2Store.getState().reset();
  }

  // --- Private helpers ---

  private async ensureReady(): Promise<void> {
    const status = useSAM2Store.getState().modelStatus;
    if (status !== 'ready') {
      throw new Error(`SAM2 model not ready (status: ${status})`);
    }
    await this.ensureWorker();
  }

  private async ensureWorker(): Promise<void> {
    if (this.worker) return;

    this.worker = new Worker(
      new URL('./sam2Worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (event: MessageEvent<SAM2WorkerResponse>) => {
      const msg = event.data;

      // Check for pending callbacks
      const callback = this.pendingCallbacks.get(msg.type);
      if (callback) {
        this.pendingCallbacks.delete(msg.type);
        callback(msg);
        return;
      }

      // Handle progress updates
      if (msg.type === 'progress') {
        log.debug(`[Worker] ${msg.stage}: ${msg.progress}%`);
        return;
      }

      // Handle errors
      if (msg.type === 'error') {
        log.error(`[Worker] ${msg.error}`);
        useSAM2Store.getState().setErrorMessage(msg.error);
        // Reject any pending callbacks
        for (const [, cb] of this.pendingCallbacks) {
          cb({ type: 'error', error: msg.error });
        }
        this.pendingCallbacks.clear();
        return;
      }
    };

    this.worker.onerror = (err) => {
      log.error('Worker error', err);
      useSAM2Store.getState().setErrorMessage(err.message || 'Worker error');
    };
  }

  /** Send a message to the worker and wait for a specific response type */
  private sendAndWait<T = any>(
    responseType: string,
    message: any,
    transfer?: Transferable[]
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCallbacks.delete(responseType);
        reject(new Error(`Timeout waiting for ${responseType}`));
      }, 60_000); // 60s timeout

      this.pendingCallbacks.set(responseType, (data: any) => {
        clearTimeout(timeout);
        if (data.type === 'error') {
          reject(new Error(data.error));
        } else {
          resolve(data as T);
        }
      });

      this.worker!.postMessage(message, { transfer: transfer ?? [] });
    });
  }
}

// --- HMR-safe singleton ---

let instance: SAM2Service | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.sam2Service) {
    instance = import.meta.hot.data.sam2Service;
  }
  import.meta.hot.dispose((data) => {
    data.sam2Service = instance;
  });
}

export function getSAM2Service(): SAM2Service {
  if (!instance) {
    instance = new SAM2Service();
  }
  return instance;
}
