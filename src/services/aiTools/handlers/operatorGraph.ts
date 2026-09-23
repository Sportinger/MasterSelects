import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../../stores/timeline/exclusiveMutationLease';
import type { Effect } from '../../../types/effects';
import type { EffectOperatorGraph, OperatorValue } from '../../../types/operatorGraph';
import { readTimelineRuntimeState } from '../../timeline/timelineRuntimeCoordinator';
import { findClipOperatorEffect } from '../../operators/clipOperatorGraphOwner';
import { addableEffectOperators, effectOperatorGraph, effectOperatorParams, hasEffectOperatorGraph, validateEffectOwnerGraph } from '../../operators/effectGraphOwner';
import { selectOperatorGraphSlice } from '../../nodeGraph/operatorGraphSlice';
import { createEffectGraphActions, editEffectGraph, setOperatorConstant, setOperatorParameter } from '../../operators/effectGraphEditing';
import { getEffectOperator } from '../../operators/operatorRegistry';
import { renderHostPort } from '../../render/renderHostPort';
import type { ToolResult } from '../types';

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`${key} is required (1..200 characters).`);
  return value;
}
function owner(args: Record<string, unknown>, mutation = false) {
  if (mutation) assertExclusiveTimelineMutationAllowed();
  const state = readTimelineRuntimeState(useTimelineStore), clipId = text(args, 'clipId');
  const clip = state.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Clip not found in the active timeline.');
  if (mutation && (state.isExporting || state.tracks.find(t => t.id === clip.trackId)?.locked)) throw new Error('Clip is locked or exporting.');
  return { state, clip };
}
function graphOwner(args: Record<string, unknown>, mutation = false) {
  const context = owner(args, mutation), effectId = text(args, 'effectId');
  // Do not silently redirect mutations to a linked clip or a shared graph owner.
  if (!context.clip.effects.some(e => e.id === effectId) && !context.clip.audioState?.effectStack?.some(e => e.id === effectId && e.descriptorId === 'audio-math')) throw new Error('Effect does not belong to the specified clip.');
  const effect = findClipOperatorEffect(context.clip, effectId);
  if (!effect) throw new Error('Effect does not belong to the specified clip.');
  return { ...context, effect, graph: effectOperatorGraph(effect) };
}
const failure = (error: unknown): ToolResult => ({ success: false, error: error instanceof Error ? error.message : String(error) });

export async function handleCreateImageNodeGraph(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { state, clip } = owner(args, true);
    if (clip.source?.type === 'motion-adjustment' || clip.source?.type === 'audio') throw new Error('An image-capable clip is required.');
    if (args.name !== undefined && (typeof args.name !== 'string' || !args.name.trim() || args.name.length > 100)) throw new Error('Invalid graph name.');
    const graph: EffectOperatorGraph = { version: 1, schemaVersion: 1, domain: 'image',
      nodes: [{ id: 'frame', operator: 'image.frame', operatorVersion: 1, bindings: {} }, { id: 'output', operator: 'image.output', operatorVersion: 1, bindings: {} }],
      edges: [{ id: 'frame-output', from: 'frame', output: 'image', to: 'output', input: 'image' }],
      layout: { frame: { x: 0, y: 0 }, output: { x: 900, y: 0 } } };
    // Image graphs already execute through the existing image-effect owner.
    const effect: Effect = { id: `effect-${crypto.randomUUID()}`, type: 'invert', name: String(args.name ?? 'Image Graph'), enabled: true, params: {}, operatorGraph: graph };
    validateEffectOwnerGraph(effect, graph, effect.params);
    const batch = startBatch('Create image node graph');
    try { state.updateClip(clip.id, { effects: [...clip.effects, effect], nodeGraph: {
      version: 1, nodes: [], ...clip.nodeGraph,
      groups: { ...clip.nodeGraph?.groups, [`effect:${effect.id}`]: { collapsed: false } },
    } }); state.invalidateCache(); renderHostPort.requestRender(); }
    finally { if (batch.opened) endBatch(); }
    return { success: true, data: { clipId: clip.id, effectId: effect.id, sourceNodeId: 'frame', sourcePortId: 'image', outputNodeId: 'output', outputPortId: 'image' } };
  } catch (error) { return failure(error); }
}

