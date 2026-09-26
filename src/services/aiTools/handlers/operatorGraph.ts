import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch, cancelHistoryBatch } from '../../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../../stores/timeline/exclusiveMutationLease';
import type { EffectOperatorGraph, OperatorValue } from '../../../types/operatorGraph';
import { readTimelineRuntimeState } from '../../timeline/timelineRuntimeCoordinator';
import { findClipOperatorEffect } from '../../operators/clipOperatorGraphOwner';
import { addableEffectOperators, effectOperatorGraph, effectOperatorParams, hasEffectOperatorGraph } from '../../operators/effectGraphOwner';
import { selectOperatorGraphSlice } from '../../nodeGraph/operatorGraphSlice';
import { createEffectGraphActions, editEffectGraph, setOperatorConstant, setOperatorParameter } from '../../operators/effectGraphEditing';
import { AGENT_GRAPH_LEGEND, agentGraphNode, foldCompoundsForAgent } from '../../nodeGraph/operatorGraphAgentView';
import { getEffectOperator } from '../../operators/operatorRegistry';
import { EFFECT_GRAPH_PARAM } from '../../operators/effectGraph';
import { setGraphValueExposed } from '../../operators/exposedGraphValues';
import { groupOperators } from '../../operators/operatorGroups';
import { createImageNodeGraphEffect } from '../../operators/imageNodeGraphEffect';
import type { ToolResult } from '../types';
import { compoundGroup, connectPublicPorts, nodePosition, openInputs, parseEndpointRef, publicPorts, type ConnectedCable } from './operatorGraphPorts';

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
/** Node IDs never contain dots; models often write `key.split`. Mapping dots to `-` keeps add and later references consistent. */
function normalizeNodeIdArgs(args: Record<string, unknown>): { args: Record<string, unknown>; renamed: Record<string, string> } {
  const renamed: Record<string, string> = {};
  const fix = (value: unknown) => {
    if (typeof value !== 'string' || !value.includes('.')) return value;
    const next = value.replace(/\./g, '-');
    renamed[value] = next;
    return next;
  };
  const next = { ...args, nodeId: fix(args.nodeId), fromNodeId: fix(args.fromNodeId), toNodeId: fix(args.toNodeId),
    ...(Array.isArray(args.nodeIds) ? { nodeIds: args.nodeIds.map(fix) } : {}) };
  for (const key of ['nodeId', 'fromNodeId', 'toNodeId'] as const) if (next[key] === undefined) delete next[key];
  return { args: next, renamed };
}

/** Tells the model the IDs it must use from now on. */
const renamedField = (renamed: Record<string, string>) => Object.keys(renamed).length ? { renamedNodeIds: renamed } : {};

const failure = (error: unknown): ToolResult => ({ success: false, error: error instanceof Error ? error.message : String(error) });

export async function handleCreateImageNodeGraph(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const { clip } = owner(args, true);
    if (args.name !== undefined && (typeof args.name !== 'string' || !args.name.trim())) throw new Error('Invalid graph name.');
    // A long descriptive name must not block the whole build: keep the first 100 characters.
    const name = typeof args.name === 'string' ? [...args.name.trim()].slice(0, 100).join('').trim() : 'Image Graph';
    const effect = { id: createImageNodeGraphEffect(clip.id, name) };
    return { success: true, data: { clipId: clip.id, effectId: effect.id, name, sourceNodeId: 'frame', sourcePortId: 'image', outputNodeId: 'output', outputPortId: 'image' } };
  } catch (error) { return failure(error); }
}

export async function handleGetOperatorGraph(rawArgs: Record<string, unknown>): Promise<ToolResult> {
  const { args } = normalizeNodeIdArgs(rawArgs);
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
    // Compounds are folded unless the caller asks for one of their inner nodes.
    const folded = foldCompoundsForAgent(graph);
    const requested = Array.isArray(args.nodeIds) ? args.nodeIds : [];
    const view = requested.some(id => !folded.nodes.some(n => n.id === id) && graph.nodes.some(n => n.id === id)) ? graph : folded;
    const slice = selectOperatorGraphSlice(view, args), params = effectOperatorParams(effect);
    const bindingKeys = slice.nodes.flatMap(node => Object.values(node.bindings).flatMap(binding => typeof binding === 'string' ? [binding] : Array.isArray(binding) ? binding : Object.values(binding)));
    return { success: true, data: { clipId: clip.id, effectId: effect.id, domain: graph.domain, incomplete: graph.incomplete ?? null,
      legend: AGENT_GRAPH_LEGEND, ...slice, nodes: slice.nodes.map(node => agentGraphNode(node, view.layout[node.id])),
      params: Object.fromEntries(bindingKeys.map(key => [key, params[key]])) } };
  } catch (error) { return failure(error); }
}

