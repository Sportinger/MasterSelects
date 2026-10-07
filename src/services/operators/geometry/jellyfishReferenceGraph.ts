import type { BoundOperatorNode, EffectOperatorGraph, OperatorValue } from '../../../types/operatorGraph';

/** Visual reconstruction from an orbit recording, not a recovered original node tree. */
export function createJellyfishReferenceGraph(): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [];
  const edges: EffectOperatorGraph['edges'] = [];
  const layout: NonNullable<EffectOperatorGraph['layout']> = {};
  const add = (id: string, operator: string, x: number, y: number, constants?: Record<string, OperatorValue>) => {
    const node: BoundOperatorNode = { id, operator, operatorVersion: 1, bindings: {}, ...(constants ? { constants } : {}) };
    nodes.push(node); layout[id] = { x, y }; return node;
  };
  const link = (from: string, output: string, to: string, input: string) =>
    edges.push({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
  const control = (id: string, label: string, value: number, min: number, max: number, step: number, x: number, y: number) => {
    const node = add(id, 'values.number', x, y, { value });
    node.bindings = { value: `${id}_value` };
    node.exposed = { label, min, max, step };
  };

  // Sparse closed courses with an oval knitted face at +Z and long loose returns behind it.
  // Static by default: the reference camera orbits the shape; it does not establish a solve.
  add('knit', 'geometry.knit-sphere', 0, 80, { radius: 0.8, rows: 13, stitches: 24,
    bandSpan: 0.7, height: 0.095, depth: 0.024, lean: 1.55, resolution: 40,
    zoneWidth: 110, zoneCenter: 0, zoneHeight: 1.8, feather: 0.22, speed: 0, phase: 0.015 });
  add('position', 'geometry.position', 0, 540);
  add('split', 'vector.split.vec3', 280, 540);
  control('body-length', 'Body Length', 1.5, 0.5, 3, 0.01, 280, 800);
  add('length', 'math.multiply.scalar', 560, 760);
  add('shape', 'vector.combine.vec3', 840, 540);
  add('stretch', 'geometry.set-position', 1120, 80);
  link('knit', 'curves', 'stretch', 'curves');
  link('position', 'position', 'split', 'value');
  link('split', 'x', 'shape', 'x'); link('split', 'y', 'shape', 'y');
  link('split', 'z', 'length', 'a'); link('body-length', 'value', 'length', 'b');
  link('length', 'value', 'shape', 'z'); link('shape', 'value', 'stretch', 'position');

  // Spatial noise keeps the repeated endpoint identical; no u-based seam or time accumulation.
  control('irregularity', 'Irregularity', 0.12, 0, 0.3, 0.001, 1120, 1080);
  add('return-position', 'geometry.position', 0, 1200);
  add('return-split', 'vector.split.vec3', 280, 1200);
  add('return-mask', 'field.ramp', 560, 1060, { x0: -1.2, y0: 1, x1: 0.5, y1: 1, x2: 1, y2: 0.12 });
  add('return-amount', 'math.multiply.scalar', 840, 1060);
  link('return-position', 'position', 'return-split', 'value');
  link('return-split', 'z', 'return-mask', 'value');
  link('return-mask', 'value', 'return-amount', 'a');
  link('irregularity', 'value', 'return-amount', 'b');
  add('wobble-x', 'field.noise', 1400, 480, { frequency: 3.2, amplitude: 0.016, seed: 17, octaves: 2 });
  add('wobble-y', 'field.noise', 1400, 780, { frequency: 4, amplitude: 0.065, seed: 29, octaves: 2 });
  add('wobble-z', 'field.noise', 1400, 1080, { frequency: 2.8, amplitude: 0.025, seed: 43, octaves: 2 });
  // One amount controls all three axes, preserving the proportion of the reference's waviness.
  add('x-ratio', 'values.number', 840, 1280, { value: 0.25 });
  add('z-ratio', 'values.number', 840, 1440, { value: 0.4 });
  add('x-amount', 'math.multiply.scalar', 1120, 1280);
  add('z-amount', 'math.multiply.scalar', 1120, 1480);
  for (const axis of ['x', 'z']) {
    link('return-amount', 'value', `${axis}-amount`, 'a');
    link(`${axis}-ratio`, 'value', `${axis}-amount`, 'b');
    link(`${axis}-amount`, 'value', `wobble-${axis}`, 'amplitude');
  }
  link('return-amount', 'value', 'wobble-y', 'amplitude');
  add('offset', 'vector.combine.vec3', 1680, 600);
  for (const axis of ['x', 'y', 'z']) link(`wobble-${axis}`, 'value', 'offset', axis);
  add('handmade', 'geometry.set-position', 1960, 80);
  link('stretch', 'curves', 'handmade', 'curves'); link('offset', 'value', 'handmade', 'offset');

  add('yarn', 'geometry.yarn-profile', 2240, 80, { plies: 3, fibers: 8, radius: 0.01, plyTwist: 7, fiberTwist: -13 });
  add('flyaways', 'geometry.flyaways', 2520, 80, { density: 1.5, length: 0.055, lift: 2, hair: 0.3, seed: 7 });
  add('material', 'material.fiber', 2800, 80, { preset: 'wool', color: '#eee2cf', roughnessLongitudinal: 0.55, matte: 0.5 });
  add('render', 'render.strands', 3080, 80, { width: 0.0025, color: '#eee2cf', antialiasing: 'analytic' });
  add('output', 'scene.output', 3360, 80);
  const chain = ['handmade', 'yarn', 'flyaways', 'material', 'render'];
  chain.slice(1).forEach((id, index) => link(chain[index], 'curves', id, 'curves'));
  link('render', 'scene', 'output', 'scene');
  return { version: 1, schemaVersion: 1, domain: 'geometry', nodes, edges, layout,
    groups: [
      { id: 'closed-knit', label: 'Closed Knit Body', color: '#5f9ea0', nodeIds: ['knit', 'position', 'split', 'body-length', 'length', 'shape', 'stretch'] },
      { id: 'loose-returns', label: 'Loose Returns', color: '#8a7fd1', nodeIds: ['irregularity', 'return-position', 'return-split', 'return-mask', 'return-amount', 'wobble-x', 'wobble-y', 'wobble-z', 'x-ratio', 'z-ratio', 'x-amount', 'z-amount', 'offset', 'handmade'] },
      { id: 'cream-yarn', label: 'Cream Yarn', color: '#c8a45a', nodeIds: ['yarn', 'flyaways', 'material'] },
    ] };
}
