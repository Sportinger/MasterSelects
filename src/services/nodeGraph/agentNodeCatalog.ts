import { EFFECT_REGISTRY } from '../../effects';
import { getAllAudioEffects } from '../../engine/audio/AudioEffectRegistry';
import { createColorNode, PRIMARY_COLOR_PARAM_DEFS, WHEEL_COLOR_PARAM_DEFS, type ColorNodeType } from '../../types/colorCorrection';
import { listFlockOperators } from '../flock/operators/flockOperatorRegistry';
import { listNodeCatalog } from '../operators/operatorCatalog';
import { EFFECT_OPERATORS } from '../operators/operatorRegistry';
import { CONTROL_OPERATORS } from '../parameterSources/controlOperators';
import { colorNodePorts } from './colorGraphPorts';

export const AGENT_NODE_KINDS = ['operator', 'effect', 'audio-effect', 'flock', 'control', 'color', 'builtin'] as const;
export type AgentNodeKind = typeof AGENT_NODE_KINDS[number];
export interface AgentNodePort {
  id: string; label: string; type: string; required?: boolean; repeated?: boolean;
  formats?: readonly string[];
}
export interface AgentNodeParameter {
  id: string; label: string; type: string; default: unknown;
  min?: number; max?: number; step?: number; animatable?: boolean;
  options?: readonly { value: string; label: string }[];
}
export interface AgentNodeDefinition {
  id: string; typeId: string; label: string; kind: AgentNodeKind; context: string;
  description: string; category: string;
  availability: 'owner-dependent' | 'fixed-anchor' | 'internal';
  inputs: AgentNodePort[]; outputs: AgentNodePort[]; parameters: AgentNodeParameter[];
}

function port(p: AgentNodePort): AgentNodePort {
  return { id: p.id, label: p.label, type: p.type, required: p.required, repeated: p.repeated, formats: p.formats };
}
function parameter(p: AgentNodeParameter): AgentNodeParameter {
  return { id: p.id, label: p.label, type: p.type, default: p.default,
    min: p.min, max: p.max, step: p.step, animatable: p.animatable, options: p.options };
}