type GraphContext = ReturnType<typeof graphOwner>;
const VALUE_OPERATORS = ['values.number', 'values.integer'];

function validValue(value: unknown): value is OperatorValue {
  return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
    || Array.isArray(value) && value.length >= 2 && value.length <= 4 && value.every(n => typeof n === 'number' && Number.isFinite(n));
}
function setValue(context: GraphContext, nodeId: string, parameter: string, value: unknown) {
  const node = context.graph.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error(compoundGroup(context.graph, nodeId) ? `${nodeId} is a compound node; set values on the nodes feeding it instead.` : 'Node not found in this graph.');
  if (!validValue(value)) throw new Error(`Invalid value for ${nodeId}.${parameter}.`);
  (node.bindings[parameter] === undefined ? setOperatorConstant : setOperatorParameter)(context.clip.id, context.effect.id, node.id, parameter, value);
}
function configureSlider(context: GraphContext, nodeId: string, args: Record<string, unknown>) {
  const node = context.graph.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error('Node not found in this graph.');
  const label = args.label !== undefined ? text(args, 'label') : node.exposed?.label ?? node.valueControl?.label ?? node.id;
  const min = args.min as number, max = args.max as number, step = args.step as number;
  if (node.exposed) {
    if (label.length > 80 || ![min, max, step].every(Number.isFinite) || min >= max || step <= 0) throw new Error('Slider requires finite min < max and positive step.');
    editEffectGraph(context.clip.id, context.effect.id, 'Configure exposed value', next => { next.nodes.find(n => n.id === node.id)!.exposed = { label, min, max, step }; });
    return;
  }
  if (!VALUE_OPERATORS.includes(node.operator) || node.bindings.value || label.length > 80
    || ![min, max, step].every(Number.isFinite) || min >= max || step <= 0
    || typeof node.constants?.value !== 'number' || node.constants.value < min || node.constants.value > max) throw new Error('Slider requires a local numeric value within finite min < max and positive step.');
  editEffectGraph(context.clip.id, context.effect.id, 'Configure value slider', next => { next.nodes.find(n => n.id === node.id)!.valueControl = { label, min, max, step }; });
}

/** `inputs` is `{ targetPort: "node" | "node.port" }` or an ordered list filling free compatible inputs. */
function inputRefs(value: unknown): Array<{ toPortId?: string; nodeId: string; portId?: string }> {
  if (value === undefined) return [];
  const entries: Array<[string | undefined, unknown]> = Array.isArray(value) ? value.map(ref => [undefined, ref])
    : value && typeof value === 'object' ? Object.entries(value) : [];
  if (!entries.length || entries.length > 16) throw new Error('inputs must list 1..16 sources.');
  return entries.map(([toPortId, ref]) => {
    if (typeof ref !== 'string' || !ref.trim() || ref.length > 200) throw new Error('Each input is "nodeId" or "nodeId.portId".');
    const parsed = parseEndpointRef(ref.trim());
    return { toPortId, nodeId: parsed.nodeId.replace(/\./g, '-'), portId: parsed.portId };
  });
}
/** Right of the rightmost source, at their mean height, stepping down past occupied cards. */
function besideSources(graph: EffectOperatorGraph, sourceIds: string[]) {
  const anchors = sourceIds.map(id => nodePosition(graph, id)).filter((p): p is { x: number; y: number } => !!p);
  if (!anchors.length) return undefined;
  const x = Math.max(...anchors.map(p => p.x)) + 280;
  let y = Math.round(anchors.reduce((sum, p) => sum + p.y, 0) / anchors.length);
  const taken = [...Object.values(graph.layout), ...(graph.groups ?? []).flatMap(group => group.composition ? [group.composition.position] : [])];
  while (taken.some(p => Math.abs(p.x - x) < 220 && Math.abs(p.y - y) < 150)) y += 160;
  return { x, y };
}

