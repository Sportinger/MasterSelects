import type { BoundOperatorNode, EffectOperatorGraph } from '../../types/operatorGraph';
import { mirrorPixelPresentationPlan } from './mirrorPixelPresentation';
import { FILM_PRISM_SPECTRUM } from '../../effects/analog/filmPrismLimits';
import { createLegacyCrtScreenGraph } from './legacyCrtScreenGraph';
import { acuarelaPresentationPlan } from './acuarelaPresentation';

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
  /** Stages that get their folder even with a single card (a lone control still sits in Parameters). */
  singleCardStages?: readonly string[];
}
const includes = (list: string, id: string) => list.split(' ').includes(id);
/** A clamped parameter's output carries the parameter, not "Clamp: Value". */
const clampLabels = (labels: Record<string, string>) => Object.fromEntries(Object.entries(labels).map(([id, label]) => [`${id}-clamped`, label]));
export const GLYPH_PRESENTATION_EFFECTS = new Set(['ascii', 'number-field', 'grid-glyph', 'pixel-code', 'word-mosaic',
  'glyph-matrix', 'data-hatch', 'brand-generator', 'stitch-poster', 'dither-text', 'symbol-matrix', 'pixel-dither',
  'retro-matrix', 'capsule-cloud', 'ui-collage', 'matrix', 'ascii-ghost', 'inscribe', 'contour-type']);
/** Glyph looks that move with the playhead (Speed, Roll). */
const GLYPH_MOVING_EFFECTS = new Set(['glyph-matrix', 'data-hatch', 'dither-text', 'symbol-matrix', 'pixel-dither', 'retro-matrix',
  'capsule-cloud', 'ui-collage', 'matrix', 'ascii-ghost']);
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
  'spill-other-mean': 'Other Mean', 'spill-is-gentle': 'Is Gentle', 'spill-limit': 'Limit', 'spill-strength': 'Strength', 'spill-excess': 'Excess',
  // What crosses between the keyer's folders, so its overview reads as one path.
  'screen-rgb': 'Screen Color', 'screen-key-primary': 'Screen Level', 'screen-safe-difference': 'Difference', 'screen-purity': 'Screen Purity',
  'matte-source-split:alpha': 'Source Alpha', 'matte-source-positive': 'Source Color', 'matte-source-primary': 'Source Level', 'matte-clipped': 'Matte',
  'edge-source-alpha': 'Source Alpha', 'edge-negative-sharpness': '−Sharpness', 'edge-key-cache': 'Keyed Matte', 'edge-shrunk-cache': 'Shrunk Matte',
  'edge-matte': 'Edge Matte', 'spill-despilled': 'Despilled Color', 'spill-alpha': 'Alpha',
  // Short enough for the overview cards: the kernel sizes' operator names were cut off.
  'kernel-shrink-sigma': 'Sigma', 'kernel-shrink-side': 'Side Taps', 'kernel-shrink-stride': 'Stride',
  'kernel-shrink-count': 'Taps', 'kernel-soften-sigma': 'Sigma', 'kernel-soften-side': 'Side Taps', 'kernel-soften-stride': 'Stride',
  'kernel-soften-count': 'Taps', 'kernel-shrink-used': 'Shrink Used' };
// What crosses between the glyph engine's folders: the cell, its colour and tone, the glyph and its coverage.
const GLYPH_PORTS = { 'safe-cell': 'Cell Pixels', 'safe-cell-vec2': 'Cell Pixels (XY)', 'safe-cell-frame-scale': 'Frame Scale', grid: 'Cells Across',
  'scaled-uv': 'Grid Position', 'cell-id': 'Cell Number', 'local-uv': 'Position in Cell', luminance: 'Luminance', 'blackLevel-clamped': 'Black Level', 'sample-uv': 'Cell Center', 'source-split:rgb': 'Cell Color',
  'source-split:alpha': 'Cell Alpha', tone: 'Tone', 'glyph-index': 'Glyph Index', 'wrapped-index': 'Glyph Index', 'rolled-index': 'Glyph Index', 'safe-count': 'Glyph Count', 'atlas-split:w': 'Glyph Coverage',
  duotone: 'Duotone', ink: 'Ink', background: 'Dark Ground', 'background-lift': 'Ground', 'glyph-result': 'Glyph Cell', mixed: 'Faded Color',
  'mixed-alpha': 'Faded Alpha', 'original-premultiplied': 'Original Premultiplied', 'look-premultiplied': 'Glyph Premultiplied',
  'mixed-premultiplied': 'Faded Premultiplied', 'mixed-safe-alpha': 'Faded Alpha', 'original-alpha': 'Original Alpha', 'cell-alpha': 'Cell Alpha', 'original-split:rgb': 'Original Color', 'original-split:alpha': 'Original Alpha' };
/** Grid Glyph: the ruled lines on the cell borders and the coverage they leave for the ink. */
const GRID_LINE_PORTS = { 'grid-line-wanted': 'Wanted Line', 'grid-line-cap': 'Line Cap', 'grid-line-pixels': 'Line Pixels', 'grid-half-width': 'Half Line', 'grid-line-reach': 'Line Reach', 'grid-line-most': 'Most Coverage',
  'grid-local-pixels': 'Pixel in Cell', 'grid-from-line-x': 'From Line', 'grid-from-line-y': 'From Line', 'grid-line-distance-x': 'Distance Across', 'grid-line-distance-y': 'Distance Down', 'grid-cover-x': 'Column Line', 'grid-cover-y': 'Row Line',
  'grid-line': 'Line Coverage', 'grid-alpha': 'Ruled Coverage' };
