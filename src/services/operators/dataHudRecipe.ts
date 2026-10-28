import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { GraphPort } from './blurGraphBuilder';
import { AnalogRecipeBuilder } from './analogRecipeBuilder';
import { objectAt, objectMap, objectMaskControls } from './objectMaskNodes';
import { chance, keyConstants, modulo, pixelScale, renderedPixels, roll, seedSalt } from './seededRecipeParts';
import { GLYPH_FONT_OPTIONS } from '../../effects/_shared/glyphFonts';
import {
  DATA_HUD_BOX_RANGE, DATA_HUD_CAPITALS, DATA_HUD_CHARACTER_WIDTH, DATA_HUD_FIRST_CAPITAL, DATA_HUD_LABEL_CHARACTERS, DATA_HUD_LABEL_SLOTS,
  DATA_HUD_LINE_RANGE, DATA_HUD_MARK_RANGE, DATA_HUD_SEED_RANGE, DATA_HUD_SIZE_RANGE, DATA_HUD_TEXT_RANGE,
} from '../../effects/analog/dataHudLimits';

/**
 * Data HUD recipe (see docs/Features/effects/data-hud.md): measurement marks drawn over the object, like the
 * overlay of a product render under analysis.
 * - Boxes (up to three, largest first: BOX_SHARES of Box Size): rectangles of Line Width lines with the
 *   middle Gap of each side open, a teal centre dot (Dots) and a label "x ddd y dddd" (Labels: the box
 *   position in pixels of a 1080p frame, monospace digits from a Text Atlas above its top-left corner).
 *   A box keeps its place and aspect for PLACE_HOLD states, the first of BOX_TRIES random places whose
 *   centre lies on the object (Object, Threshold); every state it only scales, evenly in width and height,
 *   from 1 down by Size Variation, gliding into the next scale over the last Glide share of the state.
 * - Text blocks (up to three): two to four lines of capitals, digits and signs beside the object, the even
 *   ones left of it, the odd ones right. A block picks a height on the object and finds the object's left
 *   and right edge in that row in every frame, so it travels with the object as if tracked.
 * - Small marks (up to DATA_HUD_MARK_RANGE): thin closed bars on the object with their own label, in the
 *   Marks colour; they hold their place for MARK_HOLD states, then jump.
 * - Every mark runs at its own tempo (half to full Rate) and phase, so the marks never change all at once.
 *   Lines, text and dots take their three colours; Amount fades the HUD.
 * Random keys are exact integers below 2^24 (seededRecipeParts.ts).
 */
const SALT = { width: 2, height: 3, centreX: 4, centreY: 5, label: 7, dot: 8, tempo: 9, phase: 10, columns: 11, lines: 12 } as const;
/** The boxes, largest first: each is this share of Box Size. */
const BOX_SHARES = [1, .62, .4] as const;
/** Random places a mark tries per hold; it takes the first whose centre lies on the object, else the frame centre. */
const TRIES = 10;
/** Tries spread over this middle share of the frame width (products sit in the middle; edges rarely hit). */
const TRY_SPAN = .7;
/** Samples across a row when a text block looks for the object's left and right edge. */
const ROW_SAMPLES = 16;
/** Text lines are this many Text Sizes apart; blocks keep this many Text Sizes from the object. */
const LINE_SPACING = 1.45;
const TEXT_MARGIN = 1.2;
/** Small marks: long side as a share of Box Size, short side as a share of the long one, share standing upright. */
const MARK_SIZE = [.05, .1] as const;
const MARK_THINNESS = [.2, .33] as const;
const MARK_STANDING = .3;
/** Small marks keep their place this many states (about 10 s at Rate 1.5), and try fewer places. */
const MARK_HOLD = 16;
const MARK_TRIES = 4;
/** A mark keeps its place (and aspect) for this many states; in between a box only scales. */
const PLACE_HOLD = 6;
/** The slowest mark moves at this share of Rate. */
const TEMPO_MIN = .5;
/** Label baseline gap above the box, in Text Sizes. */
const LABEL_LIFT = 1.35;

function sources(g: AnalogRecipeBuilder) {
  g.add('frame', 'image.frame'); g.add('uv', 'image.normalized-uv'); g.add('resolution', 'image.resolution'); g.add('time', 'image.timeline-time');
  g.number('zero', 0); g.number('one', 1); g.number('two', 2); g.number('half', .5); g.number('coverage-floor', 1e-6);
  keyConstants(g);
  g.add('source-split', 'vector.split.rgba', { image: ['frame', 'image'] });
  g.add('source-alpha', 'convert.alpha-to-scalar', { alpha: ['source-split', 'alpha'] });
  g.mul2('pixel', ['uv', 'uv'], ['resolution', 'value']);
  g.split2('pixel-split', 'pixel');
  g.split2('frame-size', ['resolution', 'value']);
}

