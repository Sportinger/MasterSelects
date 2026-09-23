import type { ParameterSources } from '../../types/parameterSources';
import type { TimelineClip } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import { parameterSourceTargets } from './parameterSourceTargets';
import { cloneAudioParameterSources } from './audioParameterContext';

/** Only explicit owner removal cleans up sources. Unknown persisted paths are kept for diagnostics. */
export function reconcileRemovedParameterTargets(before: TimelineClip, after: TimelineClip): TimelineClip {
  if (!after.nodeGraph?.parameterSources) return after;
  const remaining = new Set(parameterSourceTargets(after).map(target => target.path));
  const removed = new Set(parameterSourceTargets(before).map(target => target.path).filter(path => !remaining.has(path)));
  if (!removed.size) return after;
  const state = structuredClone(after.nodeGraph.parameterSources);
  for (const path of removed) delete state.targets[path];
  const removedNodes = new Set(state.graph.nodes.filter(node => node.operator === 'control.keyframes'
    && typeof node.constants?.property === 'string' && removed.has(node.constants.property)).map(node => node.id));
  state.graph.nodes = state.graph.nodes.filter(node => !removedNodes.has(node.id));
  state.graph.edges = state.graph.edges.filter(edge => !removedNodes.has(edge.from) && !removedNodes.has(edge.to));
  for (const id of removedNodes) delete state.graph.layout[id];
  for (const binding of Object.values(state.targets)) if (binding.source && removedNodes.has(binding.source.nodeId)) {
    delete binding.source; delete binding.enabled;
  }
  return { ...after, nodeGraph: { ...after.nodeGraph, parameterSources: state } };
}

/** Version copies own their reachable drivers; editing version B must not change version A. */
export function duplicateColorParameterSources(state: ParameterSources | undefined, from: string, to: string): ParameterSources | undefined {
  if (!state) return undefined;
  const result = structuredClone(state), prefix = `color.${from}.`;
  const bindings = Object.entries(state.targets).filter(([path]) => path.startsWith(prefix));
  const nodeIds = new Set<string>();
  const visit = (id: string) => {
    if (nodeIds.has(id)) return;
    nodeIds.add(id); state.graph.edges.filter(edge => edge.to === id).forEach(edge => visit(edge.from));
  };
  bindings.forEach(([, binding]) => { if (binding.source) visit(binding.source.nodeId); });
  const ids = new Map([...nodeIds].map(id => [id, `control-${crypto.randomUUID()}`]));
  const remap = (path: string) => path.startsWith(prefix) ? `color.${to}.${path.slice(prefix.length)}` : path;
  for (const node of state.graph.nodes.filter(node => nodeIds.has(node.id))) {
    const clone = structuredClone(node); clone.id = ids.get(node.id)!;
    if (clone.operator === 'control.keyframes' && typeof clone.constants?.property === 'string') clone.constants.property = remap(clone.constants.property);
    result.graph.nodes.push(clone);
    const position = state.graph.layout[node.id] ?? { x: 0, y: -320 };
    result.graph.layout[clone.id] = { x: position.x, y: position.y - 320 };
  }
  for (const edge of state.graph.edges.filter(edge => nodeIds.has(edge.to))) result.graph.edges.push({ ...edge,
    id: `control-edge-${crypto.randomUUID()}`, from: ids.get(edge.from)!, to: ids.get(edge.to)! });
  for (const [path, binding] of bindings) result.targets[remap(path)] = { ...structuredClone(binding),
    ...(binding.source ? { source: { ...binding.source, nodeId: ids.get(binding.source.nodeId)! } } : {}) };
  return result;
}

/** Canonical property identities change together, including references used as curve sources. */
export function remapParameterSourceProperties(state: ParameterSources | undefined, remap: (path: string) => string): ParameterSources | undefined {
  if (!state) return undefined;
  const result = cloneAudioParameterSources(state)!;
  result.targets = Object.fromEntries(Object.entries(result.targets).map(([path, binding]) => [remap(path), binding]));
  for (const node of result.graph.nodes) {
    if (node.operator === 'control.keyframes' && typeof node.constants?.property === 'string') {
      node.constants.property = remap(node.constants.property);
    }
  }
  return result;
}

/** A new clip-local origin preserves authored oscillator phase. Timeline-time sources are unaffected. */
export function offsetParameterSourceTime(state: ParameterSources | undefined, delta: number): ParameterSources | undefined {
  return state ? { ...structuredClone(state), clipTimeOffset: state.clipTimeOffset + delta } : undefined;
}

export function parameterSourceSplitPatch(clip: TimelineClip, delta: number): Partial<TimelineClip> {
  return clip.nodeGraph?.parameterSources ? { nodeGraph: { ...structuredClone(clip.nodeGraph),
    parameterSources: offsetParameterSourceTime(clip.nodeGraph.parameterSources, delta) } } : {};
}

export function trimmedParameterSourceClips(before: readonly TimelineClip[], after: TimelineClip[]): TimelineClip[] {
  const originals = new Map(before.map(clip => [clip.id, clip]));
  return after.map(clip => {
    const previous = originals.get(clip.id);
    if (!previous?.nodeGraph?.parameterSources || previous.startTime === clip.startTime || previous.duration === clip.duration) return clip;
    return { ...clip, nodeGraph: { ...clip.nodeGraph!, parameterSources:
      offsetParameterSourceTime(previous.nodeGraph.parameterSources, clip.startTime - previous.startTime) } };
  });
}

/** Retain complete curves, including out-of-window handles, in each part's local clock. */
export function copyParameterKeyframesToParts(keys: ReadonlyMap<string, readonly Keyframe[]>, before: TimelineClip, parts: readonly TimelineClip[]): Map<string, Keyframe[]> {
  const result = new Map([...keys].map(([id, list]) => [id, [...list]]));
  if (!before.nodeGraph?.parameterSources) return result;
  const properties = new Set(parameterSourceTargets(before).map(target => target.path));
  const source = (keys.get(before.id) ?? []).filter(key => properties.has(key.property));
  if (!source.length) return result;
  for (const part of parts) {
    const delta = part.startTime - before.startTime;
    const copies = source.map(key => ({ ...structuredClone(key), id: `kf-${crypto.randomUUID()}`, clipId: part.id, time: key.time - delta }));
    result.set(part.id, [...(result.get(part.id) ?? []).filter(key => !properties.has(key.property)), ...copies].toSorted((a, b) => a.time - b.time));
  }
  return result;
}
