import type { Effect } from '../../types/effects';
import { lensCorrection } from '../../effects/distort/lens-correction';
import { isFullscreenEffectDefinition } from '../../effects/types';

/** Main-thread software fallback for guide photos on Mesa and unavailable GPU canvases. */
export async function renderSoftwareGuidePhoto(bitmap: ImageBitmap, effects: Effect[]): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context || !isFullscreenEffectDefinition(lensCorrection)) throw new Error('Guide photo renderer unavailable.');
  context.drawImage(bitmap, 0, 0);
  const width = bitmap.width, height = bitmap.height;
  const linear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  const srgb = (v: number) => v <= .0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - .055;
  try {
    for (const effect of effects) {
      const p = lensCorrection.packUniforms({ ...effect.params as Record<string, number | boolean | string>, sourceAspect: width / height }, width, height)!;
      const source = context.getImageData(0, 0, width, height).data;
      const output = context.createImageData(width, height);
      const inside = (u: number, v: number) => u >= 0 && u <= 1 && v >= 0 && v <= 1;
      const sample = (u: number, v: number, channel: number) => {
        const x = Math.max(0, Math.min(width - 1, u * width - .5)), y = Math.max(0, Math.min(height - 1, v * height - .5));
        const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
        const a = x - x0, b = y - y0;
        return ((source[(y0 * width + x0) * 4 + channel] * (1 - a) + source[(y0 * width + x1) * 4 + channel] * a) * (1 - b)
          + (source[(y1 * width + x0) * 4 + channel] * (1 - a) + source[(y1 * width + x1) * 4 + channel] * a) * b) / 255;
      };
      const radiusScale = 2 / Math.hypot(p[3], 1);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = ((x + .5) / width - p[4]) * p[3] * radiusScale / p[2];
          const dy = ((y + .5) / height - p[5]) * radiusScale / p[2];
          const r2 = dx * dx + dy * dy, r = Math.sqrt(r2), profileR = r * 1.80277564 / p[10];
          const measured = 1 + p[15] * (p[12] * profileR ** 3 + p[13] * profileR ** 2 + p[14] * profileR);
          const radial = Math.max(.05, measured * (1 + p[0] * r2 + p[1] * r2 * r2));
          const sx = dx * radial / (p[3] * radiusScale), sy = dy * radial / radiusScale;
          const u = p[4] + sx, v = p[5] + sy;
          if (!inside(u, v)) continue;
          const tcaR2 = profileR * profileR * radial * radial;
          const redScale = (p[17] + p[16] * tcaR2) * (1 + p[6]), blueScale = (p[19] + p[18] * tcaR2) * (1 + p[7]);
          const redU = p[4] + sx * redScale, redV = p[5] + sy * redScale;
          const blueU = p[4] + sx * blueScale, blueV = p[5] + sy * blueScale;
          const start = p[9] * .95, t = Math.max(0, Math.min(1, (r - start) / (1 - start)));
          const gain = 2 ** (2 * p[8] * t * t * (3 - 2 * t));
          const vr2 = r2 * radial * radial / (p[10] * p[10]);
          const attenuation = Math.max(.05, 1 + p[20] * vr2 + p[21] * vr2 ** 2 + p[22] * vr2 ** 3);
          const rgb = [inside(redU, redV) ? sample(redU, redV, 0) : 0, sample(u, v, 1), inside(blueU, blueV) ? sample(blueU, blueV, 2) : 0];
          const offset = (y * width + x) * 4;
          rgb.forEach((color, channel) => { output.data[offset + channel] = Math.round((p[23] > .5 ? srgb(linear(color) / attenuation) : color) * gain * 255); });
          output.data[offset + 3] = Math.round(sample(u, v, 3) * 255);
        }
        if (y % 32 === 31) await new Promise(resolve => setTimeout(resolve, 0));
      }
      context.putImageData(output, 0, 0);
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Guide photo encoding failed.')), 'image/png'));
  } finally { canvas.width = canvas.height = 0; }
}