function controls(g: AnalogRecipeBuilder) {
  g.clampedParam('size', 'scale', g.number('size-min', DATA_HUD_SIZE_RANGE[0]), g.number('size-max', DATA_HUD_SIZE_RANGE[1]));
  g.clampedParam('boxes', 'boxes', 'zero', g.number('boxes-max', DATA_HUD_BOX_RANGE[1]));
  g.clampedParam('blocks', 'textBlocks', 'zero', g.number('blocks-max', DATA_HUD_BOX_RANGE[1]));
  g.clampedParam('variation', 'variation', 'zero', 'one');
  g.clampedParam('gap', 'gap', 'zero', g.number('gap-max', .9));
  g.clampedParam('line', 'lineWidth', g.number('line-min', DATA_HUD_LINE_RANGE[0]), g.number('line-max', DATA_HUD_LINE_RANGE[1]));
  g.clampedParam('labels', 'labels', 'zero', 'one');
  g.clampedParam('dots', 'dots', 'zero', 'one');
  g.clampedParam('text', 'textSize', g.number('text-min', DATA_HUD_TEXT_RANGE[0]), g.number('text-max', DATA_HUD_TEXT_RANGE[1]));
  g.clampedParam('drift', 'drift', 'zero', 'one');
  g.clampedParam('amount', 'amount', 'zero', 'one');
  g.clampedParam('seed', 'seed', g.number('seed-min', DATA_HUD_SEED_RANGE[0]), g.number('seed-max', DATA_HUD_SEED_RANGE[1]));
  objectMaskControls(g);
  g.clampedParam('marks', 'marks', 'zero', g.number('marks-max', DATA_HUD_MARK_RANGE[1]));
  for (const [id, parameter] of [['line-colour', 'colorA'], ['text-colour', 'colorB'], ['dot-colour', 'dotColor'], ['mark-colour', 'markColor']] as const) {
    g.add(`${id}-rgb`, 'convert.vec4-to-rgb', { value: g.bound(id, parameter, 'values.color') });
  }
  // Time × Rate directly, so a keyframed Rate moves by its travelled distance (imageRateTravel.ts).
  g.max('elapsed', g.mul('rate-time', 'time', g.bound('rate', 'rate')), 'zero');
  seedSalt(g);
  pixelScale(g);
  renderedPixels(g, 'size-px', 'size-clamped');
  renderedPixels(g, 'line-px', 'line-clamped');
  g.mul('text-px', 'text-clamped', 'pixel-scale');
  g.mul('char-px', 'text-px', g.number('char-width', DATA_HUD_CHARACTER_WIDTH));
  g.add('label-atlas', 'glyph.text-atlas', {}, { bindings: {}, constants: { characters: DATA_HUD_LABEL_CHARACTERS, fontFamily: GLYPH_FONT_OPTIONS[0].value, fontWeight: 500 } });
}

/** 1 where a == n for whole numbers (between n − 0.5 and n + 0.5). */
function equals(g: AnalogRecipeBuilder, id: string, a: GraphPort, n: number) {
  return g.sub(id, g.add(`${id}-low`, 'math.step.scalar', { edge: g.number(`${id}-from`, n - .5), value: a }),
    g.add(`${id}-high`, 'math.step.scalar', { edge: g.number(`${id}-to`, n + .5), value: a }));
}

/** 1 where from <= a < to. */
function within(g: AnalogRecipeBuilder, id: string, a: GraphPort, from: GraphPort, to: GraphPort) {
  return g.mul(id, g.add(`${id}-low`, 'math.step.scalar', { edge: from, value: a }),
    g.sub(`${id}-below`, 'one', g.add(`${id}-high`, 'math.step.scalar', { edge: to, value: a })));
}

