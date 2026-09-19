// HAP encode worker: second-stage frame packaging (Snappy + section layout)
// and the full CPU BC fallback when WebGPU is unavailable. Keeps multi-MB
// per-frame compression off the main thread during export.

import { encodeTextureCpu, type HapTextureEncodeFormat } from '../services/hap/dxtEncodeCpu';
import { buildHapFrame, type HapTextureFormatNibble } from '../services/hap/hapFrame';

export interface HapEncodePackRequest {
  id: number;
  kind: 'pack';
  /** Tightly packed BC blocks (transferred). */
  texture: ArrayBuffer;
  formatNibble: HapTextureFormatNibble;
  chunkCount: number;
}

export interface HapEncodeCpuRequest {
  id: number;
  kind: 'encode-pack';
  /** RGBA8 pixels (transferred). */
  pixels: ArrayBuffer;
  width: number;
  height: number;
  format: HapTextureEncodeFormat;
  formatNibble: HapTextureFormatNibble;
  chunkCount: number;
}

export type HapEncodeWorkerRequest = HapEncodePackRequest | HapEncodeCpuRequest;

export type HapEncodeWorkerResponse =
  | { id: number; ok: true; frame: ArrayBuffer }
  | { id: number; ok: false; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HapEncodeWorkerRequest>) => void) | null;
  postMessage(message: HapEncodeWorkerResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event: MessageEvent<HapEncodeWorkerRequest>) => {
  const request = event.data;
  try {
    let texture: Uint8Array;
    if (request.kind === 'pack') {
      texture = new Uint8Array(request.texture);
    } else {
      texture = encodeTextureCpu(
        request.format,
        new Uint8Array(request.pixels),
        request.width,
        request.height,
      );
    }
    const frame = buildHapFrame({
      formatNibble: request.formatNibble,
      texture,
      chunkCount: request.chunkCount,
    });
    // buildHapFrame allocates exactly-sized output, so the buffer transfers clean.
    const frameBuffer = frame.buffer as ArrayBuffer;
    scope.postMessage({ id: request.id, ok: true, frame: frameBuffer }, [frameBuffer]);
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