/** Number Field: the colour step of every cell (Steps) and the flat colour it gives. */
const NUMBER_FIELD_PORTS = { 'tone-steps-rounded': 'Whole Steps', 'steps-clamped': 'Step Count', 'tone-steps-last': 'Last Step', 'quantized-tone-scaled': 'Tone × Steps',
  'quantized-tone-floor': 'Band', 'quantized-tone-band': 'Step Number', 'quantized-tone': 'Step Tone', 'number-ink': 'Step Color', 'background-coverage': 'Coverage', 'number-mark': 'Glyph Cell' };
/** Pixel Code: the random draw inside each cell's Scramble window, and its Shadow-to-Highlight ink. */
const PIXEL_CODE_PORTS = { 'glyph-index': 'Tone Glyph', 'index-cell-random': 'Cell Random', 'index-draw': 'Random × Window', 'index-offset': 'Draw',
  'index-window': 'Window', 'index-window-start': 'Window Start', 'shifted-index': 'Step', 'index-window-wrapped': 'Place in Window', 'rolled-index': 'Glyph Index',
  'index-roll-lit': 'Lit', 'index-roll-levelled': 'Black Level Set', 'index-roll-dark': 'Dark Scramble', 'index-roll-cell': 'Cell Scramble',
  'code-shadow-rgb': 'Shadow', 'code-highlight-rgb': 'Highlight', 'code-color': 'Code Color', 'background-coverage': 'Coverage', 'code-mark': 'Glyph Cell' };
/** Retro Matrix: its scroll, text, Phosphor ink and scanlines. */
const RETRO_PORTS = { 'scroll-rows': 'Scroll', 'scroll-turns': 'Turns', 'scroll-wrapped': 'Wrapped Scroll', 'scroll-vector': 'Scroll Offset', 'scrolled-uv': 'Scrolled Grid',
  'index-text-turns': 'Text Turns', 'index-text-line': 'Text Line', 'index-text-cell': 'Text Cell', 'index-text-random': 'Text Random',
  'retro-scan-scroll': 'Scroll Lines', 'retro-scan-scroll-phase': 'Scroll Phase', 'retro-scan-phase': 'Line Phase',
  'retro-phosphor-rgb': 'Phosphor', 'background-coverage': 'Coverage', 'retro-ink': 'Ink', 'retro-tone-amount': 'Brightness', 'retro-lit': 'Lit Ink', 'retro-scan-ratio': 'Lines per Row',
  'retro-scan-pitch': 'Line Pitch', 'retro-scan-lines': 'Lines', 'retro-scan-dip': 'Line Dip', 'retro-scan-fade': 'Line Fade', 'retro-scan-faded': 'Faded Dip',
  'retro-scan': 'Scanline', 'retro-scanned': 'Glyph Cell' };
/** Matrix Rain: its falling drops (Rain) and the lit rain ink. */
const MATRIX_RAIN_PORTS = { 'rain-ground-tone': 'Glow', 'background-tone': 'Background Glow', 'ground-a-centre': 'Tap',
  'ground-stretched': 'Stretched', 'rain-smooth-fade': 'Smooth Fade', 'rain-smooth-behind': 'Smooth Behind', 'rain-pixel-row': 'Pixel Row', 'ground-a-offset': 'Tap Offset', 'black-span': 'Black Span', 'half-vec2': 'Half Cell', 'rain-tone-curve': 'Tone²', 'rain-head-flash': 'Head Light', 'rain-head-shown': 'Head Shown', 'rain-head-light': 'Lit Head',
  'rain-lit-trail': 'Trail Light', 'ground-luminance': 'Soft Luminance', 'ground-tone': 'Soft Tone', 'ground-upper': 'Upper Pair', 'ground-lower': 'Lower Pair', 'rain-pace-random': 'Pace Random', 'rain-gap-random': 'Gap Random', 'rain-phase-random': 'Phase Random',
  'rain-rate': 'Fall Rate', 'rain-spacing': 'Drop Spacing', 'rain-fallen': 'Fallen', 'rain-ahead': 'Ahead', 'rain-drops': 'Drop Phase',
  'rain-drop-place': 'Drop Place', 'rain-behind': 'Behind', 'rain-trail-rows': 'Trail Rows', 'rain-tail': 'Tail', 'rain-fade': 'Fade', 'rain-head': 'Head',
  'rain-rgb': 'Rain Color', 'rain-white-rgb': 'White', 'rain-head-color': 'Head Color', 'rain-tone-light': 'Brightness', 'rain-light': 'Light', 'rain-glyph': 'Lit Glyph',
  'rain-ground-light': 'Ground Light', 'rain-ground': 'Ground', 'rain-lit': 'Glyph Cell' };
