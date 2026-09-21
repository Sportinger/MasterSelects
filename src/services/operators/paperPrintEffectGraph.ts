import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

type Ref = { node: string; port: string };
class Builder {
  readonly nodes: BoundOperatorNode[] = []; readonly edges: OperatorEdge[] = []; readonly layout: EffectOperatorGraph['layout'] = {};
  node(id: string, operator: string, port = 'value', bindings: BoundOperatorNode['bindings'] = {}, constants?: BoundOperatorNode['constants']): Ref {
    this.nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    this.layout[id] = { x: (this.nodes.length % 9) * 340, y: Math.floor(this.nodes.length / 9) * 360 }; return { node: id, port };
  }
  number(id: string, value: number) { return this.node(id, 'values.number', 'value', {}, { value }); }
  edge(from: Ref, to: Ref, input: string) { this.edges.push({ id: `${from.node}-${from.port}-${to.node}-${input}`, from: from.node, output: from.port, to: to.node, input }); }
  unary(id: string, operator: string, value: Ref, input = 'value') { const out = this.node(id, operator); this.edge(value, out, input); return out; }
  binary(id: string, operator: string, a: Ref, b: Ref) { const out = this.node(id, operator); this.edge(a, out, 'a'); this.edge(b, out, 'b'); return out; }
  vec2(id: string, x: Ref, y: Ref) { const out = this.node(id, 'vector.combine.vec2'); this.edge(x, out, 'x'); this.edge(y, out, 'y'); return out; }
}

/** Granular expansion of the common.wgsl value-noise function used by the legacy shader. */
function noise2d(g: Builder, p: Ref, zero: Ref, one: Ref, two: Ref, three: Ref): Ref {
  const i = g.unary('noise-cell', 'math.floor.vec2', p), f = g.unary('noise-fract', 'math.fract.vec2', p);
  const f2 = g.binary('noise-fract-squared', 'math.multiply.vec2', f, f), two2 = g.unary('noise-two-vec2', 'convert.scalar-to-vec2', two);
  const three2 = g.unary('noise-three-vec2', 'convert.scalar-to-vec2', three), twiceF = g.binary('noise-twice-fract', 'math.multiply.vec2', two2, f);
  const fade = g.binary('noise-fade', 'math.multiply.vec2', f2, g.binary('noise-fade-base', 'math.subtract.vec2', three2, twiceF));
  const fadeSplit = g.node('noise-fade-split', 'vector.split.vec2'); g.edge(fade, fadeSplit, 'value');
  const ux = { node: fadeSplit.node, port: 'x' }, uy = { node: fadeSplit.node, port: 'y' };
  const hash = (id: string, x: Ref, y: Ref) => g.unary(id, 'noise.hash2d.vec2', g.binary(`${id}-point`, 'math.add.vec2', i, g.vec2(`${id}-offset`, x, y)));
  const h00 = hash('noise-h00', zero, zero), h10 = hash('noise-h10', one, zero), h01 = hash('noise-h01', zero, one), h11 = hash('noise-h11', one, one);
  const mix = (id: string, a: Ref, b: Ref, t: Ref) => { const out = g.node(id, 'math.mix.scalar'); g.edge(a, out, 'a'); g.edge(b, out, 'b'); g.edge(t, out, 't'); return out; };
  return mix('noise-result', mix('noise-row-zero', h00, h10, ux), mix('noise-row-one', h01, h11, ux), uy);
}

