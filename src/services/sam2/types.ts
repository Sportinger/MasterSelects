// SAM 2 (Segment Anything Model 2) types

/** A point prompt: foreground (1) or background (0) */
export interface SAM2Point {
  x: number; // normalized 0-1
  y: number; // normalized 0-1
  label: 0 | 1; // 0 = background, 1 = foreground
}

/** A bounding box prompt */
export interface SAM2Box {
  x1: number; // normalized 0-1
  y1: number;
  x2: number;
  y2: number;
}

/** Combined prompt for a single decode pass */
export interface SAM2Prompt {
  points: SAM2Point[];
  boxes: SAM2Box[];
}

/** A mask result for a single frame */
export interface SAM2FrameMask {
  frameIndex: number;
  maskData: Uint8Array; // 1 byte per pixel (0 or 255)
  width: number;
  height: number;
}

/** Model lifecycle status */
export type ModelStatus =
  | 'not-downloaded'
  | 'downloading'
  | 'downloaded'
  | 'loading'
  | 'ready'
  | 'error';

/** Messages from main thread → worker */
export type SAM2WorkerRequest =
  | { type: 'load-model'; encoderBuffer: ArrayBuffer; decoderBuffer: ArrayBuffer }
  | { type: 'encode-frame'; imageData: ImageData; frameIndex: number }
  | { type: 'decode-prompt'; points: SAM2Point[]; boxes: SAM2Box[]; imageWidth: number; imageHeight: number }
  | { type: 'propagate-frame'; imageData: ImageData; frameIndex: number }
  | { type: 'reset-memory' };

/** Messages from worker → main thread */
export type SAM2WorkerResponse =
  | { type: 'model-ready' }
  | { type: 'embedding-ready'; frameIndex: number }
  | { type: 'mask-result'; maskData: Uint8Array; width: number; height: number; scores: number[] }
  | { type: 'propagation-mask'; frameIndex: number; maskData: Uint8Array; width: number; height: number }
  | { type: 'error'; error: string }
  | { type: 'progress'; stage: string; progress: number };

/** Model file info for download */
export interface SAM2ModelFile {
  name: string;
  url: string;
  fallbackUrl: string;
  sizeBytes: number;
}

/** RLE-compressed mask for efficient storage */
export interface RLEMask {
  counts: Uint32Array; // run-length counts
  width: number;
  height: number;
}