/** The label glyph coverage of one box at this pixel ("x ddd y dddd" above its top-left corner). */
function label(g: AnalogRecipeBuilder, p: string, cx: GraphPort, cy: GraphPort, hx: GraphPort, hy: GraphPort) {
  const left = g.sub(`${p}-label-left`, cx, hx);
  const top = g.sub(`${p}-label-top`, g.sub(`${p}-label-box-top`, cy, hy), g.mul(`${p}-label-lift`, 'text-px', g.number(`${p}-label-lift-share`, LABEL_LIFT)));
  const rx = g.sub(`${p}-label-x`, ['pixel-split', 'x'], left), ry = g.sub(`${p}-label-y`, ['pixel-split', 'y'], top);
  const inside = g.mul(`${p}-label-inside`, within(g, `${p}-label-in-x`, rx, 'zero', g.mul(`${p}-label-width`, 'char-px', g.number(`${p}-label-slots`, DATA_HUD_LABEL_SLOTS))),
    within(g, `${p}-label-in-y`, ry, 'zero', 'text-px'));
  const position = g.div(`${p}-label-column`, rx, 'char-px');
  const slot = g.fn(`${p}-label-slot`, 'floor', position);
  // The box position in pixels of a 1080p frame: x as three digits, y as up to four.
  const x = modulo(g, `${p}-label-x-value`, g.fn(`${p}-label-x-whole`, 'floor', g.div(`${p}-label-x-ref`, cx, 'pixel-scale')), 1000);
  const y = modulo(g, `${p}-label-y-value`, g.fn(`${p}-label-y-whole`, 'floor', g.div(`${p}-label-y-ref`, cy, 'pixel-scale')), 10000);
  const xDigit = within(g, `${p}-label-x-digit`, slot, g.number(`${p}-label-x-first`, 2), g.number(`${p}-label-x-end`, 5));
  const yDigit = within(g, `${p}-label-y-digit`, slot, g.number(`${p}-label-y-first`, 8), g.number(`${p}-label-y-end`, 12));
  // Slot 2-4 show x / 100, 10, 1; slots 8-11 show y / 1000, 100, 10, 1.
  const exponent = g.plus(`${p}-label-exponent`, g.mul(`${p}-label-x-exponent`, xDigit, g.sub(`${p}-label-x-place`, g.number(`${p}-label-x-last`, 4), slot)),
    g.mul(`${p}-label-y-exponent`, yDigit, g.sub(`${p}-label-y-place`, g.number(`${p}-label-y-last`, 11), slot)));
  const place = g.fn(`${p}-label-place`, 'floor', g.plus(`${p}-label-place-rounded`, g.binary(`${p}-label-power`, 'math.power.scalar', g.number(`${p}-label-ten`, 10), exponent), 'half'));
  const value = g.plus(`${p}-label-value`, g.mul(`${p}-label-x-share`, xDigit, x), g.mul(`${p}-label-y-share`, yDigit, y));
  const digit = modulo(g, `${p}-label-digit`, g.fn(`${p}-label-shifted`, 'floor', g.div(`${p}-label-scaled`, g.plus(`${p}-label-value-centre`, value, 'half'), place)), 10);
  const isX = equals(g, `${p}-label-is-x`, slot, 0), isY = equals(g, `${p}-label-is-y`, slot, 6);
  const index = g.plus(`${p}-label-index`, g.plus(`${p}-label-letters`, g.mul(`${p}-label-x-index`, isX, g.number(`${p}-label-x-glyph`, 10)),
    g.mul(`${p}-label-y-index`, isY, g.number(`${p}-label-y-glyph`, 11))), g.mul(`${p}-label-digit-index`, g.plus(`${p}-label-digits`, xDigit, yDigit), digit));
  // A y below 1000 leaves its first digit blank; spaces (slots 1, 5, 7) are blank.
  const blankLead = g.mul(`${p}-label-blank-lead`, equals(g, `${p}-label-is-lead`, slot, 8), g.sub(`${p}-label-short-y`, 'one',
    g.add(`${p}-label-long-y`, 'math.step.scalar', { edge: g.number(`${p}-label-thousand`, 1000), value: y })));
  const drawn = g.sub(`${p}-label-drawn`, g.plus(`${p}-label-glyphs`, g.plus(`${p}-label-letter`, isX, isY), g.plus(`${p}-label-number`, xDigit, yDigit)), blankLead);
  // The monospace glyph fills the middle of its square atlas cell.
  const u = g.plus(`${p}-label-u`, g.mul(`${p}-label-u-narrow`, g.sub(`${p}-label-u-centred`, g.fn(`${p}-label-u-cell`, 'fract', position), 'half'),
    g.number(`${p}-label-u-share`, DATA_HUD_CHARACTER_WIDTH)), 'half');
  const v = g.div(`${p}-label-v`, ry, 'text-px');
  g.add(`${p}-label-glyph`, 'glyph.sample', { atlas: ['label-atlas', 'image'], columns: ['label-atlas', 'columns'], rows: ['label-atlas', 'rows'],
    index, uv: g.vec2(`${p}-label-uv`, u, v) });
  return g.mul(`${p}-label-coverage`, g.mul(`${p}-label-visible`, inside, drawn), [`${p}-label-glyph`, 'coverage']);
}

