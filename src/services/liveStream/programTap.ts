import { getContainedVideoRect } from '../capture/recording/frameTransform';
import { Logger } from '../logger';
import { renderHostPort } from '../render/renderHostPort';
import { acquireMasterTapTrack } from '../audio/routing/masterTap';
import type { ProgramTapHandle, ProgramTapOptions } from './streamTypes';

const log = Logger.create('ProgramTap');

interface TickWorkerHandle {
  close(): void;
}

export interface ProgramTapDeps {
  getSourceCanvas?: () => HTMLCanvasElement | OffscreenCanvas | null;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
  createTickWorker?: (intervalMs: number, onTick: () => void) => TickWorkerHandle;
  acquireMasterAudio?: typeof acquireMasterTapTrack;
}

type RequestFrameTrack = MediaStreamTrack & { requestFrame?: () => void };

function createDefaultCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function createDefaultTickWorker(intervalMs: number, onTick: () => void): TickWorkerHandle {
  const source = `setInterval(() => self.postMessage(0), ${JSON.stringify(intervalMs)});`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = onTick;
  let closed = false;
  return {
    close: () => {
      if (closed) return;
      closed = true;
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

export function createProgramTap(
  options: ProgramTapOptions,
  deps: ProgramTapDeps = {},
): ProgramTapHandle {
  const createCanvas = deps.createCanvas ?? createDefaultCanvas;
  const canvas = createCanvas(options.width, options.height);
  canvas.width = options.width;
  canvas.height = options.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Program tap canvas 2D context is unavailable.');

  let stream = canvas.captureStream(0);
  let videoTrack = stream.getVideoTracks()[0] as RequestFrameTrack | undefined;
  let requestFrame = typeof videoTrack?.requestFrame === 'function'
    ? () => videoTrack?.requestFrame?.()
    : null;
  if (!requestFrame) {
    stream.getTracks().forEach(track => track.stop());
    stream = canvas.captureStream(options.fps);
    videoTrack = stream.getVideoTracks()[0] as RequestFrameTrack | undefined;
  }

  const acquireMasterAudio = deps.acquireMasterAudio ?? acquireMasterTapTrack;
  const masterAudio = options.includeMasterAudio ? acquireMasterAudio() : null;
  // Add a clone so close() can stop this tap's track without silencing the
  // shared master-tap track other acquirers may still be consuming.
  const masterAudioTrack = masterAudio ? masterAudio.track.clone() : null;
  if (masterAudioTrack) stream.addTrack(masterAudioTrack);

  const getSourceCanvas = deps.getSourceCanvas
    ?? (() => renderHostPort.getCaptureCanvas()?.canvas ?? null);
  let drawing = false;
  let drawFailureLogged = false;
  const draw = () => {
    if (drawing) return;
    drawing = true;
    try {
      context.fillStyle = '#000000';
      context.fillRect(0, 0, options.width, options.height);
      const sourceCanvas = getSourceCanvas();
      if (sourceCanvas && sourceCanvas.width > 0 && sourceCanvas.height > 0) {
        const rect = getContainedVideoRect(
          { width: options.width, height: options.height },
          { width: sourceCanvas.width, height: sourceCanvas.height },
        );
        context.drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height);
      }
      drawFailureLogged = false;
    } catch (error) {
      if (!drawFailureLogged) {
        drawFailureLogged = true;
        log.warn('Failed to draw a program tap frame', error);
      }
    } finally {
      requestFrame?.();
      drawing = false;
    }
  };

  const createTickWorker = deps.createTickWorker ?? createDefaultTickWorker;
  const tickWorker = createTickWorker(1000 / options.fps, draw);
  let closed = false;

  return {
    stream,
    width: options.width,
    height: options.height,
    fps: options.fps,
    hasProgramAudio: masterAudio !== null,
    close: () => {
      if (closed) return;
      closed = true;
      tickWorker.close();
      stream.getTracks().forEach(track => track.stop());
      masterAudio?.release();
      requestFrame = null;
      videoTrack = undefined;
    },
  };
}
