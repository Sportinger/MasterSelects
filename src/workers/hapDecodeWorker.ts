// HAP decode worker: parses HAP frame sections, Snappy-decompresses chunks,
// and unpacks BC blocks to RGBA off the main thread. One request per frame;
// the frame provider owns ordering, cancellation, and VideoFrame creation.

import { decodeTextureCpu } from '../services/hap/dxtDecodeCpu';
import { parseHapFrame } from '../services/hap/hapFrame';
import type { HapVideoFourCC } from '../services/hap/hapCodecIdentity';

export interface HapDecodeWorkerRequest {
  id: number;
  /** Encoded HAP sample (transferred). */
  packet: ArrayBuffer;
  fourCC: HapVideoFourCC;
  width: number;
  height: number;
}

export type HapDecodeWorkerResponse =
  | { id: number; ok: true; rgba: ArrayBuffer; width: number; height: number; hasAlpha: boolean }
  | { id: number; ok: false; error: string };

function decodeFrameToRgba(
  packet: Uint8Array,
  fourCC: HapVideoFourCC,
  width: number,
  height: number,
): { rgba: Uint8Array; hasAlpha: boolean } {
  const parsed = parseHapFrame(packet);
  const rgba = new Uint8Array(width * height * 4);
  let hasAlpha = false;

  for (const texture of parsed.textures) {
    if (texture.formatName === 'bc4-alpha') {
      if (parsed.textures.length === 1 && fourCC === 'hapa') {
        // Standalone alpha-only movie: visualize the matte as luminance.
        decodeTextureCpu('bc4-luma', texture.data, width, height, rgba);
      } else {
        decodeTextureCpu('bc4-alpha', texture.data, width, height, rgba);
        hasAlpha = true;
      }
      continue;
    }
    decodeTextureCpu(texture.formatName, texture.data, width, height, rgba);
    if (texture.formatName === 'bc3') hasAlpha = true;
  }
  return { rgba, hasAlpha };
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HapDecodeWorkerRequest>) => void) | null;
  postMessage(message: HapDecodeWorkerResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event: MessageEvent<HapDecodeWorkerRequest>) => {
  const request = event.data;
  try {
    const { rgba, hasAlpha } = decodeFrameToRgba(
      new Uint8Array(request.packet),
      request.fourCC,
      request.width,
      request.height,
    );
    const buffer = rgba.buffer as ArrayBuffer;
    scope.postMessage({
      id: request.id,
      ok: true,
      rgba: buffer,
      width: request.width,
      height: request.height,
      hasAlpha,
    }, [buffer]);
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
