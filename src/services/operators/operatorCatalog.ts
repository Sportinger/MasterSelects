import { EFFECT_OPERATORS } from './operatorRegistry';
import { SCENE_OPERATORS } from './sceneOperators';
import { isVoxelOperator } from './voxelOperators';
import { listFlockOperators } from '../flock/operators/flockOperatorRegistry';
import { EFFECT_REGISTRY } from '../../effects';
import { getOperatorPortContract, OPERATOR_SIGNAL_CONTRACTS } from './portContracts';
import { describeNodePort } from '../nodeGraph/nodePortPresentation';
import type { NodePortContract } from '../../types/nodePortContract';
import { IMAGE_OPERATORS } from './imageOperators';
import { AUDIO_OPERATORS, AUDIO_SCALAR_OPERATORS } from './audioOperators';

export interface NodeCatalogPort {
  id: string; label: string; type: string; required?: boolean; repeated?: boolean; contract?: NodePortContract;
  formats: readonly string[];
}

export interface NodeCatalogEntry {
  id: string; label: string; description: string; category: string; context: string;
  inputs: NodeCatalogPort[];
  outputs: NodeCatalogPort[];
  parameters: { id: string; label: string; type: string; default: unknown; animatable?: boolean; min?: number; max?: number; step?: number; unit: string; format: string }[];
  sharedOperator?: string;
  family: string;
  variant: string;
  backend: string;
  fusion: string;
  state: string;
  invalidation: string;
  users: string[];
  localImplementations: string[];
  implementation: 'shared' | 'local' | 'unknown';
}

const familyOf = (id: string) => id.replace(/\.(scalar|field|rgb|vec[234])$/, '');
const usersOf = (context: string) => context.split(/\s*\+\s*/).filter(Boolean);
const operatorContext = (operator: (typeof EFFECT_OPERATORS)[number]) => AUDIO_OPERATORS.includes(operator) ? 'Audio samples'
  : operator.id.startsWith('splat.') || operator.composition?.graph.domain === 'scene' ? 'Gaussian splat scene graphs'
  : IMAGE_OPERATORS.includes(operator) || operator.composition
  ? `Local image graphs${AUDIO_SCALAR_OPERATORS.includes(operator) ? ' + Audio samples' : ''}`
  : SCENE_OPERATORS.includes(operator) ? `3D image surfaces${isVoxelOperator(operator.id) ? ' + Voxel Relief' : ''}`
    : isVoxelOperator(operator.id) ? 'Voxel Relief' : operator.id === 'forces.wind' ? 'Face Cables + Flock' : 'Face Cables';

/** A live inventory, not a second registry. Consumers retain their own validated executors. */
export function listNodeCatalog(): NodeCatalogEntry[] {
  const legacy = new Set(['surface.hybrid', 'collision.face', 'collision.surface']);
  const operators: NodeCatalogEntry[] = EFFECT_OPERATORS.filter(o => !legacy.has(o.id)).map(o => ({
    ...o, category: o.id.split('.')[0],
    inputs: o.inputs.map(p => { const contract = getOperatorPortContract(p); return { ...p, contract, formats: contract.formats }; }),
    outputs: o.outputs.map(p => { const contract = getOperatorPortContract(p); return { ...p, contract, formats: contract.formats }; }),
    parameters: o.parameters.map(p => ({ ...p, unit: p.unit ?? 'unknown', format: p.format ?? 'unknown' })),
    context: operatorContext(o),
    family: o.family ?? familyOf(o.id), variant: o.variant ?? o.id,
    backend: o.runtime, fusion: o.fusion ?? 'unspecified', state: o.state ?? 'unspecified', invalidation: o.invalidates,
    users: [...(o.consumers ?? usersOf(operatorContext(o)))],
    localImplementations: o.implementation === 'local' ? [`Operator registry: ${o.id}`] : [],
    implementation: o.implementation ?? 'unknown',
  }));
  const flockPort = (p: Omit<NodeCatalogPort, 'formats'>): NodeCatalogPort => { const contract = describeNodePort({ type: p.type, metadata: { semanticKind: `flock:${p.type}` } }); return { ...p, contract, formats: contract.formats }; };
  const flock: NodeCatalogEntry[] = listFlockOperators().map(o => ({ ...o, inputs: o.inputs.map(flockPort), outputs: o.outputs.map(flockPort), category: `flock / ${o.category}`, context: 'Flock', parameters: o.params.map(p => ({ ...p, unit: 'unknown', format: 'unknown' })),
    family: familyOf(o.sharedOperator ?? o.id), variant: o.id, backend: 'wgsl', fusion: 'compiler-owned',
    state: o.id === 'flock.simulation' || o.id === 'flock.trails' ? 'simulation' : 'stateless', invalidation: o.phase,
    users: ['Flock'], localImplementations: o.sharedOperator ? [] : ['Flock compiler'], implementation: o.sharedOperator ? 'shared' : 'local' }));
  const effects: NodeCatalogEntry[] = [...EFFECT_REGISTRY.values()].map(e => ({
    id: `effect:${e.id}`, label: e.name, description: e.id === 'face-cables' ? 'A group assembled from tracking, geometry, collision, forces and rendering nodes.' : `${e.name} effect.`,
    category: `effects / ${e.category}`, context: ['face-cables', 'voxel-relief'].includes(e.id) ? 'Clip group' : 'Clip effect stack',
    inputs: [{ id: 'image', label: 'Image', type: 'texture', contract: OPERATOR_SIGNAL_CONTRACTS.texture, formats: OPERATOR_SIGNAL_CONTRACTS.texture.formats }], outputs: [{ id: 'image', label: 'Image', type: 'texture', contract: OPERATOR_SIGNAL_CONTRACTS.texture, formats: OPERATOR_SIGNAL_CONTRACTS.texture.formats }],
    parameters: Object.entries(e.params).filter(([, p]) => !p.hidden).map(([id, p]) => ({ id, label: p.label, type: p.type, default: p.default, animatable: p.animatable, min: p.min, max: p.max, step: p.step, unit: 'unknown', format: 'unknown' })),
    family: `effect.${e.category}`, variant: e.id, backend: e.pipelineKind ?? 'fullscreen',
    fusion: e.id === 'invert' ? 'inline migration target' : 'pass-boundary', state: 'usesFeedback' in e && e.usesFeedback ? 'frame-history' : 'stateless', invalidation: 'appearance',
    users: ['Clip effect stack'], localImplementations: [`Effect registry: ${e.id}`], implementation: 'local',
  }));
  return [...operators, ...flock, ...effects].toSorted((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}
