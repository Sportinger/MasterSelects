import type { OperatorEndpoint, OperatorValue } from '../../types/operatorGraph';
import type { ParameterSourceBinding, ParameterSources } from '../../types/parameterSources';
import type { NodeGraphLayout } from '../../types/nodeGraph';
import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { renderHostPort } from '../render/renderHostPort';
import { createControlNode, getControlOperator } from './controlOperators';
import { createParameterSourceEvaluator } from './parameterSourceEvaluation';
import { getParameterSourceTarget } from './parameterSourceTargets';
import { parseColorProperty } from '../../types/colorCorrection';

/** Reset the saved basis without recording a key or disconnecting a source. */
export function setParameterBaseValue(clipId: string, property: string, value: number): void {
  const timeline = useTimelineStore.getState(), clip = timeline.clips.find(item => item.id === clipId);
  if (!clip || !getParameterSourceTarget(clip, property)) throw new Error('Unsupported target parameter.');
  if (timeline.isExporting || timeline.tracks.some(track => track.id === clip.trackId && track.locked)) throw new Error('The clip is locked or exporting.');
  if (!Number.isFinite(value)) throw new Error('Value must be finite.');
  const batch = startBatch('Reset parameter base');
  try {
    const color = parseColorProperty(property);
    if (color) timeline.updateColorNodeParam(clipId, color.versionId, color.nodeId, color.paramName, value);
    else { const [, effectId, param] = property.split('.'); timeline.updateClipEffect(clipId, effectId, { [param]: value }); }
    timeline.invalidateCache(); renderHostPort.requestRender();
  } finally { if (batch.opened) endBatch(); }
}

function emptySources(): ParameterSources {
  return { version: 1, graph: { version: 1, nodes: [], edges: [], layout: {} }, targets: {}, clipTimeOffset: 0 };
}

function edit(clipId: string, label: string, update: (state: ParameterSources) => void,
  validate?: (state: ParameterSources) => void): void {
  const timeline = useTimelineStore.getState(), clip = timeline.clips.find(item => item.id === clipId);
  if (!clip) throw new Error('Clip not found.');
  if (timeline.isExporting || timeline.tracks.some(track => track.id === clip.trackId && track.locked)) throw new Error('The clip is locked or exporting.');
  const state = clip.nodeGraph?.parameterSources ? structuredClone(clip.nodeGraph.parameterSources) : emptySources();
  update(state); validate?.(state);
  const batch = startBatch(label);
  try {
    timeline.updateClip(clipId, { nodeGraph: { ...(clip.nodeGraph ?? { version: 1 as const, nodes: [] }), parameterSources: state } });
    timeline.invalidateCache(); renderHostPort.requestRender();
  } finally { if (batch.opened) endBatch(); }
}

export function addControlNode(clipId: string, operator: string, layout: NodeGraphLayout = { x: 0, y: -300 },
  constants?: Record<string, OperatorValue>): string {
  const id = `control-${crypto.randomUUID()}`;
  edit(clipId, 'Add parameter source', state => {
    const node = createControlNode(operator, id);
    node.constants = { ...node.constants, ...constants };
    state.graph.nodes.push(node); state.graph.layout[id] = layout;
  });
  return id;
}

/** Quick-add and connect is a single undo step and never modifies the target value. */
export function addParameterSource(clipId: string, property: string, operator: string): string {
  const clip = useTimelineStore.getState().clips.find(item => item.id === clipId);
  const target = clip && getParameterSourceTarget(clip, property);
  if (!target) throw new Error('Unsupported target parameter.');
  const id = `control-${crypto.randomUUID()}`;
  edit(clipId, 'Add connected parameter source', state => {
    const node = createControlNode(operator, id);
    node.constants = { ...node.constants,
      ...(operator === 'values.number' ? { value: target.value } : {}),
      ...(operator === 'control.keyframes' ? { property } : {}),
      ...(operator === 'control.lfo' ? { offset: target.value, amplitude: 0 } : {}),
    };
    state.graph.layout[id] = { x: state.graph.nodes.length * 300, y: -320 };
    state.graph.nodes.push(node);
    state.targets[property] = { ...state.targets[property], source: { nodeId: id, portId: 'value' }, enabled: true, exposed: true };
  });
  return id;
}

