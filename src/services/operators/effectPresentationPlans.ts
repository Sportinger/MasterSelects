import type { BoundOperatorNode, EffectOperatorGraph } from '../../types/operatorGraph';
import { mirrorPixelPresentationPlan } from './mirrorPixelPresentation';
import { FILM_PRISM_SPECTRUM } from '../../effects/analog/filmPrismLimits';
import { createLegacyCrtScreenGraph } from './legacyCrtScreenGraph';
import { acuarelaPresentationPlan } from './acuarelaPresentation';
import { rom1PresentationPlan } from './rom1Presentation';

export interface EffectPresentationPlan {
  labels: Record<string, string>;
  stage: (node: BoundOperatorNode) => string;
  /** What a node's output carries, by node id (its value output) or `id:port`: the output port is
   * named so, and folder ports it feeds read "Sigma" instead of "Maximum: Value". */
  portLabels?: Record<string, string>;
  /** What an input receives, by `id:port`, where the operator's own names (X, Y, Z) say nothing. */
  inputLabels?: Record<string, string>;
  /** Port labels apply only to graphs this accepts (an effect id can carry more than one recipe). */
  portLabelsApply?: (graph: Pick<EffectOperatorGraph, 'nodes'>) => boolean;
}
const includes = (list: string, id: string) => list.split(' ').includes(id);
/** A clamped parameter's output carries the parameter, not "Clamp: Value". */
const clampLabels = (labels: Record<string, string>) => Object.fromEntries(Object.entries(labels).map(([id, label]) => [`${id}-clamped`, label]));
export const GLYPH_PRESENTATION_EFFECTS = new Set(['ascii', 'number-field', 'grid-glyph', 'pixel-code', 'word-mosaic',
  'glyph-matrix', 'data-hatch', 'brand-generator', 'stitch-poster', 'dither-text', 'symbol-matrix', 'pixel-dither',
  'retro-matrix', 'capsule-cloud', 'ui-collage', 'matrix', 'ascii-ghost', 'inscribe', 'contour-type']);
/** Pointwise color effects whose graphs predate the 2026-10 recipes (and the saved original color graphs). */
const COLORS = new Set(['brightness', 'contrast', 'saturation', 'exposure', 'levels', 'temperature', 'vibrance', 'threshold', 'posterize', 'invert']);
const COLOR_RECIPES = new Set(['brightness', 'contrast', 'saturation', 'exposure', 'levels', 'hue-shift', 'temperature', 'vibrance']);
/** Original color graphs: everything is processing except the final clamp and recombine. */
export const ORIGINAL_COLOR_PRESENTATION: EffectPresentationPlan = {
  labels: { processing: 'Color Processing', finish: 'Clamp & Alpha' },
  stage: ({ id }) => includes('clamp combine image', id) ? 'finish' : 'processing',
};
/** Stages of the rebuilt color recipes (node id prefixes, see colorEffectGraphs.ts); only applied to the unedited recipe. */
const COLOR_STAGES: readonly [RegExp, string, string][] = [
  [/-clamped$/, 'controls', 'Parameters'], [/^(clamp|combine|image)(-|$)/, 'finish', 'Clamp & Alpha'],
  [/^input(-|$)/, 'input', 'Input 0–1'], [/^curve(-|$)/, 'curve', 'Tone Curve'], [/^light-/, 'light', 'Linear Light'],
  [/^gain-/, 'gain', 'White Balance Gains'], [/^tone-|^offset-rgb$/, 'tone', 'Offset & Gamma'], [/^weight(-|$)/, 'weight', 'Muted-Colour Weight'],
  [/^measure-/, 'measure', 'Hue & Saturation'], [/^skin-/, 'skin', 'Skin Protection'], [/^gamut-/, 'gamut', 'Gamut-Safe Saturation'], [/^(range|remap)(-|$)|^inputBlack-rgb$/, 'remap', 'Input Black & White'],
  [/^gamma-/, 'gamma', 'Gamma'], [/^output-range$|^output(Black|White)-rgb$/, 'output', 'Output Range'], [/^hue-/, 'hue', 'Hue Rotation'],
];
/** What the inner values of the color recipes carry (bound parameters name themselves after their clamp). */
const COLOR_PORTS = { input: 'RGB 0–1', 'amount-steepness': 'Steepness', 'amount-flatten': 'Flatten', flatten: 'Flattened RGB', 'light-linear': 'Linear RGB', 'light-encoded': 'sRGB', 'tone-gamma': 'Toned RGB',
  'measure-hsv-split:x': 'Hue (HSV)', 'measure-hsv-split:y': 'Saturation', 'measure-hsv-split:z': 'Value (HSV)', 'skin-match': 'Skin Hue Match', 'skin-kept': 'Skin Weight', 'weight-saturation': 'Mix Amount',
  'hue-lch-split:x': 'Lightness', 'hue-lch-split:y': 'Chroma', 'hue-lch-split:z': 'Hue', 'hue-rgb': 'Rotated RGB',
  'gain-balanced': 'Balanced Gains', 'range-safe': 'Input Range', 'remap-clamp': 'Normalized RGB', 'gamma-curve': 'Curved RGB', 'output-range': 'Levels RGB' };
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
  'spin-start': 'Spin Start', 'zoom-end-scale': 'End Scale', 'fine-half-cells': 'Half Box (cells)', 'fine-pairs': 'Tap Pairs', 'fine-count': 'Fine Taps',
  'fine-slot': 'Slot', 'fine-ring': 'Ring', 'fine-covered': 'Covered Share', 'fine-tap-weight': 'Fine Weight', 'fine-u': 'Read Offset' };
