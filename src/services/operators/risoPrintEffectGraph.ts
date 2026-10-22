import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { HALFTONE_DOT, HALFTONE_TAPS } from './halftoneEffectGraphs';
import { measureInReferenceFrame } from './patternReferenceFrame';
import { prefilterCellTaps } from './patternCellFilter';

type Ref = { node: string; port: string };
class Builder {
  nodes: BoundOperatorNode[] = []; edges: OperatorEdge[] = []; layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, port = 'value', bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    this.layout[id] = { x: (this.nodes.length % 11) * 300, y: Math.floor(this.nodes.length / 11) * 220 }; return { node: id, port };
  }
  number(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref, input = 'value') { const out = this.node(id, operator); this.edge(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
  clamp(id: string, operator: string, value: Ref, min: Ref, max: Ref) {
    const out = this.node(id, operator); this.edge(value, out, 'value'); this.edge(min, out, 'min'); this.edge(max, out, 'max'); return out;
  }
  /** The sum of an RGB value's three channels. */
  sum(id: string, rgb: Ref) {
    const split = this.node(`${id}-parts`, 'vector.split.vec3', 'x'); this.edge(this.unary(`${id}-vector`, 'convert.rgb-to-vec3', rgb, 'rgb'), split, 'value');
    return this.binary(id, 'math.add.scalar', this.binary(`${id}-xy`, 'math.add.scalar', { node: split.node, port: 'x' }, { node: split.node, port: 'y' }), { node: split.node, port: 'z' });
  }
}

/** The two drums of the press: which colour parameter each one prints and the angle of its dot screen. */
export const RISO_INKS = [
  { id: 'dark', color: 'colorA', node: 'color-a', angle: 15 },
  { id: 'warm', color: 'colorB', node: 'color-b', angle: 75 },
] as const;
/** The cream paper both inks print on (sRGB). */
export const RISO_PAPER = [.96, .93, .85] as const;
/** Which way the inks slip apart (a unit vector, y down): Registration moves the dark ink this way back, the warm ink forward. */
export const RISO_SLIP = [.8, .6] as const;
/** Ridge of the separation's least-squares fit: keeps two almost equal inks solvable (they share the work). */
export const RISO_RIDGE = .005;
/** Weight of the paper in a cell's colour: it decides only where all four reads are transparent (no ink there). */
export const RISO_PAPER_WEIGHT = 1e-3;
/** Weight of the scaled share in an ink's exact coverage: decides only where the ink has no effect beside the other. */
export const RISO_TONE_BLEND = 1e-3;

/**
 * A Riso saved without a node graph before Dot Size existed (its params lack `dotSize`; new effects store every
 * default): it keeps the earlier recipe it was saved with (createEarlierRisoGraph('riso') in risoEffectGraphs.ts),
 * where both inks print the same darkness, offset sideways, without a dot screen.
 */
export function hasEarlierRisoParams(params: Record<string, unknown>): boolean {
  return params.dotSize === undefined;
}

/** Riso Glow gathers its glow over a square window of this many taps a side (odd, centred on the glow ink's drum position). */
export const RISO_GLOW_KERNEL = 9;
/** Distance between two glow taps, in cells of the dot screen: the glow reaches four taps (three cells) each way. */
export const RISO_GLOW_STEP = .75;
/** Width (sigma) of the glow's Gaussian weights, in taps. */
export const RISO_GLOW_SIGMA = 2;
/** Light the glow ink gives off at Glow 1 and the top of its pulse, as a multiple of a full layer of its colour. */
export const RISO_GLOW_GAIN = 1.5;
/** Riso Glow's pulse: the glow breathes between rest − swing and rest + swing of Glow (cos of 2 × time × Speed). */
export const RISO_GLOW_PULSE = { rest: .55, swing: .45 } as const;

/**
 * Riso: the picture printed with two inks on cream paper, like a risograph. Every cell of each ink's dot screen is
 * read as one colour (four reads in linear light, weighted by alpha) and separated into the two inks: a least-squares
 * fit of the light the cell takes from the paper, per channel, says how the colour splits between the inks (dots mix
 * linearly with the paper), the Tone step scales the split so that the dots keep the cell's brightness exactly (inks
 * multiply where they overlap), and each ink's coverage becomes a round dot that covers exactly that share of its cell
 * (HALFTONE_DOT). The dark ink's screen is turned 15°, the warm ink's 75°; Registration slips the two drums apart. Dot Size and Registration count pixels of a 1080p frame (patternReferenceFrame.ts).
 */
export function createRisoPrintGraph(): EffectOperatorGraph {
  return buildRisoPrint(false);
}

/**
 * Riso Glow: the Riso print with a fluorescent second ink (colorB, the Glow Ink) that gives off light in its own colour:
 * every glow-ink dot shines, and lights its cell around it in proportion to its coverage (a halo that fades out at the
 * cell's inscribed circle, so neighbouring halos meet at zero); the shadow ink's dots filter that light. It is screened
 * onto the print in linear light (1 − (1 − print) × e^(−strength × light), so it never clips), with strength Glow × a
 * pulse that breathes with the timeline time × Speed (full at Speed 0 and at second 0).
 */
export function createRisoGlowGraph(): EffectOperatorGraph {
  return buildRisoPrint(true);
}

function buildRisoPrint(glowing: boolean): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const resolution = g.node('resolution', 'image.resolution');
  const scale = g.node('scale', 'values.number', 'value', { value: 'scale' }), dotSize = g.node('dot-size', 'values.number', 'value', { value: 'dotSize' });
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const zero = g.number('zero', 0), one = g.number('one', 1), two = g.number('two', 2), half = g.number('half', .5);
  const half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half), oneRgb = g.node('one-rgb', 'convert.scalar-to-rgb', 'rgb'); g.edge(one, oneRgb, 'value');
  const minUv = g.unary('min-uv', 'convert.scalar-to-vec2', g.number('tiny', .001)), maxUv = g.unary('max-uv', 'convert.scalar-to-vec2', g.number('almost-one', .999));
  const pixel = g.binary('pixel', 'math.multiply.vec2', uv, resolution);
  const center = g.node('frame-center', 'math.multiply.vec2-scalar'); g.edge(resolution, center, 'a'); g.edge(half, center, 'b');
  const ownSample = g.node('sample', 'image.sample', 'image'); g.edge(frame, ownSample, 'image'); g.edge(g.clamp('clamped-uv', 'math.clamp.vec2', uv, minUv, maxUv), ownSample, 'uv');
  const own = g.node('sample-split', 'vector.split.rgba', 'rgb'); g.edge(ownSample, own, 'image');

  // Paper and Inks: the paper and each ink as light, and the light each ink takes from the paper (per channel and as one brightness).
  const paperVector = g.node('paper-vector', 'vector.combine.vec3');
  RISO_PAPER.forEach((value, index) => g.edge(g.number(`paper-${'rgb'[index]}`, value), paperVector, 'xyz'[index]));
  const paper = g.node('paper', 'convert.vec3-to-rgb', 'rgb'); g.edge(paperVector, paper, 'value');
  const paperLinear = g.node('paper-linear', 'color.srgb-to-linear.rgb', 'rgb'); g.edge(paper, paperLinear, 'rgb');
  const inks = Object.fromEntries(RISO_INKS.map(ink => {
    const color = g.node(ink.node, 'values.color', 'value', { value: ink.color });
    const rgb = g.node(`${ink.node}-rgb`, 'convert.vec4-to-rgb', 'rgb'); g.edge(color, rgb, 'value');
    const linear = g.node(`${ink.id}-ink-linear`, 'color.srgb-to-linear.rgb', 'rgb'); g.edge(rgb, linear, 'rgb');
    // How much of the paper's light a full layer of the ink takes away, per channel and as one brightness.
    const absorbs = g.binary(`${ink.id}-ink-absorbs`, 'math.subtract.rgb', oneRgb, linear);
    const absorbed = g.unary(`${ink.id}-ink-absorbed`, 'color.luminance-rec709.rgb', g.binary(`${ink.id}-ink-absorbed-rgb`, 'math.multiply.rgb', paperLinear, absorbs), 'rgb');
    return [ink.id, { linear, absorbs, absorbed }];
  })) as Record<'dark' | 'warm', { linear: Ref; absorbs: Ref; absorbed: Ref }>;
  const paperLuma = g.unary('paper-luma', 'color.luminance-rec709.rgb', paperLinear, 'rgb');
  const bothAbsorbed = g.unary('both-absorbed', 'color.luminance-rec709.rgb', g.binary('both-absorbed-rgb', 'math.multiply.rgb',
    g.binary('paper-dark-absorbs', 'math.multiply.rgb', paperLinear, inks.dark.absorbs), inks.warm.absorbs), 'rgb');
  // The fit's normal matrix: how strongly each ink darkens on its own and together (with the ridge on the diagonal).
  const ridge = g.number('ridge', RISO_RIDGE);
  const darkDark = g.binary('fit-dark-dark', 'math.add.scalar', g.sum('fit-dark-dark-raw', g.binary('fit-dark-dark-product', 'math.multiply.rgb', inks.dark.absorbs, inks.dark.absorbs)), ridge);
  const warmWarm = g.binary('fit-warm-warm', 'math.add.scalar', g.sum('fit-warm-warm-raw', g.binary('fit-warm-warm-product', 'math.multiply.rgb', inks.warm.absorbs, inks.warm.absorbs)), ridge);
  const darkWarm = g.sum('fit-dark-warm', g.binary('fit-dark-warm-product', 'math.multiply.rgb', inks.dark.absorbs, inks.warm.absorbs));
  const determinant = g.binary('fit-determinant', 'math.subtract.scalar', g.binary('fit-diagonal', 'math.multiply.scalar', darkDark, warmWarm),
    g.binary('fit-cross', 'math.multiply.scalar', darkWarm, darkWarm));

  // Registration: the two drums slip apart along RISO_SLIP, half the distance each.
  const registration = g.binary('registration', 'math.max.scalar', scale, zero);
  const slipDirection = g.node('slip-direction', 'vector.combine.vec2'); g.edge(g.number('slip-x', RISO_SLIP[0]), slipDirection, 'x'); g.edge(g.number('slip-y', RISO_SLIP[1]), slipDirection, 'y');
  const slip = g.node('slip', 'math.multiply.vec2-scalar'); g.edge(slipDirection, slip, 'a'); g.edge(g.binary('slip-half', 'math.multiply.scalar', registration, half), slip, 'b');
  // Screens: cells of Dot Size pixels; the dot edge is one output pixel soft at every size.
  const size = g.binary('safe-dot-size', 'math.max.scalar', dotSize, two), size2 = g.unary('dot-size-vec2', 'convert.scalar-to-vec2', size);
  const edgeWidth = g.binary('edge-width', 'math.divide-ieee.scalar', g.number('half-pixel', .5), size);
  const reach = g.binary('tap-reach', 'math.multiply.scalar', size, g.number('quarter', .25));
  const four = g.number('four', 4), toneFloor = g.number('tone-floor', 1e-6), toneBlend = g.number('tone-blend', RISO_TONE_BLEND);
  const paperWeight = g.number('paper-weight', RISO_PAPER_WEIGHT), zeroRgb = g.node('zero-rgb', 'convert.scalar-to-rgb', 'rgb'); g.edge(zero, zeroRgb, 'value');

  /** Cell Colour: four reads around `centre` (pixels; ± diagonal and ± anti-diagonal), in linear light and weighted by alpha. */
  const cellColourAt = (p: string, centre: Ref, diagonal: Ref, antiDiagonal: Ref): Ref => {
    let lightSum: Ref = g.node(`${p}-paper-light`, 'math.multiply.rgb-scalar'); g.edge(paperLinear, lightSum, 'a'); g.edge(paperWeight, lightSum, 'b');
    let alphaSum: Ref = paperWeight;
    HALFTONE_TAPS.forEach(([x, y], index) => {
      const id = `${p}-tap-${index + 1}`, offset = x * y > 0 ? diagonal : antiDiagonal;
      const at = g.binary(`${id}-pixels`, x > 0 ? 'math.add.vec2' : 'math.subtract.vec2', centre, offset);
      const sample = g.node(`${id}-sample`, 'image.sample', 'image'); g.edge(frame, sample, 'image');
      g.edge(g.clamp(`${id}-clamped-uv`, 'math.clamp.vec2', g.binary(`${id}-uv`, 'math.divide-ieee.vec2', at, resolution), minUv, maxUv), sample, 'uv');
      const split = g.node(`${id}-split`, 'vector.split.rgba', 'rgb'); g.edge(sample, split, 'image');
      const alpha = g.unary(`${id}-alpha`, 'convert.alpha-to-scalar', { node: split.node, port: 'alpha' }, 'alpha');
      const linear = g.node(`${id}-linear`, 'color.srgb-to-linear.rgb', 'rgb'); g.edge({ node: split.node, port: 'rgb' }, linear, 'rgb');
      const weighted = g.node(`${id}-weighted`, 'math.multiply.rgb-scalar'); g.edge(linear, weighted, 'a'); g.edge(alpha, weighted, 'b');
      lightSum = g.binary(`${id}-light-sum`, 'math.add.rgb', lightSum, weighted);
      alphaSum = g.binary(`${id}-alpha-sum`, 'math.add.scalar', alphaSum, alpha);
    });
    const cellColour = g.node(`${p}-cell-colour`, 'math.divide-ieee.rgb-scalar'); g.edge(lightSum, cellColour, 'a'); g.edge(alphaSum, cellColour, 'b');
    return cellColour;
  };

  /** Separation and Tone of one colour for ink `inkIndex`: its coverage and the other ink's, as shares of a full layer. */
  const inkCoverage = (p: string, inkIndex: number, cellColour: Ref): { coverage: Ref; otherCoverage: Ref } => {
    // Separation: the light the cell takes from the paper, per channel, fitted with both inks; this ink's share of a full layer.
    const ratio = g.binary(`${p}-paper-ratio`, 'math.divide-ieee.rgb', cellColour, paperLinear);
    const taken = g.binary(`${p}-cell-absorbs`, 'math.max.rgb', g.binary(`${p}-cell-absorbs-raw`, 'math.subtract.rgb', oneRgb, ratio), zeroRgb);
    const towardsDark = g.sum(`${p}-towards-dark`, g.binary(`${p}-towards-dark-product`, 'math.multiply.rgb', taken, inks.dark.absorbs));
    const towardsWarm = g.sum(`${p}-towards-warm`, g.binary(`${p}-towards-warm-product`, 'math.multiply.rgb', taken, inks.warm.absorbs));
    // Solved for this ink first (unconstrained, then kept within 0–1), the other ink fitted to it, then this ink again.
    const [mine, other, mineSelf, otherSelf] = inkIndex === 0 ? [towardsDark, towardsWarm, darkDark, warmWarm] : [towardsWarm, towardsDark, warmWarm, darkDark];
    // `share` is this ink's part of the colour and `otherShare` the other's, as fractions of a full layer.
    const free = g.binary(`${p}-free`, 'math.divide-ieee.scalar', g.binary(`${p}-free-raw`, 'math.subtract.scalar',
      g.binary(`${p}-free-mine`, 'math.multiply.scalar', otherSelf, mine), g.binary(`${p}-free-other`, 'math.multiply.scalar', darkWarm, other)), determinant);
    const first = g.clamp(`${p}-first`, 'math.clamp.scalar', free, zero, one);
    const refit = (id: string, target: Ref, given: Ref, self: Ref) => g.clamp(id, 'math.clamp.scalar', g.binary(`${id}-raw`, 'math.divide-ieee.scalar',
      g.binary(`${id}-rest`, 'math.subtract.scalar', target, g.binary(`${id}-shared`, 'math.multiply.scalar', darkWarm, given)), self), zero, one);
    const otherShare = refit(`${p}-other-share`, other, first, otherSelf);
    const share = refit(`${p}-share`, mine, otherShare, mineSelf);
    // Tone: both shares scaled by one factor so that the dots, mixed with the paper, keep the cell's brightness (the
    // smaller root of a quadratic: inks multiply where they overlap), then this ink's coverage solved exactly for that
    // brightness beside the other ink's (so a saturated ink hands the rest to this one).
    const ownInk = inks[inkIndex === 0 ? 'dark' : 'warm'], otherInk = inks[inkIndex === 0 ? 'warm' : 'dark'];
    const [darkShare, warmShare] = inkIndex === 0 ? [share, otherShare] : [otherShare, share];
    const cellLuma = g.unary(`${p}-cell-luma`, 'color.luminance-rec709.rgb', cellColour, 'rgb');
    const gap = g.binary(`${p}-tone-gap`, 'math.max.scalar', g.binary(`${p}-tone-gap-raw`, 'math.subtract.scalar', paperLuma, cellLuma), zero);
    const slope = g.binary(`${p}-tone-slope`, 'math.add.scalar', g.binary(`${p}-tone-slope-dark`, 'math.multiply.scalar', darkShare, inks.dark.absorbed),
      g.binary(`${p}-tone-slope-warm`, 'math.multiply.scalar', warmShare, inks.warm.absorbed));
    const overlap = g.binary(`${p}-tone-overlap`, 'math.multiply.scalar', g.binary(`${p}-tone-shares`, 'math.multiply.scalar', darkShare, warmShare), bothAbsorbed);
    const root = g.unary(`${p}-tone-root`, 'math.sqrt.scalar', g.binary(`${p}-tone-discriminant`, 'math.max.scalar', g.binary(`${p}-tone-discriminant-raw`, 'math.subtract.scalar',
      g.binary(`${p}-tone-slope-squared`, 'math.multiply.scalar', slope, slope), g.binary(`${p}-tone-product`, 'math.multiply.scalar', g.binary(`${p}-tone-overlap-four`, 'math.multiply.scalar', overlap, four), gap)), zero));
    const reachScale = g.binary(`${p}-tone-reach`, 'math.divide-ieee.scalar', g.binary(`${p}-tone-gap-twice`, 'math.multiply.scalar', gap, two),
      g.binary(`${p}-tone-reach-floor`, 'math.max.scalar', g.binary(`${p}-tone-reach-sum`, 'math.add.scalar', slope, root), toneFloor));
    const deepest = g.binary(`${p}-tone-deepest`, 'math.divide-ieee.scalar', slope, g.binary(`${p}-tone-deepest-floor`, 'math.max.scalar',
      g.binary(`${p}-tone-overlap-twice`, 'math.multiply.scalar', overlap, two), toneFloor));
    const toneScale = g.binary(`${p}-tone-scale`, 'math.min.scalar', reachScale, deepest);
    const otherCoverage = g.clamp(`${p}-other-coverage`, 'math.clamp.scalar', g.binary(`${p}-other-coverage-raw`, 'math.multiply.scalar', toneScale, otherShare), zero, one);
    const left = g.binary(`${p}-tone-left`, 'math.subtract.scalar', g.binary(`${p}-tone-left-raw`, 'math.subtract.scalar', paperLuma,
      g.binary(`${p}-other-takes`, 'math.multiply.scalar', otherCoverage, otherInk.absorbed)), cellLuma);
    const ownReach = g.binary(`${p}-tone-own-reach`, 'math.subtract.scalar', ownInk.absorbed, g.binary(`${p}-other-overlap`, 'math.multiply.scalar', otherCoverage, bothAbsorbed));
    // RISO_TONE_BLEND leans towards the scaled share where this ink has no effect beside the other (two black inks).
    const blendedShare = g.binary(`${p}-tone-own-share`, 'math.multiply.scalar', g.binary(`${p}-tone-own-scaled`, 'math.multiply.scalar', toneScale, share), toneBlend);
    const coverage = g.clamp(`${p}-coverage`, 'math.clamp.scalar', g.binary(`${p}-coverage-raw`, 'math.divide-ieee.scalar',
      g.binary(`${p}-coverage-left`, 'math.add.scalar', left, blendedShare), g.binary(`${p}-coverage-reach`, 'math.add.scalar', ownReach, toneBlend)), zero, one);
    return { coverage, otherCoverage };
  };

  let glowInk: { coverage: Ref; otherCoverage: Ref } | undefined;
  const marks = RISO_INKS.map((ink, inkIndex) => {
    const p = ink.id;
    // Screen: the paper pixel on this ink's drum, turned to its screen angle and cut into cells.
    const layer = g.binary(`${p}-layer`, inkIndex === 0 ? 'math.add.vec2' : 'math.subtract.vec2', pixel, slip);
    const radians = g.unary(`${p}-radians`, 'convert.degrees-to-radians.scalar', g.number(`${p}-angle`, ink.angle));
    const screen = g.node(`${p}-screen`, 'coordinates.rotate.vec2'); g.edge(g.binary(`${p}-centered`, 'math.subtract.vec2', layer, center), screen, 'value'); g.edge(radians, screen, 'angle');
    const cells = g.binary(`${p}-cells`, 'math.divide-ieee.vec2', screen, size2);
    const place = g.binary(`${p}-place`, 'math.subtract.vec2', g.unary(`${p}-cell-fract`, 'math.fract.vec2', cells), half2);
    // Cell Colour: four reads a quarter cell from the cell's centre, turned back onto the picture, in linear light.
    const backRadians = g.binary(`${p}-back-radians`, 'math.subtract.scalar', zero, radians);
    const centerScreen = g.node(`${p}-cell-center-screen`, 'math.multiply.vec2-scalar');
    g.edge(g.binary(`${p}-cell-center-cells`, 'math.add.vec2', g.unary(`${p}-cell-index`, 'math.floor.vec2', cells), half2), centerScreen, 'a'); g.edge(size, centerScreen, 'b');
    const turnedBack = g.node(`${p}-cell-center-turned`, 'coordinates.rotate.vec2'); g.edge(centerScreen, turnedBack, 'value'); g.edge(backRadians, turnedBack, 'angle');
    const cellCenter = g.binary(`${p}-cell-center`, 'math.add.vec2', turnedBack, center);
    const axis = (name: 'x' | 'y') => {
      const along = g.node(`${p}-tap-${name}-screen`, 'vector.combine.vec2'); g.edge(name === 'x' ? reach : zero, along, 'x'); g.edge(name === 'x' ? zero : reach, along, 'y');
      const turned = g.node(`${p}-tap-${name}`, 'coordinates.rotate.vec2'); g.edge(along, turned, 'value'); g.edge(backRadians, turned, 'angle'); return turned;
    };
    const stepX = axis('x'), stepY = axis('y');
    const diagonal = g.binary(`${p}-tap-diagonal`, 'math.add.vec2', stepX, stepY), antiDiagonal = g.binary(`${p}-tap-anti-diagonal`, 'math.subtract.vec2', stepX, stepY);
    const { coverage, otherCoverage } = inkCoverage(p, inkIndex, cellColourAt(p, cellCenter, diagonal, antiDiagonal));
    if (inkIndex === 1) glowInk = { coverage, otherCoverage };
    // Dot: the round dot that covers exactly that share of its cell (HALFTONE_DOT), one output pixel soft.
    const smallRadius = g.unary(`${p}-dot-radius-small`, 'math.sqrt.scalar', g.binary(`${p}-dot-area`, 'math.multiply.scalar', coverage, g.number(`${p}-inverse-pi`, HALFTONE_DOT.inversePi)));
    const paperRoot = g.unary(`${p}-paper-root`, 'math.sqrt.scalar', g.binary(`${p}-paper-left`, 'math.subtract.scalar', one, coverage));
    const largeRadius = g.binary(`${p}-dot-radius-large`, 'math.subtract.scalar', g.number(`${p}-cell-corner`, HALFTONE_DOT.corner),
      g.binary(`${p}-paper-gap`, 'math.multiply.scalar', paperRoot, g.number(`${p}-corner-reach`, HALFTONE_DOT.cornerReach)));
    const touching = g.node(`${p}-dots-touch`, 'compare.greater.scalar', 'condition'); g.edge(coverage, touching, 'a'); g.edge(g.number(`${p}-touch-share`, HALFTONE_DOT.touch), touching, 'b');
    const radius = g.node(`${p}-radius`, 'select.scalar'); g.edge(smallRadius, radius, 'falseValue'); g.edge(largeRadius, radius, 'trueValue'); g.edge(touching, radius, 'condition');
    const bias = g.binary(`${p}-radius-bias`, 'math.multiply.scalar', g.binary(`${p}-coverage-signed`, 'math.subtract.scalar',
      g.binary(`${p}-coverage-twice`, 'math.multiply.scalar', coverage, two), one), edgeWidth);
    const dotRadius = g.binary(`${p}-dot-radius`, 'math.add.scalar', radius, bias);
    const edge = g.node(`${p}-edge`, 'math.smoothstep.scalar');
    g.edge(g.binary(`${p}-edge-low`, 'math.subtract.scalar', dotRadius, edgeWidth), edge, 'edge0'); g.edge(g.binary(`${p}-edge-high`, 'math.add.scalar', dotRadius, edgeWidth), edge, 'edge1');
    g.edge(g.unary(`${p}-distance`, 'vector.length.vec2', place), edge, 'value');
    return g.binary(`${p}-mark`, 'math.subtract.scalar', one, edge);
  });

  // Print: the paper's light through both inks where their dots sit (inks multiply where they overlap).
  const filters = RISO_INKS.map((ink, index) => {
    const filter = g.node(`${ink.id}-filter`, 'math.mix.rgb'); g.edge(oneRgb, filter, 'a'); g.edge(inks[ink.id].linear, filter, 'b'); g.edge(marks[index], filter, 't'); return filter;
  });
  let printedLinear = g.binary('printed-linear', 'math.multiply.rgb', g.binary('paper-dark', 'math.multiply.rgb', paperLinear, filters[0]), filters[1]);
  if (glowing && glowInk) {
    // Glow Source: where the glow ink prints and the shadow ink does not, cell by cell (its coverage × (1 − the shadow
    // ink's)). The print and this share are cached together (one pass), then gathered over a RISO_GLOW_KERNEL ×
    // RISO_GLOW_KERNEL window of taps RISO_GLOW_STEP cells apart with Gaussian weights: a soft field that spills past
    // the edges of the glow ink's colours.
    const visible = g.binary('glow-visible', 'math.multiply.scalar', glowInk.coverage, g.binary('glow-uncovered', 'math.subtract.scalar', one, glowInk.otherCoverage));
    const packed = g.node('glow-print', 'vector.combine.rgba', 'image'); g.edge(printedLinear, packed, 'rgb');
    g.edge({ node: g.unary('glow-visible-alpha', 'convert.scalar-to-alpha', visible).node, port: 'alpha' }, packed, 'alpha');
    const cache = g.node('glow-cache', 'image.materialize', 'image', {}, { scale: '1' }); g.edge(packed, cache, 'image');
    const sampleOf = (id: string, at: Ref) => { const out = g.node(id, 'image.sample', 'image'); g.edge(cache, out, 'image'); g.edge(at, out, 'uv'); return out; };
    const cached = g.node('glow-cached-split', 'vector.split.rgba', 'rgb'); g.edge(sampleOf('glow-cached', uv), cached, 'image');
    const window = g.number('glow-window', RISO_GLOW_KERNEL), centreTap = g.number('glow-centre-tap', (RISO_GLOW_KERNEL - 1) / 2);
    const index = g.node('glow-index', 'vector.split.vec2', 'x'); g.edge(g.node('glow-kernel', 'image.kernel-index'), index, 'value');
    const tap = g.node('glow-tap', 'vector.combine.vec2');
    g.edge(g.binary('glow-tap-x', 'math.subtract.scalar', { node: index.node, port: 'x' }, centreTap), tap, 'x');
    g.edge(g.binary('glow-tap-y', 'math.subtract.scalar', { node: index.node, port: 'y' }, centreTap), tap, 'y');
    const weight = g.node('glow-tap-weight', 'math.gaussian.scalar'); g.edge(g.unary('glow-tap-distance', 'vector.length.vec2', tap), weight, 'value');
    g.edge(g.number('glow-sigma', RISO_GLOW_SIGMA), weight, 'sigma');
    // Taps RISO_GLOW_STEP cells apart (the same share of the frame at every size), kept within the frame's outer pixel centres.
    const step = g.binary('glow-step', 'math.multiply.scalar', size, g.number('glow-step-cells', RISO_GLOW_STEP));
    const offset = g.node('glow-tap-offset', 'math.multiply.vec2-scalar'); g.edge(tap, offset, 'a'); g.edge(step, offset, 'b');
    const at = g.clamp('glow-tap-pixels', 'math.clamp.vec2', g.binary('glow-tap-pixels-raw', 'math.add.vec2', pixel, offset), half2,
      g.binary('glow-last-centre', 'math.subtract.vec2', resolution, half2));
    const tapSample = sampleOf('glow-tap-sample', g.binary('glow-tap-uv', 'math.divide-ieee.vec2', at, resolution));
    const reduce = g.node('glow-gather', 'image.kernel-rect-reduce', 'sum');
    g.edge(tapSample, reduce, 'sample'); g.edge(weight, reduce, 'weight'); g.edge(window, reduce, 'width'); g.edge(window, reduce, 'height');
    const sums = g.node('glow-sums', 'vector.split.vec4', 'w'); g.edge(reduce, sums, 'value');
    const field = g.binary('glow-field', 'math.divide-ieee.scalar', { node: sums.node, port: 'w' }, { node: reduce.node, port: 'weightSum' });
    const light = g.node('glow-light', 'math.multiply.rgb-scalar'); g.edge(inks.warm.linear, light, 'a'); g.edge(field, light, 'b');
    // Pulse: RISO_GLOW_PULSE.rest + swing × cos(2 × time × Speed); the compiler turns Time × Speed into the distance a keyed Speed travelled.
    const time = g.node('time', 'image.timeline-time'), speed = g.node('speed', 'values.number', 'value', { value: 'speed' });
    const phase = g.binary('pulse-phase', 'math.multiply.scalar', g.binary('pulse-time', 'math.multiply.scalar', time, speed), two);
    const pulse = g.binary('pulse', 'math.add.scalar', g.number('pulse-rest', RISO_GLOW_PULSE.rest),
      g.binary('pulse-wave', 'math.multiply.scalar', g.unary('pulse-cos', 'math.cos.scalar', phase), g.number('pulse-swing', RISO_GLOW_PULSE.swing)));
    const glow = g.node('glow', 'values.number', 'value', { value: 'glow' });
    const strength = g.binary('glow-strength', 'math.multiply.scalar', g.binary('glow-clamped', 'math.max.scalar', glow, zero),
      g.binary('glow-pulse-gain', 'math.multiply.scalar', pulse, g.number('glow-gain', RISO_GLOW_GAIN)));
    // Screened onto the print in linear light: 1 − (1 − print) × e^(−strength × light), so a strong glow never clips.
    const fade = g.unary('glow-fade', 'convert.scalar-to-rgb', g.unary('glow-fade-scalar', 'math.exp.scalar', g.binary('glow-negative', 'math.subtract.scalar', zero, strength)));
    const keep = g.binary('glow-keep', 'math.power.rgb', { node: fade.node, port: 'rgb' }, light);
    const darkLeft = g.binary('glow-print-dark', 'math.subtract.rgb', oneRgb, { node: cached.node, port: 'rgb' });
    printedLinear = g.binary('glowing-linear', 'math.subtract.rgb', oneRgb, g.binary('glow-dark-kept', 'math.multiply.rgb', darkLeft, keep));
  }
  const printed = g.node('printed', 'color.linear-to-srgb.rgb', 'rgb'); g.edge(printedLinear, printed, 'rgb');
  // Mix: the print over the picture by Amount, with the pixel's own alpha.
  const mixed = g.node('mixed-color', 'math.mix.rgb'); g.edge({ node: own.node, port: 'rgb' }, mixed, 'a'); g.edge(printed, mixed, 'b'); g.edge(amount, mixed, 't');
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: own.node, port: 'alpha' }, combine, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  // Registration and Dot Size count pixels of a 1080p frame; a slip may stay below one pixel, a cell never does.
  const graph = measureInReferenceFrame({ version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout }, 'registration');
  // The Cell Colour reads take the picture averaged over half a cell: each cell shows its whole colour and moves smoothly (patternCellFilter.ts).
  return prefilterCellTaps(measureInReferenceFrame(graph, 'safe-dot-size', { minimumPixels: 1 }), 'safe-dot-size-pixels');
}