interface MarkClock {
  state: string; next: string; placeState: string; local: string;
  /** 0 while the mark holds, gliding to 1 over the last Glide share of the state. */
  glide: string;
  /** A roll of this mark for `when` (a state); `row` keeps several rolls of one kind apart (tries, rows). */
  rollAt: (kind: keyof typeof SALT, when: GraphPort, tag: string, row?: number) => string;
}

/** The clock of mark `key` (one per box or text block, not per pixel, so every pixel draws the same mark). */
function markClock(g: AnalogRecipeBuilder, p: string, key: number, hold = PLACE_HOLD): MarkClock {
  const kx = g.number(`${p}-key-x`, 2048 + key);
  const rollAt = (kind: keyof typeof SALT, when: GraphPort, tag: string, row = 0) =>
    roll(g, `${p}-${tag}`, SALT[kind], kx, row ? g.number(`${p}-${tag}-row`, 2048 + row) : 'index-offset', when);
  const tempo = g.plus(`${p}-tempo`, g.number(`${p}-tempo-min`, TEMPO_MIN), g.mul(`${p}-tempo-spread`, rollAt('tempo', 'zero', 'tempo-roll'), g.number(`${p}-tempo-range`, 1 - TEMPO_MIN)));
  const local = g.plus(`${p}-local`, g.mul(`${p}-paced`, 'elapsed', tempo), rollAt('phase', 'zero', 'phase-roll'));
  const step = g.fn(`${p}-step`, 'floor', local);
  const glide = g.smooth(`${p}-glide`, g.sub(`${p}-glide-start`, 'one', g.max(`${p}-glide-share`, 'drift-clamped', g.number(`${p}-glide-floor`, .001))), 'one',
    g.fn(`${p}-progress`, 'fract', local));
  return { local, glide, rollAt,
    state: modulo(g, `${p}-state`, step, 'key-range'),
    next: modulo(g, `${p}-next-state`, g.plus(`${p}-next-step`, step, 'one'), 'key-range'),
    placeState: modulo(g, `${p}-place-state`, g.fn(`${p}-place-step`, 'floor', g.div(`${p}-place-local`, local, g.number(`${p}-place-hold`, hold))), 'key-range') };
}

/** The first of TRIES random points (held with the place) that lies on the object, else the frame centre; `hit` = any. */
function findOnObject(g: AnalogRecipeBuilder, p: string, clock: MarkClock, count = TRIES) {
  const tries = Array.from({ length: count }, (_, k) => {
    const x = g.mul(`${p}-try${k}-x`, g.plus(`${p}-try${k}-x-share`, g.number(`${p}-try${k}-x-margin`, (1 - TRY_SPAN) / 2),
      g.mul(`${p}-try${k}-x-spread`, clock.rollAt('centreX', clock.placeState, `try${k}-x-roll`, k + 1), g.number(`${p}-try${k}-x-span`, TRY_SPAN))), ['frame-size', 'x']);
    const y = g.mul(`${p}-try${k}-y`, clock.rollAt('centreY', clock.placeState, `try${k}-y-roll`, k + 1), ['frame-size', 'y']);
    return { x, y, hit: objectAt(g, `${p}-try${k}`, g.binary(`${p}-try${k}-uv`, 'math.divide-ieee.vec2', g.vec2(`${p}-try${k}-pixel`, x, y), ['resolution', 'value'])) };
  });
  let x: GraphPort = g.mul(`${p}-fallback-x`, ['frame-size', 'x'], 'half'), y: GraphPort = g.mul(`${p}-fallback-y`, ['frame-size', 'y'], 'half');
  let hit: GraphPort = 'zero';
  for (let k = count - 1; k >= 0; k--) {
    x = g.mix(`${p}-pick${k}-x`, x, tries[k].x, tries[k].hit);
    y = g.mix(`${p}-pick${k}-y`, y, tries[k].y, tries[k].hit);
    hit = g.max(`${p}-hit${k}`, hit, tries[k].hit);
  }
  return { x, y, hit };
}

/**
 * Box `index` (0 = largest): its line, label and dot coverage at this pixel (`${p}-line`, `-text`, `-dot`).
 * It shows while `index` < Boxes and a place on the object was found.
 */