const UV_DISTORT_PORTS = { 'source-cache': 'Premultiplied Source', 'edge-uv': 'Sample UV', 'result:image': 'Distorted Image',
  'space-center': 'Centre', 'space-scale': 'Shape Scale', 'space-p': 'Offset', 'space-r': 'Distance / Radius', 'one-vec2': '(1, 1)',
  'bulge-scale': 'Lens Scale', 'bulge-moved': 'Moved Offset', 'twirl-angle': 'Turn Angle', 'twirl-moved': 'Moved Offset',
  'space-sample-uv': 'Read Position', 'wave-sample-uv': 'Read Position', phase: 'Phase' };

// What the outputs that cross into Chroma Key's Spill folder carry (the docs' Spill recipe shows the same names).
const CHROMA_KEY_PORTS = { 'unmix-color': 'Color', 'screen-channel': 'Screen Channel', 'screen-other-channels': 'Other Channels',
  'screen-found': 'Screen Found', 'spill-primary': 'Screen Level', 'spill-other': 'Stronger Other', 'spill-other-sum': 'Other Sum',
  'spill-other-mean': 'Other Mean', 'spill-is-gentle': 'Is Gentle', 'spill-limit': 'Limit', 'spill-strength': 'Strength', 'spill-excess': 'Excess' };
/** Effects whose folders come from their own graph (no presentation plan) can still name what outputs carry. */
const GRAPH_PORT_LABELS: Record<string, Record<string, string>> = {
  'slit-scan': { 'smooth-or-banded': 'Time Map', 'subject-protected': 'Protection', 'safe-delay': 'Delay (s)',
    'masked-delay': 'Protected Time', 'sample-delay': 'Delay per Pixel' },
  'time-stack': { 'decay-clamped': 'Decay', opacity: 'Opacity', delay: 'Delay', history: 'Past Frame' },
};

/** Names of what outputs carry (node id or `id:port`) for an effect's graph: card outputs and folder ports show them. */
export function effectPortLabels(type: string): Record<string, string> | undefined {
  return effectPresentationPlan(type)?.portLabels ?? GRAPH_PORT_LABELS[type];
}

