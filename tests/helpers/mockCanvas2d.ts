import { vi } from 'vitest';

interface CanvasPixels {
  data: Uint8ClampedArray;
  height: number;
  width: number;
}

function pixelsFor(
  canvas: HTMLCanvasElement,
  pixelsByCanvas: WeakMap<HTMLCanvasElement, CanvasPixels>,
): CanvasPixels {
  const width = Math.max(0, canvas.width);
  const height = Math.max(0, canvas.height);
  const current = pixelsByCanvas.get(canvas);
  if (current && current.width === width && current.height === height) return current;
  const next = { data: new Uint8ClampedArray(width * height * 4), height, width };
  pixelsByCanvas.set(canvas, next);
  return next;
}

function rgba(style: string | CanvasGradient | CanvasPattern): [number, number, number, number] {
  if (typeof style !== 'string') return [0, 0, 0, 255];
  const hex = /^#([0-9a-f]{6})$/iu.exec(style);
  if (hex) {
    const value = Number.parseInt(hex[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
  }
  const shortHex = /^#([0-9a-f]{3})$/iu.exec(style);
  if (shortHex) {
    return [...shortHex[1]].map((digit) => Number.parseInt(`${digit}${digit}`, 16))
      .concat(255) as [number, number, number, number];
  }
  return [0, 0, 0, 255];
}

function imageData(width: number, height: number, data?: Uint8ClampedArray): ImageData {
  return {
    colorSpace: 'srgb',
    data: data ?? new Uint8ClampedArray(width * height * 4),
    height,
    width,
  } as ImageData;
}

export function installCanvas2DMock(): { restore: () => void } {
  const pixelsByCanvas = new WeakMap<HTMLCanvasElement, CanvasPixels>();
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');

  const implementation = function implementation(
    this: HTMLCanvasElement,
    contextId: string,
  ): RenderingContext | null {
    if (contextId !== '2d') return null;
    const existing = contexts.get(this);
    if (existing) return existing;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- context methods need the owning canvas after this function returns
    const canvas = this;
    const context = {
      canvas,
      fillStyle: '#000000',
      font: '10px sans-serif',
      globalAlpha: 1,
      clearRect(x: number, y: number, width: number, height: number) {
        const pixels = pixelsFor(canvas, pixelsByCanvas);
        for (let row = Math.max(0, Math.floor(y)); row < Math.min(pixels.height, Math.ceil(y + height)); row += 1) {
          for (let column = Math.max(0, Math.floor(x)); column < Math.min(pixels.width, Math.ceil(x + width)); column += 1) {
            pixels.data.fill(0, (row * pixels.width + column) * 4, (row * pixels.width + column + 1) * 4);
          }
        }
      },
      createImageData(width: number, height: number) {
        return imageData(width, height);
      },
      createLinearGradient() {
        return { addColorStop() {} } as CanvasGradient;
      },
      createRadialGradient() {
        return { addColorStop() {} } as CanvasGradient;
      },
      drawImage(source: CanvasImageSource, ...args: number[]) {
        if (!(source instanceof HTMLCanvasElement)) return;
        const sourcePixels = pixelsFor(source, pixelsByCanvas);
        const targetPixels = pixelsFor(canvas, pixelsByCanvas);
        const [dx, dy, dw, dh] = args.length >= 4
          ? [args[0], args[1], args[2], args[3]]
          : [args[0] ?? 0, args[1] ?? 0, source.width, source.height];
        const targetWidth = Math.max(0, Math.floor(dw));
        const targetHeight = Math.max(0, Math.floor(dh));
        for (let row = 0; row < targetHeight; row += 1) {
          for (let column = 0; column < targetWidth; column += 1) {
            const targetX = Math.floor(dx) + column;
            const targetY = Math.floor(dy) + row;
            if (targetX < 0 || targetY < 0 || targetX >= targetPixels.width || targetY >= targetPixels.height) continue;
            const sourceX = Math.min(sourcePixels.width - 1, Math.floor(column * sourcePixels.width / Math.max(1, targetWidth)));
            const sourceY = Math.min(sourcePixels.height - 1, Math.floor(row * sourcePixels.height / Math.max(1, targetHeight)));
            const sourceOffset = (sourceY * sourcePixels.width + sourceX) * 4;
            const targetOffset = (targetY * targetPixels.width + targetX) * 4;
            targetPixels.data.set(sourcePixels.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
          }
        }
      },
      fillRect(x: number, y: number, width: number, height: number) {
        const pixels = pixelsFor(canvas, pixelsByCanvas);
        const color = rgba(context.fillStyle);
        for (let row = Math.max(0, Math.floor(y)); row < Math.min(pixels.height, Math.ceil(y + height)); row += 1) {
          for (let column = Math.max(0, Math.floor(x)); column < Math.min(pixels.width, Math.ceil(x + width)); column += 1) {
            pixels.data.set(color, (row * pixels.width + column) * 4);
          }
        }
      },
      getImageData(x: number, y: number, width: number, height: number) {
        const pixels = pixelsFor(canvas, pixelsByCanvas);
        const result = new Uint8ClampedArray(width * height * 4);
        for (let row = 0; row < height; row += 1) {
          for (let column = 0; column < width; column += 1) {
            const sourceX = x + column;
            const sourceY = y + row;
            if (sourceX < 0 || sourceY < 0 || sourceX >= pixels.width || sourceY >= pixels.height) continue;
            const sourceOffset = (sourceY * pixels.width + sourceX) * 4;
            result.set(pixels.data.subarray(sourceOffset, sourceOffset + 4), (row * width + column) * 4);
          }
        }
        return imageData(width, height, result);
      },
      measureText(text: string) {
        const width = text.length * 10;
        return { actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, width } as TextMetrics;
      },
      putImageData(value: ImageData, x: number, y: number) {
        const pixels = pixelsFor(canvas, pixelsByCanvas);
        for (let row = 0; row < value.height; row += 1) {
          for (let column = 0; column < value.width; column += 1) {
            const targetX = x + column;
            const targetY = y + row;
            if (targetX < 0 || targetY < 0 || targetX >= pixels.width || targetY >= pixels.height) continue;
            const sourceOffset = (row * value.width + column) * 4;
            pixels.data.set(value.data.subarray(sourceOffset, sourceOffset + 4), (targetY * pixels.width + targetX) * 4);
          }
        }
      },
      restore() {},
      rotate() {},
      save() {},
      scale() {},
      setTransform() {},
      translate() {},
    } as unknown as CanvasRenderingContext2D;
    contexts.set(canvas, context);
    return context;
  };

  getContext.mockImplementation(implementation as typeof HTMLCanvasElement.prototype.getContext);
  return { restore: () => getContext.mockRestore() };
}
