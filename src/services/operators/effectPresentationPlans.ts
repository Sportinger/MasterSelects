import type { BoundOperatorNode } from '../../types/operatorGraph';

export interface EffectPresentationPlan {
  labels: Record<string, string>;
  stage: (node: BoundOperatorNode) => string;
}
const includes = (list: string, id: string) => list.split(' ').includes(id);
export const GLYPH_PRESENTATION_EFFECTS = new Set(['ascii', 'number-field', 'grid-glyph', 'pixel-code', 'word-mosaic',
  'glyph-matrix', 'data-hatch', 'brand-generator', 'stitch-poster', 'dither-text', 'symbol-matrix', 'pixel-dither',
  'retro-matrix', 'capsule-cloud', 'ui-collage', 'matrix', 'ascii-ghost', 'inscribe', 'contour-type']);
const COLORS = new Set(['brightness', 'contrast', 'saturation', 'exposure', 'levels', 'temperature', 'vibrance', 'threshold', 'posterize', 'invert']);
const REDUCE = 'reduce weight-vec4 average blurred';
const BYPASS = 'half enabled bypass bypass-threshold selected';

/** Presentation stages name existing computations; they never replace an operator or route a signal. */
export function effectPresentationPlan(type: string): EffectPresentationPlan | undefined {
  if (type === 'crt-screen') return {
    labels: { curvature: 'Screen Curvature', sampling: 'Clamped Image Sampling', scan: 'Scanlines',
      mask: 'RGB Phosphor Mask', flicker: 'Timeline Flicker', finish: 'Color Mix & Sampled Alpha' },
    stage: ({ id }) => includes('uv-split resolution-split', id) ? 'sources'
      : /^(scan-|scan$)/.test(id) ? 'scan'
        : /^(time-speed$|flicker(?:-|$))/.test(id) ? 'flicker'
          : /^(safe-scale$|pixel-x$|mask(?:-|$)|is-|above-half$|below-one-half$)/.test(id) ? 'mask'
            : includes('min-vec2 max-vec2 clamped-uv curved-sample color', id) ? 'sampling'
              : /^(masked-color|scanned-color|flickered-color|mixed-color|combine)$/.test(id) ? 'finish' : 'curvature',
  };
  if (type === 'box-blur' || type === 'sharpen') return {
    labels: { sampling: 'Kernel Sampling', weight: 'Gaussian Weight', average: 'Weighted Average', finish: type === 'sharpen' ? 'Sharpen & Alpha' : 'Radius Bypass' },
    stage: ({ id }) => includes(REDUCE, id) ? 'average'
      : /^(sigma|two-sigma|distance-squared|negative-distance|exponent|weight$|radius-half)/.test(id) ? 'weight'
        : /^(frame|uv|resolution|index|one-vec2|texel-size|offset|radius-vec2|scaled-offset|sample)/.test(id) ? 'sampling' : 'finish',
  };
  if (['motion-blur', 'radial-blur', 'zoom-blur'].includes(type)) return {
    labels: { count: 'Sample Count', sampling: 'Sample Coordinates', weight: 'Sample Weight', finish: 'Average & Bypass' },
    stage: ({ id }) => /^(samples-|count$)/.test(id) ? 'count'
      : includes(`${REDUCE} ${BYPASS}`, id) ? 'finish'
        : /^(negative-t|weight|t-half)/.test(id) ? 'weight' : 'sampling',
  };
  if (type === 'glow') return {
    labels: { count: 'Ring & Sample Counts', spacing: 'Sample Spacing & Prefilter Size', taps: 'Horizontal Prefilter Taps',
      bright: 'Bright Pass', horizontal: 'Horizontal Prefilter', vertical: 'Vertical Prefilter', sampling: 'Ring Sampling',
      weight: 'Ring Weight', finish: 'Glow Resolve & Alpha' },
    stage: ({ id }) => /^(rings-|samples-|ring-circumference|sample-share$)/.test(id) ? 'count'
      : /^(ring-step|outer-arc-ratio|spacing-ratio|sample-spacing|prefilter-)/.test(id) ? 'spacing'
        : /^horizontal-(index|tap|offset|sample-uv|weight$)/.test(id) ? 'taps'
          : /^(threshold-|sample$|sample-luma|sample-bright|bright-sample|sample-split|sample-alpha|light-sample)/.test(id) ? 'bright'
            : /^horizontal-/.test(id) ? 'horizontal'
              : /^(vertical-|prefiltered-cache$)/.test(id) ? 'vertical'
                : /^(ring-progress|gaussian-sigma|ring-weight|sample-weight)/.test(id) ? 'weight'
                  : /^(index-components|ring$|ring-stagger|angle|direction|ring-radius|ring-offset|ring-sample)/.test(id) ? 'sampling' : 'finish',
  };
  if (type === 'edge-detect') return {
    labels: { sampling: 'Neighbor Luminance', gradient: 'Sobel Gradient', finish: 'Edge Output' },
    stage: ({ id }) => /^(negative-tl|two-[lrtb]$|g[xy]|gradient|magnitude)/.test(id) ? 'gradient'
      : includes('strength scaled clamped inverse invert selected rgba image', id) ? 'finish' : 'sampling',
  };
  if (['wave', 'twirl', 'bulge'].includes(type)) return {
    labels: { coordinates: type === 'wave' ? 'Wave Coordinates' : type === 'twirl' ? 'Twirl Coordinates' : 'Bulge Coordinates', sampling: 'Image Sampling' },
    stage: ({ id }) => id === 'sample' ? 'sampling' : 'coordinates',
  };
  if (['pixelate', 'mirror', 'rgb-split', 'blockify', 'block-mosaic'].includes(type)) return {
    labels: { coordinates: 'Grid & Coordinates', sampling: 'Image Sampling', finish: 'Color & Alpha' },
    stage: ({ id, operator }) => operator === 'image.sample' ? 'sampling'
      : /split|^combine$|^image$|^color-|^ink|^mosaic$|^mixed$|^scaled-color$|^poster|^eight-rgb$|^seven-rgb$|^cell-fract$|^border|^plus4$|^center4$|^minus4$/.test(id) ? 'finish' : 'coordinates',
  };
  if (COLORS.has(type)) return {
    labels: { processing: 'Color Processing', finish: 'Clamp & Alpha' },
    stage: ({ id }) => includes('clamp combine image', id) ? 'finish' : 'processing',
  };
  if (GLYPH_PRESENTATION_EFFECTS.has(type)) return {
    labels: { grid: 'Cell Grid', source: 'Cell Sampling & Tone', index: 'Glyph Selection', atlas: 'Atlas Sampling', appearance: 'Ink & Appearance', feedback: 'Feedback Resolve' },
    stage: ({ id }) => /^(tiny-vec2|almost-vec2)$/.test(id) ? 'sources'
      : /^(ghost-current|ghost-history|ghost-resolved|ghost-faded|ghost-max|ghost-image|ghost-decay)/.test(id) ? 'feedback'
      : /^(safe-cell|grid$|scaled-uv|cell-id$|local-uv|half-vec2|sample-pixel|sample-uv$)/.test(id) ? 'grid'
        : /^(clamped-source|source-sample|source-split|tone$)/.test(id) ? 'source'
          : /^(inverse-tone|mapped-tone|clamped-tone|safe-count|glyph-scaled|glyph-index|index-|shifted-index|wrapped-index|cell-id-split|word-phase|word-index|brand-centered|brand-radius|brand-index|uv-split|contour-current|contour-index)/.test(id) ? 'index'
            : /^(safe-columns|safe-rows|column-ratio|atlas-|row-width|clamped-local)/.test(id) ? 'atlas' : 'appearance',
  };
  return undefined;
}
