import type { CanvasPlacement } from './canvasPlacement';

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not prepare reference photo.')); reader.readAsDataURL(blob);
  });
}
function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Reference encoding failed.')), 'image/png'));
}

/** Full composition reference plus an explicit white=missing mask. Magenta makes holes unambiguous to image-edit models. */
export async function edgeFillReference(blob: Blob, matrix: CanvasPlacement, aspect: number): Promise<string[]> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas'), mask = document.createElement('canvas');
  const height = Math.round(aspect >= 1 ? 1600 / aspect : 1600), width = Math.round(height * aspect);
  canvas.width = mask.width = width; canvas.height = mask.height = height;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true }), maskContext = mask.getContext('2d');
    if (!context || !maskContext) throw new Error('Reference canvas unavailable.');
    const [a, b, c, d, e, f] = matrix, det = a * e - b * d;
    if (Math.abs(det) < 1e-9) throw new Error('Photo placement is unstable.');
    // Invert composition-to-source UVs into Canvas2D's source-pixel-to-output-pixel matrix.
    context.setTransform(width * e / det / bitmap.width, -height * d / det / bitmap.width,
      -width * b / det / bitmap.height, height * a / det / bitmap.height,
      width * (b * f - e * c) / det, height * (d * c - a * f) / det);
    context.drawImage(bitmap, 0, 0); context.resetTransform();
    const image = context.getImageData(0, 0, width, height), maskImage = context.createImageData(width, height);
    let holes = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      const missing = image.data[i + 3] < 250;
      const value = missing ? 255 : 0;
      maskImage.data[i] = maskImage.data[i + 1] = maskImage.data[i + 2] = value; maskImage.data[i + 3] = 255;
      if (missing) { holes++; image.data[i] = 255; image.data[i + 1] = 0; image.data[i + 2] = 255; image.data[i + 3] = 255; }
    }
    if (!holes) throw new Error('No transparent borders to fill. Apply a perspective correction or reduce the photo scale first.');
    context.putImageData(image, 0, 0); maskContext.putImageData(maskImage, 0, 0);
    return Promise.all([dataUrl(await encode(canvas)), dataUrl(await encode(mask))]);
  } finally { bitmap.close(); canvas.width = canvas.height = mask.width = mask.height = 0; }
}