function addNode(context: GraphContext, args: Record<string, unknown>, position: () => { x: number; y: number }) {
  const { clip, effect, graph } = context;
  const operatorId = text(args, 'operatorId'), spec = getEffectOperator(operatorId);
  if (!spec) throw new Error(`Unknown operator: ${operatorId}.`);
  if (!addableEffectOperators(effect.type).some(op => op.id === operatorId)) {
    throw new Error(`Operator ${operatorId} (${spec.label}) cannot be added to ${effect.type}. ${spec.description}`);
  }
  if (args.exposed === true && (!VALUE_OPERATORS.includes(operatorId) || graph.domain === 'audio')) {
    throw new Error('Only values.number/integer nodes outside audio graphs can be exposed.');
  }
  const params = args.params ?? {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('params must map parameter IDs to values.');
  const inputs = inputRefs(args.inputs);
  for (const input of inputs) publicPorts(graph, input.nodeId, 'output');
  const layout = args.position ? position() : besideSources(graph, inputs.map(input => input.nodeId));
  let nodeId: string;
  if (args.nodeId !== undefined) {
    nodeId = text(args, 'nodeId');
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(nodeId)) throw new Error(`Node ID ${nodeId} is invalid: start with a letter and use only letters, digits, _ and -.`);
    if (graph.nodes.some(n => n.id === nodeId)) throw new Error(`Node ID ${nodeId} already exists in this graph.`);
    // A compound instance expands to `<id>--<child>` nodes inside group `compound-<id>`; both must be free.
    if (spec.composition && (graph.groups?.some(group => group.id === `compound-${nodeId}`)
      || graph.nodes.some(n => n.id.startsWith(`${nodeId}--`)))) throw new Error(`Node ID ${nodeId} already exists in this graph.`);
    const id = nodeId, at = layout ?? { x: 300, y: graph.nodes.length * 180 };
    editEffectGraph(clip.id, effect.id, 'Add graph node', next => {
      next.nodes.push({ id, operator: operatorId, operatorVersion: 1, bindings: {},
        ...(spec.composition ? {} : { constants: Object.fromEntries(spec.parameters.map(p => [p.id, p.default])) }) });
      next.layout[id] = at;
    });
  } else nodeId = createEffectGraphActions(clip.id, effect.id).addNode(operatorId, layout);
  if (args.exposed === true) setGraphValueExposed(clip.id, effect.id, nodeId, true, typeof args.label === 'string' ? args.label : undefined);
  const fresh = () => graphOwner(args);
  const slider = args.min !== undefined || args.max !== undefined || args.step !== undefined;
  // An exposed range bounds its value; a local slider requires its value to be in range already.
  if (slider && args.exposed === true) configureSlider(fresh(), nodeId, args);
  for (const [parameter, value] of Object.entries(params)) setValue(fresh(), nodeId, parameter, value);
  if (slider && args.exposed !== true) configureSlider(fresh(), nodeId, args);
  const connected: ConnectedCable[] = [];
  for (const input of inputs) {
    const { from, to, insertedConversion } = connectPublicPorts(clip.id, effect.id, effect.type, fresh().graph,
      input.nodeId, input.portId, nodeId, input.toPortId);
    connected.push({ from, to, ...(insertedConversion ? { insertedConversion } : {}) });
  }
  return { nodeId, ...(connected.length ? { connected } : {}), openInputs: openInputs(fresh().graph, nodeId) };
}

/** Puts an effect's graph and values back exactly, independent of history state. */
function graphRestorer(context: GraphContext) {
  const graph = structuredClone(context.graph), params: Record<string, unknown> = { ...context.effect.params };
  delete params[EFFECT_GRAPH_PARAM];
  return () => editEffectGraph(context.clip.id, context.effect.id, 'Revert graph node', (next, nextParams) => {
    for (const key of Object.keys(next)) delete (next as unknown as Record<string, unknown>)[key];
    Object.assign(next, structuredClone(graph));
    for (const key of Object.keys(nextParams)) delete nextParams[key];
    Object.assign(nextParams, params);
  });
}

const optionalText = (args: Record<string, unknown>, key: string) => args[key] === undefined ? undefined : text(args, key);

