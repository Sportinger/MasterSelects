import { EFFECT_OPERATORS } from './operatorRegistry';
import { SCENE_OPERATORS } from './sceneOperators';
import { isVoxelOperator } from './voxelOperators';
import { listFlockOperators } from '../flock/operators/flockOperatorRegistry';
import { EFFECT_REGISTRY } from '../../effects';
import { getOperatorPortContract, OPERATOR_SIGNAL_CONTRACTS } from './portContracts';
import { describeNodePort } from '../nodeGraph/nodePortPresentation';
import type { NodePortContract } from '../../types/nodePortContract';
import { IMAGE_OPERATORS } from './imageOperators';
import { AUDIO_OPERATORS } from './audioOperators';
import { addableEffectOperators } from './effectGraphOwner';
import { operatorCategoryLabel, operatorVisibility, type NodeVisibility } from './operatorTaxonomy';
import { effectGroup, EFFECTS_HIDDEN_FROM_CATALOG } from '../../effects/effectCatalogGroups';
import { catalogText } from '../nodeGraph/catalogText';

export interface NodeCatalogPort {
  id: string; label: string; type: string; required?: boolean; repeated?: boolean; contract?: NodePortContract;
  formats: readonly string[];
}

export interface NodeCatalogEntry {
  /** `category` is the menu category; `context` names the graphs (domains) that accept the node. */
  id: string; label: string; description: string; category: string; context: string;
  domains: readonly string[]; visibility: NodeVisibility; tags: readonly string[];
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
/** Graph owners that decide which nodes can be added; a node's domains are where it is actually offered. */
const DOMAIN_OWNERS: ReadonlyArray<[string, readonly string[]]> = [
  ['Image', ['invert', 'analog-signal-lab', 'voronoi']], ['3D', ['voxel-relief', 'face-cables']],
  ['Splat', ['splat-exploration']], ['Audio', ['audio-math']],
];
let domainIndex: Map<string, string[]> | undefined;
function operatorDomains(operator: (typeof EFFECT_OPERATORS)[number]): string[] {
  domainIndex ??= new Map();
  if (!domainIndex.size) for (const [domain, owners] of DOMAIN_OWNERS) {
    for (const id of new Set(owners.flatMap(owner => addableEffectOperators(owner).map(candidate => candidate.id)))) {
      domainIndex.set(id, [...(domainIndex.get(id) ?? []), domain]);
    }
  }
  const offered = domainIndex.get(operator.id);
  if (offered?.length) return offered;
  // Anchors and compiler-owned nodes are never offered; attribute them to their graph.
  return [AUDIO_OPERATORS.includes(operator) ? 'Audio' : operator.id.startsWith('splat.') || operator.composition?.graph.domain === 'scene' ? 'Splat'
    : IMAGE_OPERATORS.includes(operator) || operator.composition || operator.id.startsWith('analog.') || operator.id.startsWith('image.') ? 'Image'
      : SCENE_OPERATORS.includes(operator) || isVoxelOperator(operator.id) ? '3D' : '3D'];
}
const operatorText = (operator: (typeof EFFECT_OPERATORS)[number]) => {
  const text = catalogText(operator.id);
  return { description: text.description ?? operator.description, tags: text.tags };
};

/** A live inventory, not a second registry. Consumers retain their own validated executors. */
export function listNodeCatalog(): NodeCatalogEntry[] {
  const legacy = new Set(['surface.hybrid', 'collision.face', 'collision.surface']);
  const operators: NodeCatalogEntry[] = EFFECT_OPERATORS.filter(o => !legacy.has(o.id)).map(o => ({
    ...o, ...operatorText(o), category: operatorCategoryLabel(o), domains: operatorDomains(o), visibility: operatorVisibility(o),
    inputs: o.inputs.map(p => { const contract = getOperatorPortContract(p); return { ...p, contract, formats: contract.formats }; }),
    outputs: o.outputs.map(p => { const contract = getOperatorPortContract(p); return { ...p, contract, formats: contract.formats }; }),
    parameters: o.parameters.map(p => ({ ...p, unit: p.unit ?? 'unknown', format: p.format ?? 'unknown' })),
    context: operatorDomains(o).join(', '),
    family: o.family ?? familyOf(o.id), variant: o.variant ?? o.id,
    backend: o.runtime, fusion: o.fusion ?? 'unspecified', state: o.state ?? 'unspecified', invalidation: o.invalidates,
    users: [...(o.consumers ?? operatorDomains(o))],
    localImplementations: o.implementation === 'local' ? [`Operator registry: ${o.id}`] : [],
    implementation: o.implementation ?? 'unknown',
  }));
  const flockPort = (p: Omit<NodeCatalogPort, 'formats'>): NodeCatalogPort => { const contract = describeNodePort({ type: p.type, metadata: { semanticKind: `flock:${p.type}` } }); return { ...p, contract, formats: contract.formats }; };
  const flock: NodeCatalogEntry[] = listFlockOperators().map(o => ({ ...o, inputs: o.inputs.map(flockPort), outputs: o.outputs.map(flockPort), category: operatorCategoryLabel(o), context: 'Flock', domains: ['Flock'], visibility: 'public' as const, tags: catalogText(o.id).tags, parameters: o.params.map(p => ({ ...p, unit: 'unknown', format: 'unknown' })),
    family: familyOf(o.sharedOperator ?? o.id), variant: o.id, backend: 'wgsl', fusion: 'compiler-owned',
    state: o.id === 'flock.simulation' || o.id === 'flock.trails' ? 'simulation' : 'stateless', invalidation: o.phase,
    users: ['Flock'], localImplementations: o.sharedOperator ? [] : ['Flock compiler'], implementation: o.sharedOperator ? 'shared' : 'local' }));
  const effects: NodeCatalogEntry[] = [...EFFECT_REGISTRY.values()].map(e => ({
    id: `effect:${e.id}`, label: e.name, description: catalogText(`effect:${e.id}`).description ?? `${e.name} effect.`, tags: catalogText(`effect:${e.id}`).tags,
    category: effectGroup(e.id).label, context: 'Clip effects', domains: ['Clip effects'],
    visibility: EFFECTS_HIDDEN_FROM_CATALOG.has(e.id) ? 'advanced' as const : 'public' as const,
    inputs: [{ id: 'image', label: 'Image', type: 'texture', contract: OPERATOR_SIGNAL_CONTRACTS.texture, formats: OPERATOR_SIGNAL_CONTRACTS.texture.formats }], outputs: [{ id: 'image', label: 'Image', type: 'texture', contract: OPERATOR_SIGNAL_CONTRACTS.texture, formats: OPERATOR_SIGNAL_CONTRACTS.texture.formats }],
    parameters: Object.entries(e.params).filter(([, p]) => !p.hidden).map(([id, p]) => ({ id, label: p.label, type: p.type, default: p.default, animatable: p.animatable, min: p.min, max: p.max, step: p.step, unit: 'unknown', format: 'unknown' })),
    family: `effect.${e.category}`, variant: e.id, backend: e.pipelineKind ?? 'fullscreen',
    fusion: e.id === 'invert' ? 'inline migration target' : 'pass-boundary', state: (('usesFeedback' in e && e.usesFeedback) || ('usesInputHistory' in e && e.usesInputHistory)) ? 'frame-history' : 'stateless', invalidation: 'appearance',
    users: ['Clip effect stack'], localImplementations: [`Effect registry: ${e.id}`], implementation: 'local',
  }));
  return [...operators, ...flock, ...effects].toSorted((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}
