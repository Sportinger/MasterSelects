import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge, OperatorValue } from '../../types/operatorGraph';

type Ref = { node: string; port: string };

/** Canonical Marching Squares graph. Only topology selection is specialized;
 * sampling, interpolation, distances, styling, and alpha remain explicit. */
export function createDefaultContourGraph(): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [], edges: OperatorEdge[] = [], layout: EffectOperatorGraph['layout'] = {};
  const outputPort = (operator: string) => operator === 'image.frame' || operator === 'image.load-pixel-clamped'
    || operator === 'vector.combine.rgba' ? 'image' : operator === 'image.normalized-uv' ? 'uv'
      : operator === 'convert.vec4-to-rgb' ? 'rgb' : operator.startsWith('compare.') ? 'condition' : 'value';
  const n = (id: string, operator: string, column: number, bindings: Record<string, string> = {}, constants?: Record<string, OperatorValue>): Ref => {
    nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    layout[id] = { x: column * 300, y: nodes.filter(node => layout[node.id]?.x === column * 300).length * 170 };
    return { node: id, port: outputPort(operator) };
  };
  const e = (from: Ref, to: Ref, input: string) => edges.push({ id: `${from.node}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input });
  const literal = (id: string, value: number) => n(id, 'values.number', 0, {}, { value });
  const unary = (id: string, operator: string, value: Ref, column: number, input = 'value') => { const out = n(id, operator, column); e(value, out, input); return out; };
  const binary = (id: string, operator: string, a: Ref, b: Ref, column: number) => { const out = n(id, operator, column); e(a, out, 'a'); e(b, out, 'b'); return out; };
  const vec2 = (id: string, x: Ref, y: Ref, column: number) => { const out = n(id, 'vector.combine.vec2', column); e(x, out, 'x'); e(y, out, 'y'); return out; };
  const component = (ref: Ref, port: string): Ref => ({ node: ref.node, port });

  const frame = n('frame', 'image.frame', 0), uv = n('uv', 'image.normalized-uv', 0), resolution = n('resolution', 'image.resolution', 0);
  const scale = n('scale', 'values.number', 0, { value: 'scale' }), threshold = n('threshold', 'values.number', 0, { value: 'threshold' });
  const amount = n('amount', 'values.number', 0, { value: 'amount' });
  const colorA = n('color-a', 'values.color', 0, { value: 'colorA' }), colorB = n('color-b', 'values.color', 0, { value: 'colorB' });
  const zero = literal('zero', 0), one = literal('one', 1), four = literal('four', 4), epsilon = literal('epsilon', .00001);
  const ten = literal('ten', 10), lineLow = literal('line-low', .035), lineHigh = literal('line-high', .1);
  const rounded = unary('rounded-scale', 'math.round-even.scalar', scale, 1), size = binary('cell-size', 'math.max.scalar', four, rounded, 2);
  const pixel = unary('pixel', 'math.floor.vec2', binary('pixel-unfloored', 'math.multiply.vec2', uv, resolution, 1), 2);
  const origin = n('origin', 'coordinates.integer-cell-origin.vec2', 3); e(pixel, origin, 'pixel'); e(size, origin, 'size');
  const sizeX = vec2('size-x', size, zero, 3), sizeY = vec2('size-y', zero, size, 3), sizeXY = vec2('size-xy', size, size, 3);
  const positions = { tl: origin, tr: binary('tr-pixel', 'math.add.vec2', origin, sizeX, 4),
    br: binary('br-pixel', 'math.add.vec2', origin, sizeXY, 4), bl: binary('bl-pixel', 'math.add.vec2', origin, sizeY, 4) };
  const tones = Object.fromEntries(Object.entries(positions).map(([id, position]) => {
    const sample = n(`${id}-sample`, 'image.load-pixel-clamped', 5); e(frame, sample, 'image'); e(position, sample, 'pixel');
    return [id, unary(`${id}-tone`, 'color.luminance-rec709.image', sample, 6, 'image')];
  })) as Record<keyof typeof positions, Ref>;
  const edgePosition = (id: string, a: Ref, b: Ref) => {
    const difference = binary(`${id}-difference`, 'math.subtract.scalar', b, a, 7);
    const denominator = binary(`${id}-denominator`, 'math.max.scalar', unary(`${id}-absolute`, 'math.abs.scalar', difference, 8), epsilon, 9);
    const ratio = binary(`${id}-ratio`, 'math.divide-ieee.scalar', binary(`${id}-numerator`, 'math.subtract.scalar', threshold, a, 8), denominator, 10);
    const out = n(`${id}-position`, 'math.clamp.scalar', 11); e(ratio, out, 'value'); e(zero, out, 'min'); e(one, out, 'max'); return out;
  };
  const top = vec2('top', edgePosition('top', tones.tl, tones.tr), zero, 12);
  const right = vec2('right', one, edgePosition('right', tones.tr, tones.br), 12);
  const bottom = vec2('bottom', edgePosition('bottom', tones.bl, tones.br), one, 12);
  const left = vec2('left', zero, edgePosition('left', tones.tl, tones.bl), 12);
  const topology = n('topology', 'geometry.marching-squares-topology', 13);
  for (const id of ['tl', 'tr', 'br', 'bl'] as const) { const occupied = n(`${id}-occupied`, 'math.step.scalar', 12); e(threshold, occupied, 'edge'); e(tones[id], occupied, 'value'); e(occupied, topology, id); }
  for (const [id, value] of Object.entries({ top, right, bottom, left })) e(value, topology, id);
  const local = (() => { const out = n('local', 'math.divide-ieee.vec2-scalar', 6); e(binary('local-pixel', 'math.subtract.vec2', pixel, origin, 5), out, 'a'); e(size, out, 'b'); return out; })();
  const segmentDistance = (id: string, start: Ref, finish: Ref) => {
    const segment = binary(`${id}-segment`, 'math.subtract.vec2', finish, start, 14);
    const relative = binary(`${id}-relative`, 'math.subtract.vec2', local, start, 14);
    const numerator = binary(`${id}-dot`, 'vector.dot.vec2', relative, segment, 15);
    const denominator = binary(`${id}-length-squared`, 'vector.dot.vec2', segment, segment, 15);
    const safe = binary(`${id}-safe-length`, 'math.max.scalar', denominator, epsilon, 16);
    const ratio = binary(`${id}-ratio`, 'math.divide-ieee.scalar', numerator, safe, 17);
    const along = n(`${id}-along`, 'math.clamp.scalar', 18); e(ratio, along, 'value'); e(zero, along, 'min'); e(one, along, 'max');
    const scaled = n(`${id}-scaled`, 'math.multiply.vec2-scalar', 19); e(segment, scaled, 'a'); e(along, scaled, 'b');
    const projected = binary(`${id}-projected`, 'math.add.vec2', start, scaled, 20);
    return unary(`${id}-distance`, 'vector.length.vec2', binary(`${id}-delta`, 'math.subtract.vec2', local, projected, 21), 22);
  };
  const a = component(topology, 'a'), b = component(topology, 'b'), c = component(topology, 'c'), d = component(topology, 'd'), count = component(topology, 'count');
  const firstDistance = segmentDistance('first', a, b), secondDistance = segmentDistance('second', c, d);
  const hasFirst = n('has-first', 'compare.greater.scalar', 18); e(count, hasFirst, 'a'); e(zero, hasFirst, 'b');
  const hasSecond = n('has-second', 'compare.greater.scalar', 18); e(count, hasSecond, 'a'); e(one, hasSecond, 'b');
  const first = n('first-selected', 'select.scalar', 23); e(ten, first, 'falseValue'); e(firstDistance, first, 'trueValue'); e(hasFirst, first, 'condition');
  const nearest = binary('nearest-distance', 'math.min.scalar', first, secondDistance, 23);
  const distance = n('distance', 'select.scalar', 24); e(first, distance, 'falseValue'); e(nearest, distance, 'trueValue'); e(hasSecond, distance, 'condition');
  const smooth = n('line-smooth', 'math.smoothstep.scalar', 25); e(lineLow, smooth, 'edge0'); e(lineHigh, smooth, 'edge1'); e(distance, smooth, 'value');
  const line = binary('line', 'math.subtract.scalar', one, smooth, 26);
  const colorARgb = unary('color-a-rgb', 'convert.vec4-to-rgb', colorA, 25), colorBRgb = unary('color-b-rgb', 'convert.vec4-to-rgb', colorB, 25);
  const contour = n('contour-color', 'math.mix.rgb', 26); e(colorBRgb, contour, 'a'); e(colorARgb, contour, 'b'); e(line, contour, 't');
  const original = n('original-sample', 'image.load-pixel-clamped', 23); e(frame, original, 'image'); e(pixel, original, 'pixel');
  const originalColor = unary('original-color', 'vector.split.rgba', original, 24, 'image');
  const mixed = n('mixed', 'math.mix.rgb', 27); e(component(originalColor, 'rgb'), mixed, 'a'); e(contour, mixed, 'b'); e(amount, mixed, 't');
  const combined = n('combined', 'vector.combine.rgba', 28); e(mixed, combined, 'rgb'); e(component(originalColor, 'alpha'), combined, 'alpha');
  const output = n('output', 'image.output', 29); e(combined, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'compute-image', nodes, edges, layout };
}