/** Effects whose folders come from their own graph (no presentation plan) can still name what outputs carry. */
const GRAPH_PORT_LABELS: Record<string, Record<string, string>> = {
  'slit-scan': { 'smooth-or-banded': 'Time Map', 'subject-protected': 'Protection', 'safe-delay': 'Delay (s)',
    'masked-delay': 'Protected Time', 'sample-delay': 'Delay per Pixel', 'centered-uv': 'Offset from Center',
    coordinate: 'Scan Position', linear: 'Linear Scan', 'out-from-center': 'Out from Center', 'radius-distance': 'Distance',
    'spatial-profile': 'Profile Time', 'protection-mask': 'Center Protection', 'time-map-mix-0': 'Field Time',
    'time-map-mix-1': 'Field Time', 'subject-clamp': 'Subject Mask', 'rgb-time-preview': 'Time Map Preview' },
  'time-stack': { 'decay-clamped': 'Decay', opacity: 'Opacity', delay: 'Delay', history: 'Past Frame' },
  // Fisheye Lens: what its folders hand on, so the overview reads as one path (fisheyeGraphPresentation.ts).
  fisheye: { 'sample-uv': 'Sample Position', 'lens-direction': 'Direction', 'sample-radius': 'Read Distance',
    'radius-half-safe': 'Lens Half Size', 'rotation-radians': 'Lens Rotation (rad)', 'frame-aspect': 'Frame Aspect',
    center: 'Lens Centre', 'lens-position-radius': 'Distance from Centre', 'edge-mode-select': 'Frame with Edges',
    'source-premultiplied': 'Premultiplied Source', 'chroma-select': 'Lens Colour', result: 'Fisheye Image' },
};

/** Names of what outputs carry (node id or `id:port`) for an effect's graph: card outputs and folder ports show them. */
export function effectPortLabels(type: string): Record<string, string> | undefined {
  return effectPresentationPlan(type)?.portLabels ?? GRAPH_PORT_LABELS[type];
}

const GLOW_PORTS: Record<string, string> = { 'source-split:rgb': 'Source Color', 'source-alpha': 'Source Alpha', 'bright-cache': 'Bright Light',
  'tap-weight': 'Tap Weight', 'up-uv': 'Up Read Position', 'down-uv': 'Down Read Position', 'level-weight': 'Level Weight',
  'top-level-weight': 'Top Level Weight', 'glow-core-weight': 'Level 0 Weight', 'glow-light': 'Glow Light', 'glow-amount': 'Glow Amount', 'glow-tinted': 'Tinted Glow', 'color-rgb': 'Glow Color', 'glow-scaled': 'Glow',
  'resolve-premultiplied': 'Premultiplied Source', 'glow-negative': '−Glow', 'euler-rgb': 'e', 'one-rgb': 'One', 'resolve-falloff': 'exp(−Glow)',
  'resolve-room': 'Room (1 − Picture)', 'resolve-remaining': 'Room × exp(−Glow)', 'resolve-result': 'Picture screened with Glow',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [[`down-${index + 1}-cache`, `Level ${index + 1} (1/${2 ** (index + 1)} size)`],
    [`up-${index + 1}-cache`, `Levels ${index + 1}+ Added`]]).flat()) };
// Threshold and Posterize: the hard step and the soft ramp that Softness blends in.
const POINTWISE_PORTS = { compare: 'Above Level', hard: 'Hard Step', ramp: 'Soft Ramp', soft: 'Softness On', smooth: 'Soft Steps', steps: 'Steps' };
/** Invert has no clamp (1 − x stays within 0 to 1), so its folders name what they do, and its three
 * Subtract outputs say which channel they carry instead of reading "Subtract: Value" three times. */
/** The Invert recipe's White Level and its three Subtract cards, under their recipe ids and operators. */
function isInvertRecipeNodes(nodes: Pick<EffectOperatorGraph, 'nodes'>['nodes']): boolean {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const one = byId.get('one');
  return one?.operator === 'values.number' && one.constants?.value === 1
    && ['invert-r', 'invert-g', 'invert-b'].every(id => byId.get(id)?.operator === 'math.subtract.scalar');
}
const INVERT_PRESENTATION: EffectPresentationPlan = {
  labels: { processing: 'Invert RGB', finish: 'Alpha & Image' },
  stage: ORIGINAL_COLOR_PRESENTATION.stage,
  portLabels: { one: 'White Level', 'invert-r': 'Inverted R', 'invert-g': 'Inverted G', 'invert-b': 'Inverted B' },
  // Free Node Graphs share the 'invert' type and take node ids the agent picks: label only the recipe's own cards.
  portLabelsApply: graph => isInvertRecipeNodes(graph.nodes),
};

/** Posterize (v2 recipe): its 30-odd cards read as a path of stages instead of one Color Processing
 * folder: the Levels/Softness/Brightness Only guards sit with their controls, then what gets stepped,
 * the hard staircase, the Softness ramp, the spread back to 0-1 and the colour kept by Brightness Only. */
const POSTERIZE_STAGES: readonly [RegExp, string][] = [
  [/^(effective-levels|ramp-width|brightness-only-share)$/, 'controls'], [/^(brightness|brightness-rgb|posterize-input)$/, 'input'],
  [/^(scaled|hard)$/, 'hard'], [/^(denominator|divide|clamped)$/, 'spread'],
  [/^(posterized-brightness|brightness-safe|brightness-gain|kept-colour(-raw)?|result-rgb|combine)$/, 'finish'],
];
const POSTERIZE_PRESENTATION: EffectPresentationPlan = {
  labels: { input: 'Step Input', hard: 'Hard Steps', soft: 'Soft Steps', spread: 'Spread to 0–1', finish: 'Colour & Alpha' },
  stage: ({ id }) => POSTERIZE_STAGES.find(([pattern]) => pattern.test(id))?.[1] ?? 'soft',
  portLabels: { ...POINTWISE_PORTS, 'effective-levels': 'Levels', 'ramp-width': 'Ramp Width', 'brightness-only-share': 'Brightness Only',
    brightness: 'Brightness', 'posterize-input': 'Step Input', scaled: 'Scaled', clamped: 'Posterized RGB', 'brightness-gain': 'Brightness Gain',
    'kept-colour': 'Kept Colour', 'half-rgb': 'Half', 'two-rgb': 'Two', 'three-rgb': 'Three', base: 'Lower Step', within: 'Within Step', 'ramp-clamped': 'Ramp Position' },
};