export async function handleGetOperatorGraph(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    if (args.effectId === undefined) {
      const { clip } = owner(args);
      if (args.nodeIds !== undefined || args.hops !== undefined || args.direction !== undefined) throw new Error('A partial graph query requires effectId.');
      const effectIds = [...clip.effects.filter(e => hasEffectOperatorGraph(e.type)).map(e => e.id),
        ...(clip.audioState?.effectStack ?? []).filter(e => e.descriptorId === 'audio-math').map(e => e.id)];
      return { success: true, data: { clipId: clip.id, graphs: effectIds.map(effectId => {
        const effect = findClipOperatorEffect(clip, effectId)!;
        try { const graph = effectOperatorGraph(effect); return { effectId, name: effect.name, domain: graph.domain, nodeCount: graph.nodes.length, edgeCount: graph.edges.length, incomplete: graph.incomplete ?? null }; }
        catch (error) { return { effectId, error: error instanceof Error ? error.message : String(error) }; }
      }) } };
    }
    const { clip, effect, graph } = graphOwner(args);
    const slice = selectOperatorGraphSlice(graph, args), params = effectOperatorParams(effect);
    const bindingKeys = slice.nodes.flatMap(node => Object.values(node.bindings).flatMap(binding => typeof binding === 'string' ? [binding] : Array.isArray(binding) ? binding : Object.values(binding)));
    return { success: true, data: { clipId: clip.id, effectId: effect.id, domain: graph.domain, incomplete: graph.incomplete ?? null,
      ...slice, nodes: slice.nodes.map(node => { const spec = getEffectOperator(node.operator)!; return { ...node,
        position: graph.layout[node.id], inputs: spec.inputs, outputs: spec.outputs,
        parameters: spec.parameters.map(p => p.id === 'value' && node.valueControl ? { ...p, ...node.valueControl } : p) }; }),
      params: Object.fromEntries(bindingKeys.map(key => [key, params[key]])) } };
  } catch (error) { return failure(error); }
}

export async function handleEditOperatorGraph(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { clip, effect, graph } = graphOwner(args, true), action = text(args, 'action');
    const actions = createEffectGraphActions(clip.id, effect.id);
    const existing = () => { const id = text(args, 'nodeId'); const node = graph.nodes.find(n => n.id === id); if (!node) throw new Error('Node not found in this graph.'); return node; };
    const position = () => { const p = args.position as { x: number; y: number } | undefined;
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('A finite position is required.'); return { x: p.x, y: p.y }; };
    let nodeId: string | undefined;
    if (action === 'add') {
      const operatorId = text(args, 'operatorId'), spec = getEffectOperator(operatorId);
      if (!spec || !addableEffectOperators(effect.type).some(op => op.id === operatorId)) throw new Error('Operator cannot be added in this owner.');
      if (args.nodeId !== undefined) {
        nodeId = text(args, 'nodeId');
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(nodeId) || graph.nodes.some(n => n.id === nodeId)) throw new Error('Node ID is invalid or already exists.');
        if (spec.composition) throw new Error('Composition nodes require an automatically allocated ID.');
        const id = nodeId, layout = args.position ? position() : { x: 300, y: graph.nodes.length * 180 };
        editEffectGraph(clip.id, effect.id, 'Add graph node', next => {
          next.nodes.push({ id, operator: operatorId, operatorVersion: 1, bindings: {}, constants: Object.fromEntries(spec.parameters.map(p => [p.id, p.default])) });
          next.layout[id] = layout;
        });
      } else nodeId = actions.addNode(operatorId, args.position ? position() : undefined);
    } else if (action === 'set') {
      const node = existing(), parameter = text(args, 'parameter');
      const value = args.value;
      if (!(typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
        || Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every(n => typeof n === 'number' && Number.isFinite(n)))) throw new Error('Invalid parameter value.');
      (node.bindings[parameter] === undefined ? setOperatorConstant : setOperatorParameter)(clip.id, effect.id, node.id, parameter, value as OperatorValue);
      nodeId = node.id;
    } else if (action === 'connect') {
      actions.connectPorts({ fromNodeId: text(args, 'fromNodeId'), fromPortId: text(args, 'fromPortId'), toNodeId: text(args, 'toNodeId'), toPortId: text(args, 'toPortId') });
    } else if (action === 'disconnect') {
      const edgeId = text(args, 'edgeId'); if (!graph.edges.some(e => e.id === edgeId)) throw new Error('Edge not found.'); actions.disconnectEdge(edgeId);
    } else if (action === 'remove') { nodeId = existing().id; actions.deleteNode(nodeId);
    } else if (action === 'move') { nodeId = existing().id; actions.moveNode(nodeId, position());
    } else if (action === 'slider') {
      const node = existing(); nodeId = node.id;
      const label = text(args, 'label'), min = args.min as number, max = args.max as number, step = args.step as number;
      if (!['values.number', 'values.integer'].includes(node.operator) || node.bindings.value || label.length > 80
        || ![min, max, step].every(Number.isFinite) || min >= max || step <= 0
        || typeof node.constants?.value !== 'number' || node.constants.value < min || node.constants.value > max) throw new Error('Slider requires a local numeric value within finite min < max and positive step.');
      editEffectGraph(clip.id, effect.id, 'Configure value slider', next => { next.nodes.find(n => n.id === node.id)!.valueControl = { label, min, max, step }; });
    } else throw new Error('Unknown graph action.');
    const updated = graphOwner(args).graph;
    return { success: true, data: { clipId: clip.id, effectId: effect.id, action, ...(nodeId ? { nodeId } : {}), incomplete: updated.incomplete ?? null, nodeCount: updated.nodes.length, edgeCount: updated.edges.length } };
  } catch (error) { return failure(error); }
}
