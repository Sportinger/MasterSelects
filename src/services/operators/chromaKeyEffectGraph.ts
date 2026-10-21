import type { EffectOperatorGraph } from '../../types/operatorGraph';
import {
  CHROMA_KEY_BLUE_PRIOR, CHROMA_KEY_DARK_FLOOR, CHROMA_KEY_FULL_SCREEN_PURITY, CHROMA_KEY_GAUSSIAN_MAX_TAPS_PER_SIDE,
  CHROMA_KEY_GAUSSIAN_REACH_SIGMAS, CHROMA_KEY_GREEN_PRIOR, CHROMA_KEY_LOCAL_PRIOR_WEIGHT, CHROMA_KEY_LOCAL_PURITY_TRUST, CHROMA_KEY_MAX_EDGE_PX, CHROMA_KEY_UNMIX_TRUST, CHROMA_KEY_MIN_SCREEN_PURITY, CHROMA_KEY_PRIOR_WEIGHT,
  CHROMA_KEY_SHRINK_REACH_SIGMAS, CHROMA_KEY_SHRINK_SHARPNESS, CHROMA_KEY_SHRINK_SIGMA_DIVISOR, CHROMA_KEY_SOFTNESS_SIGMA_DIVISOR,
  CHROMA_KEY_REFERENCE_HEIGHT, CHROMA_KEY_SCREEN_AVERAGE_EXTENT, CHROMA_KEY_SCREEN_CELL_EXTENT, CHROMA_KEY_SCREEN_COVERAGE,
  CHROMA_KEY_SCREEN_GRID_EDGE, CHROMA_KEY_SCREEN_WEIGHT_LEVEL, CHROMA_KEY_SCREEN_WEIGHT_PURITY,
} from '../../effects/keying/chroma-key/keyerContract';
import { BlurGraphBuilder, type GraphPort } from './blurGraphBuilder';

/**
 * Chroma Key screen matte (contract: effects/keying/chroma-key/keyerContract.ts), three passes:
 * 1. Screen Grid: a 64 px grid; each cell averages 5x5 reads weighted by how screen-like they are.
 * 2. Screen Color: one texel, the weighted average of the grid (the automatic screen colour).
 * 3. Key: per pixel screen matte, Clip Black/White, Edge Softness and Shrink/Grow over a 7x7
 *    kernel (one read while both are 0), spill suppression and the View choice.
 * Node ids carry their stage prefix (screen-, matte-, edge-, spill-, view-) for the folders.
 */