export async function handleEditOperatorGraph(rawArgs: Record<string, unknown>): Promise<ToolResult> {
  const { args, renamed } = normalizeNodeIdArgs(rawArgs);
  // A composite add (node, values, cables) is one undo step and changes nothing when any part fails.
  const batch = args.action === 'add' ? startBatch('Add graph node') : undefined;
  let succeeded = false;
  try {
    const context = graphOwner(args, true), { clip, effect, graph } = context, action = text(args, 'action');
    const actions = createEffectGraphActions(clip.id, effect.id);
    const existing = () => { const id = text(args, 'nodeId'); const node = graph.nodes.find(n => n.id === id); if (!node) throw new Error('Node not found in this graph.'); return node; };
    const position = () => { const p = args.position as { x: number; y: number } | undefined;
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('A finite position is required.'); return { x: p.x, y: p.y }; };
    let nodeId: string | undefined;
    let extra: Record<string, unknown> = {};
    if (action === 'add') {
      const restore = graphRestorer(context);
      try {
        const added = addNode(context, args, position);
        nodeId = added.nodeId; extra = added;
      } catch (error) {
        // A partly applied add (node without its values or cables) must not survive a failure.
        if (graphOwner(args).graph.nodes.length !== graph.nodes.length) restore();
        throw error;
      }
    } else if (action === 'set') {
      nodeId = existing().id;
      setValue(context, nodeId, text(args, 'parameter'), args.value);
    } else if (action === 'connect') {
      const cable = connectPublicPorts(clip.id, effect.id, effect.type, graph, text(args, 'fromNodeId'), optionalText(args, 'fromPortId'),
        text(args, 'toNodeId'), optionalText(args, 'toPortId'));
      if (cable.insertedConversion) nodeId = cable.insertedConversion.nodeId;
      extra = { from: cable.from, to: cable.to, ...(cable.insertedConversion ? { insertedConversion: cable.insertedConversion } : {}) };
    } else if (action === 'disconnect') {
      const edgeId = text(args, 'edgeId'); if (!graph.edges.some(e => e.id === edgeId)) throw new Error('Edge not found.'); actions.disconnectEdge(edgeId);
    } else if (action === 'remove') {
      const requested = text(args, 'nodeId'), compound = compoundGroup(graph, requested);
      if (compound) {
        nodeId = requested;
        // An expanded compound is its group: remove every member, nested group, cable and layout entry.
        editEffectGraph(clip.id, effect.id, 'Delete node', next => {
          const groupIds = new Set([compound.id]);
          for (let grown = true; grown;) {
            grown = false;
            for (const group of next.groups ?? []) if (group.parentId && groupIds.has(group.parentId) && !groupIds.has(group.id)) { groupIds.add(group.id); grown = true; }
          }
          const members = new Set((next.groups ?? []).filter(group => groupIds.has(group.id)).flatMap(group => group.nodeIds));
          next.nodes = next.nodes.filter(node => !members.has(node.id));
          next.edges = next.edges.filter(edge => !members.has(edge.from) && !members.has(edge.to));
          for (const id of members) delete next.layout[id];
          next.groups = next.groups?.filter(group => !groupIds.has(group.id));
          next.groups?.forEach(group => { group.nodeIds = group.nodeIds.filter(id => !members.has(id)); });
        });
      } else { nodeId = existing().id; actions.deleteNode(nodeId); }
    } else if (action === 'move') { nodeId = existing().id; actions.moveNode(nodeId, position());
    } else if (action === 'expose') {
      const node = existing(); nodeId = node.id;
      if (typeof args.exposed !== 'boolean') throw new Error('expose requires exposed: true or false.');
      setGraphValueExposed(clip.id, effect.id, node.id, args.exposed, typeof args.label === 'string' ? args.label : undefined);
    } else if (action === 'group') {
      // Named stage around existing nodes; a compound member joins as its whole group.
      const ids = Array.isArray(args.nodeIds) ? args.nodeIds.map(value => String(value).replace(/\./g, '-')) : [];
      if (!ids.length) throw new Error('group requires nodeIds.');
      const childIds: string[] = [], nodeIds: string[] = [];
      for (const id of ids) {
        const compound = compoundGroup(graph, id);
        if (compound) childIds.push(compound.id);
        else if (graph.nodes.some(node => node.id === id)) nodeIds.push(id);
        else throw new Error(`Node ${id} not found in this graph.`);
      }
      let groupId = '';
      editEffectGraph(clip.id, effect.id, 'Group nodes', next => { groupId = groupOperators(next, nodeIds, childIds, text(args, 'label')); });
      extra = { groupId, label: text(args, 'label'), members: ids };
    } else if (action === 'slider') {
      nodeId = existing().id;
      text(args, 'label');
      configureSlider(context, nodeId, args);
    } else throw new Error('Unknown graph action.');
    const updated = graphOwner(args).graph;
    succeeded = true;
    return { success: true, data: { clipId: clip.id, effectId: effect.id, action, ...(nodeId ? { nodeId } : {}), ...extra, ...renamedField(renamed), incomplete: updated.incomplete ?? null, nodeCount: updated.nodes.length, edgeCount: updated.edges.length } };
  } catch (error) { return failure(error); }
  finally { if (batch?.opened) { if (succeeded) endBatch(); else cancelHistoryBatch(); } }
}
