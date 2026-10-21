import type { BoundOperatorNode } from '../../types/operatorGraph';

export interface EffectPresentationPlan {
  labels: Record<string, string>;
  stage: (node: BoundOperatorNode) => string;
  /** What a node's output carries, by node id (its value output) or `id:port`: the output port is
   * named so, and folder ports it feeds read "Sigma" instead of "Maximum: Value". */
  portLabels?: Record<string, string>;
}
const includes = (list: string, id: string) => list.split(' ').includes(id);
export const GLYPH_PRESENTATION_EFFECTS = new Set(['ascii', 'number-field', 'grid-glyph', 'pixel-code', 'word-mosaic',
  'glyph-matrix', 'data-hatch', 'brand-generator', 'stitch-poster', 'dither-text', 'symbol-matrix', 'pixel-dither',
  'retro-matrix', 'capsule-cloud', 'ui-collage', 'matrix', 'ascii-ghost', 'inscribe', 'contour-type']);
const COLORS = new Set(['brightness', 'contrast', 'saturation', 'exposure', 'levels', 'temperature', 'vibrance', 'threshold', 'posterize', 'invert']);
const REDUCE = 'reduce weight-vec4 average blurred';
const BLUR_PORTS = { 'source-cache': 'Premultiplied Source', 'radius-px': 'Radius (px)', 'pixel-scale': 'Pixel Scale' };
const SEPARABLE_PORTS = { ...BLUR_PORTS, sigma: 'Sigma', reach: 'Reach', pairs: 'Pairs', stride: 'Stride', 'tap-count': 'Tap Count',
  'horizontal-cache': 'Horizontal Pass', 'vertical-image': 'Vertical Pass', 'result:image': 'Blurred Image',
  'horizontal-sequence:index': 'Tap Index', 'vertical-sequence:index': 'Tap Index', 'horizontal-sample-uv': 'Read Position',
  'vertical-sample-uv': 'Read Position' };
const DIRECTIONAL_PORTS = { ...BLUR_PORTS, 'amount-positive': 'Amount ≥ 0', direction: 'Direction', 'half-length': 'Half Length', 'range-start': 'Range Start',
  'range-length': 'Range Length', longest: 'Longest Range', 'longest-px': 'Longest (px)', center: 'Centre (px)', 'center-uv': 'Centre',
  'is-spin': 'Is Spin', farthest: 'Farthest (px)', 'coarse-count': 'Coarse Taps', step: 'Box Length', 'fine-cache': 'Short Boxes',
  'coarse-image': 'Coarse Average', 'result:image': 'Blurred Image', 'fine-sequence:index': 'Fine Tap', 'coarse-sequence:index': 'Coarse Tap',
  'taper-t': 'Position t', taper: 'Taper', 'covered-weight': 'Box Weight', 'coarse-weight': 'Tap Weight', 'coarse-count-here': 'Taps Here',
  'coarse-sample:image': 'Coarse Sample', 'radial-log-scale': 'Zoom Range', 'radial-longest': 'Longest Zoom', 'spin-arc': 'Spin Arc',
  'spin-start': 'Spin Start', 'zoom-end-scale': 'End Scale' };

const GLOW_PORTS: Record<string, string> = { 'source-split:rgb': 'Source Color', 'source-alpha': 'Source Alpha', 'bright-cache': 'Bright Light',
  'tap-weight': 'Tap Weight', 'up-uv': 'Up Read Position', 'down-uv': 'Down Read Position', 'level-weight': 'Level Weight',
  'top-level-weight': 'Top Level Weight', 'glow-core-weight': 'Level 0 Weight', 'glow-light': 'Glow Light', 'glow-amount': 'Glow Amount', 'glow-tinted': 'Tinted Glow', 'color-rgb': 'Glow Color', 'glow-scaled': 'Glow',
  'resolve-premultiplied': 'Premultiplied Source', 'glow-negative': '−Glow', 'euler-rgb': 'e', 'one-rgb': 'One', 'resolve-falloff': 'exp(−Glow)',
  'resolve-room': 'Room (1 − Picture)', 'resolve-remaining': 'Room × exp(−Glow)', 'resolve-result': 'Picture screened with Glow',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [[`down-${index + 1}-cache`, `Level ${index + 1} (1/${2 ** (index + 1)} size)`],
    [`up-${index + 1}-cache`, `Levels ${index + 1}+ Added`]]).flat()) };
