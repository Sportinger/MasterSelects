import { describe, expect, it } from 'vitest';
import { validateEffectGraph } from '../../src/services/operators/effectGraph';
import { createDefaultGeometryFragmentGraph, type EditableGeometryFragmentEffectType } from '../../src/services/operators/geometryFragmentEffectGraphs';

const types: EditableGeometryFragmentEffectType[] = ['contour-map', 'crosshatch', 'kilim', 'vector-tiling', 'embroidery', 'outline', 'bricks'];

describe('geometry fragment effect graphs', () => {
  it.each(types)('%s is a valid one-pass graph with clamped source sampling and original alpha', type => {
    const graph = createDefaultGeometryFragmentGraph(type);
    expect(validateEffectGraph(graph)).toEqual([]);
    expect(graph.domain).toBe('image');
    expect(graph.nodes.find(node => node.id === 'clamped-uv')?.operator).toBe('math.clamp.vec2');
    expect(graph.nodes.find(node => node.id === 'source')?.operator).toBe('image.sample');
    expect(graph.edges).toContainEqual(expect.objectContaining({
      from: type === 'bricks' ? 'brick-color' : 'source-color',
      output: 'alpha',
      to: 'combined',
      input: 'alpha',
    }));
    expect(graph.nodes.some(node => node.operator === 'image.materialize')).toBe(false);
    expect(graph.nodes.find(node => node.id === 'amount')?.bindings).toEqual({ value: 'amount' });
    if (type !== 'outline') expect(graph.nodes.find(node => node.id === 'scale')?.bindings).toEqual({ value: 'scale' });
    else expect(graph.nodes.some(node => node.id === 'scale')).toBe(false);
  });

  it('preserves each legacy formula as explicit generic operations', () => {
    const contour = createDefaultGeometryFragmentGraph('contour-map');
    expect(contour.nodes.find(node => node.id === 'quantized')?.operator).toBe('math.divide-ieee.scalar');
    expect(contour.nodes.find(node => node.id === 'band-distance')?.operator).toBe('math.abs.scalar');
    const hatch = createDefaultGeometryFragmentGraph('crosshatch');
    expect(hatch.nodes.filter(node => node.id.endsWith('-gate')).map(node => node.id)).toEqual(['first-gated-gate', 'second-gated-gate', 'third-gated-gate']);
    expect(hatch.nodes.find(node => node.id === 'hatch')?.operator).toBe('math.max.scalar');
    const kilim = createDefaultGeometryFragmentGraph('kilim');
    expect(kilim.nodes.find(node => node.id === 'diamond')?.operator).toBe('math.step.scalar');
    expect(kilim.nodes.find(node => node.id === 'stripe')?.operator).toBe('math.step.scalar');
    expect(kilim.nodes.find(node => node.id === 'textile-pattern')?.operator).toBe('math.abs.scalar');
  });

  it('returns isolated graph state', () => {
    const first = createDefaultGeometryFragmentGraph('crosshatch'), second = createDefaultGeometryFragmentGraph('crosshatch');
    first.layout.source!.x = 999; first.nodes[0]!.bindings.changed = 'changed'; first.edges[0]!.from = 'changed';
    expect(second.layout.source!.x).not.toBe(999); expect(second.nodes[0]!.bindings).not.toHaveProperty('changed'); expect(second.edges[0]!.from).not.toBe('changed');
  });

  it('preserves rotation, deterministic clocks, neighbor sampling, and effect-specific alpha', () => {
    const vector = createDefaultGeometryFragmentGraph('vector-tiling');
    expect(vector.nodes.find(node => node.id === 'angle-degrees')?.operator).toBe('math.add.scalar');
    expect(vector.nodes.find(node => node.id === 'angle-radians')?.operator).toBe('convert.degrees-to-radians.scalar');
    expect(vector.nodes.find(node => node.id === 'rotated')?.operator).toBe('coordinates.rotate.vec2');
    expect(vector.nodes.find(node => node.id === 'center-sample')?.operator).toBe('image.sample');
    const embroidery = createDefaultGeometryFragmentGraph('embroidery');
    const outline = createDefaultGeometryFragmentGraph('outline');
    const bricks = createDefaultGeometryFragmentGraph('bricks');
    for (const graph of [embroidery, outline, bricks]) {
      expect(graph.nodes.find(node => node.id === 'time')?.operator).toBe('image.timeline-time');
      expect(graph.nodes.find(node => node.id === 'speed')?.bindings).toEqual({ value: 'speed' });
    }
    expect(outline.nodes.filter(node => /^(right|left|down|up)-sample$/.test(node.id))).toHaveLength(4);
    expect(bricks.nodes.find(node => node.id === 'brick-hash')?.operator).toBe('noise.hash2d.vec2');
    expect(bricks.edges).toContainEqual(expect.objectContaining({ from: 'brick-color', output: 'alpha', to: 'combined', input: 'alpha' }));
    for (const graph of [vector, embroidery, outline]) {
      expect(graph.edges).toContainEqual(expect.objectContaining({ from: 'source-color', output: 'alpha', to: 'combined', input: 'alpha' }));
    }
  });
});