const GLOW_PORTS: Record<string, string> = { 'source-split:rgb': 'Source Color', 'source-alpha': 'Source Alpha', 'bright-cache': 'Bright Light',
  'tap-weight': 'Tap Weight', 'up-uv': 'Up Read Position', 'down-uv': 'Down Read Position', 'level-weight': 'Level Weight',
  'top-level-weight': 'Top Level Weight', 'level-short-side': 'Short Side', 'level-radius': 'Radius (> 0)', 'glow-core-weight': 'Level 0 Weight', 'glow-light': 'Glow Light', 'glow-amount': 'Glow Amount', 'glow-tinted': 'Tinted Glow', 'color-rgb': 'Glow Color', 'glow-scaled': 'Glow',
  'resolve-premultiplied': 'Premultiplied Source', 'glow-negative': '−Glow', 'euler-rgb': 'e', 'one-rgb': 'One', 'resolve-falloff': 'exp(−Glow)',
  'resolve-room': 'Room (1 − Picture)', 'resolve-remaining': 'Room × exp(−Glow)', 'resolve-result': 'Picture screened with Glow',
  'bright-peak': 'Brightest Channel', 'bright-threshold': 'Threshold (≥ 0)', 'bright-knee': 'Softness × Headroom', 'bright-ramp-start': 'Ramp Start',
  'bright-ramp-end': 'Ramp End', 'bright-contribution': 'Glow Share', 'level-reach-px': 'Radius × Short Side', 'level-fineness': 'Fineness',
  'level-fine-fade': 'Fine Fade', 'level-position-shifted': 'Octaves + 1', 'glow-light-sum': 'Light Sum', 'glow-weight-safe': 'Weight Sum (≥ 1)', 'zero-rgb': 'Zero',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [[`down-${index + 1}-cache`, `Level ${index + 1} (1/${2 ** (index + 1)} size)`],
    [`up-${index + 1}-cache`, `Levels ${index + 1}+ Added`], [`up-${index + 1}-level-split:rgb`, `Level ${index + 1} Light`],
    [`up-${index + 1}-weights`, 'Weight Sum'], [`up-${index + 1}-alpha`, 'Weight Sum'], [`up-${index + 1}-weight-sum`, 'Smaller Levels Weight']]).flat()) };
// Threshold and Posterize: the hard step and the soft ramp that Softness blends in.
const POINTWISE_PORTS = { compare: 'Above Level', hard: 'Hard Step', ramp: 'Soft Ramp', soft: 'Softness On', smooth: 'Soft Steps', steps: 'Steps' };

/** The CRT Screen graph saved before the 2026-10 rebuild keeps the stage folders it opened with. */
const LEGACY_CRT_PLAN: EffectPresentationPlan = {
  labels: { curvature: 'Screen Curvature', sampling: 'Clamped Image Sampling', scan: 'Scanlines',
    mask: 'RGB Phosphor Mask', flicker: 'Timeline Flicker', finish: 'Color Mix & Sampled Alpha' },
  stage: ({ id }) => includes('uv-split resolution-split', id) ? 'sources'
    : /^(scan-|scan$)/.test(id) ? 'scan'
      : /^(time-speed$|flicker(?:-|$))/.test(id) ? 'flicker'
        : /^(safe-scale$|pixel-x$|mask(?:-|$)|is-|above-half$|below-one-half$)/.test(id) ? 'mask'
          : includes('min-vec2 max-vec2 clamped-uv curved-sample color', id) ? 'sampling'
            : /^(masked-color|scanned-color|flickered-color|mixed-color|combine)$/.test(id) ? 'finish' : 'curvature',
};

/** Earlier recipes of a type that saved effects may still run, each with the folders it opened with. */
export function legacyEffectPresentationPlans(type: string): Array<{ create: () => EffectOperatorGraph; plan: EffectPresentationPlan }> {
  return type === 'crt-screen' ? [{ create: createLegacyCrtScreenGraph, plan: LEGACY_CRT_PLAN }] : [];
}

