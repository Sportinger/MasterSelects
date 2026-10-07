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
  // Material points circulate through a stationary knitting window: the generator folds
  // incoming yarn and unfolds outgoing yarn, rather than rotating an already knitted body.
  const knit = add('knit', 'geometry.knit-sphere', 0, 80, { radius: 0.8, rows: 13, stitches: 24,
    bandSpan: 0.7, height: 0.095, depth: 0.024, lean: 1.55, resolution: 40,
    zoneWidth: 110, zoneCenter: 0, zoneHeight: 1.8, feather: 0.22, speed: 0.05, phase: 0.015 });
  // Generator parameters have no input ports; this exposed Value shares the speed binding.
  control('circulation', 'Yarn Circulation (turns/s)', 0.05, -0.2, 0.2, 0.001, 0, 340);
  knit.bindings.speed = 'circulation_value';
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
  link('tail-set', 'curves', 'handmade', 'curves'); link('offset', 'value', 'handmade', 'offset');

  // A second, independent motion deforms the finished centerlines. The head contracts
  // and locally advances; a narrow wave keeps its strength down the loose returns.
  // Both motions use source time, so seeking, trimming and export never accumulate a solve.
  const pulseStart = nodes.length;
  add('pulse-clock', 'geometry.clip-time', 0, 1850);
  control('pulse-rate', 'Pulse Rate (Hz)', 0.4, 0, 2, 0.01, 0, 2010);
  control('pulse-strength', 'Pulse Strength', 0.4, 0, 0.6, 0.01, 0, 2170);
  add('pulse-tau', 'values.number', 0, 2330, { value: 2 * Math.PI });
  add('pulse-one', 'values.number', 0, 2490, { value: 1 });
  add('pulse-half', 'values.number', 0, 2650, { value: 0.5 });
  add('pulse-sharpness', 'values.number', 0, 2810, { value: 6 });
  add('pulse-front', 'values.number', 280, 2490, { value: 0.8 });
  add('pulse-lag', 'values.number', 280, 2650, { value: 3.2 });
  add('pulse-extension', 'values.number', 280, 2810, { value: 0.12 });
  add('pulse-position', 'geometry.position', 0, 1600);
  add('pulse-split', 'vector.split.vec3', 280, 1600);
  link('pulse-position', 'position', 'pulse-split', 'value');
  type Port = [node: string, output: string];
  const value = (id: string): Port => [id, 'value'];
  const math = (id: string, op: string, a: Port, b: Port | undefined, x: number, y: number): Port => {
    add(id, `math.${op}.scalar`, x, y);
    link(...a, id, b ? 'a' : 'value');
    if (b) link(...b, id, 'b');
    return value(id);
  };
  const cycles = math('pulse-cycles', 'multiply', value('pulse-clock'), value('pulse-rate'), 280, 1850);
  const turn = math('pulse-turn', 'fract', cycles, undefined, 560, 1850);
  const phase = math('pulse-phase', 'multiply', turn, value('pulse-tau'), 840, 1850);
  const longitudinal = math('pulse-longitudinal', 'divide-ieee', ['pulse-split', 'z'], value('body-length'), 560, 1600);
  const distance = math('pulse-distance', 'subtract', value('pulse-front'), longitudinal, 840, 1600);
  const delay = math('pulse-delay', 'multiply', distance, value('pulse-lag'), 1120, 1600);
  const localPhase = math('pulse-local-phase', 'subtract', phase, delay, 1400, 1700);
  const wave = math('pulse-cos', 'cos', localPhase, undefined, 1680, 1700);
  const positive = math('pulse-positive', 'subtract', value('pulse-one'), wave, 1960, 1700);
  const normalized = math('pulse-normalized', 'multiply', positive, value('pulse-half'), 2240, 1700);
  const beat = math('pulse-beat', 'power', normalized, value('pulse-sharpness'), 2520, 1700);
  add('pulse-head-weight', 'field.ramp', 840, 2150, { x0: -2.4, y0: 0, x1: -0.8, y1: 1, x2: 0.8, y2: 1 });
  link(...longitudinal, 'pulse-head-weight', 'value');
  const weighted = math('pulse-weighted', 'multiply', beat, value('pulse-head-weight'), 2800, 1700);
  const amount = math('pulse-amount', 'multiply', weighted, value('pulse-strength'), 3080, 1700);
  const radialScale = math('pulse-radial-scale', 'subtract', value('pulse-one'), amount, 3360, 1700);
  const x = math('pulse-x', 'multiply', ['pulse-split', 'x'], radialScale, 3640, 1600);
  const y = math('pulse-y', 'multiply', ['pulse-split', 'y'], radialScale, 3640, 1800);
  const extension = math('pulse-extend-amount', 'multiply', amount, value('pulse-extension'), 3360, 2050);
  // Local displacement follows the same travelling envelope; no whole-body translation.
  const z = math('pulse-z', 'add', ['pulse-split', 'z'], extension, 3920, 2050);
  add('pulse-shape', 'vector.combine.vec3', 4480, 1700);
  link(...x, 'pulse-shape', 'x'); link(...y, 'pulse-shape', 'y'); link(...z, 'pulse-shape', 'z');
  add('pulse-set', 'geometry.set-position', 2240, 80);
  link('handmade', 'curves', 'pulse-set', 'curves'); link('pulse-shape', 'value', 'pulse-set', 'position');
  const pulseNodes = nodes.slice(pulseStart).map(node => node.id);

  // Move through the noise field on a closed orbit: living returns, deterministic seeks
  // and the same twenty-second loop as the yarn flow. Zero motion freezes the pattern.
  const driftStart = nodes.length;
  control('return-motion', 'Return Motion', 0.6, 0, 2, 0.01, 0, 3250);
  add('return-rate', 'values.number', 0, 3410, { value: 0.05 });
  const driftCycles = math('return-cycles', 'multiply', value('pulse-clock'), value('return-rate'), 280, 3250);
  const driftTurn = math('return-turn', 'fract', driftCycles, undefined, 560, 3250);
  const driftPhase = math('return-phase', 'multiply', driftTurn, value('pulse-tau'), 840, 3250);
  const driftCos = math('return-cos', 'cos', driftPhase, undefined, 1120, 3170);
  const driftSin = math('return-sin', 'sin', driftPhase, undefined, 1120, 3410);
  const driftOrigin = math('return-origin', 'subtract', driftCos, value('pulse-one'), 1400, 3170);
  const driftX = math('return-drift-x', 'multiply', driftOrigin, value('return-motion'), 1680, 3170);
  const driftZ = math('return-drift-z', 'multiply', driftSin, value('return-motion'), 1680, 3410);
  const samplingX = math('return-sampling-x', 'add', ['return-split', 'x'], driftX, 1960, 3170);
  const samplingZ = math('return-sampling-z', 'add', ['return-split', 'z'], driftZ, 1960, 3410);
  add('return-sampling', 'vector.combine.vec3', 2240, 3250);
  link(...samplingX, 'return-sampling', 'x');
  link('return-split', 'y', 'return-sampling', 'y');
  link(...samplingZ, 'return-sampling', 'z');
  for (const axis of ['x', 'y', 'z']) link('return-sampling', 'value', `wobble-${axis}`, 'position');
  const driftNodes = nodes.slice(driftStart).map(node => node.id);

  // Shape the resting loops before noise and swimming motion. +Z is the knitted head;
  // the inset peaks behind the dome and eases toward a rounded rear cap.
  // Un-stretched Z keeps the profile independent of Body Length.
  const tailStart = nodes.length;
  control('tail-inset', 'Tail Inset', 0.45, 0, 0.85, 0.01, 0, 3900);
  add('tail-position', 'geometry.position', 0, 3700);
  add('tail-split', 'vector.split.vec3', 280, 3700);
  link('tail-position', 'position', 'tail-split', 'value');
  const tailZ = math('tail-longitudinal', 'divide-ieee', ['tail-split', 'z'], value('body-length'), 560, 3700);
  add('tail-mask', 'field.ramp', 840, 3700, { x0: -0.55, y0: 0.5, x1: 0.3, y1: 1, x2: 0.72, y2: 0 });
  link(...tailZ, 'tail-mask', 'value');
  const inset = math('tail-amount', 'multiply', value('tail-mask'), value('tail-inset'), 1120, 3700);
  const tailScale = math('tail-scale', 'subtract', value('pulse-one'), inset, 1400, 3700);
  const tailX = math('tail-x', 'multiply', ['tail-split', 'x'], tailScale, 1680, 3620);
  const tailY = math('tail-y', 'multiply', ['tail-split', 'y'], tailScale, 1680, 3820);
  add('tail-shape', 'vector.combine.vec3', 1960, 3700);
  link(...tailX, 'tail-shape', 'x'); link(...tailY, 'tail-shape', 'y');
  link('tail-split', 'z', 'tail-shape', 'z');
  add('tail-set', 'geometry.set-position', 1680, 80);
  link('stretch', 'curves', 'tail-set', 'curves');
  link('tail-shape', 'value', 'tail-set', 'position');
  const tailNodes = nodes.slice(tailStart).map(node => node.id);

  add('yarn', 'geometry.yarn-profile', 2520, 80, { plies: 3, fibers: 8, radius: 0.01, plyTwist: 7, fiberTwist: -13 });
  add('flyaways', 'geometry.flyaways', 2800, 80, { density: 1.5, length: 0.055, lift: 2, hair: 0.3, seed: 7 });
  add('material', 'material.fiber', 3080, 80, { preset: 'wool', color: '#eee2cf', roughnessLongitudinal: 0.55, matte: 0.5 });
  add('render', 'render.strands', 3360, 80, { width: 0.0025, color: '#eee2cf', antialiasing: 'analytic' });
  add('output', 'scene.output', 3640, 80);
  const chain = ['pulse-set', 'yarn', 'flyaways', 'material', 'render'];
  chain.slice(1).forEach((id, index) => link(chain[index], 'curves', id, 'curves'));
  link('render', 'scene', 'output', 'scene');
  return { version: 1, schemaVersion: 1, domain: 'geometry', nodes, edges, layout,
    groups: [
      { id: 'closed-knit', label: 'Closed Knit Body', color: '#5f9ea0', nodeIds: ['knit', 'circulation', 'position', 'split', 'body-length', 'length', 'shape', 'stretch'] },
      { id: 'tail-shaping', label: 'Tail Shape', color: '#709ba2', nodeIds: tailNodes },
      { id: 'loose-returns', label: 'Loose Returns', color: '#8a7fd1', nodeIds: ['irregularity', 'return-position', 'return-split', 'return-mask', 'return-amount', 'wobble-x', 'wobble-y', 'wobble-z', 'x-ratio', 'z-ratio', 'x-amount', 'z-amount', 'offset', 'handmade', ...driftNodes] },
      { id: 'cream-yarn', label: 'Cream Yarn', color: '#c8a45a', nodeIds: ['yarn', 'flyaways', 'material'] },
      { id: 'jellyfish-pulse', label: 'Jellyfish Pulse', color: '#729fbc', nodeIds: pulseNodes },
    ] };
}
