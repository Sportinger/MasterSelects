import { EFFECT_OPERATORS } from './operatorRegistry';
import { SCENE_OPERATORS } from './sceneOperators';
import { listFlockOperators } from '../flock/operators/flockOperatorRegistry';
import { EFFECT_REGISTRY } from '../../effects';
import { getOperatorPortContract, OPERATOR_SIGNAL_CONTRACTS } from './portContracts';
import { describeNodePort } from '../nodeGraph/nodePortPresentation';
import type { NodePortContract } from '../../types/nodePortContract';

export interface NodeCatalogPort {
  id: string; label: string; type: string; required?: boolean; repeated?: boolean; contract?: NodePortContract;
}

export interface NodeCatalogEntry {
  id: string; label: string; description: string; category: string; context: string;
  inputs: NodeCatalogPort[];
  outputs: NodeCatalogPort[];
  parameters: { id: string; label: string; type: string; default: unknown; animatable?: boolean }[];
  sharedOperator?: string;
}

/** A live inventory, not a second registry. Consumers retain their own validated executors. */
export function listNodeCatalog(): NodeCatalogEntry[] {
  const legacy = new Set(['surface.hybrid', 'collision.face', 'collision.surface']);
  const operators: NodeCatalogEntry[] = EFFECT_OPERATORS.filter(o => !legacy.has(o.id)).map(o => ({
    ...o, category: o.id.split('.')[0],
    inputs: o.inputs.map(p => ({ ...p, contract: getOperatorPortContract(p) })),
    outputs: o.outputs.map(p => ({ ...p, contract: getOperatorPortContract(p) })),
    context: SCENE_OPERATORS.includes(o) ? '3D image surfaces' : o.id === 'forces.wind' ? 'Face Cables + Flock' : 'Face Cables',
  }));
  const flockPort = (p: NodeCatalogPort) => ({ ...p, contract: describeNodePort({ type: p.type, metadata: { semanticKind: `flock:${p.type}` } }) });
  const flock: NodeCatalogEntry[] = listFlockOperators().map(o => ({ ...o, inputs: o.inputs.map(flockPort), outputs: o.outputs.map(flockPort), category: `flock / ${o.category}`, context: 'Flock', parameters: o.params }));
  const effects: NodeCatalogEntry[] = [...EFFECT_REGISTRY.values()].map(e => ({
    id: `effect:${e.id}`, label: e.name, description: e.id === 'face-cables' ? 'A group assembled from tracking, geometry, collision, forces and rendering nodes.' : `${e.name} effect.`,
    category: `effects / ${e.category}`, context: e.id === 'face-cables' ? 'Clip group' : 'Clip effect stack',
    inputs: [{ id: 'image', label: 'Image', type: 'texture', contract: OPERATOR_SIGNAL_CONTRACTS.texture }], outputs: [{ id: 'image', label: 'Image', type: 'texture', contract: OPERATOR_SIGNAL_CONTRACTS.texture }],
    parameters: Object.entries(e.params).filter(([, p]) => !p.hidden).map(([id, p]) => ({ id, label: p.label, type: p.type, default: p.default, animatable: p.animatable })),
  }));
  return [...operators, ...flock, ...effects].toSorted((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}
