import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
import { GLYPH_ATLAS_TEXEL_INSET, GLYPH_MAX_BLACK_LEVEL, GLYPH_MIN_CELL_PIXELS, GLYPH_NO_TRAVEL, GLYPH_REFERENCE_HEIGHT, GLYPH_SPEED_TRAVEL } from '../../effects/glyph/glyphGrid';
import { RETRO_LEGACY_SCANLINES, RETRO_LINE_SPACING, RETRO_PHOSPHOR, RETRO_SCROLL_RATE, RETRO_TONE_BASE, RETRO_TONE_FACTOR } from '../../effects/glyph/retroMatrix';
type Ref = { node: string; port: string };
class Builder {
  nodes: BoundOperatorNode[] = []; edges: OperatorEdge[] = []; layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, port = 'value', bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref { this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) }); this.layout[id] = { x: (this.nodes.length % 10) * 340, y: Math.floor(this.nodes.length / 10) * 360 }; return { node: id, port }; }
  number(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${from.port}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref) { const out = this.node(id, operator); this.edge(value, out, 'value'); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
}

type GlyphGraphVariant = 'ascii' | 'number-field' | 'grid-glyph' | 'pixel-code' | 'word-mosaic' | 'glyph-matrix' | 'data-hatch' | 'brand-generator' | 'stitch-poster' | 'dither-text' | 'symbol-matrix' | 'pixel-dither' | 'retro-matrix' | 'capsule-cloud' | 'ui-collage' | 'matrix' | 'ascii-ghost' | 'inscribe' | 'contour-type';

/**
 * Shared granular expansion of the glyph cell, ramp, and atlas path (every look of the glyph engine).
 * - Cells: Cell Size (at least 2) counts pixels of a 1080p frame (shorter side), at least 2 output
 *   pixels, so preview qualities, thumbnails and exports show the same characters (glyphGrid.ts).
 * - Clock: moving looks advance by timeline time × Speed, or by the distance a keyframed Speed has
 *   travelled (`speedTravel`, written while rendering), so a Speed ramp never jumps.
 * - Roll (moving looks): each cell runs through a window of 1 + ceil(Roll × (ramp − 1)) characters around
 *   its own one; Roll 1 is the whole ramp (instances saved before Roll existed), 0 holds the cells still.
 * - Background: the cell ground is mixed from the look's dark ground towards the character colour
 *   (Background 0 = the original dark ground, which instances saved before it existed keep).
 */