export function setControlNodeValue(clipId: string, nodeId: string, parameter: string, value: OperatorValue): void {
  edit(clipId, 'Edit parameter source', state => {
    const node = state.graph.nodes.find(item => item.id === nodeId);
    if (!node) throw new Error('Control source not found.');
    const definition = getControlOperator(node.operator);
    if (!definition?.parameters.some(param => param.id === parameter) && !definition?.inputs.some(input => input.id === parameter)) throw new Error('Unknown control parameter.');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Value must be finite.');
    node.constants = { ...node.constants, [parameter]: value };
  });
}

export function moveControlNode(clipId: string, nodeId: string, layout: NodeGraphLayout): void {
  edit(clipId, 'Move parameter source', state => { state.graph.layout[nodeId] = layout; });
}

export function connectControlNodes(clipId: string, source: OperatorEndpoint, target: OperatorEndpoint): void {
  edit(clipId, 'Connect parameter sources', state => {
    const from = state.graph.nodes.find(node => node.id === source.nodeId), to = state.graph.nodes.find(node => node.id === target.nodeId);
    if (!from || !to || !getControlOperator(from.operator)?.outputs.some(port => port.id === source.portId)
      || !getControlOperator(to.operator)?.inputs.some(port => port.id === target.portId)) throw new Error('Choose compatible scalar control ports.');
    const edges = state.graph.edges.filter(edge => edge.to !== target.nodeId || edge.input !== target.portId);
    const reachable = new Set<string>();
    const visit = (id: string) => { if (reachable.has(id)) return; reachable.add(id); edges.filter(edge => edge.from === id).forEach(edge => visit(edge.to)); };
    visit(target.nodeId);
    if (reachable.has(source.nodeId)) throw new Error('Control graph connection would create a cycle.');
    state.graph.edges = [...edges, { id: `control-edge-${crypto.randomUUID()}`, from: source.nodeId, output: source.portId, to: target.nodeId, input: target.portId }];
  });
}

export function disconnectControlEdge(clipId: string, edgeId: string): void {
  edit(clipId, 'Disconnect parameter sources', state => { state.graph.edges = state.graph.edges.filter(edge => edge.id !== edgeId); });
}

export function setParameterSourceBinding(clipId: string, property: string, patch: Partial<ParameterSourceBinding>): void {
  const timeline = useTimelineStore.getState(), clip = timeline.clips.find(item => item.id === clipId);
  if (!clip || !getParameterSourceTarget(clip, property)) throw new Error('Parameter does not support control sources.');
  edit(clipId, 'Change parameter source', state => {
    state.targets[property] = { ...state.targets[property], ...patch };
  }, state => {
    // Reject invalid connections before mutation, without evaluating unrelated targets.
    if (state.targets[property]?.source && state.targets[property].enabled !== false) {
      const candidate = { ...clip, nodeGraph: { ...(clip.nodeGraph ?? { version: 1 as const, nodes: [] }), parameterSources: state } };
      createParameterSourceEvaluator(candidate, timeline.clipKeyframes.get(clipId) ?? [], Math.max(0, Math.min(clip.duration, timeline.playheadPosition - clip.startTime))).resolve(property);
    }
  });
}

export function deleteControlNode(clipId: string, nodeId: string): void {
  edit(clipId, 'Delete parameter source', state => {
    state.graph.nodes = state.graph.nodes.filter(node => node.id !== nodeId);
    state.graph.edges = state.graph.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId);
    delete state.graph.layout[nodeId];
    for (const binding of Object.values(state.targets)) if (binding.source?.nodeId === nodeId) {
      delete binding.source; delete binding.enabled;
    }
  });
}
