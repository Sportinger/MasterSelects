import type { BoundOperatorNode, EffectOperatorGraph, OperatorValue } from '../../../types/operatorGraph';
import type { EffectPreset } from '../../nodeGraph/effectPresetLibrary';
import { createWaveStrandsGraph } from './weaveGraph';
import { createJellyfishReferenceGraph } from './jellyfishReferenceGraph';

type NodeSpec = [id: string, operator: string, constants?: Record<string, OperatorValue>];

function yarnGraph(generator: NodeSpec, radius: number): EffectOperatorGraph {
  const specs: NodeSpec[] = [generator,
    ['yarn', 'geometry.yarn-profile', { plies: 3, fibers: 8, radius, plyTwist: 5, fiberTwist: -11 }],
    ['material', 'material.fiber', { preset: 'cotton', color: '#e8b879', roughnessLongitudinal: 0.45, matte: 0.25 }],
    ['render', 'render.strands', { width: 0.003, antialiasing: 'analytic' }],
    ['output', 'scene.output']];
  const nodes: BoundOperatorNode[] = specs.map(([id, operator, constants]) =>
    ({ id, operator, operatorVersion: 1, bindings: {}, ...(constants ? { constants } : {}) }));
  return { version: 1, schemaVersion: 1, domain: 'geometry', nodes,
    layout: Object.fromEntries(specs.map(([id], index) => [id, { x: index * 310, y: 80 }])),
    edges: specs.slice(1).map(([to], index) => ({ id: `link-${index}`, from: specs[index][0], to,
      output: index === specs.length - 2 ? 'scene' : 'curves', input: index === specs.length - 2 ? 'scene' : 'curves' })) };
}

/** Recovered study geometry; new editable copies never depend on browser preset storage. */
export function listBuiltInWeavePresets(): EffectPreset[] {
  return [
    { id: 'builtin:weave:four-yarn-ring', label: 'Four-Yarn Knit Ring',
      effect: { type: 'weave', enabled: true, params: {},
        operatorGraph: yarnGraph(['study', 'geometry.knit-passage', { duration: 33.8, follow: 'follow' }], 0.026) } },
    { id: 'builtin:weave:endless-knit-band', label: 'Endless Knit Band',
      effect: { type: 'weave', enabled: true, params: {},
        operatorGraph: yarnGraph(['band', 'geometry.knit-sphere', { rows: 4, radius: 0.8, bandSpan: 0.16,
          zoneCenter: 0, zoneHeight: 1.8, feather: 0.3, height: 0.07, depth: 0.025, speed: 0.05 }], 0.012) } },
    { id: 'builtin:weave:wave-strands', label: 'Wave Strands',
      effect: { type: 'weave', enabled: true, params: {}, operatorGraph: createWaveStrandsGraph() } },
    { id: 'builtin:weave:jellyfish-reference', label: 'Jellyfish — Video Reconstruction',
      effect: { type: 'weave', enabled: true, params: { 'body-length_value': 1.5, 'tail-inset_value': 0.45, irregularity_value: 0.04,
        circulation_value: 0.05, 'return-motion_value': 0.4, 'curl-strength_value': 0.18, 'curl-detail_value': 3.5, 'curl-evolution_value': 0.08, 'soft-head_value': .035, 'soft-tail_value': .075, 'soft-speed_value': .15, 'return-length_value': 1.5, 'pulse-rate_value': 0.4, 'pulse-strength_value': 0.4 },
        operatorGraph: createJellyfishReferenceGraph() } },
  ];
}