function hudBox(g: AnalogRecipeBuilder, index: number) {
  const p = `box${index}`;
  const clock = markClock(g, p, index);
  const { placeState } = clock;
  const rollAt = (kind: keyof typeof SALT, when: GraphPort, tag: string) => clock.rollAt(kind, when, tag);
  // Even scale: one factor for width and height, from 1 down by Size Variation, gliding into the next state's.
  const scaleAt = (when: string, tag: string) => g.sub(`${p}-scale-${tag}`, 'one', g.mul(`${p}-shrink-${tag}`, 'variation-clamped',
    g.mul(`${p}-shrink-${tag}-share`, rollAt('width', when, `scale-${tag}-roll`), 'half')));
  const scale = g.mix(`${p}-scale`, scaleAt(clock.state, 'now'), scaleAt(clock.next, 'next'), clock.glide);
  // Aspect, held with the place: 0.7 to 1.4 width per height.
  const aspect = g.plus(`${p}-aspect`, g.number(`${p}-aspect-min`, .7), g.mul(`${p}-aspect-spread`, rollAt('height', placeState, 'aspect-roll'), g.number(`${p}-aspect-range`, .7)));
  const base = g.mul(`${p}-base`, g.mul(`${p}-base-size`, 'size-px', g.number(`${p}-share`, BOX_SHARES[index])), g.mul(`${p}-base-scaled`, scale, 'half'));
  const hx = g.mul(`${p}-half-w`, base, g.fn(`${p}-aspect-w`, 'sqrt', aspect)), hy = g.div(`${p}-half-h`, base, g.fn(`${p}-aspect-h`, 'sqrt', aspect));
  const centre = findOnObject(g, p, clock);
  const cx = centre.x, cy = centre.y;
  const shown = g.add(`${p}-shown`, 'math.step.scalar', { edge: g.number(`${p}-index`, index + .5), value: 'boxes-clamped' });
  const placed = g.mul(`${p}-placed`, shown, centre.hit);
  // Outline: inside the box and within Line Width of a side; the middle Gap of each side stays open.
  const dx = g.fn(`${p}-dx`, 'abs', g.sub(`${p}-dx-signed`, ['pixel-split', 'x'], cx)), dy = g.fn(`${p}-dy`, 'abs', g.sub(`${p}-dy-signed`, ['pixel-split', 'y'], cy));
  const inBox = g.mul(`${p}-in-box`, g.add(`${p}-in-x`, 'math.step.scalar', { edge: dx, value: hx }), g.add(`${p}-in-y`, 'math.step.scalar', { edge: dy, value: hy }));
  const vertical = g.add(`${p}-side-v`, 'math.step.scalar', { edge: g.sub(`${p}-inner-x`, hx, 'line-px'), value: dx });
  const horizontal = g.add(`${p}-side-h`, 'math.step.scalar', { edge: g.sub(`${p}-inner-y`, hy, 'line-px'), value: dy });
  const band = g.max(`${p}-band`, vertical, horizontal);
  const openH = g.mul(`${p}-open-h`, g.mul(`${p}-open-h-side`, horizontal, g.sub(`${p}-not-v`, 'one', vertical)),
    g.sub(`${p}-open-h-mid`, 'one', g.add(`${p}-open-h-out`, 'math.step.scalar', { edge: g.mul(`${p}-gap-x`, 'gap-clamped', hx), value: dx })));
  const openV = g.mul(`${p}-open-v`, g.mul(`${p}-open-v-side`, vertical, g.sub(`${p}-not-h`, 'one', horizontal)),
    g.sub(`${p}-open-v-mid`, 'one', g.add(`${p}-open-v-out`, 'math.step.scalar', { edge: g.mul(`${p}-gap-y`, 'gap-clamped', hy), value: dy })));
  g.mul(`${p}-line`, g.mul(`${p}-line-placed`, placed, g.mul(`${p}-line-band`, inBox, band)), g.sub(`${p}-line-closed`, 'one', g.max(`${p}-open`, openH, openV)));
  // Centre dot: a square of about two Line Widths.
  const dotHalf = g.max(`${p}-dot-half`, g.mul(`${p}-dot-size`, 'line-px', g.number(`${p}-dot-share`, .9)), 'one');
  g.mul(`${p}-dot`, g.mul(`${p}-dot-placed`, placed, chance(g, `${p}-dot-on`, rollAt('dot', placeState, 'dot-roll'), 'dots-clamped')),
    g.add(`${p}-dot-in`, 'math.step.scalar', { edge: g.max(`${p}-dot-distance`, dx, dy), value: dotHalf }));
  g.mul(`${p}-text`, g.mul(`${p}-text-placed`, placed, chance(g, `${p}-label-on`, rollAt('label', placeState, 'label-roll'), 'labels-clamped')), label(g, p, cx, cy, hx, hy));
}


/**
 * Text block `index`: two to four lines of eight to fifteen monospace characters (a line of capitals, then
 * digits, capitals and signs, ragged at the right) beside the object, left of it for even blocks, right for
 * odd ones. The row is held with the place; the object's edge in that row is found in every frame, so the
 * block travels with the object. Returns its glyph coverage at this pixel.
 */