/** Presentation stages name existing computations; they never replace an operator or route a signal. */
export function effectPresentationPlan(type: string): EffectPresentationPlan | undefined {
  if (type === 'crt-screen') return {
    labels: { premultiply: 'Linear Light Source (cached)', screen: 'Tube Shape & Rim', scan: 'Scanline Beams',
      mask: 'Phosphor Mask', flicker: 'Hum Bar & Flutter', finish: 'Light Out & Alpha' },
    portLabels: { 'screen-uv': 'Tube Position', 'screen-tube': 'Tube Coverage', 'screen-vignette': 'Rim Shade', 'scan-linear': 'Beam Light',
      'scan-depth': 'Beam Depth', 'mask-factor:rgb': 'Mask', 'flicker-gain': 'Flicker Gain', 'flat-alpha': 'Coverage', 'zero-rgb': 'Black', 'line0-linear': 'Line Light', 'line1-linear': 'Next Line Light',
      'scan-d0': 'Distance to Line', 'scan-d1': 'Distance to Next Line', 'scan-w0-weight': 'Beam Weight', 'scan-w1-weight': 'Next Beam Weight',
      'scan-sigma-floor': 'Half-Pixel Floor', 'scan-line-height': 'Line Height', 'scan-w0-brightness': 'Line Brightness',
      'line-box': 'Line Box (cached)', 'line-box-width': 'Box Height', 'scan-line-reach': 'Line Reach',
      'source-cache': 'Linear Light Source', ...clampLabels({ amount: 'Mix', curvature: 'Curvature', 'line-count': 'Line Count', 'scanline-depth': 'Line Depth',
        'mask-strength': 'Mask Strength', 'mask-size': 'Mask Size', flicker: 'Flicker' }) },
    // Only the parameter clamps are controls: the beams' own luma clamps belong to Scanline Beams.
    stage: ({ id }) => /-clamped$/.test(id) && !/^scan-/.test(id) ? 'controls' : /^(source-|zero-rgb$|gamma-rgb$)/.test(id) ? 'premultiply'
      : /^(screen-|one-vec2$|half-vec2$)/.test(id) ? 'screen'
        : /^(scan-|flat-|line[01]-|line-box)/.test(id) ? 'scan'
          : /^mask-/.test(id) ? 'mask' : /^flicker-/.test(id) ? 'flicker'
            : id === 'resolution-split' ? 'sources' : 'finish',
  };
  if (type === 'glitch') return {
    labels: { state: 'Burst Clock', tear: 'Torn Rows', block: 'Block Copies', read: 'Read Position & RGB Split',
      channels: 'Channel Reads & Swap', finish: 'Colour & Alpha' },
    portLabels: { 'state-tick': 'Glitch State', 'state-seed': 'Seed Key', 'state-level': 'Burst Level', 'tear-shift': 'Tear Shift',
      'tear-active': 'Row Torn', 'block-offset': 'Block Offset', 'block-active': 'Block Moved', 'block-rotate': 'Swap Channels',
      'read-uv': 'Read Position', 'state-seed-key': 'Seed Key Offset', 'state-strength': 'Burst Strength', 'state-burst': 'Glitching', 'split-shift': 'Split Shift', 'red-read-uv': 'Red Read Position', 'blue-read-uv': 'Blue Read Position',
      'red-alpha': 'Red Alpha', 'green-alpha': 'Green Alpha', 'blue-alpha': 'Blue Alpha',
      'red-premultiplied': 'Red', 'green-premultiplied': 'Green', 'blue-premultiplied': 'Blue', 'finish-rotated': 'Swapped Colour',
      ...clampLabels({ amount: 'Intensity', density: 'Density', bands: 'Bands', split: 'RGB Split', seed: 'Seed' }) },
    stage: ({ id }) => /^(amount|density|bands|split|seed)-clamped$/.test(id) ? 'controls'
      : /^(uv-split|resolution-split|half-vec2)$/.test(id) ? 'sources' : /^state-/.test(id) ? 'state' : /^tear-/.test(id) ? 'tear'
        : /^block-/.test(id) ? 'block' : /^(read-|split-|red-read-uv$|blue-read-uv$)/.test(id) ? 'read'
          : /^(red|green|blue)-|^finish-(r|g|b|rotated|rotated-vector)$/.test(id) ? 'channels' : 'finish',
  };
  if (type === 'film-prism') return {
    labels: { premultiply: 'Premultiplied Source (cached)', spread: 'Fringe Spread & Direction', positions: 'Tap Positions',
      spectrum: 'Spectrum Reads & Sum', sharpen: 'Sharp Brightness', noise: 'Grain Noise', grain: 'Grain Strength', finish: 'Add Grain & Alpha' },
    portLabels: { 'source-cache': 'Premultiplied Source', 'fringe-reach': 'Reach', 'fringe-jitter': 'Jitter', 'fringe-direction': 'Direction',
      'fringe-centred': 'From Centre', 'fringe-is-prism': 'Is Prism', 'grain-noise': 'Grain Noise', 'grain-rgb': 'Grain',
      'finish-spread': 'Fringed Colour', 'finish-straight': 'Sharp Fringed Colour', 'finish-luma': 'Brightness', 'sharp-rgb': 'Pixel Colour',
      'sharp-alpha': 'Pixel Coverage', 'finish-alpha': 'Coverage',
      ...Object.fromEntries(FILM_PRISM_SPECTRUM.flatMap((_, index) => (['Red', 'Green', 'Blue'] as const)
        .map(colour => [`fringe-tap${index}-${colour.toLowerCase()}`, `${colour} Share`]))),
      'grain-midtones': 'Mid-tone Weight', 'grain-amplitude': 'Grain Amount', 'grain-luma': 'Brightness',
      ...Object.fromEntries(FILM_PRISM_SPECTRUM.map((_, index) => [`fringe-tap${index}-uv`, `Tap ${index + 1} Position`])),
      ...clampLabels({ amount: 'Fringe', grain: 'Grain', 'grain-size': 'Grain Size' }) },
    stage: ({ id }) => /^(amount|grain|grain-size)-clamped$/.test(id) ? 'controls'
      : /^(resolution-split|half-vec2)$/.test(id) ? 'sources' : /^source-/.test(id) ? 'premultiply'
        : /^fringe-tap\d+-(t|position|reach|scale|lens|lens-offset|shift|prism|prism-offset|uv)$/.test(id) ? 'positions'
          : /^fringe-(tap|red|green|blue)|^finish-(alpha-rg|alpha|safe-alpha|premultiplied-vector|premultiplied|spread)$/.test(id) ? 'spectrum'
            : /^sharp-|^finish-(spread-luma|sharp-luma|sharp-coverage|luma|luma-difference|luma-shift|straight)$/.test(id) ? 'sharpen'
            : /^fringe-/.test(id) ? 'spread'
              : /^grain-(luma|midtone|floor|amplitude|strength|scale|offset|rgb)/.test(id) ? 'grain'
                : /^grain-/.test(id) ? 'noise' : 'finish',
  };
  if (type === 'chroma-key') return {
    portLabels: CHROMA_KEY_PORTS,
    labels: { channel: 'Screen Channel', grid: 'Screen Grid (64 px cache)', average: 'Screen Average (1 px cache)', screen: 'Screen Color',
      matte: 'Screen Matte & Clip', kernel: 'Edge Sizes', cache: 'Matte Cache', shrink: 'Shrink / Grow (soft min/max)',
      soften: 'Edge Softness (blur)', edge: 'Edge Result', unmix: 'Screen Subtraction', spill: 'Spill Suppression', view: 'View & Output' },
    stage: ({ id }) => /^screen-(cell-|grid)/.test(id) ? 'grid' : /^screen-(average-|color-estimate|centre-uv)/.test(id) ? 'average'
      : /^screen-(is-|picked-|green-channel|blue-channel|preset-channel|channel$|other-channels|all-channels)/.test(id) ? 'channel'
        : /^matte-/.test(id) ? 'matte' : /^kernel-/.test(id) ? 'kernel' : /^edge-(key-|keyed-alpha|source-alpha|negative-sharpness)/.test(id) ? 'cache'
          : /^edge-(shrink-|erode|grow|shrunk)/.test(id) ? 'shrink' : /^edge-soften-/.test(id) ? 'soften' : /^edge-/.test(id) ? 'edge'
            : /^unmix-/.test(id) ? 'unmix' : /^spill-/.test(id) ? 'spill' : /^(view-|result$)/.test(id) ? 'view' : 'screen',
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
    // The source brightness feeds the rows, the window, the mask and the limit: its own folder, so
    // the Unsharp Mask folder (after the vertical pass) does not close a loop and fall apart.
    labels: { size: 'Radius & Window Size', source: 'Source Brightness', premultiply: 'Premultiplied Source (cached)', horizontal: 'Horizontal Blur Pass', rows: 'Row Darkest & Brightest',
      vertical: 'Vertical Blur Pass', window: 'Window Darkest & Brightest', detail: 'Unsharp Mask (brightness)', halo: 'Halo Limit', finish: 'Apply to Color & Alpha' },
    portLabels: { ...SEPARABLE_PORTS, 'sharpened-luma': 'Sharpened Brightness', 'window-darkest': 'Darkest Nearby', 'window-brightest': 'Brightest Nearby',
      detail: 'Detail', 'row-max': 'Row Brightest', 'row-min': 'Row Darkest', 'row-cache': 'Rows (blur, darkest, brightest)', 'row-tap-luma': 'Tap Brightness',
      'window-range': 'Range', 'halo-margin-raw': 'Range × Overshoot', 'halo-margin': 'Margin', 'halo-ceiling-raw': 'Brightest + Margin', 'halo-ceiling': 'Ceiling',
      'halo-floor-raw': 'Darkest − Margin', 'halo-floor': 'Floor', 'roll-off-scale': 'Roll-off Scale', 'excess-above-raw': 'Sharpened − Ceiling', 'excess-above': 'Excess Above',
      'excess-below': 'Excess Below', 'inside-range': 'Within Floor…Ceiling', 'roll-off-above-share': 'Excess / Scale', 'roll-off-above-ratio': '1 + Excess / Scale',
      'roll-off-above-log': 'ln(1 + Excess / Scale)', 'roll-off-above': 'Rolled-off Excess', 'roll-off-below': 'Rolled-off Excess Below',
      'limited-luma-up': 'Within + Rolled-off Excess', 'limited-luma': 'Limited Brightness', 'limited-change': 'Limited Change',
      overshoot: 'Overshoot', 'margin-floor': 'Margin Floor', 'roll-off': 'Roll Off', 'window-reach-steps': 'Reach in Taps',
      'window-x-coverage': 'Row Tap Share', 'window-y-coverage': 'Column Tap Share', 'row-tap-covered': 'Covered Tap Brightness', 'row-tap-weight': 'Tap Weight',
      'column-tap-brightest': 'Covered Row Brightest', 'column-tap-darkest': 'Covered Row Darkest', 'window-count': 'Window Taps',
      'window-x-px': 'Row Offset (px)', 'window-y-px': 'Column Offset (px)', 'source-split:rgb': 'Source RGB', 'source-split:alpha': 'Source Alpha',
      'source-luma': 'Source Brightness', 'horizontal-split:rgb': 'Row-Blurred RGB', 'horizontal-split:alpha': 'Row-Blurred Alpha',
      'vertical-split:x': 'Blurred Brightness', 'vertical-split:y': 'Blurred Alpha' },
    stage: ({ id }) => /^(source-premultiplied|source-cache)/.test(id) ? 'premultiply' : /^horizontal-/.test(id) ? 'horizontal'
      : /^(row-|empty-row-)/.test(id) ? 'rows' : /^vertical-/.test(id) ? 'vertical'
        : /^(column-|window-(brightest|darkest|bright-total|dark-total))/.test(id) ? 'window'
          : /^(window-range|halo-|overshoot|margin-floor|roll-off|excess-|inside-range|limited-luma)/.test(id) ? 'halo'
            : /^(source-split|source-luma)$/.test(id) ? 'source'
              : /^(blur-|detail|scaled-detail|sharpened-luma)/.test(id) ? 'detail'
              : /^(limited-change|luma-change|result-|combine)/.test(id) ? 'finish' : 'size',
  };
  // Drift Lines (createDriftLinesGraph): band index across the turned bands, the wave that shifts each band, the line shading.
  if (type === 'drift-lines') return {
    labels: { bands: 'Bands (Band Size, Angle)', drift: 'Drift Wave (Drift, Speed)', sampling: 'Shifted Sample', lines: 'Line Shading & Alpha' },
    portLabels: { 'row-height': 'Band Height (px)', across: 'Across the Bands (px)', row: 'Band Index', shift: 'Shift (px)', radians: 'Angle (rad)',
      'sample-uv': 'Shifted Position', line: 'Line Shade' },
    stage: ({ id }) => /^(sample|clamped-uv|min-uv|max-uv)$/.test(id) ? 'sampling'
      : /^(line|sample-split|darkened|combine)(-|$)/.test(id) ? 'lines'
        : /^(time-|row-phase$|shift|resolution-split$|along$|offset|back-radians$|sample-uv$)/.test(id) ? 'drift' : 'bands',
  };
  if (type === 'vignette') return {
    labels: { shape: 'Distance & Roundness', falloff: 'Falloff (Size, Softness, Amount)', dither: 'Anti-Banding Dither', finish: 'Darken & Alpha' },
    portLabels: { distance: 'Distance (corners = 1)', falloff: 'Falloff', gain: 'Brightness Gain', dither: 'Dither',
      'half-diagonal': 'Half Diagonal (px)', 'gain-change': 'Darkening Depth', shaded: 'Darkened Color',
      'circle-scale': 'Circle Scale', 'frame-scale': 'Frame Scale (√2)', center: 'Centre (0.5, 0.5)', 'corner-distance': 'Corner Distance',
      'minimum-feather': 'Minimum Feather', pixel: 'Pixel Position', 'dither-b-pixel': 'Shifted Pixel' },
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
    labels: { bright: 'Bright Pass (ramp to white)', kernel: 'Tap Kernel & Level Weight', down: 'Pyramid Down (halve the light)',
      up: 'Pyramid Up (add levels back)', finish: 'Glow Resolve & Alpha' },
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
    // The 3.2.7 recipe (one 2D window, `tap-*`) shares this plan: its taps sit in Window Taps.
    labels: { scale: 'Line Width (sigma & window)', horizontal: 'Horizontal Pass (row brightness & x slope)', vertical: 'Vertical Pass (window sums)',
      window: 'Window Taps (premultiplied brightness)', gradient: 'Gradient & Edge Strength', finish: 'Line Color & Alpha' },
    portLabels: { sigma: 'Sigma (px)', reach: 'Reach (taps)', 'window-size': 'Window Size', 'tap-moment': 'Moments', edge: 'Edge', 'line-color': 'Line Color',
      'two-sigma': '2 Sigma (px)', 'reach-needed': 'Whole Taps', 'reach-covered': 'Covered Reach (taps)', 'tap-spacing': 'Tap Spacing (px)', 'tap-spacing-wide': '2 Sigma, at least 64 (px)',
      'tap-weight': 'Gaussian Weight', 'window-reduce:sum': 'Window Sums', 'vertical-reduce:sum': 'Window Sums',
      'horizontal-offset-px': 'Tap X (px)', 'vertical-offset-px': 'Tap Y (px)', 'horizontal-weight': 'Tap Weight', 'vertical-weight': 'Tap Weight',
      'horizontal-coverage': 'Tap Share', 'vertical-coverage': 'Tap Share', 'horizontal-luma': 'Premultiplied Brightness',
      'horizontal-moment': 'Row Moments', 'horizontal-average': 'Row Moments / Weight', 'horizontal-cache': 'Row Moments (cached)',
      'vertical-row': 'Cached Row', 'vertical-moment': 'Window Moments',
      'gradient-sums': 'Gradient (x, y)', vivid: 'Picture Colour (full brightness)', 'edge-premultiplied': 'Premultiplied Line + Background' },
    stage: ({ id }) => /^(pixel-scale|short-side|width-safe|sigma|two-sigma|reach|window-size|tap-spacing)/.test(id) ? 'scale'
      : /^horizontal-/.test(id) ? 'horizontal' : /^vertical-/.test(id) ? 'vertical'
        : /^(tap-|window-reduce|window-index)/.test(id) ? 'window'
          : /^(window-|gradient-(sums|length|normalized)|edge-contrast|edge-raw|edge-falloff|edge-negative|strength-safe|edge$)/.test(id) ? 'gradient' : 'finish',
  };
  if (['wave', 'twirl', 'bulge'].includes(type)) return {
    labels: { premultiply: 'Premultiplied Source (cached)', space: 'Centre, Shape & Radius', phase: 'Phase & Speed', edges: 'Frame Edges & Sampling',
      coordinates: type === 'wave' ? 'Wave Displacement' : type === 'twirl' ? 'Twirl Angle' : 'Bulge & Pinch Curve', finish: 'Straight Alpha Output' },
    portLabels: UV_DISTORT_PORTS,
    stage: ({ id }) => /^source-/.test(id) ? 'premultiply' : /^(result|coverage-floor)/.test(id) ? 'finish'
      : id === 'sample' || /^edge-/.test(id) ? 'edges'
      : id === 'one-vec2' ? (type === 'wave' ? 'edges' : 'space')
        : /^space-(moved-delta|sample-uv)$/.test(id) ? 'coordinates' : /^space-/.test(id) ? 'space'
          : /^phase(-|$)/.test(id) ? 'phase' : 'coordinates',
  };
  const mirrorPixel = mirrorPixelPresentationPlan(type) ?? acuarelaPresentationPlan(type) ?? rom1PresentationPlan(type);
  if (mirrorPixel) return mirrorPixel;
  if (COLOR_RECIPES.has(type)) return {
    labels: { processing: 'Color Processing', ...Object.fromEntries(COLOR_STAGES.map(([, stage, label]) => [stage, label])) },
    portLabels: COLOR_PORTS,
    inputLabels: { 'hue-lch-combine:x': 'Lightness', 'hue-lch-combine:y': 'Chroma', 'hue-lch-combine:z': 'Hue' },
    stage: ({ id }) => COLOR_STAGES.find(([pattern]) => pattern.test(id))?.[1] ?? 'processing',
  };
  // Threshold and Posterize name their hard step and soft ramp (Softness, 2026-10-21).
  if (COLORS.has(type)) return type === 'threshold' || type === 'posterize' ? { ...ORIGINAL_COLOR_PRESENTATION, portLabels: POINTWISE_PORTS } : ORIGINAL_COLOR_PRESENTATION;
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
