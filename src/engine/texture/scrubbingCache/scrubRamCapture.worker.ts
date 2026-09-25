/// <reference lib="webworker" />
// CPU readback for background scrub frames. getImageData on a ~2 MB frame blocks
// for tens of milliseconds, so it runs here instead of on the editor main thread.

interface CaptureRequest { id: number; bitmap: ImageBitmap }

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = (event: MessageEvent<CaptureRequest>) => {
  const { id, bitmap } = event.data;
  try {
    const { width, height } = bitmap;
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!context) throw new Error('Canvas 2D unavailable');
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    self.postMessage({ id, width, height, buffer: pixels.data.buffer }, [pixels.data.buffer]);
  } catch {
    self.postMessage({ id, failed: true });
  } finally {
    bitmap.close();
  }
};