function textBlock(g: AnalogRecipeBuilder, index: number) {
  const p = `text${index}`;
  const clock = markClock(g, p, 8 + index);
  const { placeState } = clock;
  const row = findOnObject(g, p, clock);
  // The object's left- and rightmost sample in that row.
  let leftmost: GraphPort = ['frame-size', 'x'], rightmost: GraphPort = 'zero';
  for (let k = 0; k < ROW_SAMPLES; k++) {
    const x = g.mul(`${p}-scan${k}-x`, ['frame-size', 'x'], g.number(`${p}-scan${k}-share`, (k + .5) / ROW_SAMPLES));
    const hit = objectAt(g, `${p}-scan${k}`, g.binary(`${p}-scan${k}-uv`, 'math.divide-ieee.vec2', g.vec2(`${p}-scan${k}-pixel`, x, row.y), ['resolution', 'value']));
    leftmost = g.min(`${p}-left${k}`, leftmost, g.mix(`${p}-left${k}-candidate`, ['frame-size', 'x'], x, hit));
    rightmost = g.max(`${p}-right${k}`, rightmost, g.mul(`${p}-right${k}-candidate`, x, hit));
  }
  const lineHeight = g.mul(`${p}-line-height`, 'text-px', g.number(`${p}-line-share`, LINE_SPACING));
  const columns = g.plus(`${p}-columns`, g.number(`${p}-columns-min`, 8), g.fn(`${p}-columns-extra`, 'floor', g.mul(`${p}-columns-scaled`, clock.rollAt('columns', placeState, 'columns-roll'), g.number(`${p}-columns-range`, 8))));
  const lines = g.plus(`${p}-lines`, 'two', g.fn(`${p}-lines-extra`, 'floor', g.mul(`${p}-lines-scaled`, clock.rollAt('lines', placeState, 'lines-roll'), g.number(`${p}-lines-range`, 3))));
  const width = g.mul(`${p}-width`, columns, 'char-px'), height = g.mul(`${p}-height`, lines, lineHeight);
  const margin = g.mul(`${p}-margin`, 'text-px', g.number(`${p}-margin-share`, TEXT_MARGIN));
  const inset = g.number(`${p}-inset`, 4);
  // Left blocks end a margin before the object, right blocks start a margin after it; both stay in the frame.
  const left = index % 2 === 0
    ? g.max(`${p}-x0`, g.sub(`${p}-x0-raw`, g.sub(`${p}-x0-edge`, leftmost, margin), width), inset)
    : g.min(`${p}-x0`, g.plus(`${p}-x0-raw`, rightmost, margin), g.sub(`${p}-x0-max`, g.sub(`${p}-x0-frame`, ['frame-size', 'x'], width), inset));
  const top = g.sub(`${p}-y0`, row.y, g.mul(`${p}-half-height`, height, 'half'));
  const rx = g.sub(`${p}-x`, ['pixel-split', 'x'], left), ry = g.sub(`${p}-y`, ['pixel-split', 'y'], top);
  const column = g.fn(`${p}-column`, 'floor', g.div(`${p}-column-position`, rx, 'char-px'));
  const line = g.fn(`${p}-line`, 'floor', g.div(`${p}-line-position`, ry, lineHeight));
  const inLine = g.sub(`${p}-in-line-y`, ry, g.mul(`${p}-line-top`, line, lineHeight));
  const inside = g.mul(`${p}-inside`, g.mul(`${p}-inside-box`, within(g, `${p}-in-x`, rx, 'zero', width), within(g, `${p}-in-y`, ry, 'zero', height)),
    within(g, `${p}-in-glyph`, inLine, 'zero', 'text-px'));
  // One random value per character, line and state (Random (Cell): exact integer keys).
  const seeded = modulo(g, `${p}-char-state`, g.plus(`${p}-char-state-seeded`, clock.state, g.mul(`${p}-char-seed`, 'seed-key', g.number(`${p}-seed-stride`, 97))), 'key-range');
  const value = g.unary(`${p}-char-roll`, 'noise.cell-hash.vec2', g.vec2(`${p}-char-key`,
    g.plus(`${p}-char-key-x`, g.plus(`${p}-char-key-column`, column, g.mul(`${p}-char-key-line`, line, g.number(`${p}-line-stride`, 32))), g.number(`${p}-char-key-block`, 128 * (index + 1))),
    g.plus(`${p}-char-key-y`, g.number(`${p}-char-key-base`, 7), g.mul(`${p}-char-key-state`, seeded, 'key-range'))));
  // Each line ends after a random share of the columns; about one character in eight is a space.
  const lineRoll = g.unary(`${p}-line-roll`, 'noise.cell-hash.vec2', g.vec2(`${p}-line-key`, g.plus(`${p}-line-key-x`, line, g.number(`${p}-line-key-block`, 64 * (index + 1))),
    g.mul(`${p}-line-key-state`, placeState, 'key-range')));
  const length = g.sub(`${p}-length`, columns, g.fn(`${p}-trim`, 'floor', g.mul(`${p}-trim-share`, lineRoll, g.mul(`${p}-trim-max`, columns, 'half'))));
  const space = g.add(`${p}-space`, 'math.step.scalar', { edge: g.fn(`${p}-space-roll`, 'fract', g.mul(`${p}-space-spread`, value, g.number(`${p}-space-scale`, 13))), value: g.number(`${p}-space-share`, .12) });
  const drawn = g.mul(`${p}-drawn`, g.mul(`${p}-drawn-line`, inside, g.sub(`${p}-in-length`, 'one', g.add(`${p}-past-end`, 'math.step.scalar', { edge: length, value: column }))), g.sub(`${p}-not-space`, 'one', space));
  // The first line is capitals; the others mix every glyph.
  const header = equals(g, `${p}-header`, line, 0);
  const anyGlyph = g.fn(`${p}-any-glyph`, 'floor', g.mul(`${p}-any-glyph-scaled`, value, g.number(`${p}-glyph-count`, DATA_HUD_LABEL_CHARACTERS.length)));
  const capital = g.plus(`${p}-capital`, g.number(`${p}-first-capital`, DATA_HUD_FIRST_CAPITAL), g.fn(`${p}-capital-index`, 'floor', g.mul(`${p}-capital-scaled`, value, g.number(`${p}-capital-count`, DATA_HUD_CAPITALS))));
  const glyph = g.mix(`${p}-glyph-index`, anyGlyph, capital, header);
  const u = g.plus(`${p}-u`, g.mul(`${p}-u-narrow`, g.sub(`${p}-u-centred`, g.fn(`${p}-u-cell`, 'fract', g.div(`${p}-u-position`, rx, 'char-px')), 'half'),
    g.number(`${p}-u-share`, DATA_HUD_CHARACTER_WIDTH)), 'half');
  g.add(`${p}-glyph`, 'glyph.sample', { atlas: ['label-atlas', 'image'], columns: ['label-atlas', 'columns'], rows: ['label-atlas', 'rows'],
    index: glyph, uv: g.vec2(`${p}-uv`, u, g.div(`${p}-v`, inLine, 'text-px')) });
  const shown = g.add(`${p}-shown`, 'math.step.scalar', { edge: g.number(`${p}-index`, index + .5), value: 'blocks-clamped' });
  return g.mul(`${p}-coverage`, g.mul(`${p}-visible`, g.mul(`${p}-placed`, shown, row.hit), drawn), [`${p}-glyph`, 'coverage']);
}

