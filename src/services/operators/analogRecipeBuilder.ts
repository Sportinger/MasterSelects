import { BlurGraphBuilder, type GraphPort } from './blurGraphBuilder';

/**
 * Recipe builder for the analog effects (CRT Screen, Glitch, Film Prism): the blur builder's
 * explicit nodes and edges plus short helpers for the scalar, vec2 and RGB math they use.
 * Every helper adds exactly one shared granular operator; nothing is implicit or hidden.
 */
export class AnalogRecipeBuilder extends BlurGraphBuilder {
  mul(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.multiply.scalar', a, b); }
  plus(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.add.scalar', a, b); }
  sub(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.subtract.scalar', a, b); }
  div(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.divide-ieee.scalar', a, b); }
  min(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.min.scalar', a, b); }
  max(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.max.scalar', a, b); }
  clamp(id: string, value: GraphPort, min: GraphPort, max: GraphPort) { return this.add(id, 'math.clamp.scalar', { value, min, max }); }
  mix(id: string, a: GraphPort, b: GraphPort, t: GraphPort) { return this.add(id, 'math.mix.scalar', { a, b, t }); }
  smooth(id: string, edge0: GraphPort, edge1: GraphPort, value: GraphPort) { return this.add(id, 'math.smoothstep.scalar', { edge0, edge1, value }); }
  fn(id: string, name: 'sin' | 'cos' | 'exp' | 'floor' | 'fract' | 'abs' | 'sqrt', value: GraphPort) { return this.unary(id, `math.${name}.scalar`, value); }
  greater(id: string, a: GraphPort, b: GraphPort): GraphPort { return [this.add(id, 'compare.greater.scalar', { a, b }), 'condition']; }
  select(id: string, condition: GraphPort, falseValue: GraphPort, trueValue: GraphPort) { return this.add(id, 'select.scalar', { condition, falseValue, trueValue }); }
  /** Integer PCG hash in [0, 1): uniform for any key, no sine-hash stripes. */
  hash(id: string, value: GraphPort) { return this.unary(id, 'noise.hash2d-pcg.vec2', value); }

  vec2(id: string, x: GraphPort, y: GraphPort) { return this.add(id, 'vector.combine.vec2', { x, y }); }
  split2(id: string, value: GraphPort): [GraphPort, GraphPort] { this.unary(id, 'vector.split.vec2', value); return [[id, 'x'], [id, 'y']]; }
  splat2(id: string, value: GraphPort) { return this.unary(id, 'convert.scalar-to-vec2', value); }
  add2(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.add.vec2', a, b); }
  sub2(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.subtract.vec2', a, b); }
  mul2(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.multiply.vec2', a, b); }
  scale2(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.multiply.vec2-scalar', a, b); }

  addRgb(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.add.rgb', a, b); }
  mulRgb(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.multiply.rgb', a, b); }
  scaleRgb(id: string, a: GraphPort, b: GraphPort) { return this.binary(id, 'math.multiply.rgb-scalar', a, b); }
  mixRgb(id: string, a: GraphPort, b: GraphPort, t: GraphPort) { return this.add(id, 'math.mix.rgb', { a, b, t }); }
  rgb3(id: string, x: GraphPort, y: GraphPort, z: GraphPort): GraphPort {
    this.add(`${id}-vector`, 'vector.combine.vec3', { x, y, z });
    return [this.add(id, 'convert.vec3-to-rgb', { value: `${id}-vector` }), 'rgb'];
  }
  /** One value in all three channels (RGB port). */
  rgbConstant(id: string, value: GraphPort): GraphPort { return [this.unary(id, 'convert.scalar-to-rgb', value), 'rgb']; }

  /** A number parameter clamped to the range the recipe renders (`paramWarnings` reports values outside it). */
  clampedParam(id: string, parameter: string, min: GraphPort, max: GraphPort) {
    return this.clamp(`${id}-clamped`, this.bound(id, parameter), min, max);
  }
}

/**
 * Bilinear read of the premultiplied frame cache, returned as straight colour (rgb) and alpha.
 * Filtering premultiplied texels and dividing by the filtered alpha gives the alpha-weighted
 * colour, so a transparent neighbour never darkens a visible edge.
 */
export function straightSample(g: AnalogRecipeBuilder, prefix: string, cache: string, uv: GraphPort): { rgb: string; alpha: GraphPort } {
  g.add(`${prefix}-sample`, 'image.sample', { image: [cache, 'image'], uv });
  g.add(`${prefix}-split`, 'vector.split.rgba', { image: [`${prefix}-sample`, 'image'] });
  const alpha = g.add(`${prefix}-alpha`, 'convert.alpha-to-scalar', { alpha: [`${prefix}-split`, 'alpha'] });
  const safe = g.max(`${prefix}-safe-alpha`, alpha, 'coverage-floor');
  return { rgb: g.add(`${prefix}-rgb`, 'math.divide-ieee.rgb-scalar', { a: [`${prefix}-split`, 'rgb'], b: safe }), alpha };
}
