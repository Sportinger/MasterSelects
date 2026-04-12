// .splat format loader for Gaussian Splat data
//
// The .splat format is a simple binary format:
//   32 bytes per splat:
//     position: 3 x float32 = 12 bytes
//     scale:    3 x float32 = 12 bytes
//     color:    4 x uint8   =  4 bytes (RGBA)
//     rotation: 4 x uint8   =  4 bytes (quaternion, encoded)

import { Logger } from '../../../services/logger.ts';
import type {
  GaussianSplatBuffer,
  GaussianSplatAsset,
  GaussianSplatMetadata,
} from './types.ts';
import { FLOATS_PER_SPLAT, BYTES_PER_SPLAT_RAW } from './types.ts';
import { computeBoundingBox, normalizeQuaternion, buildMetadata } from './normalize.ts';

const log = Logger.create('SplatLoader');

/**
 * Parse a .splat file into a GaussianSplatAsset.
 *
 * Format per splat (32 bytes, little-endian):
 *   [0-11]  position:  3 x float32
 *   [12-23] scale:     3 x float32
 *   [24-27] color:     4 x uint8 (R, G, B, A)
 *   [28-31] rotation:  4 x uint8 (encoded quaternion)
 */
export async function loadSplat(file: File): Promise<GaussianSplatAsset> {
  const startTime = performance.now();
  log.info('Loading .splat file', { name: file.name, size: file.size });

  const arrayBuffer = await file.arrayBuffer();

  if (arrayBuffer.byteLength % BYTES_PER_SPLAT_RAW !== 0) {
    log.warn('.splat file size not evenly divisible by 32', {
      size: arrayBuffer.byteLength,
      remainder: arrayBuffer.byteLength % BYTES_PER_SPLAT_RAW,
    });
  }

  const splatCount = Math.floor(arrayBuffer.byteLength / BYTES_PER_SPLAT_RAW);
  if (splatCount === 0) {
    throw new Error('.splat file is empty or too small');
  }

  const data = new Float32Array(splatCount * FLOATS_PER_SPLAT);
  const dataView = new DataView(arrayBuffer);

  for (let i = 0; i < splatCount; i++) {
    const srcOffset = i * BYTES_PER_SPLAT_RAW;
    const outBase = i * FLOATS_PER_SPLAT;

    // Position (3 x float32, already in world space)
    data[outBase + 0] = dataView.getFloat32(srcOffset + 0, true);
    data[outBase + 1] = dataView.getFloat32(srcOffset + 4, true);
    data[outBase + 2] = dataView.getFloat32(srcOffset + 8, true);

    // Scale (3 x float32, already exp-activated in .splat format)
    data[outBase + 3] = dataView.getFloat32(srcOffset + 12, true);
    data[outBase + 4] = dataView.getFloat32(srcOffset + 16, true);
    data[outBase + 5] = dataView.getFloat32(srcOffset + 20, true);

    // Color (4 x uint8 → float [0,1])
    const r = dataView.getUint8(srcOffset + 24);
    const g = dataView.getUint8(srcOffset + 25);
    const b = dataView.getUint8(srcOffset + 26);
    const a = dataView.getUint8(srcOffset + 27);

    data[outBase + 10] = r / 255;
    data[outBase + 11] = g / 255;
    data[outBase + 12] = b / 255;
    data[outBase + 13] = a / 255;

    // Rotation (4 x uint8, encoded as [0-255] → [-1, 1])
    // .splat stores rotation as: (value - 128) / 128
    const qr0 = (dataView.getUint8(srcOffset + 28) - 128) / 128;
    const qr1 = (dataView.getUint8(srcOffset + 29) - 128) / 128;
    const qr2 = (dataView.getUint8(srcOffset + 30) - 128) / 128;
    const qr3 = (dataView.getUint8(srcOffset + 31) - 128) / 128;

    // Normalize quaternion (w, x, y, z)
    const [nw, nx, ny, nz] = normalizeQuaternion(qr0, qr1, qr2, qr3);
    data[outBase + 6] = nw;
    data[outBase + 7] = nx;
    data[outBase + 8] = ny;
    data[outBase + 9] = nz;
  }

  const boundingBox = computeBoundingBox(data, splatCount);
  const metadata = buildMetadata(
    'splat',
    splatCount,
    boundingBox,
    file.size,
    false,  // no SH in .splat format
    0,
  );

  const buffer: GaussianSplatBuffer = {
    data,
    splatCount,
    shDegree: 0,
  };

  const elapsed = performance.now() - startTime;
  log.info('.splat loaded', {
    splatCount,
    bufferMB: (data.byteLength / (1024 * 1024)).toFixed(1),
    elapsedMs: elapsed.toFixed(0),
  });

  return {
    metadata,
    frames: [{ index: 0, buffer }],
    sourceFile: file,
    sourceUrl: '',
  };
}

/**
 * Parse only the .splat header for quick metadata extraction.
 * Since .splat has no header, we just derive count from file size.
 */
export function parseSplatHeaderOnly(file: File): GaussianSplatMetadata {
  const splatCount = Math.floor(file.size / BYTES_PER_SPLAT_RAW);

  return buildMetadata(
    'splat',
    splatCount,
    { min: [0, 0, 0], max: [0, 0, 0] },
    file.size,
    false,
    0,
  );
}