/** Threshold (v2 recipe): instead of one Color Processing folder and a "Clamp & Alpha" it has no Clamp
 * for, its cards read as stages: the brightness, the hard cut at Level, the Softness ramp around it,
 * and the pick between them turned back into a black-and-white picture with the transparency. */
const THRESHOLD_STAGES: readonly [RegExp, string][] = [
  [/^ramp-width$/, 'controls'], [/^luma$/, 'brightness'], [/^(compare|hard)$/, 'hard'],
  [/^(value|result-rgb|combine)$/, 'finish'],
];
const THRESHOLD_PRESENTATION: EffectPresentationPlan = {
  labels: { brightness: 'Brightness', hard: 'Hard Edge', soft: 'Soft Edge', finish: 'Black & White' },
  stage: ({ id }) => THRESHOLD_STAGES.find(([pattern]) => pattern.test(id))?.[1] ?? 'soft',
  // The brightness is one card, but it is the stage both edges read.
  singleCardStages: ['brightness'],
  portLabels: { ...POINTWISE_PORTS, luma: 'Brightness', 'ramp-width': 'Ramp Width', 'ramp-distance': 'Distance',
    'ramp-clamped': 'Ramp Position', value: 'Black & White', 'result-rgb': 'Threshold RGB' },
};

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

