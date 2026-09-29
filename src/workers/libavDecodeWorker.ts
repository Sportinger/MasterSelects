// libavcodec (LGPL WASM) decode worker for intra MXF essence (DNxHD/DNxHR,
// MPEG-2 Intra/IMX). One decoder per worker; the frame provider owns ordering
// and cancellation. Frames are built here and transferred as VideoFrames.

export type LibavWorkerCodec = 'dnxhd' | 'mpeg2video';

export type LibavDecodeWorkerRequest =
  | {
      type: 'open';
      codec: LibavWorkerCodec;
      /** Emit 8-bit I420/I422 even for 10-bit essence (Canvas2D consumers). */
      eightBit: boolean;
      visibleRect: { x: number; y: number; width: number; height: number } | null;
      colorMatrix: 'bt709' | 'smpte170m';
    }
  | { type: 'decode'; id: number; packet: ArrayBuffer; timestampUs: number; durationUs: number }
  | { type: 'close' };

export type LibavDecodeWorkerResponse =
  | { type: 'opened' }
  | { type: 'frame'; id: number; frame: VideoFrame; interlaced: boolean; topFieldFirst: boolean }
  | { type: 'error'; id: number | null; error: string };

interface LibavModule {
  HEAPU8: Uint8Array;
  _dec_open(name: number, extra: number, extraSize: number, threads: number): number;
  _dec_send(dec: number, data: number, size: number, pts: number): number;
  _dec_receive(dec: number): number;
  _dec_flush(dec: number): void;
  _dec_close(dec: number): void;
  _dec_width(dec: number): number;
  _dec_height(dec: number): number;
  _dec_pix_fmt(dec: number): number;
  _dec_interlaced(dec: number): number;
  _dec_tff(dec: number): number;
  _dec_plane(dec: number, index: number): number;
  _dec_stride(dec: number, index: number): number;
  _dec_pix_fmt_yuv422p10(): number;
  _dec_pix_fmt_yuv422p(): number;
  _dec_pix_fmt_yuv420p10(): number;
  _dec_pix_fmt_yuv420p(): number;
  _dec_malloc(size: number): number;
  _dec_free(ptr: number): void;
}

/** DOM typings lag behind Chromium's high-bit-depth formats (I422P10 etc.). */
type PixelFormatName = 'I420' | 'I422' | 'I420P10' | 'I422P10';

interface PixelLayout {
  format: PixelFormatName;
  bytesPerSample: 1 | 2;
  chromaHeightDivisor: 1 | 2;
  sourceBytesPerSample: 1 | 2;
}

let module: LibavModule | null = null;
let decoder = 0;
let options: Extract<LibavDecodeWorkerRequest, { type: 'open' }> | null = null;
let layouts = new Map<number, PixelLayout>();

async function loadModule(): Promise<LibavModule> {
  if (module) return module;
  // Served from /public so the LGPL binary stays a separate, replaceable file.
  const url = new URL('/wasm/libavcodec/libavcodec.js', self.location.origin).href;
  const factory = (await import(/* @vite-ignore */ url)).default as () => Promise<LibavModule>;
  module = await factory();
  layouts = new Map<number, PixelLayout>([
    [module._dec_pix_fmt_yuv422p(), { format: 'I422', bytesPerSample: 1, chromaHeightDivisor: 1, sourceBytesPerSample: 1 }],
    [module._dec_pix_fmt_yuv420p(), { format: 'I420', bytesPerSample: 1, chromaHeightDivisor: 2, sourceBytesPerSample: 1 }],
    [module._dec_pix_fmt_yuv422p10(), { format: 'I422P10', bytesPerSample: 2, chromaHeightDivisor: 1, sourceBytesPerSample: 2 }],
    [module._dec_pix_fmt_yuv420p10(), { format: 'I420P10', bytesPerSample: 2, chromaHeightDivisor: 2, sourceBytesPerSample: 2 }],
  ]);
  return module;
}

function openDecoder(m: LibavModule, codec: LibavWorkerCodec): number {
  const name = new TextEncoder().encode(`${codec}\0`);
  const namePtr = m._dec_malloc(name.length);
  m.HEAPU8.set(name, namePtr);
  const handle = m._dec_open(namePtr, 0, 0, 1);
  m._dec_free(namePtr);
  if (!handle) throw new Error(`libavcodec could not open ${codec}`);
  return handle;
}