/** Paint `colour` over the premultiplied colour/alpha so far with `coverage` × Amount. */
function over(g: AnalogRecipeBuilder, id: string, rgb: GraphPort, alpha: GraphPort, colour: GraphPort, coverage: GraphPort) {
  const t = g.mul(`${id}-t`, g.min(`${id}-coverage`, coverage, 'one'), 'amount-clamped'), keep = g.sub(`${id}-keep`, 'one', t);
  return { rgb: g.addRgb(`${id}-rgb`, g.scaleRgb(`${id}-under`, rgb, keep), g.scaleRgb(`${id}-paint`, colour, t)), alpha: g.plus(`${id}-alpha`, g.mul(`${id}-alpha-under`, alpha, keep), t) };
}

/**
 * Small mark `index`: a thin closed bar on the object (MARK_SIZE of Box Size long, MARK_THINNESS as wide,
 * lying or standing), shown while `index` < Small Marks, with a label by Labels. It keeps its place for
 * MARK_HOLD states and then jumps. Returns its line and label coverage (`${p}-line`, `${p}-text`).
 */
function smallMark(g: AnalogRecipeBuilder, index: number) {
  const p = `mark${index}`;
  const clock = markClock(g, p, 16 + index, MARK_HOLD);
  const { placeState } = clock;
  // A thin bar: its long side MARK_SIZE of Box Size, its short side MARK_THINNESS of that; lying or standing.
  const long = g.mul(`${p}-long`, g.mul(`${p}-length`, 'size-px', g.plus(`${p}-length-share`, g.number(`${p}-length-min`, MARK_SIZE[0]),
    g.mul(`${p}-length-spread`, clock.rollAt('width', placeState, 'width-roll'), g.number(`${p}-length-range`, MARK_SIZE[1] - MARK_SIZE[0])))), 'half');
  const short = g.max(`${p}-short`, g.mul(`${p}-short-share`, long, g.plus(`${p}-thin`, g.number(`${p}-thin-min`, MARK_THINNESS[0]),
    g.mul(`${p}-thin-spread`, clock.rollAt('height', placeState, 'height-roll'), g.number(`${p}-thin-range`, MARK_THINNESS[1] - MARK_THINNESS[0])))), 'line-px');
  const standing = chance(g, `${p}-standing`, clock.rollAt('dot', placeState, 'standing-roll'), g.number(`${p}-standing-share`, MARK_STANDING));
  const hx = g.mix(`${p}-half-w`, long, short, standing), hy = g.mix(`${p}-half-h`, short, long, standing);
  const { x: cx, y: cy, hit } = findOnObject(g, p, clock, MARK_TRIES);
  const shown = g.mul(`${p}-placed`, g.add(`${p}-shown`, 'math.step.scalar', { edge: g.number(`${p}-index`, index + .5), value: 'marks-clamped' }), hit);
  const line = g.max(`${p}-line-px`, g.mul(`${p}-line-thin`, 'line-px', g.number(`${p}-line-share`, .75)), 'one');
  const dx = g.fn(`${p}-dx`, 'abs', g.sub(`${p}-dx-signed`, ['pixel-split', 'x'], cx)), dy = g.fn(`${p}-dy`, 'abs', g.sub(`${p}-dy-signed`, ['pixel-split', 'y'], cy));
  const inBox = g.mul(`${p}-in-box`, g.add(`${p}-in-x`, 'math.step.scalar', { edge: dx, value: hx }), g.add(`${p}-in-y`, 'math.step.scalar', { edge: dy, value: hy }));
  const band = g.max(`${p}-band`, g.add(`${p}-side-v`, 'math.step.scalar', { edge: g.sub(`${p}-inner-x`, hx, line), value: dx }),
    g.add(`${p}-side-h`, 'math.step.scalar', { edge: g.sub(`${p}-inner-y`, hy, line), value: dy }));
  g.mul(`${p}-line`, shown, g.mul(`${p}-outline`, inBox, band));
  g.mul(`${p}-text`, g.mul(`${p}-text-placed`, shown, chance(g, `${p}-label-on`, clock.rollAt('label', placeState, 'label-roll'), 'labels-clamped')), label(g, p, cx, cy, hx, hy));
}