export function createDefaultPaperPrintGraph(): EffectOperatorGraph {
  const g = new Builder(), frame = g.node('frame', 'image.frame', 'image'), uv = g.node('uv', 'image.normalized-uv', 'uv');
  const clampMin = g.number('clamp-min', .001), clampMax = g.number('clamp-max', .999);
  const clampMin2 = g.unary('clamp-min-vec2', 'convert.scalar-to-vec2', clampMin), clampMax2 = g.unary('clamp-max-vec2', 'convert.scalar-to-vec2', clampMax);
  const clampedUv = g.node('clamped-uv', 'math.clamp.vec2'); g.edge(uv, clampedUv, 'value'); g.edge(clampMin2, clampedUv, 'min'); g.edge(clampMax2, clampedUv, 'max');
  const sampled = g.node('sampled', 'image.sample', 'image'); g.edge(frame, sampled, 'image'); g.edge(clampedUv, sampled, 'uv');
  const resolution = g.node('resolution', 'image.resolution'), scale = g.node('scale', 'values.number', 'value', { value: 'scale' });
  const amount = g.node('amount', 'values.number', 'value', { value: 'amount' }), colorA = g.node('color-a', 'values.color', 'value', { value: 'colorA' });
  const colorB = g.node('color-b', 'values.color', 'value', { value: 'colorB' }), zero = g.number('zero', 0), one = g.number('one', 1);
  const two = g.number('two', 2), three = g.number('three', 3), half = g.number('half', .5), grainAmount = g.number('grain-amount', .3);
  const low = g.number('pressed-low', .15), high = g.number('pressed-high', .85), paperBase = g.number('paper-base', .92), paperGrain = g.number('paper-grain', .08);
  const pixel = g.unary('pixel', 'math.floor.vec2', g.binary('uv-resolution', 'math.multiply.vec2', uv, resolution));
  const effectiveScale = g.binary('effective-scale', 'math.max.scalar', scale, one), scale2 = g.unary('scale-vec2', 'convert.scalar-to-vec2', effectiveScale);
  const noise = noise2d(g, g.binary('noise-point', 'math.divide-ieee.vec2', pixel, scale2), zero, one, two, three);
  const grain = g.binary('grain', 'math.subtract.scalar', noise, half), grainTone = g.binary('grain-tone', 'math.multiply.scalar', grain, grainAmount);
  const luma = g.node('luminance', 'color.luminance-rec709.image'); g.edge(sampled, luma, 'image');
  const tone = g.binary('tone', 'math.add.scalar', luma, grainTone), pressed = g.node('pressed', 'math.smoothstep.scalar');
  g.edge(low, pressed, 'edge0'); g.edge(high, pressed, 'edge1'); g.edge(tone, pressed, 'value');
  const aRgb = g.node('color-a-rgb', 'convert.vec4-to-rgb', 'rgb'), bRgb = g.node('color-b-rgb', 'convert.vec4-to-rgb', 'rgb');
  g.edge(colorA, aRgb, 'value'); g.edge(colorB, bRgb, 'value');
  const ink = g.node('print-ink', 'math.mix.rgb'); g.edge(aRgb, ink, 'a'); g.edge(bRgb, ink, 'b'); g.edge(pressed, ink, 't');
  const factor = g.binary('paper-factor', 'math.add.scalar', paperBase, g.binary('paper-grain-factor', 'math.multiply.scalar', grain, paperGrain));
  const printColor = g.node('print-color', 'math.multiply.rgb-scalar'); g.edge(ink, printColor, 'a'); g.edge(factor, printColor, 'b');
  const split = g.node('frame-split', 'vector.split.rgba', 'rgb'); g.edge(sampled, split, 'image');
  const mixed = g.node('mixed', 'math.mix.rgb'); g.edge({ node: split.node, port: 'rgb' }, mixed, 'a'); g.edge(printColor, mixed, 'b'); g.edge(amount, mixed, 't');
  const combine = g.node('combine', 'vector.combine.rgba', 'image'); g.edge(mixed, combine, 'rgb'); g.edge({ node: split.node, port: 'alpha' }, combine, 'alpha');
  const output = g.node('output', 'image.output', ''); g.edge(combine, output, 'image');
  return { version: 1, schemaVersion: 1, domain: 'image', nodes: g.nodes, edges: g.edges, layout: g.layout };
}
