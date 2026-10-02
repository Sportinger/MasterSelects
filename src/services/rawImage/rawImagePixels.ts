import { zlibSync } from 'fflate';

/** Encode LibRaw's interleaved 8-bit sRGB output without a GPU/canvas dependency. */
export function encodeRawImagePng(width: number, height: number, colors: number, data: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || ![1, 3, 4].includes(colors) || width * height > 100_000_000 || data.length !== width * height * colors) {
    throw new Error('Invalid decoded RAW image dimensions or pixel buffer');
  }
  const rowBytes = width * colors;
  const scanlines = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) scanlines.set(data.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 8; header[9] = colors === 1 ? 0 : colors === 3 ? 2 : 6;
  const chunks = [pngChunk('IHDR', header), pngChunk('IDAT', zlibSync(scanlines, { level: 1 })), pngChunk('IEND', new Uint8Array())];
  const png = new Uint8Array(8 + chunks.reduce((size, chunk) => size + chunk.length, 0));
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  for (const chunk of chunks) { png.set(chunk, offset); offset += chunk.length; }
  return png;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set([...type].map(char => char.charCodeAt(0)), 4);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, chunk.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}
