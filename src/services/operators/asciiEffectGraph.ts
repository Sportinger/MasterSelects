import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';
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

/** Shared granular expansion of the legacy glyph cell, ramp, and atlas path. */
function createDefaultGlyphGraph(variant: GlyphGraphVariant): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv'), resolution = g.node('resolution', 'image.resolution');
  const cellSize = g.node('cell-size', 'values.number', 'value', { value: 'cellSize' }), amount = g.node('amount', 'values.number', 'value', { value: 'amount' });
  const animated = variant === 'glyph-matrix' || variant === 'data-hatch' || variant === 'dither-text' || variant === 'symbol-matrix' || variant === 'pixel-dither' || variant === 'retro-matrix' || variant === 'capsule-cloud' || variant === 'ui-collage' || variant === 'matrix' || variant === 'ascii-ghost';
  const speed = animated ? g.node('speed', 'values.number', 'value', { value: 'speed' }) : undefined;
  const time = animated ? g.node('time', 'image.timeline-time') : undefined;
  const invert = g.node('invert', 'values.boolean', 'value', { value: 'invert' }), colorMode = g.node('color-mode', 'values.choice', 'value', { value: 'colorMode' });
  const colorA = g.node('color-a', 'values.color', 'value', { value: 'colorA' }), colorB = g.node('color-b', 'values.color', 'value', { value: 'colorB' });
  const atlas = g.node('atlas', 'glyph.atlas', 'image', { rampPreset: 'rampPreset', customRamp: 'customRamp', fontFamily: 'fontFamily', fontWeight: 'fontWeight' });
  const glyphCount = { node: atlas.node, port: 'glyphCount' }, columns = { node: atlas.node, port: 'columns' }, rows = { node: atlas.node, port: 'rows' };
  const zero = g.number('zero', 0), one = g.number('one', 1), two = g.number('two', 2), half = g.number('half', .5), almost = g.number('almost', .999), indexMax = g.number('index-max', .99999);
  const safeCell = g.binary('safe-cell', 'math.max.scalar', cellSize, two), safeCell2 = g.unary('safe-cell-vec2', 'convert.scalar-to-vec2', safeCell);
  const grid = g.binary('grid', 'math.divide-ieee.vec2', resolution, safeCell2), scaledUv = g.binary('scaled-uv', 'math.multiply.vec2', uv, grid);
  const cellId = g.unary('cell-id', 'math.floor.vec2', scaledUv), localUv = g.unary('local-uv', 'math.fract.vec2', scaledUv);
  const half2 = g.unary('half-vec2', 'convert.scalar-to-vec2', half), samplePixel = g.binary('sample-pixel', 'math.add.vec2', cellId, half2), sampleUv = g.binary('sample-uv', 'math.divide-ieee.vec2', samplePixel, grid);
  const tiny = g.number('tiny', .001), tiny2 = g.unary('tiny-vec2', 'convert.scalar-to-vec2', tiny), almost2 = g.unary('almost-vec2', 'convert.scalar-to-vec2', almost), clampedSourceUv = g.node('clamped-source-uv', 'math.clamp.vec2');
  g.edge(sampleUv, clampedSourceUv, 'value'); g.edge(tiny2, clampedSourceUv, 'min'); g.edge(almost2, clampedSourceUv, 'max');
  const source = g.node('source-sample', 'image.sample', 'image'); g.edge(frame, source, 'image'); g.edge(clampedSourceUv, source, 'uv');
  const sourceSplit = g.node('source-split', 'vector.split.rgba', 'rgb'); g.edge(source, sourceSplit, 'image'); const sourceRgb = { node: sourceSplit.node, port: 'rgb' };
  const tone = g.node('tone', 'color.luminance-rec709.rgb'); g.edge(sourceRgb, tone, 'rgb'); const inverseTone = g.binary('inverse-tone', 'math.subtract.scalar', one, tone);
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
      const timeSpeed = g.binary('index-time-speed', 'math.multiply.scalar', time!, speed!); animatedTimeSpeed = timeSpeed;
      const phase = g.binary('index-time-phase', 'math.multiply.scalar', timeSpeed, g.number('index-time-scale', variant === 'matrix' ? 8 : variant === 'glyph-matrix' ? 6 : variant === 'ascii-ghost' ? 5 : variant === 'symbol-matrix' ? 4 : variant === 'retro-matrix' ? 3 : variant === 'pixel-dither' ? 1 : 2));
      if (variant === 'glyph-matrix') {
        const idSplit = g.node('cell-id-split', 'vector.split.vec2', 'x'); g.edge(cellId, idSplit, 'value');
        const yPhase = g.binary('index-y-phase', 'math.multiply.scalar', { node: idSplit.node, port: 'y' }, g.number('index-y-scale', .35));
        offset = g.unary('index-offset', 'math.floor.scalar', g.binary('index-sweep', 'math.add.scalar',
          g.binary('index-sweep-x', 'math.add.scalar', phase, { node: idSplit.node, port: 'x' }), yPhase));
      } else if (variant === 'symbol-matrix') {
        const phaseFloor = g.unary('index-time-floor', 'math.floor.scalar', phase), phaseVector = g.unary('index-time-vector', 'convert.scalar-to-vec2', phaseFloor);
        const jitterPoint = g.binary('index-jitter-point', 'math.add.vec2', cellId, phaseVector), jitter = g.unary('index-jitter', 'noise.hash2d.vec2', jitterPoint);
        offset = g.unary('index-offset', 'math.floor.scalar', g.binary('index-jitter-scaled', 'math.multiply.scalar', jitter, safeCount));
      } else if (variant === 'retro-matrix') {
        const uvParts = g.node('index-uv-split', 'vector.split.vec2', 'y'); g.edge(uv, uvParts, 'value');
        const rowOffset = g.binary('index-row-offset', 'math.multiply.scalar', { node: uvParts.node, port: 'y' }, safeCount);
        offset = g.unary('index-offset', 'math.floor.scalar', g.binary('index-retro-phase', 'math.subtract.scalar', phase, rowOffset));
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
    const shifted = g.binary('shifted-index', 'math.add.scalar', baseGlyphIndex, offset);
    const cycles = g.unary('index-cycles', 'math.floor.scalar', g.binary('index-ratio', 'math.divide-ieee.scalar', shifted, safeCount));
    glyphIndex = g.binary('wrapped-index', 'math.subtract.scalar', shifted, g.binary('index-wrap', 'math.multiply.scalar', cycles, safeCount));
  }
  const safeColumns = g.binary('safe-columns', 'math.max.scalar', columns, one), safeRows = g.binary('safe-rows', 'math.max.scalar', rows, one);
  const columnRatio = g.binary('column-ratio', 'math.divide-ieee.scalar', glyphIndex, safeColumns), atlasRow = g.unary('atlas-row', 'math.floor.scalar', columnRatio);
  const rowWidth = g.binary('row-width', 'math.multiply.scalar', atlasRow, safeColumns), atlasColumn = g.binary('atlas-column', 'math.subtract.scalar', glyphIndex, rowWidth);
  const tile = g.node('atlas-tile', 'vector.combine.vec2'); g.edge(atlasColumn, tile, 'x'); g.edge(atlasRow, tile, 'y');
  const clampedLocal = g.node('clamped-local-uv', 'math.clamp.vec2'); g.edge(localUv, clampedLocal, 'value'); g.edge(tiny2, clampedLocal, 'min'); g.edge(almost2, clampedLocal, 'max');
  const atlasPixel = g.binary('atlas-pixel', 'math.add.vec2', tile, clampedLocal), atlasSize = g.node('atlas-size', 'vector.combine.vec2'); g.edge(safeColumns, atlasSize, 'x'); g.edge(safeRows, atlasSize, 'y');
  const atlasUv = g.binary('atlas-uv', 'math.divide-ieee.vec2', atlasPixel, atlasSize), atlasSample = g.node('atlas-sample', 'image.sample', 'image'); g.edge(atlas, atlasSample, 'image'); g.edge(atlasUv, atlasSample, 'uv');
  const atlasVec4 = g.node('atlas-vec4', 'convert.image-to-vec4'); g.edge(atlasSample, atlasVec4, 'image');
  const atlasSplit = g.node('atlas-split', 'vector.split.vec4', 'w'); g.edge(atlasVec4, atlasSplit, 'value'); const glyphAlpha = { node: atlasSplit.node, port: 'w' };
  const aRgb = g.node('color-a-rgb', 'convert.vec4-to-rgb', 'rgb'), bRgb = g.node('color-b-rgb', 'convert.vec4-to-rgb', 'rgb'); g.edge(colorA, aRgb, 'value'); g.edge(colorB, bRgb, 'value');
  if (variant === 'number-field') {
    const five = g.number('tone-levels', 5), four = g.number('tone-divisor', 4);
    const scaled = g.binary('quantized-tone-scaled', 'math.multiply.scalar', tone, five), floored = g.unary('quantized-tone-floor', 'math.floor.scalar', scaled);
    const quantized = g.binary('quantized-tone', 'math.divide-ieee.scalar', floored, four), numberInk = g.node('number-ink', 'math.mix.rgb');
    g.edge(aRgb, numberInk, 'a'); g.edge(bRgb, numberInk, 'b'); g.edge(quantized, numberInk, 't');
    const marked = g.node('number-mark', 'math.multiply.rgb-scalar'); g.edge(numberInk, marked, 'a'); g.edge(glyphAlpha, marked, 'b');
    const mixed = g.node('mixed', 'math.mix.rgb'); g.edge(sourceRgb, mixed, 'a'); g.edge(marked, mixed, 'b'); g.edge(amount, mixed, 't');
    const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: sourceSplit.node, port: 'alpha' }, combine, 'alpha'); const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
    return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
  }
  if (variant === 'pixel-code') {
    const dark = g.node('code-dark', 'vector.combine.vec3'); g.edge(g.number('code-dark-r', .08), dark, 'x'); g.edge(g.number('code-dark-g', .3), dark, 'y'); g.edge(g.number('code-dark-b', .48), dark, 'z');
    const light = g.node('code-light', 'vector.combine.vec3'); g.edge(g.number('code-light-r', .28), light, 'x'); g.edge(g.number('code-light-g', .95), light, 'y'); g.edge(g.number('code-light-b', .72), light, 'z');
    const darkRgb = g.node('code-dark-rgb', 'convert.vec3-to-rgb', 'rgb'), lightRgb = g.node('code-light-rgb', 'convert.vec3-to-rgb', 'rgb'); g.edge(dark, darkRgb, 'value'); g.edge(light, lightRgb, 'value');
    const codeColor = g.node('code-color', 'math.mix.rgb'); g.edge(darkRgb, codeColor, 'a'); g.edge(lightRgb, codeColor, 'b'); g.edge(tone, codeColor, 't');
    const mark = g.node('code-mark', 'math.multiply.rgb-scalar'); g.edge(codeColor, mark, 'a'); g.edge(glyphAlpha, mark, 'b');
    const mixed = g.node('mixed', 'math.mix.rgb'); g.edge(sourceRgb, mixed, 'a'); g.edge(mark, mixed, 'b'); g.edge(amount, mixed, 't');
    const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: sourceSplit.node, port: 'alpha' }, combine, 'alpha'); const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
    return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
  }
  if (variant === 'pixel-dither') {
    const centered = g.binary('pixel-dither-centered', 'math.subtract.vec2', localUv, half2), radius = g.unary('pixel-dither-radius', 'vector.length.vec2', centered);
    const radial = g.binary('pixel-dither-radial', 'math.subtract.scalar', one, radius), glowLift = g.binary('pixel-dither-glow-lift', 'math.multiply.scalar', radial, g.number('pixel-dither-glow-factor', .18));
    const glow = g.node('pixel-dither-glow', 'math.smoothstep.scalar'); g.edge(g.number('pixel-dither-glow-low', .05), glow, 'edge0'); g.edge(g.number('pixel-dither-glow-high', .65), glow, 'edge1'); g.edge(g.binary('pixel-dither-glow-input', 'math.add.scalar', glyphAlpha, glowLift), glow, 'value');
    const neonBase = g.node('pixel-dither-neon-base', 'math.mix.rgb'); g.edge(aRgb, neonBase, 'a'); g.edge(bRgb, neonBase, 'b'); g.edge(tone, neonBase, 't');
    const neonGlow = g.node('pixel-dither-neon-glow', 'math.multiply.rgb-scalar'); g.edge(neonBase, neonGlow, 'a'); g.edge(glow, neonGlow, 'b');
    const neon = g.node('pixel-dither-neon', 'math.multiply.rgb-scalar'); g.edge(neonGlow, neon, 'a'); g.edge(g.number('pixel-dither-neon-scale', 1.25), neon, 'b');
    const mixed = g.node('mixed', 'math.mix.rgb'); g.edge(sourceRgb, mixed, 'a'); g.edge(neon, mixed, 'b'); g.edge(amount, mixed, 't');
    const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: sourceSplit.node, port: 'alpha' }, combine, 'alpha'); const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
    return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
  }
  if (variant === 'retro-matrix') {
    const amberVector = g.node('retro-amber-vector', 'vector.combine.vec3'); g.edge(one, amberVector, 'x'); g.edge(g.number('retro-amber-green', .52), amberVector, 'y'); g.edge(g.number('retro-amber-blue', .08), amberVector, 'z');
    const amberRgb = g.node('retro-amber-rgb', 'convert.vec3-to-rgb', 'rgb'); g.edge(amberVector, amberRgb, 'value');
    const amberAlpha = g.node('retro-amber-alpha', 'math.multiply.rgb-scalar'); g.edge(amberRgb, amberAlpha, 'a'); g.edge(glyphAlpha, amberAlpha, 'b');
    const toneScale = g.binary('retro-tone-scale', 'math.multiply.scalar', tone, g.number('retro-tone-factor', .7)), toneAmount = g.binary('retro-tone-amount', 'math.add.scalar', g.number('retro-tone-base', .55), toneScale);
    const amber = g.node('retro-amber', 'math.multiply.rgb-scalar'); g.edge(amberAlpha, amber, 'a'); g.edge(toneAmount, amber, 'b');
    const uvParts = g.node('retro-uv-split', 'vector.split.vec2', 'y'); g.edge(uv, uvParts, 'value'); const resolutionParts = g.node('retro-resolution-split', 'vector.split.vec2', 'y'); g.edge(resolution, resolutionParts, 'value');
    const scanPixel = g.binary('retro-scan-pixel', 'math.multiply.scalar', { node: uvParts.node, port: 'y' }, { node: resolutionParts.node, port: 'y' });
    const scanPhase = g.binary('retro-scan-phase', 'math.multiply.scalar', scanPixel, g.number('retro-pi', 3.14159265359)), scanWave = g.unary('retro-scan-wave', 'math.sin.scalar', scanPhase);
    const scan = g.binary('retro-scan', 'math.add.scalar', g.number('retro-scan-base', .82), g.binary('retro-scan-modulation', 'math.multiply.scalar', g.number('retro-scan-scale', .18), scanWave));
    const scanned = g.node('retro-scanned', 'math.multiply.rgb-scalar'); g.edge(amber, scanned, 'a'); g.edge(scan, scanned, 'b');
    const mixed = g.node('mixed', 'math.mix.rgb'); g.edge(sourceRgb, mixed, 'a'); g.edge(scanned, mixed, 'b'); g.edge(amount, mixed, 't');
    const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: sourceSplit.node, port: 'alpha' }, combine, 'alpha'); const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
    return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
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
    const marked = g.node('matrix-marked', 'math.multiply.rgb-scalar'); g.edge(greenRgb, marked, 'a'); g.edge(glyphAlpha, marked, 'b');
    const mixed = g.node('mixed', 'math.mix.rgb'); g.edge(sourceRgb, mixed, 'a'); g.edge(marked, mixed, 'b'); g.edge(amount, mixed, 't');
    const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: sourceSplit.node, port: 'alpha' }, combine, 'alpha'); const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
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
    const scaledEdge = g.binary('contour-edge-cell-scale', 'math.multiply.scalar', edgeLength, cellSize);
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
    const scaledCell = g.binary('inscribe-cell-scale', 'math.multiply.scalar', cellSize, g.number('inscribe-edge-factor', 2.5));
    const edge = g.binary('inscribe-edge', 'math.multiply.scalar', edgeLength, scaledCell), visible = g.node('inscribe-visible', 'math.smoothstep.scalar');
    g.edge(g.number('inscribe-edge-low', .02), visible, 'edge0'); g.edge(g.number('inscribe-edge-high', .35), visible, 'edge1'); g.edge(edge, visible, 'value');
    inkAlpha = g.binary('inscribe-alpha', 'math.multiply.scalar', glyphAlpha, visible);
    const inscribeBackground = g.node('inscribe-background', 'math.multiply.rgb-scalar'); g.edge(sourceRgb, inscribeBackground, 'a'); g.edge(g.number('inscribe-background-scale', .18), inscribeBackground, 'b'); background = inscribeBackground;
  }
  const alpha = g.node('glyph-alpha', 'math.clamp.scalar'); g.edge(inkAlpha, alpha, 'value'); g.edge(zero, alpha, 'min'); g.edge(one, alpha, 'max');
  const result = g.node('glyph-result', 'math.mix.rgb'); g.edge(background, result, 'a'); g.edge(ink, result, 'b'); g.edge(alpha, result, 't');
  const mixed = g.node('mixed', 'math.mix.rgb'); g.edge(sourceRgb, mixed, 'a'); g.edge(result, mixed, 'b'); g.edge(amount, mixed, 't');
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: sourceSplit.node, port: 'alpha' }, combine, 'alpha');
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
