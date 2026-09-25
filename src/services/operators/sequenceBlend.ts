import { SEQUENCE_BLEND_MODES } from './sequenceBlendModes';
export { SEQUENCE_BLEND_WGSL } from './sequenceBlendWgsl';

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const luma = (v: number[]) => v[0] * 0.299 + v[1] * 0.587 + v[2] * 0.114;
const burn = (b: number, s: number) => s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s);
const dodge = (b: number, s: number) => s === 1 ? 1 : Math.min(1, b / (1 - s));
function hsl(c: number[]) {
  const hi = Math.max(...c.slice(0, 3)), lo = Math.min(...c.slice(0, 3)), d = hi - lo, l = (hi + lo) / 2;
  const h = d === 0 ? 0 : hi === c[0] ? (c[1] - c[2]) / d + (c[1] < c[2] ? 6 : 0)
    : hi === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
  return [h / 6, d === 0 ? 0 : d / (l < 0.5 ? hi + lo : 2 - hi - lo), l];
}
function rgb([h, s, l]: number[]) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [h + 1 / 3, h, h - 1 / 3].map(value => {
    const t = (value + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  });
}
function random(uv: readonly number[], time: number) {
  const fract = (v: number) => v - Math.floor(v);
  const p = [uv[0], uv[1], uv[0]].map(v => fract((v * 1000 + time * 60) * 0.1031));
  const dot = p[0] * (p[1] + 33.33) + p[1] * (p[2] + 33.33) + p[2] * (p[0] + 33.33);
  return fract((p[0] + p[1] + 2 * dot) * (p[2] + dot));
}

/** Shared timeline RGB formulas, composed in straight alpha for sequence images. */
export function blendSequencePixel(back: number[], front: number[], mode: number, opacity = 1,
  uv: readonly number[] = [0, 0], time = 0): number[] {
  const name = SEQUENCE_BLEND_MODES[Math.round(mode)] ?? 'normal';
  let sa = clamp(front[3] * opacity); const ba = clamp(back[3]);
  if (name === 'dissolve' || name === 'dancing-dissolve') sa = random(uv, name === 'dancing-dissolve' ? time : 0) < sa ? 1 : 0;
  if (name.startsWith('stencil-') || name.startsWith('silhouette-')) {
    const mask = name.endsWith('luma') ? luma(front) : front[3];
    const alpha = ba * clamp((name.startsWith('silhouette-') ? 1 - mask : mask) * opacity);
    return alpha > 0 ? [...back.slice(0, 3), alpha] : [0, 0, 0, 0];
  }
  if (name === 'alpha-add') return [...back.slice(0, 3).map((b, i) => b * (1 - sa) + front[i] * sa), Math.min(1, ba + sa)];
  const alpha = sa + ba * (1 - sa);
  if (alpha === 0) return [0, 0, 0, 0];
  let blended: number[];
  if (['hue', 'saturation', 'color', 'luminosity'].includes(name)) {
    const b = hsl(back), s = hsl(front);
    blended = rgb([name === 'hue' || name === 'color' ? s[0] : b[0],
      name === 'saturation' || name === 'color' ? s[1] : b[1], name === 'luminosity' ? s[2] : b[2]]);
  } else if (name === 'darker-color' || name === 'lighter-color') {
    blended = (name === 'darker-color' ? luma(back) < luma(front) : luma(back) > luma(front)) ? back : front;
  } else blended = back.slice(0, 3).map((b, i) => {
    const s = front[i];
    switch (name) {
      case 'darken': return Math.min(b, s);
      case 'lighten': return Math.max(b, s);
      case 'multiply': return b * s;
      case 'screen': return 1 - (1 - b) * (1 - s);
      case 'color-burn': return burn(b, s);
      case 'classic-color-burn': return 1 - (1 - b) / Math.max(s, 0.001);
      case 'linear-burn': return Math.max(0, b + s - 1);
      case 'add': case 'linear-dodge': return Math.min(1, b + s);
      case 'color-dodge': return dodge(b, s);
      case 'classic-color-dodge': return b / Math.max(1 - s, 0.001);
      case 'overlay': return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
      case 'hard-light': return s < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
      case 'soft-light': return s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b)
        : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b);
      case 'linear-light': return clamp(b + 2 * s - 1);
      case 'vivid-light': return s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * (s - 0.5));
      case 'pin-light': return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * (s - 0.5));
      case 'hard-mix': return b + s >= 1 ? 1 : 0;
      case 'difference': case 'classic-difference': return Math.abs(b - s);
      case 'exclusion': return b + s - 2 * b * s;
      case 'subtract': return Math.max(0, b - s);
      case 'divide': return b / Math.max(s, 0.001);
      default: return s;
    }
  });
  return [...back.slice(0, 3).map((b, i) => clamp((sa * ((1 - ba) * front[i] + ba * blended[i]) + (1 - sa) * ba * b) / alpha)), alpha];
}
