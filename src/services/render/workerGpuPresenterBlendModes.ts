import { Logger } from '../logger';

const log = Logger.create('WorkerGpuPresenterBlend');

/** Shader index of Porter-Duff plus (premultiplied colour and alpha are added). */
export const WORKER_PRESENTER_PLUS_BLEND_INDEX = 15;

/** Blend modes the Worker VideoFrame presenter shaders implement, by shader index. */
const BLEND_MODE_TO_GPU_INDEX: Readonly<Record<string, number>> = {
  normal: 0,
  dissolve: 0,
  'dancing-dissolve': 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  'darker-color': 4,
  lighten: 5,
  'lighter-color': 5,
  add: 6,
  'linear-dodge': 6,
  subtract: 7,
  'linear-burn': 7,
  difference: 8,
  'classic-difference': 8,
  exclusion: 9,
  'color-dodge': 10,
  'classic-color-dodge': 10,
  'color-burn': 11,
  'classic-color-burn': 11,
  'hard-light': 12,
  'soft-light': 13,
  divide: 14,
  plus: WORKER_PRESENTER_PLUS_BLEND_INDEX,
};

const reportedBlendModes = new Set<string>();

/** Maps a blend mode to the presenter shader; an unsupported mode is drawn Normal and logged once. */
export function resolveWorkerPresenterBlendIndex(blendMode: string): number {
  const index = BLEND_MODE_TO_GPU_INDEX[blendMode];
  if (index !== undefined) return index;
  if (!reportedBlendModes.has(blendMode)) {
    reportedBlendModes.add(blendMode);
    log.warn('The Worker video presenter does not implement this blend mode; the layer is drawn in Normal mode', {
      blendMode,
    });
  }
  return 0;
}

/** WGSL for the plus branch; `alpha` is the layer alpha × opacity, `frameColor` straight colour. */
export const WORKER_PRESENTER_PLUS_BLEND_WGSL = `
  if (layer.blendMode == ${WORKER_PRESENTER_PLUS_BLEND_INDEX}u) {
    return vec4f(min(baseColor.rgb + frameColor.rgb * alpha, vec3f(1.0)), min(baseColor.a + alpha, 1.0));
  }`;