/** Riso's folders (createRisoPrintGraph), shared by Riso Glow's print. */
const RISO_PLAN: EffectPresentationPlan = {
  labels: { inks: 'Paper & Inks', screen: 'Screens (Dot Size, Registration)', filter: 'Cell Filter', cell: 'Cell Colour', separation: 'Separation',
    tone: 'Tone', dot: 'Dots', finish: 'Print & Mix (Amount)' },
  portLabels: { 'scale-clamped': 'Registration', 'scale-clamped-frame-pixels': 'Registration (px)', 'dotSize-clamped': 'Dot Size', slip: 'Slip (px)', 'dark-layer': 'Dark Drum (px)', 'warm-layer': 'Warm Drum (px)',
    'frame-center': 'Frame Centre (px)', 'paper-linear': 'Paper Light', 'paper-luma': 'Paper Brightness', 'dark-ink-linear': 'Dark Ink Light',
    'warm-ink-linear': 'Warm Ink Light', 'dark-ink-absorbs': 'Dark Ink Takes', 'warm-ink-absorbs': 'Warm Ink Takes',
    'dark-ink-absorbed': 'Dark Ink Takes (brightness)', 'warm-ink-absorbed': 'Warm Ink Takes (brightness)', 'both-absorbed': 'Both Inks Take (brightness)',
    'fit-dark-dark': 'Dark · Dark', 'fit-warm-warm': 'Warm · Warm', 'fit-dark-warm': 'Dark · Warm', 'fit-determinant': 'Determinant',
    'dotSize-clamped-pixels': 'Dot Size (px)', 'edge-width': 'Half Edge (cells)', 'tap-reach': 'Quarter Cell (px)', 'half-vec2': 'Half (0.5, 0.5)',
    'dark-cells': 'Dark Position in Cells', 'warm-cells': 'Warm Position in Cells', 'dark-place': 'Dark Place in Cell', 'warm-place': 'Warm Place in Cell',
    'dark-cell-center': 'Dark Cell Centre (px)', 'warm-cell-center': 'Warm Cell Centre (px)', 'dark-cell-colour': 'Dark Cell Colour', 'warm-cell-colour': 'Warm Cell Colour',
    'dark-cell-absorbs': 'Dark Cell Takes', 'warm-cell-absorbs': 'Warm Cell Takes', 'dark-towards-dark': 'Cell · Dark Ink', 'dark-towards-warm': 'Cell · Warm Ink',
    'warm-towards-dark': 'Cell · Dark Ink', 'warm-towards-warm': 'Cell · Warm Ink', 'dark-free': 'Free Dark Share', 'warm-free': 'Free Warm Share',
    'dark-first': 'First Dark Share', 'warm-first': 'First Warm Share',
    'dark-share': 'Dark Share', 'dark-other-share': 'Warm Share (Dark Cell)', 'warm-share': 'Warm Share', 'warm-other-share': 'Dark Share (Warm Cell)',
    'dark-tone-scale': 'Dark Tone Scale', 'warm-tone-scale': 'Warm Tone Scale', 'dark-other-coverage': 'Warm Coverage (Dark Cell)',
    'warm-other-coverage': 'Dark Coverage (Warm Cell)', 'dark-coverage': 'Dark Coverage', 'warm-coverage': 'Warm Coverage',
    'dark-mark': 'Dark Dots', 'warm-mark': 'Warm Dots', printed: 'Print', 'sample-split:rgb': 'Pixel RGB', 'sample-split:alpha': 'Pixel Alpha',
    'min-uv': 'Lowest UV', 'max-uv': 'Highest UV', 'one-rgb': 'One (RGB)', 'zero-rgb': 'Zero (RGB)', 'dark-radians': 'Dark Angle (rad)', 'warm-radians': 'Warm Angle (rad)',
    'dark-ink-absorbed-rgb': 'Dark Ink Takes from Paper', 'warm-ink-absorbed-rgb': 'Warm Ink Takes from Paper', 'cell-filter': 'Cell Filter (cached)', 'cell-filter-rows': 'Row Average (cached)', 'cell-filter-width': 'Box Width (px)', 'cell-filter-taps': 'Reads per Row', 'cell-filter-srgb': 'Average Colour' },
  portLabelsApply: graph => graph.nodes.some(node => node.id === 'dark-share'),
  stage: ({ id }) => /^cell-filter/.test(id) ? 'filter'
    : /^(paper|paper-vector|paper-linear|paper-luma|paper-dark-absorbs|one-rgb|zero-rgb|color-[ab]-rgb)$|^both-absorbed|^(dark|warm)-ink-/.test(id) ? 'inks'
      : /^fit-|^(dark|warm)-(paper-ratio|cell-absorbs|towards-|free|first$|other-share|share)/.test(id) ? 'separation'
        : /^(dark|warm)-(cell-luma$|tone-|other-coverage|other-takes$|other-overlap$|coverage$|coverage-(raw|left|reach)$)/.test(id) ? 'tone'
          : /^(dark|warm)-(dot-|paper-left$|paper-root$|paper-gap$|dots-touch$|radius|coverage-(twice|signed)$|edge|distance$|mark$)/.test(id) ? 'dot'
            : /^tap-reach$|^(dark|warm)-(back-radians|cell-center|cell-index|tap-|paper-light|cell-colour)/.test(id) ? 'cell'
              : /^(dark-filter|warm-filter|paper-dark|printed-linear|printed|mixed-color|combine|sample|sample-split|clamped-uv)$/.test(id) ? 'finish' : 'screen',
};

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
  // Halftone (createDefaultHalftoneGraph): the turned dot screen, the light of each cell, the round dot, ink and paper.
  if (type === 'halftone') return {
    labels: { screen: 'Screen (Dot Size, Angle)', filter: 'Cell Filter', tone: 'Cell Tone', dot: 'Dot', finish: 'Ink & Paper (Amount)' },
    portLabels: { 'screen-pixel': 'Screen Position (px)', cell: 'Place in Cell', 'edge-width': 'Half Edge (cells)', 'cell-center-uv': 'Cell Centre',
      'tap-diagonal': 'Quarter Diagonal', 'tap-anti-diagonal': 'Quarter Anti-diagonal', tone: 'Cell Light', darkness: 'Ink Share', radius: 'Radius',
      'dot-radius': 'Dot Radius', mark: 'Dot Mask', 'ink-color': 'Print', 'safe-scale-pixels': 'Dot Size (px)', 'angle-radians': 'Angle (rad)',
      'half-vec2': 'Half (0.5, 0.5)', 'frame-center': 'Frame Centre (px)', 'cell-divided': 'Position in Cells', 'sample-split:rgb': 'Pixel RGB', 'sample-split:alpha': 'Pixel Alpha',
      'cell-filter': 'Cell Filter (cached)', 'cell-filter-rows': 'Row Average (cached)', 'cell-filter-width': 'Box Width (px)', 'cell-filter-taps': 'Reads per Row', 'cell-filter-srgb': 'Average Colour' },
    stage: ({ id }) => /^cell-filter/.test(id) ? 'filter' : /^(cell-index|cell-center|back-radians|tap-|own-|cell-alpha$|tone$|sample$|sample-split$|clamped-uv$|min-uv$|max-uv$|shared-)/.test(id) ? 'tone'
      : /^(darkness|inverse-tone|dot-|paper-|dots-touch$|radius|edge-low$|edge-high$|distance$|edge$|mark$)/.test(id) ? 'dot'
        : /^(color-a-rgb|color-b-rgb|ink-color|mixed-color|combine)$/.test(id) ? 'finish' : 'screen',
  };
  // Riso (createRisoPrintGraph): paper and inks, each ink's slipped and turned dot screen, the colour of its cells, the
  // split between the inks, the tone that keeps the brightness, the round dots and the print. Each folder holds the dark
  // ink's nodes and the warm ink's; stages only feed later ones.
  if (type === 'riso') return RISO_PLAN;
  // Riso Glow (createRisoGlowGraph): Riso's six print folders, then the print cached with the glow ink's share, that share
  // gathered from the window around each pixel, the pulse, and the glow screened onto the print.
  if (type === 'riso-glow') return {
    labels: { ...RISO_PLAN.labels, print: 'Print & Glow Share', spill: 'Glow Spill', pulse: 'Pulse (Glow, Speed)', finish: 'Glow & Mix (Amount)' },
    // Its inks are the Shadow Ink and the Glow Ink (Riso's Dark and Warm Ink).
    portLabels: { ...Object.fromEntries(Object.entries(RISO_PLAN.portLabels ?? {}).map(([id, label]) => [id, label.replace(/\bDark\b/gu, 'Shadow').replace(/\bWarm\b/gu, 'Glow')])),
      pixel: 'Pixel (px)', 'glow-visible': 'Glow Share', 'glow-share': 'Glowing Part', 'glow-cache': 'Print + Glow Share (cached)', 'glow-cached-split:rgb': 'Print',
      'glow-tap': 'Tap (taps)', 'glow-tap-weight': 'Tap Weight', 'glow-step': 'Tap Step (px)', 'glow-tap-pixels': 'Tap Position (px)',
      'glow-field': 'Gathered Share', 'glow-light': 'Glow Light', pulse: 'Pulse', 'glow-strength': 'Strength', 'glow-keep': 'Dark Kept',
      'glowing-linear': 'Glowing Print', ...clampLabels({ glow: 'Glow' }) },
    portLabelsApply: graph => graph.nodes.some(node => node.id === 'glow-cache'),
    stage: node => /^(dark-filter|warm-filter|paper-dark|printed-linear|glow-visible|glow-uncovered|glow-visible-alpha|glow-print|glow-cache|glow-share|glow-paper-share|glow-own-alpha|glow-open|sample|sample-split|clamped-uv)$/.test(node.id) ? 'print'
      : /^(glow-window|glow-centre-tap|glow-index|glow-kernel|glow-tap|glow-step|glow-last-centre|glow-gather|glow-sums|glow-field|glow-light)/.test(node.id) ? 'spill'
        : /^(time|speed|pulse|glow|glow-clamped|glow-strength|glow-pulse-gain|glow-gain)$|^pulse-/.test(node.id) ? 'pulse'
          : /^(glow-cached|glow-fade|glow-negative|glow-keep|glow-print-dark|glow-dark-kept|glowing-linear)/.test(node.id) ? 'finish'
            : RISO_PLAN.stage(node),
  };
  // Dithering (createDefaultDitheringGraph): the big pixels, each cell's colour, its two nearest steps, the Bayer step, the mix.
  if (type === 'dither') return {
    labels: { grid: 'Pixel Grid (Pixel Size)', filter: 'Cell Filter', cell: 'Cell Colour', levels: 'Levels', dither: 'Dither', finish: 'Mix (Amount)' },
    portLabels: { cells: 'Cell Position', 'cell-center-pixels': 'Cell Centre (px)', 'tap-reach': 'Reach (px)', 'safe-scale-pixels': 'Pixel Size (px)',
      'tap-diagonal': 'Diagonal', 'tap-anti-diagonal': 'Anti-diagonal', 'cell-light': 'Cell Light', 'sample-split:rgb': 'Pixel RGB',
      'sample-split:alpha': 'Pixel Alpha', 'levels-clamped': 'Levels', steps: 'Steps', 'level-lower': 'Lower Step', 'step-lower': 'Lower Step (sRGB)',
      'step-upper': 'Upper Step (sRGB)', 'step-lower-linear': 'Lower Light', 'step-upper-linear': 'Upper Light', 'step-span': 'Step Span',
      share: 'Upper Share', threshold: 'Bayer Threshold', 'step-up': 'Step Up', 'level-index': 'Step', dithered: 'Dithered RGB',
      'tap-4-alpha-sum': 'Alpha of All Points', 'tap-4-light-sum': 'Light of All Points', 'cell-average': 'Average Light', 'no-reads': 'All Transparent',
      'cell-filter': 'Cell Filter (cached)', 'cell-filter-rows': 'Row Average (cached)', 'cell-filter-width': 'Box Width (px)', 'cell-filter-taps': 'Reads per Row', 'cell-filter-srgb': 'Average Colour' },
    portLabelsApply: graph => graph.nodes.some(node => node.id === 'share'),
    stage: ({ id }) => /^cell-filter/.test(id) ? 'filter' : /^(sample|sample-split|clamped-uv|min-uv|max-uv|cell-size-less-one|cell-average|cell-alpha|no-reads|own-linear|cell-picked|cell-light)$|^tap-/.test(id) ? 'cell'
      : /^(levels-clamped|steps|cell-srgb|level-position|level-lower|level-upper|one-rgb|span-floor|above-lower|share)$|^step-(lower|upper|span)/.test(id) ? 'levels'
        : /^(threshold|threshold-rgb|share-raised|step-up|level-index|dithered-raw|dithered)$/.test(id) ? 'dither'
          : /^(mixed-color|combine)$/.test(id) ? 'finish' : 'grid',
  };
  // Paper Print (createDefaultPaperPrintGraph): the turned grain, evened out to a threshold, each pixel's share of ink,
  // the paper's surface, the width of the ink's soft edge, ink over paper where the share beats the threshold, the mix.
  if (type === 'paper-print') return {
    labels: { grain: 'Grain (Grain Size)', even: 'Even Out', share: 'Ink Share', surface: 'Paper Surface (Texture)', edge: 'Ink Edge', print: 'Print',
      finish: 'Mix (Amount)' },
    portLabels: { pixel: 'Pixel (px)', 'frame-scale': 'Frame Scale', 'scale-clamped-pixels': 'Grain Size (px)', 'grain-turned': 'Turned Pixel (px)', 'grain-position': 'Position in Grains',
      'grain-noise': 'Grain Noise', 'grain-centred': 'Noise − 0.5', threshold: 'Threshold', 'sample-split:rgb': 'Pixel RGB', 'sample-split:alpha': 'Pixel Alpha',
      'min-uv': 'Lowest UV', 'max-uv': 'Highest UV', 'ink-rgb': 'Ink RGB', 'paper-rgb': 'Paper RGB', 'ink-linear': 'Ink Light', 'paper-linear': 'Paper Light',
      'picture-light': 'Picture Brightness', 'ink-light': 'Ink Brightness', 'paper-light': 'Paper Brightness', 'light-span': 'Paper − Ink',
      'safe-span': 'Safe Span', 'ink-share': 'Ink Share', 'texture-size-frame-pixels': 'Bump Size (px)', 'surface-noise': 'Paper Height',
      'surface-centred': 'Height − 0.5', 'valley-depth': 'Valley Depth', 'valley-lift': 'Valley Lift', 'surface-shade': 'Paper Shade',
      'threshold-lifted': 'Lifted Threshold', 'edge-width': 'One Pixel (threshold)', 'edge-fitted': 'Edge Width', 'ink-coverage': 'Ink Coverage',
      'printed-linear': 'Print Light', printed: 'Print', ...clampLabels({ texture: 'Texture' }) },
    portLabelsApply: graph => graph.nodes.some(node => node.id === 'ink-coverage'),
    stage: ({ id }) => /^(grain-centred|grain-square|grain-cube|threshold)$|^even-/.test(id) ? 'even'
      : /^(sample|sample-split|clamped-uv|min-uv|max-uv|ink-rgb|paper-rgb|ink-linear|paper-linear|picture-linear|picture-light|ink-light|paper-light|safe-span|paper-brighter|light-missing)$|^(light-span|span-|ink-share)/.test(id) ? 'share'
        : /^(texture-|surface-|valley-)/.test(id) ? 'surface'
          : /^(share-rest|share-nearest-end)$|^edge-/.test(id) ? 'edge'
            : /^(threshold-lifted|share-over-threshold|share-above|ink-centred|ink-coverage)$|^printed/.test(id) ? 'print'
            : /^(mixed|combine)$/.test(id) ? 'finish' : 'grain',
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
    labels: { bright: 'Bright Pass (ramp to white)', kernel: 'Tap Kernel & Level Weight', down: 'Pyramid: Halve the Light',
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
    labels: { premultiply: 'Premultiplied Source (cached)', space: 'Centre, Shape & Radius', phase: 'Phase & Speed', edges: 'Frame Edges & Sampling',
      coordinates: type === 'wave' ? 'Wave Displacement' : type === 'twirl' ? 'Twirl Angle' : 'Bulge & Pinch Curve', finish: 'Straight Alpha Output' },
    portLabels: UV_DISTORT_PORTS,
    stage: ({ id }) => /^source-/.test(id) ? 'premultiply' : /^(result|coverage-floor)/.test(id) ? 'finish'
      : id === 'sample' || /^edge-/.test(id) ? 'edges'
      : id === 'one-vec2' ? (type === 'wave' ? 'edges' : 'space')
        : /^space-(moved-delta|sample-uv)$/.test(id) ? 'coordinates' : /^space-/.test(id) ? 'space'
          : /^phase(-|$)/.test(id) ? 'phase' : 'coordinates',
  };
  const mirrorPixel = mirrorPixelPresentationPlan(type) ?? acuarelaPresentationPlan(type);
  if (mirrorPixel) return mirrorPixel;
  if (COLOR_RECIPES.has(type)) return {
    labels: { processing: 'Color Processing', ...Object.fromEntries(COLOR_STAGES.map(([, stage, label]) => [stage, label])) },
    portLabels: COLOR_PORTS,
    inputLabels: { 'hue-lch-combine:x': 'Lightness', 'hue-lch-combine:y': 'Chroma', 'hue-lch-combine:z': 'Hue' },
    // Hue Shift's only control (it wraps instead of clamping) sits in Parameters like every colour recipe's.
    singleCardStages: ['controls'],
    stage: ({ id }) => COLOR_STAGES.find(([pattern]) => pattern.test(id))?.[1] ?? 'processing',
  };
  // Threshold and Posterize (Softness, 2026-10-21) have stage folders; Invert names its own.
  if (type === 'invert') return INVERT_PRESENTATION;
  if (type === 'posterize') return POSTERIZE_PRESENTATION;
  if (type === 'threshold') return THRESHOLD_PRESENTATION;
  if (COLORS.has(type)) return ORIGINAL_COLOR_PRESENTATION;
  // The moving looks split the glyph choice into Glyph Offset (how far each cell has moved on through
  // the ramp right now) and Roll Window (the part of the ramp it may move through, Roll); Symbol Matrix's
  // brightness pulse has a folder of its own (Pulse).
  if (GLYPH_PRESENTATION_EFFECTS.has(type) && GLYPH_MOVING_EFFECTS.has(type)) {
    const glyph = glyphPresentation();
    return { ...glyph, labels: { ...glyph.labels, offset: 'Glyph Offset', roll: 'Roll Window', pulse: 'Pulse', scroll: 'Scroll', scanlines: 'Scanlines', rain: 'Rain', glow: 'Glow' },
      portLabels: { ...GLYPH_PORTS, 'glyph-index': 'Tone Glyph', 'index-offset': 'Glyph Offset', 'index-time-speed': 'Clock', 'index-time-phase': 'Ticks',
        'index-sweep': 'Sweep', 'index-window': 'Window', 'index-window-start': 'Window Start', 'shifted-index': 'Step', 'index-window-wrapped': 'Place in Window',
        'index-cell-random': 'Cell Random', 'index-tick': 'Cell Tick', 'index-jitter': 'Draw', 'symbol-pulse': 'Pulse', 'symbol-alpha': 'Pulsed Coverage',
        'index-roll-lit': 'Lit', 'index-roll-levelled': 'Black Level Set', 'index-roll-dark': 'Dark Roll', 'index-roll-cell': 'Cell Roll',
        'symbol-pulse-scale': 'Half Twinkle', 'symbol-pulse-base': 'Pulse Base',
        ...(type === 'retro-matrix' ? RETRO_PORTS : {}), ...(type === 'matrix' ? MATRIX_RAIN_PORTS : {}) },
      stage: (node) => type === 'retro-matrix' && /^(index-(time-rate|speed-travel|travel-|time-speed)|scroll-)/.test(node.id) ? 'scroll'
        // Matrix Rain: the clock and the drops of each column (Rain); the rain's colour and light stay in Ink & Appearance.
        : type === 'matrix' && /^(index-(time-rate|speed-travel|travel-|time-speed)|trail-clamped$|rain-(cell|pace|gap|phase|rate|spacing|fallen|ahead|lag|drops|drop-place|behind|trail|tail|fade|head$|head-left|pixel|smooth))/.test(node.id) ? 'rain'
        // Matrix Rain: the smooth glow of the picture behind the code (Background) has a folder of its own, Glow; it hands its
        // strength to Ink & Appearance, which colours it (Ground), so no cable runs back between the two folders.
        : type === 'matrix' && /^(ground-|rain-ground-|background-(tone|clamped)$)/.test(node.id) ? 'glow'
        : type === 'retro-matrix' && /^(scrolled-uv|sample-unscrolled)$/.test(node.id) ? 'grid'
        : /^(scanlines-clamped$|retro-scan(?!ned))/.test(node.id) ? 'scanlines'
        : /^(roll-clamped$|rolled-index$|shifted-index$|index-(roll|window|in-window|ratio|cycles|wrap))/.test(node.id) ? 'roll'
        : /^(index-|cell-id-split$)/.test(node.id) ? 'offset' : /^(symbol-|twinkle-clamped$)/.test(node.id) ? 'pulse' : glyph.stage(node) };
  }
  // Grid Glyph: its ruled lines (Line Width, Line Glow) have a folder of their own, Grid Lines.
  if (type === 'grid-glyph') {
    const glyph = glyphPresentation();
    return { ...glyph, labels: { ...glyph.labels, lines: 'Grid Lines' }, portLabels: { ...GLYPH_PORTS, ...GRID_LINE_PORTS },
      stage: (node) => /^(grid-|lineWidth-clamped$|lineGlow-clamped$)/.test(node.id) ? 'lines' : glyph.stage(node) };
  }
  // Number Field: its colour steps (Steps) have a folder of their own, Color Steps.
  if (type === 'number-field') {
    const glyph = glyphPresentation();
    return { ...glyph, labels: { ...glyph.labels, steps: 'Color Steps' }, portLabels: { ...GLYPH_PORTS, ...NUMBER_FIELD_PORTS },
      stage: (node) => /^(tone-steps|steps-clamped$|quantized-tone)/.test(node.id) ? 'steps' : glyph.stage(node) };
  }
  // Pixel Code: the random draw inside each cell's window (Scramble) has a folder of its own, Scramble.
  if (type === 'pixel-code') {
    const glyph = glyphPresentation();
    return { ...glyph, labels: { ...glyph.labels, scramble: 'Scramble' }, portLabels: { ...GLYPH_PORTS, ...PIXEL_CODE_PORTS },
      stage: (node) => /^(scramble-clamped$|rolled-index$|shifted-index$|index-)/.test(node.id) ? 'scramble' : glyph.stage(node) };
  }
  if (GLYPH_PRESENTATION_EFFECTS.has(type)) return glyphPresentation();
  return undefined;
}

