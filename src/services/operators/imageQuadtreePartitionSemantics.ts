import { roundImageSegmentScale } from './imageSegmentSortSemantics';

export type QuadtreePixel = readonly [number, number];
export type QuadtreeColor = readonly [number, number, number, number];
export interface ImageQuadtreePartitionResult { readonly origin: QuadtreePixel; readonly size: number }

const f = Math.fround;
const INT32_MAX = 2_147_483_647;
const add = (a: number, b: number) => f(f(a) + f(b));
const subtract = (a: number, b: number) => f(f(a) - f(b));
const multiply = (a: number, b: number) => f(f(a) * f(b));

/** Pure CPU reference for the legacy six-level Quadtree Zoom partition.
 * Keep the five loads and variance arithmetic in source order: this is the
 * parity oracle for the future scoped Image IR lowering, not a faster solver. */
export function partitionImageQuadtree(options: {
  pixel: QuadtreePixel;
  resolution: QuadtreePixel;
  scale: number;
  threshold: number;
  timelineTimeSeconds: number;
  speed: number;
  loadPixel: (pixel: QuadtreePixel) => QuadtreeColor;
}): ImageQuadtreePartitionResult {
  const [width, height] = options.resolution, [pixelX, pixelY] = options.pixel;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width > INT32_MAX || height > INT32_MAX) {
    throw new Error('Quadtree resolution must contain positive integers.');
  }
  if (!Number.isSafeInteger(pixelX) || !Number.isSafeInteger(pixelY)
    || pixelX < 0 || pixelY < 0 || pixelX >= width || pixelY >= height) {
    throw new Error('Quadtree pixel must be an in-bounds integer coordinate.');
  }
  for (const [name, value] of [['scale', options.scale], ['threshold', options.threshold],
    ['timeline time', options.timelineTimeSeconds], ['speed', options.speed]] as const) {
    if (!Number.isFinite(value) || !Number.isFinite(f(value))) throw new Error(`Quadtree ${name} must be finite f32.`);
  }
  if (typeof options.loadPixel !== 'function') throw new Error('Quadtree requires a pixel loader.');

  const minimumSize = Math.max(2, roundImageSegmentScale(options.scale));
  if (minimumSize > Math.floor(INT32_MAX / 32)) throw new Error('Quadtree scale exceeds the i32 block-size range.');
  const phase = add(multiply(options.timelineTimeSeconds, options.speed), 0);
  if (!Number.isFinite(phase)) throw new Error('Quadtree time and speed overflow f32.');
  const pulse = add(.82, multiply(.18, f(Math.sin(multiply(phase, 2)))));
  const limit = multiply(options.threshold, pulse);
  if (!Number.isFinite(limit)) throw new Error('Quadtree threshold pulse overflows f32.');
  let blockSize = minimumSize * 32;
  const loadTone = (x: number, y: number) => {
    const color = options.loadPixel([Math.max(0, Math.min(width - 1, x)), Math.max(0, Math.min(height - 1, y))]);
    if (!Array.isArray(color) || color.length !== 4 || color.some(value => !Number.isFinite(value))) {
      throw new Error('Quadtree pixel loader must return four finite channels.');
    }
    // Ordered f32 products/additions are deterministic reference semantics;
    // GPU dot-product contraction may still differ in the last bit.
    return add(add(multiply(color[0], .2126), multiply(color[1], .7152)), multiply(color[2], .0722));
  };
  const variance = (originX: number, originY: number, size: number) => {
    const half = Math.max(1, Math.trunc(size / 2));
    const a = loadTone(originX, originY);
    const b = loadTone(originX + size - 1, originY);
    const c = loadTone(originX, originY + size - 1);
    const d = loadTone(originX + size - 1, originY + size - 1);
    const e = loadTone(originX + half, originY + half);
    const mean = f(add(add(add(add(a, b), c), d), e) / f(5));
    const square = (value: number) => multiply(subtract(value, mean), subtract(value, mean));
    return f(add(add(add(add(square(a), square(b)), square(c)), square(d)), square(e)) / f(5));
  };
  for (let level = 0; level < 6; level++) {
    const originX = Math.trunc(pixelX / blockSize) * blockSize;
    const originY = Math.trunc(pixelY / blockSize) * blockSize;
    if (blockSize <= minimumSize || variance(originX, originY, blockSize) <= limit) break;
    blockSize = Math.max(minimumSize, Math.trunc(blockSize / 2));
  }
  return { origin: [Math.trunc(pixelX / blockSize) * blockSize, Math.trunc(pixelY / blockSize) * blockSize], size: blockSize };
}
