// Kernel loop-invariant hoisting (imageOperatorScopes.kernelInvariantValues) and the Acuarela passes
// that rely on it: values that do not depend on the kernel index are computed once per pixel and
// reach the kernel term as arguments; results must not change.
import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { createDefaultAcuarelaGraph } from '../../src/services/operators/acuarelaWatercolorGraph';
import { compileImageOperatorGraph, evaluateImageOperatorPlan } from '../../src/services/operators/imageOperatorGraph';
import { evaluateFractalNoise2d } from '../../src/services/operators/imageNoiseSemantics';
import type { BoundOperatorNode, EffectOperatorGraph } from '../../src/types/operatorGraph';

type Rgba = [number, number, number, number];
const node = (id: string, operator: string, value?: number): BoundOperatorNode => ({
  id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }),
});
const edge = (from: string, output: string, to: string, input: string) => ({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });

/** A 3 x 3 kernel whose tap spacing is a noise value of the pixel position: noise(uv * 7) * 4 texels. */
function noisySpacingGraph(): EffectOperatorGraph {
  const nodes = [node('frame', 'image.frame'), node('uv', 'image.normalized-uv'), node('resolution', 'image.resolution'),
    node('seven', 'values.number', 7), node('noise-at', 'math.multiply.vec2-scalar'), node('octaves', 'values.number', 2), node('roughness', 'values.number', .5),
    node('noise', 'noise.fractal2d.vec2'), node('four', 'values.number', 4), node('spacing', 'math.multiply.scalar'),
    node('index', 'image.kernel-index'), node('index-texels', 'math.multiply.vec2-scalar'), node('offset', 'math.divide-ieee.vec2'), node('tap-uv', 'math.add.vec2'),
    node('tap', 'image.sample'), node('weight', 'values.number', 1), node('extent', 'values.number', 1),
    node('reduce', 'image.kernel-grid-reduce'), node('image', 'convert.vec4-to-image'), node('output', 'image.output')];
  const edges = [edge('uv', 'uv', 'noise-at', 'a'), edge('seven', 'value', 'noise-at', 'b'), edge('noise-at', 'value', 'noise', 'value'),
    edge('octaves', 'value', 'noise', 'octaves'), edge('roughness', 'value', 'noise', 'roughness'), edge('noise', 'value', 'spacing', 'a'), edge('four', 'value', 'spacing', 'b'),
    edge('index', 'value', 'index-texels', 'a'), edge('spacing', 'value', 'index-texels', 'b'), edge('index-texels', 'value', 'offset', 'a'), edge('resolution', 'value', 'offset', 'b'),
    edge('uv', 'uv', 'tap-uv', 'a'), edge('offset', 'value', 'tap-uv', 'b'), edge('frame', 'image', 'tap', 'image'), edge('tap-uv', 'value', 'tap', 'uv'),
    edge('tap', 'image', 'reduce', 'sample'), edge('weight', 'value', 'reduce', 'weight'), edge('extent', 'value', 'reduce', 'extent'),
    edge('reduce', 'sum', 'image', 'value'), edge('image', 'image', 'output', 'image')];
  return { version: 1, schemaVersion: 1, domain: 'image', nodes, edges, layout: Object.fromEntries(nodes.map((item, index) => [item.id, { x: index * 100, y: 0 }])) };
}

const termFunctions = (wgsl: string) => wgsl.split(/\nfn /).filter(part => part.startsWith('evaluateKernelTerm'));

describe('kernel loop-invariant hoisting', () => {
  it('computes an index-independent noise once per pixel and passes it into the kernel term', () => {
    const plan = compileImageOperatorGraph(noisySpacingGraph());
    expect(plan.kernelScopes?.[0].captures?.length).toBeGreaterThan(0);
    const terms = termFunctions(plan.wgsl);
    expect(terms).toHaveLength(1);
    expect(terms[0]).not.toContain('imageGraphFractalNoise(');
    expect(plan.wgsl.split('fn evaluateImageGraph(')[1]).toContain('imageGraphFractalNoise(');
  });

  it('keeps the result: the plain sum of the nine taps at the noise spacing', () => {
    const plan = compileImageOperatorGraph(noisySpacingGraph());
    const uv: [number, number] = [.37, .61], resolution: [number, number] = [40, 30];
    const image = ([u, v]: [number, number]): Rgba => [u, v, u * v, 1];
    const spacing = evaluateFractalNoise2d([uv[0] * 7, uv[1] * 7], 2, .5) * 4;
    const expected = [0, 0, 0, 0];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
      image([uv[0] + x * spacing / resolution[0], uv[1] + y * spacing / resolution[1]]).forEach((value, channel) => { expected[channel] += value; });
    }
    const actual = evaluateImageOperatorPlan(plan, [0, 0, 0, 1], { uv, resolution, sampleImage: image }) as Rgba;
    expected.forEach((value, channel) => expect(actual[channel]).toBeCloseTo(value, 5));
  });
});

describe('Acuarela passes', () => {
  const params = (overrides: Record<string, number> = {}) => ({ ...getDefaultParams('acuarela'), ...overrides });
  it('evaluates no noise field per wash tap (wet patches, wobble and tap jitter are hoisted)', () => {
    const passes = compileImageOperatorGraph(createDefaultAcuarelaGraph(), params(), {}).passes!;
    for (const index of [1, 2]) {
      const terms = termFunctions(passes[index].program.wgsl);
      expect(terms, `pass ${index}`).toHaveLength(1);
      expect(terms[0], `pass ${index}`).not.toContain('imageGraphFractalNoise(');
      expect(passes[index].program.wgsl.split('fn evaluateImageGraph(')[1], `pass ${index}`).toContain('imageGraphFractalNoise(');
    }
  });

  it('blends Mix premultiplied, so a transparent layer keeps its colour where the wash edge moved', () => {
    // Opaque orange left of x = 960 in the source; the wash cache ends 4 px earlier (a moved paint edge).
    const orange: Rgba = [1, .6, .2, 1];
    const premultiplied = (edge: number) => ([u]: [number, number]): Rgba => u * 1920 < edge ? orange : [0, 0, 0, 0];
    const final = (mix: number) => compileImageOperatorGraph(createDefaultAcuarelaGraph(),
      params({ opacity: mix, edges: 0, simplify: 0, shadows: 0, granulation: 0, blooms: 0, paper: 0, lift: 0 }), {}).passes![3].program;
    const pixel = (mix: number, x: number) => evaluateImageOperatorPlan(final(mix), [0, 0, 0, 0], { uv: [(x + .5) / 1920, .5], resolution: [1920, 1080],
      timelineTimeSeconds: 0, sampleImage: premultiplied(960),
      sampleResource: (id, uv) => (id.includes('wash') ? premultiplied(956) : premultiplied(960))(uv) }) as Rgba;
    for (const x of [957, 958, 959]) {
      const original = pixel(0, x), painted = pixel(1, x), half = pixel(.5, x);
      expect(original[3]).toBe(1); expect(painted[3]).toBe(0);
      // Premultiplied reference from the two ends: (0.5 C0 a0 + 0.5 C1 a1) / (0.5 a0 + 0.5 a1).
      const alpha = .5 * original[3] + .5 * painted[3];
      for (let channel = 0; channel < 3; channel++) {
        expect(half[channel]).toBeCloseTo((.5 * original[channel] * original[3] + .5 * painted[channel] * painted[3]) / alpha, 5);
      }
      expect(half[3]).toBeCloseTo(alpha, 6);
    }
  });
});