// Threshold and Posterize: the hard step and the soft ramp that Softness blends in.
const POINTWISE_PORTS = { compare: 'Above Level', hard: 'Hard Step', ramp: 'Soft Ramp', soft: 'Softness On', smooth: 'Soft Steps', steps: 'Steps' };

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
  if (type === 'gaussian-blur' || type === 'box-blur') return {
    labels: { premultiply: 'Premultiplied Source (cached)', size: 'Radius & Tap Count', horizontal: 'Horizontal Pass', vertical: 'Vertical Pass', finish: 'Straight Alpha Output' },
    portLabels: SEPARABLE_PORTS,
    stage: ({ id }) => /^source-/.test(id) ? 'premultiply' : /^horizontal-/.test(id) ? 'horizontal' : /^vertical-/.test(id) ? 'vertical'
      : /^(result|coverage-floor)/.test(id) ? 'finish' : 'size',
  };
  if (['motion-blur', 'radial-blur', 'zoom-blur'].includes(type)) return {
    labels: { premultiply: 'Premultiplied Source (cached)', range: 'Blur Range', count: 'Tap Counts & Box Length', fine: 'Stage A: Short Box (cached)',
      coarse: 'Stage B: Coarse Taps', finish: 'Straight Alpha Output' },
    portLabels: DIRECTIONAL_PORTS,
    stage: ({ id }) => /^source-/.test(id) ? 'premultiply' : /^fine-/.test(id) ? 'fine'
      : /^(coarse-(?!needed$|count$|limit$|root$)|range-span|range-direction|boxes|covered|along|taper)/.test(id) ? 'coarse'
        : /^(coarse-|longest-px|step)/.test(id) ? 'count'
          : /^(result|coverage-floor)/.test(id) ? 'finish' : 'range',
  };
  if (type === 'sharpen-earlier') return {
    labels: { sampling: 'Kernel Sampling', weight: 'Gaussian Weight', average: 'Weighted Average', finish: 'Sharpen & Alpha' },
    stage: ({ id }) => includes(REDUCE, id) ? 'average'
      : /^(sigma|two-sigma|distance-squared|negative-distance|exponent|weight$|radius-half)/.test(id) ? 'weight'
        : /^(frame|uv|resolution|index|one-vec2|texel-size|offset|radius-vec2|scaled-offset|sample)/.test(id) ? 'sampling' : 'finish',
  };
  if (type === 'sharpen') return {
    labels: { size: 'Radius & Tap Count', premultiply: 'Premultiplied Source (cached)', horizontal: 'Horizontal Blur Pass', vertical: 'Vertical Blur Pass',
      detail: 'Unsharp Mask (brightness)', halo: 'Halo Limit', finish: 'Apply to Color & Alpha' },
    portLabels: { ...SEPARABLE_PORTS, 'sharpened-luma': 'Sharpened Brightness', 'darkest-value': 'Darkest Nearby', 'brightest-value': 'Brightest Nearby',
      detail: 'Detail', 'detail-change': 'Wanted Change', 'detail-up': 'Wanted Up', 'detail-down': 'Wanted Down', 'halo-ceiling': 'Ceiling', 'halo-floor': 'Floor',
      'halo-room-up-raw': 'Ceiling − Brightness', 'halo-room-up': 'Room Up', 'halo-room-down': 'Room Down', 'halo-limited-up-negative': '−Wanted Up',
      'halo-limited-up-exponent': '−Wanted Up / Room', 'halo-limited-up-falloff': 'exp(−Wanted Up / Room)', 'halo-limited-up-share': 'Share of Room',
      'halo-limited-up': 'Limited Up', 'halo-limited-down': 'Limited Down', 'limited-change': 'Limited Change' },
    stage: ({ id }) => /^(source-premultiplied|source-cache)/.test(id) ? 'premultiply' : /^horizontal-/.test(id) ? 'horizontal' : /^vertical-/.test(id) ? 'vertical'
      : /^(darkest-|brightest-|window-|halo-|limited-|detail-(change|up|down|negative)|exponent-|room-floor|overshoot)/.test(id) ? 'halo'
        : /^(source-split|source-luma|blur-|detail|scaled-detail|sharpened-luma)/.test(id) ? 'detail'
          : /^(luma-change|result-|combine)/.test(id) ? 'finish' : 'size',
  };
  if (type === 'vignette') return {
    labels: { shape: 'Distance & Roundness', falloff: 'Falloff (Size, Softness, Amount)', dither: 'Anti-Banding Dither', finish: 'Darken & Alpha' },
    portLabels: { distance: 'Distance (corners = 1)', falloff: 'Falloff', gain: 'Brightness Gain', dither: 'Dither' },
    stage: ({ id }) => /^(minimum-feather|feather|falloff|outer-edge|gain|darkening)/.test(id) ? 'falloff' : /^(pixel$|dither)/.test(id) ? 'dither'
      : /^(source-split|shaded|dithered|clamped|combine)$/.test(id) ? 'finish' : 'shape',
  };
  if (type === 'grain') return {
    labels: { cells: 'Grain Cells (Size)', pattern: 'Pattern per Frame (Speed, Seed)', noise: 'Smooth Noise', mix: 'Layers & Color Grain',
      response: 'Film Response (midtones)', finish: 'Add Grain & Alpha' },
    portLabels: { 'grain-uv': 'Grain Position', 'pattern-offset': 'Pattern Offset', 'grain-mono': 'Monochrome Grain', 'grain-rgb': 'Grain', response: 'Response', strength: 'Strength' },
    stage: ({ id }) => /^(size-safe|pixel-scale|short-side|cell-px|pixel$|grain-uv)/.test(id) ? 'cells' : /^(pattern-|seed-)/.test(id) ? 'pattern'
      : /^(corner-|grain-(layer-\d|red-noise|green-noise|blue-noise))/.test(id) ? 'noise' : /^grain-(?!scaled)/.test(id) ? 'mix'
        : /^(response|source-luma|strength)/.test(id) ? 'response' : 'finish',
  };
  if (type === 'scanlines') return {
    labels: { lines: 'Line Pattern (Density, Scroll)', fade: 'Fade Dense Lines', finish: 'Darken & Alpha' },
    portLabels: { wave: 'Line Wave', 'line-visibility': 'Line Visibility', pattern: 'Pattern', gain: 'Brightness Gain' },
    stage: ({ id }) => /^(resolution-split|line-|frame-turns|frequency-safe|frequency-magnitude|pattern|half-wave)/.test(id) ? 'fade'
      : /^(opacity-limited|gain|darkening|gap|source-split|shaded|combine)$/.test(id) ? 'finish' : 'lines',
  };
  if (type === 'glow') return {
    labels: { bright: 'Bright Pass (soft knee)', kernel: 'Tap Kernel & Level Weight', down: 'Pyramid: Halve the Light',
      up: 'Pyramid: Add Levels Back Up', finish: 'Glow Resolve & Alpha' },
    portLabels: GLOW_PORTS,
    stage: ({ id }) => /^(bright-|source-)/.test(id) ? 'bright'
      : /^(tap-|texel$|one-vec2$|up-offset$|up-uv$|down-offset$|down-uv$|level-|top-level-|finest-)/.test(id) ? 'kernel'
        : /^down-/.test(id) ? 'down' : /^up-/.test(id) ? 'up' : 'finish',
  };
  if (type === 'glow-earlier') return {
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
  if (type === 'edge-detect-earlier') return {
    labels: { sampling: 'Neighbor Luminance', gradient: 'Sobel Gradient', finish: 'Edge Output' },
    stage: ({ id }) => /^(negative-tl|two-[lrtb]$|g[xy]|gradient|magnitude)/.test(id) ? 'gradient'
      : includes('strength scaled clamped inverse invert selected rgba image', id) ? 'finish' : 'sampling',
  };
  if (type === 'edge-detect') return {
    labels: { scale: 'Line Width (sigma & window)', window: 'Window Taps (premultiplied brightness)', gradient: 'Gradient & Edge Strength', finish: 'Line Color & Alpha' },
    portLabels: { sigma: 'Sigma (px)', reach: 'Reach (px)', 'window-size': 'Window Size', 'tap-moment': 'Moments', edge: 'Edge', 'line-color': 'Line Color' },
    stage: ({ id }) => /^(pixel-scale|short-side|width-safe|sigma|two-sigma|reach|window-size)/.test(id) ? 'scale'
      : /^(tap-|window-reduce|window-index)/.test(id) ? 'window'
        : /^(window-|gradient-(sums|length|normalized)|edge-contrast|edge-raw|edge-falloff|edge-negative|strength-safe|edge$)/.test(id) ? 'gradient' : 'finish',
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
    ...(type === 'threshold' || type === 'posterize' ? { portLabels: POINTWISE_PORTS } : {}),
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
