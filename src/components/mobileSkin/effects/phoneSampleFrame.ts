// The neutral sample picture effect and filter cards render on when the composition shows nothing at
// the playhead (an empty timeline, a gap). It carries what effects act on: a hue sweep, a light-to-dark
// ramp, a skin-coloured disc, pure white and black, and a fine checker in the centre (blur, sharpen
// and line effects show there; the thumbnail runtime's detail view zooms into the centre). Pure, no DOM.

import type { LookRaster } from '../../../effects/looks/lookThumbnailViews';

export const PHONE_SAMPLE_FRAME_WIDTH = 640;
export const PHONE_SAMPLE_FRAME_HEIGHT = 360;

function hueToRgb(hue: number): [number, number, number] {
  const h = (hue % 1) * 6;
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return [r, g, b];
}

/** The sample picture as straight-alpha RGBA8, 640x360 (16:9). */
export function createPhoneSampleFrame(width = PHONE_SAMPLE_FRAME_WIDTH, height = PHONE_SAMPLE_FRAME_HEIGHT): LookRaster {
  const data = new Uint8ClampedArray(width * height * 4);
  const discX = width * 0.3, discY = height * 0.5, discR = height * 0.24;
  const checker = { x0: width * 0.5, x1: width * 0.74, y0: height * 0.3, y1: height * 0.7 };
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      let rgb: [number, number, number];
      if (y < height * 0.12) {
        // Light ramp along the top: black to white.
        rgb = [u, u, u];
      } else if (y > height * 0.88) {
        // Pure white and black blocks along the bottom.
        rgb = Math.floor(u * 8) % 2 === 0 ? [1, 1, 1] : [0, 0, 0];
      } else {
        // Hue sweep, brighter at the top, darker at the bottom.
        const [r, g, b] = hueToRgb(u * 0.85);
        const light = 0.85 - 0.55 * v;
        rgb = [0.15 + r * light, 0.15 + g * light, 0.15 + b * light];
        const dx = x - discX, dy = y - discY;
        if (dx * dx + dy * dy < discR * discR) rgb = [0.86, 0.64, 0.5];
        if (x >= checker.x0 && x < checker.x1 && y >= checker.y0 && y < checker.y1) {
          const on = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
          rgb = on ? [0.92, 0.92, 0.92] : [0.08, 0.08, 0.08];
        }
      }
      const offset = (y * width + x) * 4;
      data[offset] = Math.round(Math.min(1, rgb[0]) * 255);
      data[offset + 1] = Math.round(Math.min(1, rgb[1]) * 255);
      data[offset + 2] = Math.round(Math.min(1, rgb[2]) * 255);
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}