function buildFrame(m: LibavModule, timestampUs: number, durationUs: number): VideoFrame {
  const width = m._dec_width(decoder);
  const height = m._dec_height(decoder);
  const source = layouts.get(m._dec_pix_fmt(decoder));
  if (!source) throw new Error(`Unsupported libavcodec pixel format ${m._dec_pix_fmt(decoder)}`);
  const toEightBit = options!.eightBit && source.sourceBytesPerSample === 2;
  const bytesPerSample = toEightBit ? 1 : source.bytesPerSample;
  const format: PixelFormatName = toEightBit
    ? (source.chromaHeightDivisor === 2 ? 'I420' : 'I422')
    : source.format;
  const chromaWidth = Math.ceil(width / 2);
  const chromaHeight = Math.ceil(height / source.chromaHeightDivisor);
  const planeSizes = [
    { w: width, h: height },
    { w: chromaWidth, h: chromaHeight },
    { w: chromaWidth, h: chromaHeight },
  ];
  const total = planeSizes.reduce((sum, p) => sum + p.w * p.h * bytesPerSample, 0);
  const out = new Uint8Array(total);
  const layout: PlaneLayout[] = [];
  let offset = 0;
  const heap = m.HEAPU8;
  for (let plane = 0; plane < 3; plane += 1) {
    const { w, h } = planeSizes[plane]!;
    const srcPtr = m._dec_plane(decoder, plane);
    const srcStride = m._dec_stride(decoder, plane);
    const rowBytes = w * bytesPerSample;
    layout.push({ offset, stride: rowBytes });
    for (let y = 0; y < h; y += 1) {
      const row = srcPtr + y * srcStride;
      if (toEightBit) {
        for (let x = 0; x < w; x += 1) {
          const v = heap[row + x * 2]! | (heap[row + x * 2 + 1]! << 8);
          out[offset + x] = v >> 2;
        }
      } else {
        out.set(heap.subarray(row, row + rowBytes), offset);
      }
      offset += rowBytes;
    }
  }
  const visible = options!.visibleRect;
  return new VideoFrame(out, {
    format: format as VideoPixelFormat,
    codedWidth: width,
    codedHeight: height,
    ...(visible && visible.y + visible.height <= height && visible.x + visible.width <= width
      ? { visibleRect: visible }
      : {}),
    layout,
    timestamp: timestampUs,
    ...(durationUs > 0 ? { duration: durationUs } : {}),
    colorSpace: {
      primaries: options!.colorMatrix === 'bt709' ? 'bt709' : 'smpte170m',
      transfer: options!.colorMatrix === 'bt709' ? 'bt709' : 'smpte170m',
      matrix: options!.colorMatrix,
      fullRange: false,
    },
  });
}

const EAGAIN = -6;

function decodePacket(m: LibavModule, packet: Uint8Array, timestampUs: number, durationUs: number) {
  const ptr = m._dec_malloc(packet.length);
  m.HEAPU8.set(packet, ptr);
  const sent = m._dec_send(decoder, ptr, packet.length, 0);
  m._dec_free(ptr);
  if (sent < 0) throw new Error(`libavcodec rejected the packet (${sent})`);
  let status = m._dec_receive(decoder);
  if (status === EAGAIN) {
    // Intra essence: drain the one-frame delay, then reset for the next independent packet.
    m._dec_send(decoder, 0, 0, 0);
    status = m._dec_receive(decoder);
    m._dec_flush(decoder);
  }
  if (status !== 0) throw new Error(`libavcodec produced no frame (${status})`);
  return {
    frame: buildFrame(m, timestampUs, durationUs),
    interlaced: m._dec_interlaced(decoder) === 1,
    topFieldFirst: m._dec_tff(decoder) === 1,
  };
}

function post(message: LibavDecodeWorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

self.onmessage = async (event: MessageEvent<LibavDecodeWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'open') {
      const m = await loadModule();
      if (decoder) m._dec_close(decoder);
      options = request;
      decoder = openDecoder(m, request.codec);
      post({ type: 'opened' });
    } else if (request.type === 'decode') {
      if (!module || !decoder) throw new Error('libavcodec decoder is not open');
      const result = decodePacket(module, new Uint8Array(request.packet), request.timestampUs, request.durationUs);
      post({ type: 'frame', id: request.id, ...result }, [result.frame as unknown as Transferable]);
    } else if (request.type === 'close') {
      if (module && decoder) module._dec_close(decoder);
      decoder = 0;
      self.close();
    }
  } catch (error) {
    post({
      type: 'error',
      id: request.type === 'decode' ? request.id : null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
