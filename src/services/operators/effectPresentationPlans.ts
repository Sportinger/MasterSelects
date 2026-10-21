import type { BoundOperatorNode } from '../../types/operatorGraph';
import { FILM_PRISM_SPECTRUM } from '../../effects/analog/filmPrismLimits';

export interface EffectPresentationPlan {
  labels: Record<string, string>;
  stage: (node: BoundOperatorNode) => string;
  /** What a node's output carries, by node id (its value output) or `id:port`: the output port is
   * named so, and folder ports it feeds read "Sigma" instead of "Maximum: Value". */
  portLabels?: Record<string, string>;
}
const includes = (list: string, id: string) => list.split(' ').includes(id);
/** A clamped parameter's output carries the parameter, not "Clamp: Value". */
const clampLabels = (labels: Record<string, string>) => Object.fromEntries(Object.entries(labels).map(([id, label]) => [`${id}-clamped`, label]));
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

/** Presentation stages name existing computations; they never replace an operator or route a signal. */
export function effectPresentationPlan(type: string): EffectPresentationPlan | undefined {
  if (type === 'crt-screen') return {
    labels: { premultiply: 'Premultiplied Source (cached)', screen: 'Tube Shape & Rim', scan: 'Scanline Beams',
      mask: 'Phosphor Mask', flicker: 'Hum Bar & Flutter', finish: 'Light Out & Alpha' },
    portLabels: { 'screen-uv': 'Tube Position', 'screen-tube': 'Tube Coverage', 'screen-vignette': 'Rim Shade', 'scan-linear': 'Beam Light',
      'scan-depth': 'Beam Depth', 'mask-factor:rgb': 'Mask', 'flicker-gain': 'Flicker Gain', 'flat-alpha': 'Coverage', 'zero-rgb': 'Black', 'line0-rgb': 'Line Colour', 'line1-rgb': 'Next Line Colour',
      'scan-d0': 'Distance to Line', 'scan-d1': 'Distance to Next Line', 'scan-w0-weight': 'Beam Weight', 'scan-w1-weight': 'Next Beam Weight',
      ...clampLabels({ amount: 'Mix', curvature: 'Curvature', 'line-count': 'Line Count', 'scanline-depth': 'Line Depth',
        'mask-strength': 'Mask Strength', 'mask-size': 'Mask Size', flicker: 'Flicker' }) },
    // Only the parameter clamps are controls: the beams' own luma clamps belong to Scanline Beams.
    stage: ({ id }) => /-clamped$/.test(id) && !/^scan-/.test(id) ? 'controls' : /^source-/.test(id) ? 'premultiply'
      : /^(screen-|one-vec2$|half-vec2$)/.test(id) ? 'screen'
        : /^(scan-|flat-|line[01]-|zero-rgb$|gamma-rgb$)/.test(id) ? 'scan'
          : /^mask-/.test(id) ? 'mask' : /^flicker-/.test(id) ? 'flicker'
            : id === 'resolution-split' ? 'sources' : 'finish',
  };
  if (type === 'glitch') return {
    labels: { state: 'Burst Clock', tear: 'Torn Rows', block: 'Block Copies', read: 'Read Position & RGB Split',
      channels: 'Channel Reads', finish: 'Channel Swap & Alpha' },
    portLabels: { 'state-tick': 'Glitch State', 'state-seed': 'Seed Key', 'state-level': 'Burst Level', 'tear-shift': 'Tear Shift',
      'tear-active': 'Row Torn', 'block-offset': 'Block Offset', 'block-active': 'Block Moved', 'block-rotate': 'Swap Channels',
      'read-uv': 'Read Position', 'state-burst-salt': 'Burst Key', 'state-strength': 'Burst Strength', 'state-burst': 'Glitching', 'split-shift': 'Split Shift', 'red-read-uv': 'Red Read Position', 'blue-read-uv': 'Blue Read Position',
      'red-alpha': 'Red Alpha', 'green-alpha': 'Green Alpha', 'blue-alpha': 'Blue Alpha',
      'red-premultiplied': 'Red', 'green-premultiplied': 'Green', 'blue-premultiplied': 'Blue',
      ...clampLabels({ amount: 'Intensity', density: 'Density', bands: 'Bands', split: 'RGB Split', seed: 'Seed' }) },
    stage: ({ id }) => /^(amount|density|bands|split|seed)-clamped$/.test(id) ? 'controls'
      : /^(uv-split|resolution-split)$/.test(id) ? 'sources' : /^state-/.test(id) ? 'state' : /^tear-/.test(id) ? 'tear'
        : /^block-/.test(id) ? 'block' : /^(read-|split-|red-read-uv$|blue-read-uv$)/.test(id) ? 'read'
          : /^(red|green|blue)-|^half-vec2$/.test(id) ? 'channels' : 'finish',
  };
  if (type === 'film-prism') return {
    labels: { premultiply: 'Premultiplied Source (cached)', spread: 'Fringe Spread & Direction', positions: 'Tap Positions',
      spectrum: 'Spectrum Reads & Sum', noise: 'Grain Noise', grain: 'Grain Strength', finish: 'Add Grain & Alpha' },
    portLabels: { 'source-cache': 'Premultiplied Source', 'fringe-reach': 'Reach', 'fringe-jitter': 'Jitter', 'fringe-direction': 'Direction',
      'fringe-centred': 'From Centre', 'fringe-is-prism': 'Is Prism', 'grain-noise': 'Grain Noise', 'grain-rgb': 'Grain',
      'finish-straight': 'Fringed Colour', 'finish-alpha': 'Coverage',
      ...Object.fromEntries(FILM_PRISM_SPECTRUM.flatMap((_, index) => (['Red', 'Green', 'Blue'] as const)
        .map(colour => [`fringe-tap${index}-${colour.toLowerCase()}`, `${colour} Share`]))),
      'grain-midtones': 'Mid-tone Weight', 'grain-amplitude': 'Grain Amount', 'grain-luma': 'Brightness',
      ...Object.fromEntries(FILM_PRISM_SPECTRUM.map((_, index) => [`fringe-tap${index}-uv`, `Tap ${index + 1} Position`])),
      ...clampLabels({ amount: 'Fringe', grain: 'Grain', 'grain-size': 'Grain Size' }) },
    stage: ({ id }) => /^(amount|grain|grain-size)-clamped$/.test(id) ? 'controls'
      : /^(resolution-split|half-vec2)$/.test(id) ? 'sources' : /^source-/.test(id) ? 'premultiply'
        : /^fringe-tap\d+-(t|position|reach|scale|lens|lens-offset|shift|prism|prism-offset|uv)$/.test(id) ? 'positions'
          : /^fringe-(tap|red|green|blue)|^finish-(alpha-rg|alpha|safe-alpha|premultiplied-vector|premultiplied|straight)$/.test(id) ? 'spectrum'
            : /^fringe-/.test(id) ? 'spread'
              : /^grain-(luma|midtone|floor|amplitude|strength|scale|offset|rgb)/.test(id) ? 'grain'
                : /^grain-/.test(id) ? 'noise' : 'finish',
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
  if (type === 'sharpen') return {
    labels: { sampling: 'Kernel Sampling', weight: 'Gaussian Weight', average: 'Weighted Average', finish: 'Sharpen & Alpha' },
    stage: ({ id }) => includes(REDUCE, id) ? 'average'
      : /^(sigma|two-sigma|distance-squared|negative-distance|exponent|weight$|radius-half)/.test(id) ? 'weight'
        : /^(frame|uv|resolution|index|one-vec2|texel-size|offset|radius-vec2|scaled-offset|sample)/.test(id) ? 'sampling' : 'finish',
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