function glyphPresentation(): EffectPresentationPlan {
  return {
    labels: { grid: 'Cell Grid', source: 'Cell Sampling & Tone', index: 'Glyph Selection', atlas: 'Atlas Sampling', appearance: 'Ink & Appearance', feedback: 'Feedback Resolve' },
    portLabels: GLYPH_PORTS,
    stage: ({ id }) => /^(tiny-vec2|almost-vec2)$/.test(id) ? 'sources'
      : /^(ghost-current|ghost-history|ghost-resolved|ghost-faded|ghost-max|ghost-image|ghost-decay)/.test(id) ? 'feedback'
      : /^(cellSize-clamped$|safe-cell|grid$|scaled-uv|cell-id$|local-uv|half-vec2|sample-pixel|sample-uv$)/.test(id) ? 'grid'
        : /^(clamped-source|source-sample|source-split|tone$|luminance$|black-|blackLevel-clamped$)/.test(id) ? 'source'
          : /^(inverse-tone|mapped-tone|clamped-tone|safe-count|glyph-scaled|glyph-index|index-|shifted-index|wrapped-index|rolled-index$|roll-clamped$|cell-id-split|word-phase|word-index|brand-centered|brand-radius|brand-index|uv-split|contour-current|contour-index)/.test(id) ? 'index'
            : /^(safe-columns|safe-rows|column-ratio|atlas-|row-width|clamped-local)/.test(id) ? 'atlas' : 'appearance',
  };
}