/** Public authoring metadata only: never expose shaders, runtime functions or composition bodies. */
export function getAgentNodeCatalog(): AgentNodeDefinition[] {
  const operators = new Map(EFFECT_OPERATORS.map(o => [o.id, o]));
  const flock = new Map(listFlockOperators().map(o => [o.id, o]));
  const entries: AgentNodeDefinition[] = listNodeCatalog().map(entry => {
    const effect = entry.id.startsWith('effect:') ? EFFECT_REGISTRY.get(entry.id.slice(7)) : undefined;
    const operator = operators.get(entry.id), flockOperator = flock.get(entry.id);
    const parameters = effect ? Object.entries(effect.params).filter(([, p]) => !p.hidden).map(([id, p]) => ({ id, ...p }))
      : flockOperator?.params ?? operator?.parameters ?? entry.parameters;
    return {
      id: entry.id, typeId: effect?.id ?? entry.id, label: entry.label,
      kind: effect ? 'effect' : flockOperator ? 'flock' : 'operator',
      context: entry.context, description: entry.description, category: entry.category,
      availability: effect && 'internal' in effect && effect.internal ? 'internal'
        : operator && !operator.addable && !['image.frame', 'values.number'].includes(operator.id)
          ? (operator.id.endsWith('.output') || operator.id.endsWith('.input') ? 'fixed-anchor' : 'internal')
          : 'owner-dependent',
      inputs: entry.inputs.map(port), outputs: entry.outputs.map(port), parameters: parameters.map(parameter),
    };
  });
  for (const operator of CONTROL_OPERATORS) entries.push({
    // Control constants have different ranges than identically named image operators.
    id: `control:${operator.id}`, typeId: operator.id, label: operator.label, kind: 'control',
    context: 'Parameter sources', description: operator.description, category: 'control', availability: 'owner-dependent',
    inputs: operator.inputs.map(port), outputs: operator.outputs.map(port), parameters: operator.parameters.map(parameter),
  });
  for (const effect of getAllAudioEffects()) entries.push({
    id: `audio:${effect.id}`, typeId: effect.id, label: effect.name, kind: 'audio-effect',
    context: 'Audio effect stack', description: `${effect.name} audio effect.`, category: effect.category ?? 'audio',
    availability: 'owner-dependent',
    inputs: [{ id: 'input', label: 'Audio', type: 'audio' }], outputs: [{ id: 'output', label: 'Audio', type: 'audio' }],
    parameters: Object.entries(effect.params).map(([id, p]) => ({
      id, label: p.name, type: p.options ? 'select' : typeof p.default, default: p.default,
      options: p.options?.map(value => ({ value, label: value })),
    })),
  });
  const colorTypes: ColorNodeType[] = ['input', 'primary', 'wheels', 'parallel-mixer', 'layer-mixer', 'key-mixer', 'splitter', 'combiner', 'source', 'alpha-output', 'output'];
  for (const type of colorTypes) {
    const node = createColorNode(type, `catalog:${type}`), ports = colorNodePorts(node);
    entries.push({ id: `color:${type}`, typeId: type, label: node.name, kind: 'color', context: 'Color graph',
      description: `${node.name} color node.`, category: 'color',
      availability: type === 'input' || type === 'output' ? 'fixed-anchor' : 'owner-dependent',
      inputs: ports.inputs.map(port), outputs: ports.outputs.map(port),
      parameters: (type === 'primary' ? PRIMARY_COLOR_PARAM_DEFS : type === 'wheels' ? WHEEL_COLOR_PARAM_DEFS : []).map(p => ({
        id: p.key, label: p.label, type: 'number', default: p.defaultValue, min: p.min, max: p.max, step: p.step, animatable: true,
      })),
    });
  }
  // Field-backed clip stages are not freely instantiable operators. Their ports/parameters
  // depend on the selected source; do not invent a generic wiring or parameter contract.
  for (const [id, label] of [['source', 'Source'], ['transform', 'Transform'], ['mask', 'Mask'], ['color', 'Color'], ['output', 'Output'], ['ai', 'AI Node'], ['keyframes', 'Keyframe Node']]) {
    entries.push({ id: `builtin:${id}`, typeId: id, label, kind: 'builtin', context: 'Clip graph', category: 'clip',
      description: `${label}: clip/source-specific ports and parameters are resolved from the owning graph.`,
      availability: id === 'source' || id === 'output' ? 'fixed-anchor' : 'owner-dependent', inputs: [], outputs: [], parameters: [] });
  }
  return entries.toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function summarizeAgentNode(entry: AgentNodeDefinition) {
  return { id: entry.id, label: entry.label, kind: entry.kind, context: entry.context,
    description: entry.description, availability: entry.availability,
    inputTypes: [...new Set(entry.inputs.map(p => p.type))], outputTypes: [...new Set(entry.outputs.map(p => p.type))] };
}

/** Complete compact inventory supplied before the first model action, not a search top-N. */
export function buildAgentNodeCatalogContext(request = '') {
  // Only selects public reference material; never infers or executes an edit.
  const includeDefinitions = /(?:\bnode\w*\b|\bknoten\w*\b)/iu.test(request);
  const catalog = getAgentNodeCatalog();
  const groups = new Map<string, { kind: AgentNodeKind; context: string; entries: string[][] }>();
  for (const entry of catalog) {
    const key = `${entry.kind}:${entry.context}`;
    const group = groups.get(key) ?? { kind: entry.kind, context: entry.context, entries: [] };
    group.entries.push([entry.id, entry.label, [...new Set(entry.inputs.map(p => p.type))].join(','),
      [...new Set(entry.outputs.map(p => p.type))].join(','), entry.availability]);
    groups.set(key, group);
  }
  return { schemaVersion: 1, scope: 'Registered built-in nodes and effects; excludes project-local custom definitions.',
    columns: ['id', 'label', 'inputTypes', 'outputTypes', 'availability'],
    detailsTool: 'getNodeDefinitions', searchTool: 'searchNodeCatalog', focusTool: 'focusNodeGraph',
    groups: [...groups.values()], total: catalog.length,
    ...(includeDefinitions ? { definitions: catalog } : {}) };
}

function shortPurpose(description: string): string {
  const sentence = description.split(/(?<=\.)\s/u)[0].replace(/\.$/u, '').trim();
  if (sentence.length <= 48) return sentence;
  const cut = sentence.slice(0, 48);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 24)).trim();
}

/**
 * Plain-text inventory for provider turns: one line per addable node, grouped
 * by context. Ports, parameters and ranges stay behind getNodeDefinitions.
 */
export function buildAgentNodeCatalogText(): string {
  const contexts = new Map<string, string[]>();
  for (const entry of getAgentNodeCatalog()) {
    if (entry.availability === 'internal') continue;
    const types = (ports: AgentNodePort[]) => [...new Set(ports.map(p => p.type))].join(',');
    const anchor = entry.availability === 'fixed-anchor' ? ' [anchor]' : '';
    const lines = contexts.get(entry.context) ?? [];
    lines.push(`${entry.id} ${types(entry.inputs)}>${types(entry.outputs)} ${shortPurpose(entry.description) || entry.label}${anchor}`);
    contexts.set(entry.context, lines);
  }
  return ['Editor node catalog. Line: id inputTypes>outputTypes purpose. Exact ports, parameters and ranges: getNodeDefinitions(ids). Search: searchNodeCatalog. Show a graph: focusNodeGraph.',
    ...[...contexts].map(([context, lines]) => `## ${context}\n${lines.join('\n')}`)].join('\n');
}