function createDefaultGlyphGraph(variant: GlyphGraphVariant): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv'), resolution = g.node('resolution', 'image.resolution');
  const cellSize = g.node('cell-size', 'values.number', 'value', { value: 'cellSize' }), amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const animated = variant === 'glyph-matrix' || variant === 'data-hatch' || variant === 'dither-text' || variant === 'symbol-matrix' || variant === 'pixel-dither' || variant === 'retro-matrix' || variant === 'capsule-cloud' || variant === 'ui-collage' || variant === 'matrix' || variant === 'ascii-ghost';
  const speed = animated ? g.node('speed', 'values.number', 'value', { value: 'speed' }) : undefined;
  const time = animated ? g.node('time', 'image.timeline-time') : undefined;
  const invert = g.node('invert', 'values.boolean', 'value', { value: 'invert' }), colorMode = g.node('color-mode', 'values.choice', 'value', { value: 'colorMode' });
  const colorA = g.node('color-a', 'values.color', 'value', { value: 'colorA' }), colorB = g.node('color-b', 'values.color', 'value', { value: 'colorB' });
  // Without a stored value (an instance saved before Background existed) the ground stays dark (0).
  const backgroundValue = g.node('background-value', 'values.number', 'value', { value: 'background' }, { value: 0 });
  // fill: the characters fill their cell (graphs saved before it keep the smaller type, glyphAtlasRaster.ts).
  const atlas = g.node('atlas', 'glyph.atlas', 'image', { rampPreset: 'rampPreset', customRamp: 'customRamp', fontFamily: 'fontFamily', fontWeight: 'fontWeight' }, { fill: true });
  const glyphCount = { node: atlas.node, port: 'glyphCount' }, columns = { node: atlas.node, port: 'columns' }, rows = { node: atlas.node, port: 'rows' };
  const zero = g.number('zero', 0), one = g.number('one', 1), two = g.number('two', 2), half = g.number('half', .5), almost = g.number('almost', .999), indexMax = g.number('index-max', .99999);
  // Cell Size below 2 renders as 2 (renderMin; paramRangeNotes reports it through this node's id).
  const cellClamped = g.binary('cellSize-clamped', 'math.max.scalar', cellSize, two);
  const shortSide = g.unary('safe-cell-short-side', 'vector.reduce-min.vec2', resolution);
  const frameScale = g.binary('safe-cell-frame-scale', 'math.divide-ieee.scalar', shortSide, g.number('safe-cell-reference-height', GLYPH_REFERENCE_HEIGHT));
  const cellPixels = g.binary('safe-cell-pixels', 'math.multiply.scalar', cellClamped, frameScale);
  const safeCell = g.binary('safe-cell', 'math.max.scalar', cellPixels, g.number('safe-cell-minimum', GLYPH_MIN_CELL_PIXELS)), safeCell2 = g.unary('safe-cell-vec2', 'convert.scalar-to-vec2', safeCell);
  const grid = g.binary('grid', 'math.divide-ieee.vec2', resolution, safeCell2), scaledUv = g.binary('scaled-uv', 'math.multiply.vec2', uv, grid);
  // Timeline time × Speed, or the distance a keyframed Speed has travelled (absent: GLYPH_NO_TRAVEL). Built where a
  // look first needs it: Retro Matrix's scroll moves the cell grid itself, the other moving looks pick characters with it.
  let motionClock: Ref | undefined;
  const clock = () => motionClock ??= (() => {
    const timeRate = g.binary('index-time-rate', 'math.multiply.scalar', time!, speed!);
    const travel = g.node('index-speed-travel', 'values.number', 'value', { value: GLYPH_SPEED_TRAVEL }, { value: GLYPH_NO_TRAVEL });
    const keyed = g.node('index-travel-keyed', 'compare.greater.scalar', 'condition'); g.edge(travel, keyed, 'a'); g.edge(g.number('index-travel-floor', GLYPH_NO_TRAVEL / 2), keyed, 'b');
    const timeSpeed = g.node('index-time-speed', 'select.scalar'); g.edge(timeRate, timeSpeed, 'falseValue'); g.edge(travel, timeSpeed, 'trueValue'); g.edge(keyed, timeSpeed, 'condition');
    return timeSpeed;
  })();
  // Retro Matrix scrolls its text up like a terminal: the rows move on by the clock × Scroll Rate (3 rows a second at
  // Speed 1), so a character stays whole while it moves, and every cell reads the picture where it is now.
  let scroll: Ref | undefined;
  if (variant === 'retro-matrix') {
    const rows = g.binary('scroll-rows', 'math.multiply.scalar', clock(), g.number('scroll-rate', RETRO_SCROLL_RATE));
    scroll = g.node('scroll-vector', 'vector.combine.vec2'); g.edge(zero, scroll, 'x'); g.edge(rows, scroll, 'y');
  }
  const gridUv = scroll ? g.binary('scrolled-uv', 'math.add.vec2', scaledUv, scroll) : scaledUv;
  const cellId = g.unary('cell-id', 'math.floor.vec2', gridUv), localUv = g.unary('local-uv', 'math.fract.vec2', gridUv);
  const half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half), samplePixel = g.binary('sample-pixel', 'math.add.vec2', cellId, half2);
  const sampleUv = g.binary('sample-uv', 'math.divide-ieee.vec2', scroll ? g.binary('sample-unscrolled', 'math.subtract.vec2', samplePixel, scroll) : samplePixel, grid);
  const tiny = g.number('tiny', .001), tiny2 = g.unary('tiny-vec2', 'convert.scalar-to-vec2', tiny), almost2 = g.unary('almost-vec2', 'convert.scalar-to-vec2', almost), clampedSourceUv = g.node('clamped-source-uv', 'math.clamp.vec2');
  g.edge(sampleUv, clampedSourceUv, 'value'); g.edge(tiny2, clampedSourceUv, 'min'); g.edge(almost2, clampedSourceUv, 'max');
  const source = g.node('source-sample', 'image.sample', 'image'); g.edge(frame, source, 'image'); g.edge(clampedSourceUv, source, 'uv');
  const sourceSplit = g.node('source-split', 'vector.split.rgba', 'rgb'); g.edge(source, sourceSplit, 'image'); const sourceRgb = { node: sourceSplit.node, port: 'rgb' };
  // Amount fades from the untouched picture (each pixel, not the cell's colour) to the look, transparency included.
  const original = g.node('original-sample', 'image.sample', 'image'); g.edge(frame, original, 'image'); g.edge(uv, original, 'uv');
  const originalSplit = g.node('original-split', 'vector.split.rgba', 'rgb'); g.edge(original, originalSplit, 'image');
  // Mixed premultiplied (colour × its alpha), then divided by the mixed alpha, so the hidden colour of a
  // transparent pixel never leaks into the fade around a cut-out figure; fully transparent stays black.
  const blend = (look: Ref) => {
    const originalAlpha = g.node('original-alpha', 'convert.alpha-to-scalar'); g.edge({ node: originalSplit.node, port: 'alpha' }, originalAlpha, 'alpha');
    const cellAlpha = g.node('cell-alpha', 'convert.alpha-to-scalar'); g.edge({ node: sourceSplit.node, port: 'alpha' }, cellAlpha, 'alpha');
    const originalPremultiplied = g.binary('original-premultiplied', 'math.multiply.rgb-scalar', { node: originalSplit.node, port: 'rgb' }, originalAlpha);
    const lookPremultiplied = g.binary('look-premultiplied', 'math.multiply.rgb-scalar', look, cellAlpha);
    const mixedPremultiplied = g.node('mixed-premultiplied', 'math.mix.rgb'); g.edge(originalPremultiplied, mixedPremultiplied, 'a'); g.edge(lookPremultiplied, mixedPremultiplied, 'b'); g.edge(amount, mixedPremultiplied, 't');
    const mixedAlpha = g.node('mixed-alpha', 'math.mix.scalar'); g.edge(originalAlpha, mixedAlpha, 'a'); g.edge(cellAlpha, mixedAlpha, 'b'); g.edge(amount, mixedAlpha, 't');
    const safeAlpha = g.binary('mixed-safe-alpha', 'math.max.scalar', mixedAlpha, g.number('mixed-alpha-floor', 1e-6));
    const mixed = g.binary('mixed', 'math.divide-ieee.rgb-scalar', mixedPremultiplied, safeAlpha);
    const alphaChannel = g.node('mixed-alpha-channel', 'convert.scalar-to-alpha', 'alpha'); g.edge(mixedAlpha, alphaChannel, 'value');
    const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge(alphaChannel, combine, 'alpha');
    return combine;
  };
  const luminance = g.node('luminance', 'color.luminance-rec709.rgb'); g.edge(sourceRgb, luminance, 'rgb');
  // Black Level: tones at or below it become the darkest character, the rest spread over the whole ramp
  // ((tone − level) / (1 − level)). Without a stored value (saved before it existed) it is 0: the tone as before.
  // Outside 0..0.9 it renders clamped (renderMin/renderMax; paramRangeNotes reports it through this node's id).
  const blackValue = g.node('black-level', 'values.number', 'value', { value: 'blackLevel' }, { value: 0 });
  const blackLevel = g.node('blackLevel-clamped', 'math.clamp.scalar'); g.edge(blackValue, blackLevel, 'value'); g.edge(zero, blackLevel, 'min'); g.edge(g.number('black-level-max', GLYPH_MAX_BLACK_LEVEL), blackLevel, 'max');
  const lowered = g.binary('black-lowered', 'math.subtract.scalar', luminance, blackLevel);
  const stretched = g.binary('black-stretched', 'math.divide-ieee.scalar', lowered, g.binary('black-span', 'math.subtract.scalar', one, blackLevel));
  const tone = g.node('tone', 'math.clamp.scalar'); g.edge(stretched, tone, 'value'); g.edge(zero, tone, 'min'); g.edge(one, tone, 'max');
  const inverseTone = g.binary('inverse-tone', 'math.subtract.scalar', one, tone);
  const mapped = g.node('mapped-tone', 'select.scalar'); g.edge(tone, mapped, 'falseValue'); g.edge(inverseTone, mapped, 'trueValue'); g.edge(invert, mapped, 'condition');
  const clampedTone = g.node('clamped-tone', 'math.clamp.scalar'); g.edge(mapped, clampedTone, 'value'); g.edge(zero, clampedTone, 'min'); g.edge(indexMax, clampedTone, 'max');
  const safeCount = g.binary('safe-count', 'math.max.scalar', glyphCount, one), glyphScaled = g.binary('glyph-scaled', 'math.multiply.scalar', clampedTone, safeCount);
  const baseGlyphIndex = g.unary('glyph-index', 'math.floor.scalar', glyphScaled); let glyphIndex = baseGlyphIndex;
  let animatedTimeSpeed: Ref | undefined;
  if (variant === 'pixel-code' || variant === 'word-mosaic' || variant === 'brand-generator' || variant === 'contour-type' || animated) {
    let offset: Ref;
    if (variant === 'contour-type') {
      const currentSample = g.node('contour-current-sample', 'image.sample', 'image'); g.edge(frame, currentSample, 'image'); g.edge(uv, currentSample, 'uv');
      const currentTone = g.node('contour-current-tone', 'color.luminance-rec709.image'); g.edge(currentSample, currentTone, 'image');
      offset = g.unary('index-offset', 'math.floor.scalar', g.binary('contour-index-scaled', 'math.multiply.scalar', currentTone, glyphCount));
    } else if (variant === 'pixel-code') {
      const indexPixels = g.binary('index-pixels', 'math.multiply.vec2', uv, resolution);
      const indexCell = g.unary('index-cell', 'math.floor.vec2', g.binary('index-grid', 'math.divide-ieee.vec2', indexPixels, safeCell2));
      const noise = g.unary('index-noise', 'noise.hash2d.vec2', indexCell), scaled = g.binary('index-noise-scaled', 'math.multiply.scalar', noise, safeCount);
      offset = g.unary('index-offset', 'math.floor.scalar', scaled);
    } else if (variant === 'word-mosaic') {
      const split = g.node('uv-split', 'vector.split.vec2', 'x'); g.edge(uv, split, 'value');
      const phase = g.binary('word-phase', 'math.multiply.scalar', { node: split.node, port: 'x' }, half);
      const phaseFloor = g.unary('word-phase-floor', 'math.floor.scalar', phase), fraction = g.binary('word-phase-fract', 'math.subtract.scalar', phase, phaseFloor);
      offset = g.unary('index-offset', 'math.floor.scalar', g.binary('word-index-scaled', 'math.multiply.scalar', fraction, safeCount));
    } else if (variant === 'brand-generator') {
      const centered = g.binary('brand-centered', 'math.subtract.vec2', uv, half2);
      const radius = g.unary('brand-radius', 'vector.length.vec2', centered);
      offset = g.unary('index-offset', 'math.floor.scalar', g.binary('brand-index-scaled', 'math.multiply.scalar', radius, safeCount));
    } else {
      const timeSpeed = clock(); animatedTimeSpeed = timeSpeed;
      // Ticks: the clock × the look's own rate (Retro Matrix moves by its scroll instead).
      const phase = variant === 'retro-matrix' ? zero : g.binary('index-time-phase', 'math.multiply.scalar', timeSpeed, g.number('index-time-scale', variant === 'matrix' ? 8 : variant === 'glyph-matrix' ? 6 : variant === 'ascii-ghost' ? 5 : variant === 'symbol-matrix' ? 4 : variant === 'pixel-dither' ? 1 : 2));
      if (variant === 'retro-matrix') {
        // The text: one fixed random character per cell of the scrolled grid (column, line), so it moves with the scroll.
        const textRandom = g.unary('index-text-random', 'noise.cell-hash.vec2', cellId);
        offset = g.unary('index-offset', 'math.floor.scalar', g.binary('index-text-scaled', 'math.multiply.scalar', textRandom, safeCount));
      } else if (variant === 'glyph-matrix') {
        const idSplit = g.node('cell-id-split', 'vector.split.vec2', 'x'); g.edge(cellId, idSplit, 'value');
        const yPhase = g.binary('index-y-phase', 'math.multiply.scalar', { node: idSplit.node, port: 'y' }, g.number('index-y-scale', .35));
        offset = g.unary('index-offset', 'math.floor.scalar', g.binary('index-sweep', 'math.add.scalar',
          g.binary('index-sweep-x', 'math.add.scalar', phase, { node: idSplit.node, port: 'x' }), yPhase));
      } else if (variant === 'symbol-matrix') {
        // Each cell swaps at its own moment (ticks shifted by a random share of a tick, so the swaps spread over
        // time instead of hitting every cell on one frame) to a random character of its window. The key pairs the
        // cell's own random with its tick: hashing cell + tick slid one random field diagonally across the frame.
        const cellRandom = g.unary('index-cell-random', 'noise.cell-hash.vec2', cellId);
        const tick = g.unary('index-tick', 'math.floor.scalar', g.binary('index-tick-staggered', 'math.add.scalar', phase, cellRandom));
        const jitterKey = g.node('index-jitter-key', 'vector.combine.vec2'); g.edge(cellRandom, jitterKey, 'x'); g.edge(tick, jitterKey, 'y');
        const jitter = g.unary('index-jitter', 'noise.hash2d-pcg.vec2', jitterKey);
        offset = g.unary('index-offset', 'math.floor.scalar', g.binary('index-jitter-scaled', 'math.multiply.scalar', jitter, safeCount));
      } else if (variant === 'capsule-cloud' || variant === 'ui-collage') {
        const spatialScale = g.unary('index-spatial-scale', 'convert.scalar-to-vec2', g.number('index-spatial-frequency', variant === 'capsule-cloud' ? 12 : 7));
        const spatialCell = g.unary('index-spatial-cell', 'math.floor.vec2', g.binary('index-spatial-uv', 'math.multiply.vec2', uv, spatialScale));
        const spatialHash = g.unary('index-spatial-hash', 'noise.hash2d.vec2', spatialCell);
        const spatialOffset = g.binary('index-spatial-offset', 'math.multiply.scalar', spatialHash, safeCount);
        offset = g.unary('index-offset', 'math.floor.scalar', g.binary('index-spatial-phase', 'math.add.scalar', timeSpeed, spatialOffset));
      } else if (variant === 'matrix') {
        const idParts = g.node('index-matrix-id', 'vector.split.vec2', 'x'); g.edge(cellId, idParts, 'value');
        const column = g.node('index-matrix-column', 'vector.combine.vec2'); g.edge({ node: idParts.node, port: 'x' }, column, 'x'); g.edge(zero, column, 'y');
        const columnHash = g.unary('index-matrix-hash', 'noise.hash2d.vec2', column), columnOffset = g.binary('index-matrix-column-offset', 'math.multiply.scalar', columnHash, safeCount);
        const rainStart = g.binary('index-matrix-rain-start', 'math.add.scalar', phase, columnOffset);
        offset = g.unary('index-offset', 'math.floor.scalar', g.binary('index-matrix-rain', 'math.subtract.scalar', rainStart, { node: idParts.node, port: 'y' }));
      } else offset = g.unary('index-offset', 'math.floor.scalar', phase);
    }
    if (animated) {
      // Roll: the moving looks run each cell through a window of 1 + ceil(Roll × (ramp − 1)) characters around
      // its own one (2 or more as soon as Roll > 0), kept inside the ramp, from its own character on. Roll 1
      // is the whole ramp (the earlier look); 0 holds every cell on the character of its brightness.
      const rollValue = g.node('roll', 'values.number', 'value', { value: 'roll' }, { value: 1 });
      // Roll outside 0..1 renders clamped (renderMin/renderMax; paramRangeNotes reports it through this node's id).
      const roll = g.node('roll-clamped', 'math.clamp.scalar'); g.edge(rollValue, roll, 'value'); g.edge(zero, roll, 'min'); g.edge(one, roll, 'max');
      const steps = g.binary('index-roll-scaled', 'math.multiply.scalar', roll, g.binary('index-roll-steps', 'math.subtract.scalar', safeCount, one));
      const window = g.binary('index-window', 'math.add.scalar', g.unary('index-roll-chars', 'math.ceil.scalar', steps), one);
      const halfWindow = g.unary('index-window-half', 'math.floor.scalar', g.binary('index-window-halved', 'math.multiply.scalar', window, half));
      const start = g.node('index-window-start', 'math.clamp.scalar'); g.edge(g.binary('index-window-centered', 'math.subtract.scalar', baseGlyphIndex, halfWindow), start, 'value');
      g.edge(zero, start, 'min'); g.edge(g.binary('index-window-last-start', 'math.subtract.scalar', safeCount, window), start, 'max');
      const shifted = g.binary('shifted-index', 'math.add.scalar', g.binary('index-in-window', 'math.subtract.scalar', baseGlyphIndex, start), offset);
      // + ½ keeps the quotient off whole numbers, so GPU division never drops a cycle.
      const cycles = g.unary('index-cycles', 'math.floor.scalar', g.binary('index-ratio', 'math.divide-ieee.scalar', g.binary('index-ratio-centered', 'math.add.scalar', shifted, half), window));
      const wrapped = g.binary('index-window-wrapped', 'math.subtract.scalar', shifted, g.binary('index-wrap', 'math.multiply.scalar', cycles, window));
      glyphIndex = g.binary('rolled-index', 'math.add.scalar', start, wrapped);
    } else {
      const shifted = g.binary('shifted-index', 'math.add.scalar', baseGlyphIndex, offset);
      const cycles = g.unary('index-cycles', 'math.floor.scalar', g.binary('index-ratio', 'math.divide-ieee.scalar', shifted, safeCount));
      glyphIndex = g.binary('wrapped-index', 'math.subtract.scalar', shifted, g.binary('index-wrap', 'math.multiply.scalar', cycles, safeCount));
    }
  }
  const safeColumns = g.binary('safe-columns', 'math.max.scalar', columns, one), safeRows = g.binary('safe-rows', 'math.max.scalar', rows, one);
  const columnRatio = g.binary('column-ratio', 'math.divide-ieee.scalar', glyphIndex, safeColumns), atlasRow = g.unary('atlas-row', 'math.floor.scalar', columnRatio);
  const rowWidth = g.binary('row-width', 'math.multiply.scalar', atlasRow, safeColumns), atlasColumn = g.binary('atlas-column', 'math.subtract.scalar', glyphIndex, rowWidth);
  const tile = g.node('atlas-tile', 'vector.combine.vec2'); g.edge(atlasColumn, tile, 'x'); g.edge(atlasRow, tile, 'y');
  // Half an atlas texel inside the tile: linear filtering never mixes in the neighbouring character, so blocks
  // that fill their tile join without seams at any cell size (graphs saved before it keep .001–.999).
  const inset = g.number('atlas-texel-inset', GLYPH_ATLAS_TEXEL_INSET), insetEnd = g.number('atlas-texel-inset-end', 1 - GLYPH_ATLAS_TEXEL_INSET);
  const clampedLocal = g.node('clamped-local-uv', 'math.clamp.vec2'); g.edge(localUv, clampedLocal, 'value');
  g.edge(g.unary('atlas-inset-vec2', 'convert.scalar-to-vec2', inset), clampedLocal, 'min'); g.edge(g.unary('atlas-inset-end-vec2', 'convert.scalar-to-vec2', insetEnd), clampedLocal, 'max');
  const atlasPixel = g.binary('atlas-pixel', 'math.add.vec2', tile, clampedLocal), atlasSize = g.node('atlas-size', 'vector.combine.vec2'); g.edge(safeColumns, atlasSize, 'x'); g.edge(safeRows, atlasSize, 'y');
  const atlasUv = g.binary('atlas-uv', 'math.divide-ieee.vec2', atlasPixel, atlasSize), atlasSample = g.node('atlas-sample', 'image.sample', 'image'); g.edge(atlas, atlasSample, 'image'); g.edge(atlasUv, atlasSample, 'uv');
  const atlasVec4 = g.node('atlas-vec4', 'convert.image-to-vec4'); g.edge(atlasSample, atlasVec4, 'image');
  const atlasSplit = g.node('atlas-split', 'vector.split.vec4', 'w'); g.edge(atlasVec4, atlasSplit, 'value'); const glyphAlpha = { node: atlasSplit.node, port: 'w' };
  const aRgb = g.node('color-a-rgb', 'convert.vec4-to-rgb', 'rgb'), bRgb = g.node('color-b-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorA, aRgb, 'value'); g.edge(colorB, bRgb, 'value');
  // Background outside 0..1 renders clamped (renderMin/renderMax; paramRangeNotes reports it through this node's id).
  const backgroundAmount = g.node('background-clamped', 'math.clamp.scalar'); g.edge(backgroundValue, backgroundAmount, 'value'); g.edge(zero, backgroundAmount, 'min'); g.edge(one, backgroundAmount, 'max');
  /** Looks that colour every cell in their own palette: the ink shows at full strength under the character and at Background (× `ground`) around it. */
  const inkCoverage = (coverage: Ref, ground: Ref = backgroundAmount) => {
    const lifted = g.node('background-coverage', 'math.mix.scalar'); g.edge(ground, lifted, 'a'); g.edge(one, lifted, 'b'); g.edge(coverage, lifted, 't');
    return lifted;
  };
  if (variant === 'number-field') {
    const five = g.number('tone-levels', 5), four = g.number('tone-divisor', 4);
    const scaled = g.binary('quantized-tone-scaled', 'math.multiply.scalar', tone, five), floored = g.unary('quantized-tone-floor', 'math.floor.scalar', scaled);
    const quantized = g.binary('quantized-tone', 'math.divide-ieee.scalar', floored, four), numberInk = g.node('number-ink', 'math.mix.rgb');
    g.edge(aRgb, numberInk, 'a'); g.edge(bRgb, numberInk, 'b'); g.edge(quantized, numberInk, 't');
    const marked = g.node('number-mark', 'math.multiply.rgb-scalar'); g.edge(numberInk, marked, 'a'); g.edge(inkCoverage(glyphAlpha), marked, 'b');
    const combine = blend(marked); const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
    return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
  }
  if (variant === 'pixel-code') {
    const dark = g.node('code-dark', 'vector.combine.vec3'); g.edge(g.number('code-dark-r', .08), dark, 'x'); g.edge(g.number('code-dark-g', .3), dark, 'y'); g.edge(g.number('code-dark-b', .48), dark, 'z');
    const light = g.node('code-light', 'vector.combine.vec3'); g.edge(g.number('code-light-r', .28), light, 'x'); g.edge(g.number('code-light-g', .95), light, 'y'); g.edge(g.number('code-light-b', .72), light, 'z');
    const darkRgb = g.node('code-dark-rgb', 'convert.vec3-to-rgb', 'rgb'), lightRgb = g.node('code-light-rgb', 'convert.vec3-to-rgb', 'rgb'); g.edge(dark, darkRgb, 'value'); g.edge(light, lightRgb, 'value');
    const codeColor = g.node('code-color', 'math.mix.rgb'); g.edge(darkRgb, codeColor, 'a'); g.edge(lightRgb, codeColor, 'b'); g.edge(tone, codeColor, 't');
    const mark = g.node('code-mark', 'math.multiply.rgb-scalar'); g.edge(codeColor, mark, 'a'); g.edge(inkCoverage(glyphAlpha), mark, 'b');
    const combine = blend(mark); const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
    return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
  }
  if (variant === 'pixel-dither') {
    const centered = g.binary('pixel-dither-centered', 'math.subtract.vec2', localUv, half2), radius = g.unary('pixel-dither-radius', 'vector.length.vec2', centered);
    const radial = g.binary('pixel-dither-radial', 'math.subtract.scalar', one, radius), glowLift = g.binary('pixel-dither-glow-lift', 'math.multiply.scalar', radial, g.number('pixel-dither-glow-factor', .18));
    const glow = g.node('pixel-dither-glow', 'math.smoothstep.scalar'); g.edge(g.number('pixel-dither-glow-low', .05), glow, 'edge0'); g.edge(g.number('pixel-dither-glow-high', .65), glow, 'edge1'); g.edge(g.binary('pixel-dither-glow-input', 'math.add.scalar', glyphAlpha, glowLift), glow, 'value');
    const neonBase = g.node('pixel-dither-neon-base', 'math.mix.rgb'); g.edge(aRgb, neonBase, 'a'); g.edge(bRgb, neonBase, 'b'); g.edge(tone, neonBase, 't');
    const neonGlow = g.node('pixel-dither-neon-glow', 'math.multiply.rgb-scalar'); g.edge(neonBase, neonGlow, 'a'); g.edge(inkCoverage(glow), neonGlow, 'b');
    const neon = g.node('pixel-dither-neon', 'math.multiply.rgb-scalar'); g.edge(neonGlow, neon, 'a'); g.edge(g.number('pixel-dither-neon-scale', 1.25), neon, 'b');
    const combine = blend(neon); const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
    return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
  }
  if (variant === 'retro-matrix') {
    // Phosphor: the colour the characters glow in (amber, as instances saved before it existed render it).
    const phosphor = g.node('retro-phosphor', 'values.color', 'value', { value: 'phosphor' }, { value: RETRO_PHOSPHOR });
    const phosphorRgb = g.node('retro-phosphor-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(phosphor, phosphorRgb, 'value');
    const ink = g.node('retro-ink', 'math.multiply.rgb-scalar'); g.edge(phosphorRgb, ink, 'a'); g.edge(inkCoverage(glyphAlpha), ink, 'b');
    // Brightness: dim characters in the dark, full glow (and a little overdrive) in the light, so the picture reads.
    const toneScale = g.binary('retro-tone-scale', 'math.multiply.scalar', tone, g.number('tone-factor', RETRO_TONE_FACTOR));
    const brightness = g.binary('retro-tone-amount', 'math.add.scalar', g.number('tone-base', RETRO_TONE_BASE), toneScale);
    const lit = g.node('retro-lit', 'math.multiply.rgb-scalar'); g.edge(ink, lit, 'a'); g.edge(brightness, lit, 'b');
    // Scanlines: one line every Line Spacing pixels of a 1080p frame, moving with the text (the scrolled row coordinate),
    // so preview, thumbnails and a 4K export show the same lines; lines closer than 3 output pixels fade into an even
    // dimming instead of a moiré. Scanlines outside 0..1 render clamped (scanlines-clamped, paramRangeNotes).
    const strengthValue = g.node('scanlines', 'values.number', 'value', { value: 'scanlines' }, { value: RETRO_LEGACY_SCANLINES });
    const strength = g.node('scanlines-clamped', 'math.clamp.scalar'); g.edge(strengthValue, strength, 'value'); g.edge(zero, strength, 'min'); g.edge(one, strength, 'max');
    const rowParts = g.node('retro-scan-row', 'vector.split.vec2', 'y'); g.edge(gridUv, rowParts, 'value');
    const rowPixel = g.binary('retro-scan-pixel', 'math.multiply.scalar', { node: rowParts.node, port: 'y' }, safeCell);
    const pitch = g.binary('retro-scan-pitch', 'math.multiply.scalar', frameScale, g.number('line-spacing', RETRO_LINE_SPACING));
    const lines = g.binary('retro-scan-lines', 'math.divide-ieee.scalar', rowPixel, pitch);
    // sin² (π × lines): 0 on a line, 1 between two lines.
    const sine = g.unary('retro-scan-sine', 'math.sin.scalar', g.binary('retro-scan-angle', 'math.multiply.scalar', lines, g.number('pi', Math.PI)));
    const dip = g.binary('retro-scan-dip', 'math.power.scalar', sine, two);
    const fade = g.node('retro-scan-fade', 'math.smoothstep.scalar'); g.edge(g.number('fade-from', 1.5), fade, 'edge0'); g.edge(g.number('fade-to', 3), fade, 'edge1'); g.edge(pitch, fade, 'value');
    const fadedDip = g.node('retro-scan-faded', 'math.mix.scalar'); g.edge(half, fadedDip, 'a'); g.edge(dip, fadedDip, 'b'); g.edge(fade, fadedDip, 't');
    const scan = g.binary('retro-scan', 'math.subtract.scalar', one, g.binary('retro-scan-depth', 'math.multiply.scalar', strength, fadedDip));
    const scanned = g.node('retro-scanned', 'math.multiply.rgb-scalar'); g.edge(lit, scanned, 'a'); g.edge(scan, scanned, 'b');
    const combine = blend(scanned); const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
    // It draws only in its Phosphor colour: the shared colour nodes (retired Color Source, Dark, Light) stay out of its setup.
    const unused = new Set(['color-mode', 'color-a', 'color-b', 'color-a-rgb', 'color-b-rgb']);
    for (const id of unused) delete g.layout[id];
    return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes.filter(node => !unused.has(node.id)),
      edges: g.edges.filter(edge => !unused.has(edge.from) && !unused.has(edge.to)), layout: g.layout };
  }
  if (variant === 'matrix') {
    const idParts = g.node('matrix-id-split', 'vector.split.vec2', 'x'); g.edge(cellId, idParts, 'value');
    const repeatedX = g.node('matrix-repeated-x', 'vector.combine.vec2'); g.edge({ node: idParts.node, port: 'x' }, repeatedX, 'x'); g.edge({ node: idParts.node, port: 'x' }, repeatedX, 'y');
    const yPhase = g.binary('matrix-y-phase', 'math.multiply.scalar', { node: idParts.node, port: 'y' }, g.number('matrix-y-factor', .43));
    const timePhase = g.binary('matrix-time-phase', 'math.multiply.scalar', animatedTimeSpeed!, g.number('matrix-time-factor', 5));
    const basePhase = g.binary('matrix-base-phase', 'math.subtract.scalar', yPhase, timePhase);
    const hashPhase = g.binary('matrix-hash-phase', 'math.multiply.scalar', g.unary('matrix-hash', 'noise.hash2d.vec2', repeatedX), g.number('matrix-tau', 6.28318530718));
    const wave = g.unary('matrix-wave', 'math.sin.scalar', g.binary('matrix-wave-phase', 'math.add.scalar', basePhase, hashPhase));
    const headBase = g.binary('matrix-head-base', 'math.add.scalar', half, g.binary('matrix-head-wave', 'math.multiply.scalar', half, wave));
    const head = g.binary('matrix-head', 'math.power.scalar', headBase, g.number('matrix-head-power', 4));
    const green = g.node('matrix-green-vector', 'vector.combine.vec3'); g.edge(g.number('matrix-green-r', .04), green, 'x'); g.edge(g.binary('matrix-green-g', 'math.add.scalar', g.number('matrix-green-base', .35), g.binary('matrix-green-head', 'math.multiply.scalar', head, g.number('matrix-green-scale', .65))), green, 'y'); g.edge(g.number('matrix-green-b', .13), green, 'z');
    const greenRgb = g.node('matrix-green-rgb', 'convert.vec3-to-rgb', 'rgb'); g.edge(green, greenRgb, 'value');
    const matrixGround = g.binary('background-tone', 'math.multiply.scalar', backgroundAmount, tone);
    const marked = g.node('matrix-marked', 'math.multiply.rgb-scalar'); g.edge(greenRgb, marked, 'a'); g.edge(inkCoverage(glyphAlpha, matrixGround), marked, 'b');
    const combine = blend(marked); const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
    return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
  }
  const duotone = g.node('duotone', 'math.mix.rgb'); g.edge(aRgb, duotone, 'a'); g.edge(bRgb, duotone, 'b'); g.edge(tone, duotone, 't');
  const sourceMode = g.binary('source-mode', 'math.subtract.scalar', one, colorMode), ink = g.node('ink', 'math.mix.rgb'); g.edge(duotone, ink, 'a'); g.edge(sourceRgb, ink, 'b'); g.edge(sourceMode, ink, 't');
  const aDark = g.node('color-a-dark', 'math.multiply.rgb-scalar'); g.edge(aRgb, aDark, 'a'); g.edge(g.number('duotone-dark-scale', .15), aDark, 'b');
  const sourceDark = g.node('source-dark', 'math.multiply.rgb-scalar'); g.edge(sourceRgb, sourceDark, 'a'); g.edge(g.number('source-dark-scale', .08), sourceDark, 'b');
  let background = g.node('background', 'math.mix.rgb'); g.edge(aDark, background, 'a'); g.edge(sourceDark, background, 'b'); g.edge(sourceMode, background, 't');
  let inkAlpha = glyphAlpha;
  if (variant === 'grid-glyph') {
    const local = g.node('local-split', 'vector.split.vec2', 'x'); g.edge(localUv, local, 'value');
    const oneMinusX = g.binary('one-minus-local-x', 'math.subtract.scalar', one, { node: local.node, port: 'x' });
    const oneMinusY = g.binary('one-minus-local-y', 'math.subtract.scalar', one, { node: local.node, port: 'y' });
    const edgeX = g.binary('edge-x', 'math.min.scalar', { node: local.node, port: 'x' }, oneMinusX);
    const edgeY = g.binary('edge-y', 'math.min.scalar', { node: local.node, port: 'y' }, oneMinusY);
    const edgeDistance = g.binary('edge-distance', 'math.min.scalar', edgeX, edgeY), edge = g.node('grid-edge', 'math.smoothstep.scalar');
    g.edge(g.number('grid-edge-low', .02), edge, 'edge0'); g.edge(g.number('grid-edge-high', .07), edge, 'edge1'); g.edge(edgeDistance, edge, 'value');
    const gridLine = g.binary('grid-line', 'math.subtract.scalar', one, edge);
    const border = g.binary('grid-border', 'math.multiply.scalar', gridLine, g.number('grid-strength', .28));
    inkAlpha = g.binary('grid-alpha', 'math.max.scalar', glyphAlpha, border);
  } else if (variant === 'word-mosaic') {
    const local = g.node('local-split', 'vector.split.vec2', 'x'); g.edge(localUv, local, 'value'); const localY = { node: local.node, port: 'y' };
    const bandRise = g.node('word-band-rise', 'math.smoothstep.scalar'); g.edge(g.number('word-band-low', .04), bandRise, 'edge0'); g.edge(g.number('word-band-high', .12), bandRise, 'edge1'); g.edge(localY, bandRise, 'value');
    const bandFall = g.node('word-band-fall', 'math.smoothstep.scalar'); g.edge(g.number('word-fall-low', .78), bandFall, 'edge0'); g.edge(g.number('word-fall-high', .95), bandFall, 'edge1'); g.edge(localY, bandFall, 'value');
    const wordBand = g.binary('word-band', 'math.multiply.scalar', bandRise, g.binary('word-band-inverse', 'math.subtract.scalar', one, bandFall));
    const centerDistance = g.unary('word-center-distance', 'math.abs.scalar', g.binary('word-center', 'math.subtract.scalar', localY, half));
    const connectorWidth = g.node('word-connector-width', 'math.step.scalar'); g.edge(centerDistance, connectorWidth, 'edge'); g.edge(g.number('word-half-width', .08), connectorWidth, 'value');
    const connectorTone = g.node('word-connector-tone', 'math.step.scalar'); g.edge(g.number('word-tone-threshold', .25), connectorTone, 'edge'); g.edge(tone, connectorTone, 'value');
    const connector = g.binary('word-connector', 'math.multiply.scalar', connectorWidth, connectorTone);
    const bandConnector = g.binary('word-band-connector', 'math.multiply.scalar', connector, wordBand);
    const border = g.binary('word-border', 'math.multiply.scalar', bandConnector, g.number('word-strength', .45));
    inkAlpha = g.binary('word-alpha', 'math.max.scalar', glyphAlpha, border);
  } else if (variant === 'data-hatch') {
    const local = g.node('local-split', 'vector.split.vec2', 'x'); g.edge(localUv, local, 'value');
    const diagonal = g.binary('hatch-diagonal', 'math.add.scalar', { node: local.node, port: 'x' }, { node: local.node, port: 'y' });
    const phase = g.unary('hatch-phase', 'math.fract.scalar', g.binary('hatch-scaled', 'math.multiply.scalar', diagonal, g.number('hatch-frequency', 4)));
    const distance = g.unary('hatch-distance', 'math.abs.scalar', g.binary('hatch-center', 'math.subtract.scalar', phase, half));
    const smooth = g.node('hatch-smooth', 'math.smoothstep.scalar'); g.edge(g.number('hatch-low', .04), smooth, 'edge0');
    g.edge(g.number('hatch-high', .13), smooth, 'edge1'); g.edge(distance, smooth, 'value');
    const hatch = g.binary('hatch-mask', 'math.subtract.scalar', one, smooth);
    const darkness = g.binary('hatch-darkness', 'math.subtract.scalar', one, tone);
    const hatchTone = g.binary('hatch-tone', 'math.multiply.scalar', hatch, darkness);
    const hatchStrength = g.binary('hatch-strength', 'math.multiply.scalar', hatchTone, g.number('hatch-strength-value', .55));
    inkAlpha = g.binary('hatch-alpha', 'math.max.scalar', glyphAlpha, hatchStrength);
  } else if (variant === 'brand-generator') {
    const parts = g.node('brand-uv-split', 'vector.split.vec2', 'x'); g.edge(uv, parts, 'value');
    const xEdge = g.binary('brand-edge-x', 'math.min.scalar', { node: parts.node, port: 'x' }, g.binary('brand-one-minus-x', 'math.subtract.scalar', one, { node: parts.node, port: 'x' }));
    const yEdge = g.binary('brand-edge-y', 'math.min.scalar', { node: parts.node, port: 'y' }, g.binary('brand-one-minus-y', 'math.subtract.scalar', one, { node: parts.node, port: 'y' }));
    const edge = g.binary('brand-edge', 'math.min.scalar', xEdge, yEdge), smooth = g.node('brand-frame-smooth', 'math.smoothstep.scalar');
    g.edge(g.number('brand-frame-low', .02), smooth, 'edge0'); g.edge(g.number('brand-frame-high', .05), smooth, 'edge1'); g.edge(edge, smooth, 'value');
    const frameMask = g.binary('brand-frame', 'math.subtract.scalar', one, smooth);
    inkAlpha = g.binary('brand-alpha', 'math.max.scalar', glyphAlpha, frameMask);
  } else if (variant === 'stitch-poster') {
    const parts = g.node('stitch-local-split', 'vector.split.vec2', 'x'); g.edge(localUv, parts, 'value');
    const x = g.binary('stitch-x', 'math.subtract.scalar', { node: parts.node, port: 'x' }, half), y = g.binary('stitch-y', 'math.subtract.scalar', { node: parts.node, port: 'y' }, half);
    const diagonalA = g.unary('stitch-diagonal-a', 'math.abs.scalar', g.binary('stitch-difference', 'math.subtract.scalar', x, y));
    const diagonalB = g.unary('stitch-diagonal-b', 'math.abs.scalar', g.binary('stitch-sum', 'math.add.scalar', x, y));
    const distance = g.binary('stitch-distance', 'math.min.scalar', diagonalA, diagonalB), smooth = g.node('stitch-smooth', 'math.smoothstep.scalar');
    g.edge(g.number('stitch-low', .025), smooth, 'edge0'); g.edge(g.number('stitch-high', .08), smooth, 'edge1'); g.edge(distance, smooth, 'value');
    const stitch = g.binary('stitch-mask', 'math.subtract.scalar', one, smooth), darkness = g.binary('stitch-darkness', 'math.subtract.scalar', one, tone);
    const toneWeight = g.binary('stitch-tone-weight', 'math.add.scalar', g.number('stitch-tone-base', .35), g.binary('stitch-tone-scale', 'math.multiply.scalar', g.number('stitch-tone-factor', .65), darkness));
    inkAlpha = g.binary('stitch-alpha', 'math.max.scalar', glyphAlpha, g.binary('stitch-thread', 'math.multiply.scalar', stitch, toneWeight));
    const stitchBackground = g.node('stitch-background', 'math.mix.rgb'); g.edge(bRgb, stitchBackground, 'a'); g.edge(background, stitchBackground, 'b'); g.edge(g.number('stitch-background-mix', .25), stitchBackground, 't'); background = stitchBackground;
  } else if (variant === 'dither-text') {
    const id = g.node('dither-id-split', 'vector.split.vec2', 'x'); g.edge(cellId, id, 'value');
    const parity = g.binary('dither-id-sum', 'math.add.scalar', { node: id.node, port: 'x' }, { node: id.node, port: 'y' });
    const checkerPhase = g.unary('dither-checker-fract', 'math.fract.scalar', g.binary('dither-checker-scaled', 'math.multiply.scalar', parity, half));
    const checker = g.node('dither-checker', 'math.step.scalar'); g.edge(half, checker, 'edge'); g.edge(checkerPhase, checker, 'value');
    const threshold = g.node('dither-threshold', 'math.mix.scalar'); g.edge(g.number('dither-threshold-low', .28), threshold, 'a'); g.edge(g.number('dither-threshold-high', .72), threshold, 'b'); g.edge(checker, threshold, 't');
    const timeVector = g.unary('dither-time-vector', 'convert.scalar-to-vec2', time!), hashPoint = g.binary('dither-hash-point', 'math.add.vec2', cellId, timeVector);
    const noise = g.unary('dither-noise', 'noise.hash2d.vec2', hashPoint), noiseAmount = g.binary('dither-noise-amount', 'math.multiply.scalar', noise, g.number('dither-noise-scale', .18));
    const visible = g.node('dither-visible', 'math.step.scalar'); g.edge(threshold, visible, 'edge'); g.edge(g.binary('dither-tone-noise', 'math.add.scalar', tone, noiseAmount), visible, 'value');
    inkAlpha = g.binary('dither-alpha', 'math.multiply.scalar', glyphAlpha, visible);
  } else if (variant === 'symbol-matrix') {
    const baseHash = g.unary('symbol-base-hash', 'noise.hash2d.vec2', cellId);
    const pulseTime = g.binary('symbol-pulse-time', 'math.multiply.scalar', animatedTimeSpeed!, g.number('symbol-pulse-time-scale', 2));
    const hashPhase = g.binary('symbol-hash-phase', 'math.multiply.scalar', baseHash, g.number('symbol-tau', 6.28318530718));
    const wave = g.unary('symbol-wave', 'math.sin.scalar', g.binary('symbol-wave-phase', 'math.add.scalar', pulseTime, hashPhase));
    const pulse = g.binary('symbol-pulse', 'math.add.scalar', g.number('symbol-pulse-base', .65), g.binary('symbol-pulse-wave', 'math.multiply.scalar', g.number('symbol-pulse-scale', .35), wave));
    inkAlpha = g.binary('symbol-alpha', 'math.multiply.scalar', glyphAlpha, pulse);
  } else if (variant === 'capsule-cloud') {
    const local = g.node('capsule-local-split', 'vector.split.vec2', 'x'); g.edge(localUv, local, 'value');
    const px = g.binary('capsule-p-x', 'math.subtract.scalar', g.unary('capsule-abs-x', 'math.abs.scalar', g.binary('capsule-center-x', 'math.subtract.scalar', { node: local.node, port: 'x' }, half)), g.number('capsule-half-width', .43));
    const py = g.binary('capsule-p-y', 'math.subtract.scalar', g.unary('capsule-abs-y', 'math.abs.scalar', g.binary('capsule-center-y', 'math.subtract.scalar', { node: local.node, port: 'y' }, half)), g.number('capsule-half-height', .26));
    const positive = g.node('capsule-positive', 'vector.combine.vec2'); g.edge(g.binary('capsule-positive-x', 'math.max.scalar', px, zero), positive, 'x'); g.edge(g.binary('capsule-positive-y', 'math.max.scalar', py, zero), positive, 'y');
    const outside = g.unary('capsule-outside-distance', 'vector.length.vec2', positive), inside = g.binary('capsule-inside-distance', 'math.min.scalar', g.binary('capsule-axis-max', 'math.max.scalar', px, py), zero);
    const signedDistance = g.binary('capsule-radius-distance', 'math.subtract.scalar', g.binary('capsule-distance', 'math.add.scalar', outside, inside), g.number('capsule-radius', .18));
    const smooth = g.node('capsule-smooth', 'math.smoothstep.scalar'); g.edge(g.number('capsule-edge-low', -.02), smooth, 'edge0'); g.edge(g.number('capsule-edge-high', .03), smooth, 'edge1'); g.edge(signedDistance, smooth, 'value');
    const pill = g.binary('capsule-pill', 'math.subtract.scalar', one, smooth), pillInk = g.binary('capsule-pill-ink', 'math.multiply.scalar', pill, g.number('capsule-pill-strength', .18));
    inkAlpha = g.binary('capsule-alpha', 'math.max.scalar', glyphAlpha, pillInk);
  } else if (variant === 'ui-collage') {
    const local = g.node('collage-local-split', 'vector.split.vec2', 'x'); g.edge(localUv, local, 'value');
    const edgeX = g.binary('collage-edge-x', 'math.min.scalar', { node: local.node, port: 'x' }, g.binary('collage-one-minus-x', 'math.subtract.scalar', one, { node: local.node, port: 'x' }));
    const edgeY = g.binary('collage-edge-y', 'math.min.scalar', { node: local.node, port: 'y' }, g.binary('collage-one-minus-y', 'math.subtract.scalar', one, { node: local.node, port: 'y' }));
    const edgeDistance = g.binary('collage-edge-distance', 'math.min.scalar', edgeX, edgeY), edgeSmooth = g.node('collage-edge-smooth', 'math.smoothstep.scalar');
    g.edge(g.number('collage-edge-low', .03), edgeSmooth, 'edge0'); g.edge(g.number('collage-edge-high', .09), edgeSmooth, 'edge1'); g.edge(edgeDistance, edgeSmooth, 'value');
    const border = g.binary('collage-border', 'math.subtract.scalar', one, edgeSmooth);
    const cursorVector = g.node('collage-cursor-vector', 'vector.combine.vec2'); g.edge(g.number('collage-cursor-x', .72), cursorVector, 'x'); g.edge(g.number('collage-cursor-y', .28), cursorVector, 'y');
    const cursorDistance = g.unary('collage-cursor-distance', 'vector.length.vec2', g.binary('collage-cursor-offset', 'math.subtract.vec2', localUv, cursorVector));
    const cursor = g.node('collage-cursor', 'math.step.scalar'); g.edge(cursorDistance, cursor, 'edge'); g.edge(g.number('collage-cursor-radius', .07), cursor, 'value');
    const decoration = g.binary('collage-decoration', 'math.max.scalar', g.binary('collage-border-strength', 'math.multiply.scalar', border, g.number('collage-border-scale', .42)), cursor);
    inkAlpha = g.binary('collage-alpha', 'math.max.scalar', glyphAlpha, decoration);
  } else if (variant === 'contour-type') {
    const derivative = g.node('contour-derivative', 'image.derivative.auto.scalar', 'gradient'); g.edge(tone, derivative, 'value');
    const edgeLength = g.unary('contour-edge-length', 'vector.length.vec2', derivative);
    const scaledEdge = g.binary('contour-edge-cell-scale', 'math.multiply.scalar', edgeLength, safeCell);
    const edge = g.binary('contour-edge', 'math.multiply.scalar', scaledEdge, g.number('contour-edge-factor', 3)), edgeVisible = g.node('contour-edge-visible', 'math.smoothstep.scalar');
    g.edge(g.number('contour-edge-low', .05), edgeVisible, 'edge0'); g.edge(g.number('contour-edge-high', .4), edgeVisible, 'edge1'); g.edge(edge, edgeVisible, 'value');
    const toneBands = g.binary('contour-tone-bands', 'math.multiply.scalar', tone, g.number('contour-band-count', 8));
    const centeredBand = g.binary('contour-centered-band', 'math.subtract.scalar', g.unary('contour-band-fraction', 'math.fract.scalar', toneBands), half);
    const bandSmooth = g.node('contour-band-smooth', 'math.smoothstep.scalar'); g.edge(g.number('contour-band-low', .03), bandSmooth, 'edge0');
    g.edge(g.number('contour-band-high', .12), bandSmooth, 'edge1'); g.edge(g.unary('contour-band-distance', 'math.abs.scalar', centeredBand), bandSmooth, 'value');
    const band = g.binary('contour-band', 'math.subtract.scalar', one, bandSmooth);
    inkAlpha = g.binary('contour-alpha', 'math.multiply.scalar', glyphAlpha, g.binary('contour-visible', 'math.max.scalar', band, edgeVisible));
  } else if (variant === 'inscribe') {
    const derivative = g.node('inscribe-derivative', 'image.derivative.auto.scalar', 'gradient'); g.edge(tone, derivative, 'value');
    const edgeLength = g.unary('inscribe-edge-length', 'vector.length.vec2', derivative);
    const scaledCell = g.binary('inscribe-cell-scale', 'math.multiply.scalar', safeCell, g.number('inscribe-edge-factor', 2.5));
    const edge = g.binary('inscribe-edge', 'math.multiply.scalar', edgeLength, scaledCell), visible = g.node('inscribe-visible', 'math.smoothstep.scalar');
    g.edge(g.number('inscribe-edge-low', .02), visible, 'edge0'); g.edge(g.number('inscribe-edge-high', .35), visible, 'edge1'); g.edge(edge, visible, 'value');
    inkAlpha = g.binary('inscribe-alpha', 'math.multiply.scalar', glyphAlpha, visible);
    const inscribeBackground = g.node('inscribe-background', 'math.multiply.rgb-scalar'); g.edge(sourceRgb, inscribeBackground, 'a'); g.edge(g.number('inscribe-background-scale', .18), inscribeBackground, 'b'); background = inscribeBackground;
  }
  const lifted = g.node('background-lift', 'math.mix.rgb'); g.edge(background, lifted, 'a'); g.edge(ink, lifted, 'b'); g.edge(backgroundAmount, lifted, 't'); background = lifted;
  const alpha = g.node('glyph-alpha', 'math.clamp.scalar'); g.edge(inkAlpha, alpha, 'value'); g.edge(zero, alpha, 'min'); g.edge(one, alpha, 'max');
  const result = g.node('glyph-result', 'math.mix.rgb'); g.edge(background, result, 'a'); g.edge(ink, result, 'b'); g.edge(alpha, result, 't');
  const combine = blend(result);
  if (variant === 'ascii-ghost') {
    const current = g.node('ghost-current', 'convert.image-to-vec4'); g.edge(combine, current, 'image');
    const history = g.node('history', 'image.frame-history', 'image'), historyValue = g.node('ghost-history-value', 'convert.image-to-vec4'); g.edge(history, historyValue, 'image');
    const currentParts = g.node('ghost-current-parts', 'vector.split.vec4', 'x'); g.edge(current, currentParts, 'value');
    const historyParts = g.node('ghost-history-parts', 'vector.split.vec4', 'x'); g.edge(historyValue, historyParts, 'value');
    const decay = g.number('ghost-decay', .88), resolved = g.node('ghost-resolved', 'vector.combine.vec4');
    for (const component of ['x', 'y', 'z', 'w'] as const) {
      const faded = g.binary(`ghost-faded-${component}`, 'math.multiply.scalar', { node: historyParts.node, port: component }, decay);
      g.edge(g.binary(`ghost-max-${component}`, 'math.max.scalar', { node: currentParts.node, port: component }, faded), resolved, component);
    }
    const resolvedImage = g.node('ghost-image', 'convert.vec4-to-image', 'image'); g.edge(resolved, resolvedImage, 'value');
    const ghostOutput = g.node('output', 'image.output', ''); g.edge(resolvedImage, ghostOutput, 'image');
  } else { const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image'); }
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}

/** Granular expansion of the legacy ASCII glyph cell and ink helpers. */
export function createDefaultAsciiGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('ascii'); }
export function createDefaultNumberFieldGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('number-field'); }
export function createDefaultGridGlyphGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('grid-glyph'); }
export function createDefaultPixelCodeGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('pixel-code'); }
export function createDefaultWordMosaicGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('word-mosaic'); }
export function createDefaultGlyphMatrixGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('glyph-matrix'); }
export function createDefaultDataHatchGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('data-hatch'); }
export function createDefaultBrandGeneratorGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('brand-generator'); }
export function createDefaultStitchPosterGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('stitch-poster'); }
export function createDefaultDitherTextGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('dither-text'); }
export function createDefaultSymbolMatrixGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('symbol-matrix'); }
export function createDefaultPixelDitherGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('pixel-dither'); }
export function createDefaultRetroMatrixGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('retro-matrix'); }
export function createDefaultCapsuleCloudGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('capsule-cloud'); }
export function createDefaultUiCollageGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('ui-collage'); }
export function createDefaultMatrixGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('matrix'); }
export function createDefaultAsciiGhostGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('ascii-ghost'); }
export function createDefaultInscribeGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('inscribe'); }
export function createDefaultContourTypeGraph(): EffectOperatorGraph { return createDefaultGlyphGraph('contour-type'); }