export function createDefaultDataHudGraph(): EffectOperatorGraph {
  const g = new AnalogRecipeBuilder();
  sources(g); controls(g); objectMap(g);
  const boxes = BOX_SHARES.map((_, index) => { hudBox(g, index); return `box${index}`; });
  const blocks = BOX_SHARES.map((_, index) => textBlock(g, index));
  const merge = (id: string, parts: GraphPort[]) => parts.slice(1).reduce<GraphPort>((all, part, k) => g.max(`${id}-${k}`, all, part), parts[0]);
  const lines = merge('hud-line', boxes.map(box => `${box}-line`)), dots = merge('hud-dot', boxes.map(box => `${box}-dot`));
  const text = merge('hud-text', [...boxes.map(box => `${box}-text`), ...blocks]);
  const marks = Array.from({ length: DATA_HUD_MARK_RANGE[1] }, (_, index) => { smallMark(g, index); return `mark${index}`; });
  const markLines = merge('hud-mark', marks.flatMap(mark => [`${mark}-line`, `${mark}-text`]));
  // Premultiplied frame, then lines, text and dots on top.
  let paint = { rgb: g.scaleRgb('base-rgb', ['source-split', 'rgb'], 'source-alpha') as GraphPort, alpha: 'source-alpha' as GraphPort };
  paint = over(g, 'paint-lines', paint.rgb, paint.alpha, ['line-colour-rgb', 'rgb'], lines);
  paint = over(g, 'paint-text', paint.rgb, paint.alpha, ['text-colour-rgb', 'rgb'], text);
  paint = over(g, 'paint-marks', paint.rgb, paint.alpha, ['mark-colour-rgb', 'rgb'], markLines);
  paint = over(g, 'paint-dots', paint.rgb, paint.alpha, ['dot-colour-rgb', 'rgb'], dots);
  const straight = g.add('result-rgb', 'math.divide-ieee.rgb-scalar', { a: paint.rgb, b: g.max('result-safe-alpha', paint.alpha, 'coverage-floor') });
  g.add('result', 'vector.combine.rgba', { rgb: straight, alpha: [g.unary('result-alpha', 'convert.scalar-to-alpha', paint.alpha), 'alpha'] });
  g.add('output', 'image.output', { image: ['result', 'image'] });
  return g.graph(10);
}
