import { drawCodecFrame } from '../services/mediaRuntime/codec/drawCodecFrame';
interface InitRequest {
  type: 'init';
  width: number;
  height: number;
  quality: number;
}

interface EncodeRequest {
  type: 'encode';
  requestId: number;
  frameIndex: number;
  frame: VideoFrame;
  rotation?: number;
}

type WorkerRequest = InitRequest | EncodeRequest;

interface ReadyResponse {
  type: 'ready';
}

interface EncodedResponse {
  type: 'encoded';
  requestId: number;
  frameIndex: number;
  blob: Blob;
  drawMs: number;
  jpegMs: number;
  size: number;
}

interface ErrorResponse {
  type: 'error';
  requestId?: number;
  message: string;
}

type WorkerResponse = ReadyResponse | EncodedResponse | ErrorResponse;

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const workerScope = self as unknown as WorkerScope;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let jpegQuality = 0.82;

function postError(message: string, requestId?: number): void {
  workerScope.postMessage({
    type: 'error',
    requestId,
    message,
  });
}

workerScope.onmessage = async (event) => {
  const message = event.data;

  if (message.type === 'init') {
    try {
      canvas = new OffscreenCanvas(message.width, message.height);
      ctx = canvas.getContext('2d');
      jpegQuality = message.quality;
      if (!ctx) {
        throw new Error('Failed to create OffscreenCanvas 2D context');
      }
      workerScope.postMessage({ type: 'ready' });
    } catch (error) {
      postError(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  if (!canvas || !ctx) {
    postError('Proxy frame encoder worker was not initialized', message.requestId);
    try {
      message.frame.close();
    } catch {
      // Ignore close errors for transferred frames.
    }
    return;
  }

  try {
    const drawStart = performance.now();
    drawCodecFrame(ctx, message.frame, canvas.width, canvas.height, message.rotation ?? 0);
    const drawMs = performance.now() - drawStart;
    message.frame.close();

    const jpegStart = performance.now();
    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: jpegQuality,
    });
    const jpegMs = performance.now() - jpegStart;

    workerScope.postMessage({
      type: 'encoded',
      requestId: message.requestId,
      frameIndex: message.frameIndex,
      blob,
      drawMs,
      jpegMs,
      size: blob.size,
    });
  } catch (error) {
    try {
      message.frame.close();
    } catch {
      // Ignore close errors for transferred frames.
    }
    postError(error instanceof Error ? error.message : String(error), message.requestId);
  }
};

export {};