export function createDefaultChromaKeyGraph(): EffectOperatorGraph {
  const g = new BlurGraphBuilder();
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution');
  for (const [id, value] of [['zero', 0], ['one', 1], ['half', .5], ['tiny', 1e-4]] as const) g.number(id, value);

  // Parameters.
  g.bound('key-color', 'keyColor', 'values.choice');
  g.bound('screen-color', 'screenColor', 'values.color');
  g.bound('clip-black', 'clipBlack'); g.bound('clip-white', 'clipWhite');
  g.bound('spill-suppression', 'spillSuppression'); g.bound('spill-method', 'spillMethod', 'values.choice');
  g.bound('edge-softness', 'edgeSoftness'); g.bound('edge-shrink', 'edgeShrink');
  g.bound('view', 'view', 'values.choice');

  // Screen channel: Green screen, Blue screen, or the strongest channel of the picked colour.
  g.number('screen-custom-threshold', 1.5);
  const isCustom = g.add('screen-is-custom', 'math.step.scalar', { edge: 'screen-custom-threshold', value: 'key-color' });
  const isBlueOrCustom = g.add('screen-is-blue-or-custom', 'math.step.scalar', { edge: 'half', value: 'key-color' });
  const isBlue = g.binary('screen-is-blue', 'math.subtract.scalar', isBlueOrCustom, isCustom);
  const picked = g.add('screen-picked-rgb', 'convert.vec4-to-rgb', { value: 'screen-color' });
  const pickedChannels = g.add('screen-picked-channels', 'vector.split.vec4', { value: 'screen-color' });
  const pickedRedBlue = g.binary('screen-picked-red-blue', 'math.max.scalar', [pickedChannels, 'x'], [pickedChannels, 'z']);
  const pickedGreen = g.add('screen-picked-is-green', 'math.step.scalar', { edge: pickedRedBlue, value: [pickedChannels, 'y'] });
  const pickedBlueOverRed = g.add('screen-picked-blue-over-red', 'math.step.scalar', { edge: [pickedChannels, 'x'], value: [pickedChannels, 'z'] });
  const pickedNotGreen = g.binary('screen-picked-not-green', 'math.subtract.scalar', 'one', pickedGreen);
  const pickedBlue = g.binary('screen-picked-is-blue', 'math.multiply.scalar', pickedNotGreen, pickedBlueOverRed);
  const pickedRed = g.binary('screen-picked-is-red', 'math.subtract.scalar', pickedNotGreen, pickedBlue);
  const pickedMask = g.add('screen-picked-channel', 'vector.combine.vec3', { x: pickedRed, y: pickedGreen, z: pickedBlue });
  const rgbConstant = (id: string, [r, gg, b]: readonly number[]) => {
    g.number(`${id}-r`, r); g.number(`${id}-g`, gg); g.number(`${id}-b`, b);
    return [g.add(id, 'convert.vec3-to-rgb', { value: g.add(`${id}-vec3`, 'vector.combine.vec3', { x: `${id}-r`, y: `${id}-g`, z: `${id}-b` }) }), 'rgb'] as const;
  };
  const greenMask = rgbConstant('screen-green-channel', [0, 1, 0]), blueMask = rgbConstant('screen-blue-channel', [0, 0, 1]);
  const presetMask = g.add('screen-preset-channel', 'math.mix.rgb', { a: greenMask, b: blueMask, t: isBlue });
  const channel = g.add('screen-channel', 'math.mix.rgb', { a: presetMask, b: [g.add('screen-picked-channel-rgb', 'convert.vec3-to-rgb', { value: pickedMask }), 'rgb'], t: isCustom });
  const otherChannels = g.binary('screen-other-channels', 'math.subtract.rgb', [g.add('screen-all-channels', 'convert.scalar-to-rgb', { value: 'one' }), 'rgb'], channel);

  /** Screen difference parts of a straight colour: primary channel, strongest other channel, difference. */
  const difference = (id: string, rgb: GraphPort) => {
    const positive = g.add(`${id}-positive`, 'math.clamp.rgb-scalar', { value: rgb, min: 'zero', max: g.number(`${id}-ceiling`, 64) });
    const primary = g.add(`${id}-primary`, 'vector.reduce-max.rgb', { rgb: g.binary(`${id}-primary-rgb`, 'math.multiply.rgb', positive, channel) });
    const other = g.add(`${id}-other`, 'vector.reduce-max.rgb', { rgb: g.binary(`${id}-other-rgb`, 'math.multiply.rgb', positive, otherChannels) });
    return { primary, other, difference: g.binary(`${id}-difference`, 'math.subtract.scalar', primary, other) };
  };

  // Pass 1, Screen Grid (64 px): weighted sum of screen-like reads, (sum w*rgb, sum w) / 25.
  const cellIndex = g.add('screen-cell-index', 'image.kernel-index');
  g.number('screen-cell-taps', 2 * CHROMA_KEY_SCREEN_CELL_EXTENT + 1);
  g.number('screen-cell-extent', CHROMA_KEY_SCREEN_CELL_EXTENT);
  const cellTexels = g.binary('screen-cell-texels', 'math.divide-ieee.vec2', [g.add('screen-cell-step', 'math.divide-ieee.vec2-scalar', { a: cellIndex, b: 'screen-cell-taps' }), 'value'], 'resolution');
  const cellUv = g.binary('screen-cell-uv', 'math.add.vec2', ['uv', 'uv'], cellTexels);
  const cellRead = g.add('screen-cell-read', 'image.sample', { image: ['frame', 'image'], uv: cellUv });
  const cellSplit = g.add('screen-cell-split', 'vector.split.rgba', { image: [cellRead, 'image'] });
  const cell = difference('screen-cell', [cellSplit, 'rgb']);
  const cellPurity = g.binary('screen-cell-purity', 'math.divide-ieee.scalar', cell.difference, g.binary('screen-cell-safe-primary', 'math.max.scalar', cell.primary, 'tiny'));
  const ramp = (id: string, [low, high]: readonly number[], value: string) =>
    g.add(id, 'math.smoothstep.scalar', { edge0: g.number(`${id}-low`, low), edge1: g.number(`${id}-high`, high), value });
  const cellWeight = g.binary('screen-cell-weight', 'math.multiply.scalar',
    g.binary('screen-cell-likeness', 'math.multiply.scalar', ramp('screen-cell-purity-ramp', CHROMA_KEY_SCREEN_WEIGHT_PURITY, cellPurity),
      ramp('screen-cell-level-ramp', CHROMA_KEY_SCREEN_WEIGHT_LEVEL, cell.primary)),
    g.add('screen-cell-alpha', 'convert.alpha-to-scalar', { alpha: [cellSplit, 'alpha'] }));
  const cellTerm = g.add('screen-cell-term', 'vector.combine.rgba', { rgb: [cellSplit, 'rgb'], alpha: [g.add('screen-cell-unit', 'convert.scalar-to-alpha', { value: 'one' }), 'alpha'] });
  const cellReduce = g.add('screen-cell-reduce', 'image.kernel-grid-reduce', { sample: [cellTerm, 'image'], weight: cellWeight, extent: 'screen-cell-extent' });
  g.number('screen-cell-count', (2 * CHROMA_KEY_SCREEN_CELL_EXTENT + 1) ** 2);
  const cellMean = g.binary('screen-cell-mean', 'math.divide-ieee.vec4', [cellReduce, 'sum'], [g.add('screen-cell-count-vec4', 'convert.scalar-to-vec4', { value: 'screen-cell-count' }), 'value']);
  const grid = g.add('screen-grid', 'image.materialize', { image: [g.add('screen-grid-image', 'convert.vec4-to-image', { value: cellMean }), 'image'] },
    { bindings: {}, constants: { maxEdge: CHROMA_KEY_SCREEN_GRID_EDGE } });

  // Pass 2, Screen Color (1 texel): mean of 33x33 reads over the grid.
  const averageIndex = g.add('screen-average-index', 'image.kernel-index');
  g.number('screen-average-taps', 2 * CHROMA_KEY_SCREEN_AVERAGE_EXTENT + 1);
  g.number('screen-average-extent', CHROMA_KEY_SCREEN_AVERAGE_EXTENT);
  const centre = g.add('screen-centre-uv', 'convert.scalar-to-vec2', { value: 'half' });
  const averageUv = g.binary('screen-average-uv', 'math.add.vec2', centre,
    [g.add('screen-average-offset', 'math.divide-ieee.vec2-scalar', { a: averageIndex, b: 'screen-average-taps' }), 'value']);
  const averageRead = g.add('screen-average-read', 'image.sample', { image: [grid, 'image'], uv: averageUv });
  const averageReduce = g.add('screen-average-reduce', 'image.kernel-grid-reduce', { sample: [averageRead, 'image'], weight: 'one', extent: 'screen-average-extent' });
  const averageMean = g.binary('screen-average-mean', 'math.divide-ieee.vec4', [averageReduce, 'sum'],
    [g.add('screen-average-weight-vec4', 'convert.scalar-to-vec4', { value: [averageReduce, 'weightSum'] }), 'value']);
  const screenStats = g.add('screen-color-estimate', 'image.materialize', { image: [g.add('screen-average-image', 'convert.vec4-to-image', { value: averageMean }), 'image'] },
    { bindings: {}, constants: { maxEdge: 1 } });

  // Screen colour used by the key: the estimate (with a faint preset prior while no screen is seen) or the pick.
  const stats = g.add('screen-stats', 'image.sample', { image: [screenStats, 'image'], uv: centre });
  const statsSplit = g.add('screen-stats-split', 'vector.split.rgba', { image: [stats, 'image'] });
  const coverage = g.add('screen-coverage', 'convert.alpha-to-scalar', { alpha: [statsSplit, 'alpha'] });
  const prior = g.add('screen-prior', 'math.mix.rgb', { a: rgbConstant('screen-green-prior', CHROMA_KEY_GREEN_PRIOR), b: rgbConstant('screen-blue-prior', CHROMA_KEY_BLUE_PRIOR), t: isBlue });
  g.number('screen-prior-weight', CHROMA_KEY_PRIOR_WEIGHT);
  const estimate = g.add('screen-estimate', 'math.divide-ieee.rgb-scalar', {
    a: g.binary('screen-estimate-sum', 'math.add.rgb', [statsSplit, 'rgb'], g.add('screen-prior-term', 'math.multiply.rgb-scalar', { a: prior, b: 'screen-prior-weight' })),
    b: g.binary('screen-estimate-weight', 'math.add.scalar', coverage, 'screen-prior-weight') });
  const screen = g.add('screen-rgb', 'math.mix.rgb', { a: estimate, b: [picked, 'rgb'], t: isCustom });
  const screenParts = difference('screen-key', screen);
  const screenDifference = g.binary('screen-safe-difference', 'math.max.scalar', screenParts.difference, 'tiny');
  const screenPurity = g.binary('screen-purity', 'math.divide-ieee.scalar', screenParts.difference, g.binary('screen-safe-primary', 'math.max.scalar', screenParts.primary, 'tiny'));
  const coverageFound = g.binary('screen-found-auto', 'math.max.scalar', ramp('screen-coverage-ramp', CHROMA_KEY_SCREEN_COVERAGE, coverage), isCustom);
  const found = g.binary('screen-found', 'math.multiply.scalar', coverageFound,
    ramp('screen-purity-ramp', [CHROMA_KEY_MIN_SCREEN_PURITY, CHROMA_KEY_FULL_SCREEN_PURITY], screenPurity));
  g.number('matte-dark-floor', CHROMA_KEY_DARK_FLOOR);
  const darkFloor = g.binary('matte-dark-level', 'math.multiply.scalar', screenParts.primary, 'matte-dark-floor');

  // Clip Black/White (0..1, as keyerContract clamps them) as levels on the raw matte; a reversed pair
  // becomes a hard cut at Clip Black.
  const clipBlack = g.add('matte-clip-black', 'math.clamp.scalar', { value: 'clip-black', min: 'zero', max: 'one' });
  const clipWhite = g.add('matte-clip-white', 'math.clamp.scalar', { value: 'clip-white', min: 'zero', max: 'one' });
  const clipRange = g.binary('matte-clip-range', 'math.max.scalar', g.binary('matte-clip-span', 'math.subtract.scalar', clipWhite, clipBlack), g.number('matte-clip-min-span', 1e-3));

  // Screen matte of this pixel, then Clip Black/White as levels.
  const sourceSplit = g.add('matte-source-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  const source = difference('matte-source', [sourceSplit, 'rgb']);
  const brightness = g.add('matte-brightness', 'math.clamp.scalar', { value: source.primary, min: darkFloor, max: screenParts.primary });
  const transparency = g.binary('matte-transparency', 'math.multiply.scalar',
    g.binary('matte-ratio', 'math.divide-ieee.scalar', g.binary('matte-scaled-difference', 'math.multiply.scalar', source.difference, screenParts.primary),
      g.binary('matte-reference', 'math.multiply.scalar', screenDifference, g.binary('matte-safe-brightness', 'math.max.scalar', brightness, 'tiny'))), found);
  const raw = g.binary('matte-raw', 'math.subtract.scalar', 'one', g.add('matte-transparency-clamped', 'math.clamp.scalar', { value: transparency, min: 'zero', max: 'one' }));
  const clipped = g.add('matte-clipped', 'math.clamp.scalar', { value: g.binary('matte-levels', 'math.divide-ieee.scalar', g.binary('matte-above-black', 'math.subtract.scalar', raw, clipBlack), clipRange), min: 'zero', max: 'one' });

  // Edge: Shrink/Grow (soft minimum/maximum) then Edge Softness (blur), each a pair of separable
  // Gaussian passes over a cached matte, in pixels of a 1080p frame. At 0 the compiler folds the
  // selects below, so an untouched edge adds no pass.
  g.number('kernel-reference-height', CHROMA_KEY_REFERENCE_HEIGHT); g.number('kernel-max-px', CHROMA_KEY_MAX_EDGE_PX);
  g.number('kernel-max-shrink', -CHROMA_KEY_MAX_EDGE_PX);
  const pixelScale = g.binary('kernel-pixel-scale', 'math.divide-ieee.scalar', g.unary('kernel-short-side', 'vector.reduce-min.vec2', 'resolution'), 'kernel-reference-height');
  const softness = g.add('kernel-softness-clamped', 'math.clamp.scalar', { value: 'edge-softness', min: 'zero', max: 'kernel-max-px' });
  const shrink = g.add('kernel-shrink-clamped', 'math.clamp.scalar', { value: 'edge-shrink', min: 'kernel-max-shrink', max: 'kernel-max-px' });
  const greater = (id: string, a: GraphPort, b: GraphPort): GraphPort => [g.binary(id, 'compare.greater.scalar', a, b), 'condition'];
  const select = (id: string, condition: GraphPort, falseValue: GraphPort, trueValue: GraphPort) =>
    g.add(id, 'select.scalar', { condition, falseValue, trueValue });
  const shrinkPositive = greater('kernel-shrink-positive', shrink, 'zero');
  const shrinkNegative = greater('kernel-shrink-negative', 'zero', shrink);
  const softnessPositive = greater('kernel-softness-positive', softness, 'zero');
  const shrinkActive = select('kernel-shrink-active', shrinkPositive, select('kernel-grow-active', shrinkNegative, 'zero', 'one'), 'one');
  const edgeActive = select('kernel-edge-active', softnessPositive, shrinkActive, 'one');
  const shrinkUsed = greater('kernel-shrink-used', shrinkActive, 'half');
  g.number('kernel-sigma-floor', 1e-3);
  g.number('kernel-max-taps', CHROMA_KEY_GAUSSIAN_MAX_TAPS_PER_SIDE); g.number('two', 2);
  /** Gaussian size in pixels: sigma, taps per side and their spacing (wider kernels stride). */
  const kernel = (id: string, amount: string, divisor: number, reachSigmas: number) => {
    g.number(`${id}-sigma-divisor`, divisor); g.number(`${id}-reach-sigmas`, reachSigmas);
    const sigma = g.binary(`${id}-sigma`, 'math.max.scalar', g.binary(`${id}-sigma-px`, 'math.divide-ieee.scalar',
      g.binary(`${id}-amount-px`, 'math.multiply.scalar', amount, pixelScale), `${id}-sigma-divisor`), 'kernel-sigma-floor');
    const reach = g.binary(`${id}-reach`, 'math.multiply.scalar', sigma, `${id}-reach-sigmas`);
    const side = g.binary(`${id}-side`, 'math.min.scalar', g.unary(`${id}-side-needed`, 'math.ceil.scalar', reach), 'kernel-max-taps');
    const stride = g.binary(`${id}-stride`, 'math.max.scalar', g.binary(`${id}-stride-needed`, 'math.divide-ieee.scalar', reach, 'kernel-max-taps'), 'one');
    const count = g.binary(`${id}-count`, 'math.add.scalar', g.binary(`${id}-count-sides`, 'math.multiply.scalar', side, 'two'), 'one');
    return { sigma, side, stride, count };
  };
  /** One separable Gaussian pass of an opaque matte image: weighted mean of taps along one axis. */
  const gaussianPass = (id: string, axis: 'x' | 'y', source: GraphPort, size: ReturnType<typeof kernel>): GraphPort => {
    const index = g.add(`${id}-index`, 'image.sequence-index');
    const offsetPx = g.binary(`${id}-offset-px`, 'math.multiply.scalar', g.binary(`${id}-signed`, 'math.subtract.scalar', [index, 'index'], size.side), size.stride);
    const offset = g.add(`${id}-offset`, 'vector.combine.vec2', axis === 'x' ? { x: offsetPx, y: 'zero' } : { x: 'zero', y: offsetPx });
    const uvTap = g.binary(`${id}-uv`, 'math.add.vec2', ['uv', 'uv'], g.binary(`${id}-offset-uv`, 'math.divide-ieee.vec2', offset, 'resolution'));
    const read = g.add(`${id}-read`, 'image.sample', { image: source, uv: uvTap });
    const weight = g.add(`${id}-weight`, 'math.gaussian.scalar', { value: offsetPx, sigma: size.sigma });
    const reduce = g.add(`${id}-reduce`, 'image.sequence-reduce', { sample: [read, 'image'], weight, count: size.count });
    const mean = g.binary(`${id}-mean`, 'math.divide-ieee.vec4', [reduce, 'sum'],
      [g.add(`${id}-weight-vec4`, 'convert.scalar-to-vec4', { value: g.binary(`${id}-safe-weight`, 'math.max.scalar', [reduce, 'weightSum'], 'tiny') }), 'value']);
    return [g.add(`${id}-image`, 'convert.vec4-to-image', { value: mean }), 'image'];
  };
  // Matte cache: (matte, exp(-k matte), exp(-k (1 - matte)), 1) feeds both edge stages.
  g.number('edge-sharpness', CHROMA_KEY_SHRINK_SHARPNESS);
  const negativeSharpness = g.binary('edge-negative-sharpness', 'math.subtract.scalar', 'zero', 'edge-sharpness');
  // The edge stages work on the keyed alpha (matte x source alpha): transparent source pixels are no
  // subject, so Shrink/Grow and Edge Softness never spread the subject in from them.
  const sourceAlpha = g.add('edge-source-alpha', 'convert.alpha-to-scalar', { alpha: [sourceSplit, 'alpha'] });
  const keyed = g.binary('edge-keyed-alpha', 'math.multiply.scalar', clipped, sourceAlpha);
  const keyCacheValue = g.add('edge-key-value', 'vector.combine.vec4', { x: keyed,
    y: g.unary('edge-key-erode-term', 'math.exp.scalar', g.binary('edge-key-erode-exponent', 'math.multiply.scalar', keyed, negativeSharpness)),
    z: g.unary('edge-key-grow-term', 'math.exp.scalar', g.binary('edge-key-grow-exponent', 'math.multiply.scalar',
      g.binary('edge-key-inverse', 'math.subtract.scalar', 'one', keyed), negativeSharpness)), w: 'one' });
  const keyCache: GraphPort = [g.add('edge-key-cache', 'image.materialize', { image: [g.add('edge-key-image', 'convert.vec4-to-image', { value: keyCacheValue }), 'image'] }), 'image'];
  // Shrink/Grow: soft minimum -ln(mean exp(-k m)) / k, or soft maximum 1 + ln(mean exp(-k (1 - m))) / k.
  const shrinkMagnitude = g.unary('kernel-shrink-magnitude', 'math.abs.scalar', shrink);
  const shrinkSize = kernel('kernel-shrink', shrinkMagnitude, CHROMA_KEY_SHRINK_SIGMA_DIVISOR, CHROMA_KEY_SHRINK_REACH_SIGMAS);
  const shrinkRows = g.add('edge-shrink-rows', 'image.materialize', { image: gaussianPass('edge-shrink-h', 'x', keyCache, shrinkSize) });
  const shrinkMean = g.add('edge-shrink-mean', 'convert.image-to-vec4', { image: gaussianPass('edge-shrink-v', 'y', [shrinkRows, 'image'], shrinkSize) });
  const shrinkParts = g.add('edge-shrink-parts', 'vector.split.vec4', { value: shrinkMean });
  const logOf = (id: string, value: GraphPort) => g.unary(id, 'math.log.scalar', g.binary(`${id}-safe`, 'math.max.scalar', value, g.number(`${id}-floor`, 1e-7)));
  const eroded = g.binary('edge-eroded', 'math.divide-ieee.scalar', logOf('edge-erode-log', [shrinkParts, 'y']), negativeSharpness);
  const grown = g.binary('edge-grown', 'math.add.scalar', 'one', g.binary('edge-grow-shift', 'math.divide-ieee.scalar', logOf('edge-grow-log', [shrinkParts, 'z']), 'edge-sharpness'));
  const shrunk = g.add('edge-shrunk', 'math.clamp.scalar', { value: g.add('edge-shrink-choice', 'math.mix.scalar',
    { a: grown, b: eroded, t: g.add('edge-shrink-direction', 'math.step.scalar', { edge: 'zero', value: shrink }) }), min: 'zero', max: 'one' });
  const shrunkCache = g.add('edge-shrunk-cache', 'image.materialize', { image: [g.add('edge-shrunk-image', 'convert.vec4-to-image',
    { value: g.add('edge-shrunk-value', 'convert.scalar-to-vec4', { value: shrunk }) }), 'image'] });
  const softSource = g.add('edge-soften-source', 'control.select.image', { condition: shrinkUsed, falseValue: keyCache, trueValue: [shrunkCache, 'image'] });
  // Edge Softness: blur of the (shrunk) matte.
  const softSize = kernel('kernel-soften', softness, CHROMA_KEY_SOFTNESS_SIGMA_DIVISOR, CHROMA_KEY_GAUSSIAN_REACH_SIGMAS);
  const softRows = g.add('edge-soften-rows', 'image.materialize', { image: gaussianPass('edge-soften-h', 'x', [softSource, 'image'], softSize) });
  const softened = gaussianPass('edge-soften-v', 'y', [softRows, 'image'], softSize);
  const edgeImage = g.add('edge-result', 'control.select.image', { condition: softnessPositive, falseValue: [softSource, 'image'], trueValue: softened });
  const edgeMatte = [g.add('edge-result-parts', 'vector.split.vec4', { value: g.add('edge-result-value', 'convert.image-to-vec4', { image: [edgeImage, 'image'] }) }), 'x'] as const;
  const matte = g.add('edge-matte', 'math.mix.scalar', { a: keyed, b: edgeMatte, t: edgeActive });

  // Screen subtraction: take the screen's share (1 - matte) out of the colour, so hair, chiffon and edges
  // show the new background instead of a grey or green rim. The screen behind the pixel is the Screen
  // Grid's local mean (the frame estimate where no cell saw screen, the pick for a picked colour), dimmed
  // like the matte dims it for pixels darker than the screen.
  g.number('unmix-local-prior', CHROMA_KEY_LOCAL_PRIOR_WEIGHT);
  const localSplit = g.add('unmix-local-split', 'vector.split.rgba', { image: [g.add('unmix-local-read', 'image.sample', { image: [grid, 'image'], uv: ['uv', 'uv'] }), 'image'] });
  const localScreen = g.add('unmix-local-screen', 'math.divide-ieee.rgb-scalar', {
    a: g.binary('unmix-local-sum', 'math.add.rgb', [localSplit, 'rgb'], g.add('unmix-local-prior-term', 'math.multiply.rgb-scalar', { a: screen, b: 'unmix-local-prior' })),
    b: g.binary('unmix-local-total', 'math.add.scalar', g.add('unmix-local-weight', 'convert.alpha-to-scalar', { alpha: [localSplit, 'alpha'] }), 'unmix-local-prior') });
  // A local colour much less pure than the frame estimate is chiffon or smoke filling the cell, not screen.
  const localParts = difference('unmix-local-parts', localScreen);
  const localPurity = g.binary('unmix-local-purity', 'math.divide-ieee.scalar', localParts.difference, g.binary('unmix-local-safe-primary', 'math.max.scalar', localParts.primary, 'tiny'));
  const purityRatio = g.binary('unmix-local-purity-ratio', 'math.divide-ieee.scalar', localPurity, g.binary('unmix-screen-safe-purity', 'math.max.scalar', screenPurity, 'tiny'));
  const localTrust = ramp('unmix-local-trust', CHROMA_KEY_LOCAL_PURITY_TRUST, purityRatio);
  const behindAuto = g.add('unmix-screen-auto', 'math.mix.rgb', { a: screen, b: localScreen, t: localTrust });
  const behind = g.add('unmix-screen', 'math.mix.rgb', { a: behindAuto, b: screen, t: isCustom });
  const behindPrimary = g.add('unmix-screen-primary', 'vector.reduce-max.rgb', { rgb: g.binary('unmix-screen-primary-rgb', 'math.multiply.rgb', behind, channel) });
  const behindLevel = g.add('unmix-screen-level', 'math.clamp.scalar', { value: source.primary,
    min: g.binary('unmix-screen-dark-level', 'math.multiply.scalar', behindPrimary, 'matte-dark-floor'), max: behindPrimary });
  const dimmed = g.add('unmix-screen-dimmed', 'math.multiply.rgb-scalar', { a: behind,
    b: g.binary('unmix-screen-dim', 'math.divide-ieee.scalar', behindLevel, g.binary('unmix-screen-safe-primary', 'math.max.scalar', behindPrimary, 'tiny')) });
  const screenPart = g.add('unmix-screen-part', 'math.multiply.rgb-scalar', { a: dimmed, b: g.binary('unmix-screen-share', 'math.subtract.scalar', 'one', clipped) });
  const ceiling = g.binary('unmix-ceiling', 'math.max.scalar', 'one', g.add('unmix-source-max', 'vector.reduce-max.rgb', { rgb: 'matte-source-positive' }));
  const premultiplied = g.add('unmix-premultiplied', 'math.clamp.rgb-scalar', { value: g.binary('unmix-removed', 'math.subtract.rgb', 'matte-source-positive', screenPart), min: 'zero', max: ceiling });
  const unmixed = g.add('unmix-straight', 'math.divide-ieee.rgb-scalar', { a: premultiplied, b: g.binary('unmix-safe-matte', 'math.max.scalar', clipped, 'tiny') });
  const trust = ramp('unmix-trust', CHROMA_KEY_UNMIX_TRUST, clipped);
  const colour = g.add('unmix-color', 'math.clamp.rgb-scalar', { value: g.add('unmix-mix', 'math.mix.rgb', { a: 'matte-source-positive', b: unmixed, t: trust }), min: 'zero', max: ceiling });

  // Spill suppression: the screen channel is limited to the mean of the other two (Neutral) or to the
  // stronger one (Gentle, keeps yellows on green and cyans on blue).
  const spillAmount = g.add('spill-amount', 'math.clamp.scalar', { value: 'spill-suppression', min: 'zero', max: 'one' });
  const spillPrimary = g.add('spill-primary', 'vector.reduce-max.rgb', { rgb: g.binary('spill-primary-rgb', 'math.multiply.rgb', colour, channel) });
  const spillOther = g.add('spill-other', 'vector.reduce-max.rgb', { rgb: g.binary('spill-other-rgb', 'math.multiply.rgb', colour, otherChannels) });
  const spillChannels = g.add('spill-channels', 'vector.split.vec3', { value: g.add('spill-vec3', 'convert.rgb-to-vec3', { rgb: colour }) });
  const channelSum = g.binary('spill-channel-sum', 'math.add.scalar', g.binary('spill-channel-sum-xy', 'math.add.scalar', [spillChannels, 'x'], [spillChannels, 'y']), [spillChannels, 'z']);
  const otherMean = g.binary('spill-other-mean', 'math.multiply.scalar', g.binary('spill-other-sum', 'math.subtract.scalar', channelSum, spillPrimary), 'half');
  const limit = g.add('spill-limit', 'math.mix.scalar', { a: otherMean, b: spillOther,
    t: g.add('spill-is-gentle', 'math.step.scalar', { edge: 'half', value: 'spill-method' }) });
  const excess = g.binary('spill-excess', 'math.multiply.scalar', g.binary('spill-positive', 'math.max.scalar', g.binary('spill-over-limit', 'math.subtract.scalar', spillPrimary, limit), 'zero'),
    g.binary('spill-strength', 'math.multiply.scalar', spillAmount, found));
  const despilled = g.binary('spill-despilled', 'math.subtract.rgb', colour, g.add('spill-removed', 'math.multiply.rgb-scalar', { a: channel, b: excess }));
  // Output alpha: the (edge-shaped) keyed alpha, never above the source alpha (Grow cannot fill transparency).
  const alpha = g.binary('spill-alpha', 'math.min.scalar', matte, sourceAlpha);

  // View: Final result (straight colour, keyed alpha) or the matte as an opaque grey image.
  const isMatte = g.add('view-is-matte', 'math.step.scalar', { edge: 'half', value: 'view' });
  const rgb = g.add('view-rgb', 'math.mix.rgb', { a: despilled, b: [g.add('view-matte-rgb', 'convert.scalar-to-rgb', { value: alpha }), 'rgb'], t: isMatte });
  const outAlpha = g.add('view-alpha', 'math.mix.scalar', { a: alpha, b: 'one', t: isMatte });
  const result = g.add('result', 'vector.combine.rgba', { rgb, alpha: [g.add('view-alpha-port', 'convert.scalar-to-alpha', { value: outAlpha }), 'alpha'] });
  g.add('output', 'image.output', { image: [result, 'image'] });
  return g.graph(10);
}
