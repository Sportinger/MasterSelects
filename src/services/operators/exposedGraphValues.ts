import type { BoundOperatorNode, EffectOperatorGraph } from '../../types/operatorGraph';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { getEffectOperator } from './operatorRegistry';
import { editEffectGraph } from './effectGraphEditing';

/** Graph value nodes that can publish their value as a keyframeable effect parameter. */
const EXPOSABLE_VALUE_OPERATORS = new Set(['values.number', 'values.integer']);
const DEFAULT_RANGE = { min: -30, max: 30, step: 0.01 };

export interface ExposedGraphValue {
  nodeId: string;
  /** Effect param key; the animatable property is `effect.<effectId>.<key>`. */
  key: string;
  label: string;
  min: number; max: number; step: number;
  integer: boolean;
}

/** Stable effect param key owned by an exposed value node. */
export const exposedValueKey = (nodeId: string) => `${nodeId}_value`;

/** Audio graphs execute local constants only; bound values would not reach the processor. */
export function canExposeGraphValue(graph: EffectOperatorGraph, node: BoundOperatorNode): boolean {
  if (graph.domain === 'audio' || !EXPOSABLE_VALUE_OPERATORS.has(node.operator)) return false;
  const binding = node.bindings.value;
  return binding === undefined || binding === exposedValueKey(node.id);
}

export function exposedGraphValues(graph: EffectOperatorGraph | undefined): ExposedGraphValue[] {
  return (graph?.nodes ?? []).flatMap(node => {
    const binding = node.bindings.value;
    if (!node.exposed || typeof binding !== 'string') return [];
    const integer = node.operator === 'values.integer';
    return [{ nodeId: node.id, key: binding, label: node.exposed.label,
      min: node.exposed.min ?? DEFAULT_RANGE.min, max: node.exposed.max ?? DEFAULT_RANGE.max,
      step: node.exposed.step ?? (integer ? 1 : DEFAULT_RANGE.step), integer }];
  });
}

function defaultExposedLabel(graph: EffectOperatorGraph, node: BoundOperatorNode) {
  if (node.valueControl?.label) return node.valueControl.label;
  const taken = new Set(graph.nodes.map(item => item.exposed?.label));
  for (let index = 1; ; index++) if (!taken.has(`Value ${index}`)) return `Value ${index}`;
}

/**
 * Pure graph edit. Exposing moves the node's literal into an effect param so
 * timeline keyframes drive it; unexposing in a constant-literal graph (image)
 * bakes the current base value back into the node and releases the param.
 * Returns the released param key, whose keyframes the caller must remove.
 */
export function applyGraphValueExposure(graph: EffectOperatorGraph, params: Record<string, unknown>,
  nodeId: string, exposed: boolean, label?: string): { releasedKey?: string } {
  const node = graph.nodes.find(item => item.id === nodeId);
  if (!node) throw new Error(`Node ${nodeId} is not in this graph.`);
  if (!canExposeGraphValue(graph, node)) throw new Error(EXPOSABLE_VALUE_OPERATORS.has(node.operator)
    ? 'This value is already owned by an effect parameter or cannot be exposed in this graph.'
    : 'Only Value nodes can be exposed to the Effects tab.');
  const trimmed = label?.trim();
  if (trimmed !== undefined && (!trimmed || trimmed.length > 80)) throw new Error('Exposed label must be 1-80 characters.');
  const key = exposedValueKey(node.id);
  if (exposed) {
    if (!node.bindings.value) {
      const spec = getEffectOperator(node.operator)?.parameters.find(parameter => parameter.id === 'value');
      const literal = node.constants?.value;
      params[key] = typeof literal === 'number' ? literal : Number(spec?.default ?? 1);
      node.bindings = { ...node.bindings, value: key };
      if (node.constants) {
        const { value: _released, ...rest } = node.constants;
        node.constants = rest;
      }
    }
    const control = node.valueControl ?? node.exposed;
    node.exposed = { label: trimmed ?? node.exposed?.label ?? defaultExposedLabel(graph, node),
      ...(control?.min !== undefined && control.max !== undefined && control.step !== undefined
        ? { min: control.min, max: control.max, step: control.step } : {}) };
    delete node.valueControl;
    return {};
  }
  if (!node.exposed) return {};
  const previous = node.exposed;
  delete node.exposed;
  // Non-image graphs bind every added node parameter; only the marker is removed.
  if (graph.domain !== 'image') return {};
  const current = params[key];
  node.constants = { ...node.constants, value: typeof current === 'number' && Number.isFinite(current) ? current : 1 };
  const { value: _binding, ...bindings } = node.bindings;
  node.bindings = bindings;
  delete params[key];
  if (previous.min !== undefined && previous.max !== undefined && previous.step !== undefined) {
    node.valueControl = { label: previous.label, min: previous.min, max: previous.max, step: previous.step };
  }
  return { releasedKey: key };
}

/** One undoable edit shared by the node inspector, the Effects tab and AI tools. */
export function setGraphValueExposed(clipId: string, effectId: string, nodeId: string, exposed: boolean, label?: string) {
  const batch = startBatch(exposed ? 'Expose node value' : 'Unexpose node value');
  try {
    let releasedKey: string | undefined;
    editEffectGraph(clipId, effectId, exposed ? 'Expose node value' : 'Unexpose node value', (graph, params) => {
      releasedKey = applyGraphValueExposure(graph, params, nodeId, exposed, label).releasedKey;
    });
    if (releasedKey) {
      const state = readTimelineRuntimeState(useTimelineStore);
      const property = `effect.${effectId}.${releasedKey}`;
      for (const keyframe of state.clipKeyframes.get(clipId) ?? []) {
        if (keyframe.property === property) state.removeKeyframe(keyframe.id);
      }
    }
  } finally { if (batch.opened) endBatch(); }
}

export function renameExposedGraphValue(clipId: string, effectId: string, nodeId: string, label: string) {
  editEffectGraph(clipId, effectId, 'Rename exposed value', (graph, params) => {
    const node = graph.nodes.find(item => item.id === nodeId);
    if (!node?.exposed) throw new Error('This node value is not exposed.');
    applyGraphValueExposure(graph, params, nodeId, true, label);
  });
}
