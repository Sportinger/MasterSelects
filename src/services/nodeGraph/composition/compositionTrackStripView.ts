import type { NodeGraph, NodeGraphEdge, NodeGraphNode } from '../../../types/nodeGraph';
import { compositionEdge, compositionPort } from './compositionGraphPrimitives';
import { compositionNodeId } from './compositionGraphProjection';

export const trackStripGroupId = (trackId: string) => `comp:track:${trackId}:pieces`;
/** Gap between stacked cards of a clip column (reference card, Slice, Speed, Place). */
const CHAIN_GAP = 24, LANE_PITCH = 230;
export interface TrackStripViewOptions {
  selectedNodeIds?: ReadonlySet<string>;
  selectedClipIds?: ReadonlySet<string>;
  expandedClipIds?: ReadonlySet<string>;
  /** Clips whose reference cards stay shown (picked in the timeline); graph-side picks do not change it. */
  revealedClipIds?: ReadonlySet<string>;
  /** Transition nodes that stay shown after being picked, independent of later graph selection. */
  revealedNodeIds?: ReadonlySet<string>;
  /** Card height as painted (canvas geometry); stacked columns use it so cards never overlap. */
  nodeHeight?: (node: NodeGraphNode) => number;
  collapsed?: Readonly<Record<string, boolean>>;
  /** Deterministic operation counts for scale regression tests; no clocks or global state. */
  counters?: { nodes: number; edges: number; segments: number };
}

/** Display-only folding. The complete stable projection stays available to agents and inspectors. */
export function compositionTrackStripView(graph: NodeGraph, options: TrackStripViewOptions = {}): NodeGraph {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const tracks = new Map<string, NodeGraphNode>();
  const clipTracks = new Map<string, string[]>();
  const visible = new Set<string>();
  const opened = new Set<string>();
  const requiredParticipants = new Set<string>();
  const selected = options.selectedNodeIds ?? new Set<string>();
  for (const node of graph.nodes) {
    if (options.counters) options.counters.nodes++;
    const binding = node.binding;
    if (binding?.kind === 'composition-track') tracks.set(binding.trackId, { ...node, inputs: [...node.inputs], outputs: [...node.outputs] });
    if (binding?.kind === 'composition-transition' && (selected.has(node.id) || options.revealedNodeIds?.has(node.id))) {
      requiredParticipants.add(binding.outgoingClipId); requiredParticipants.add(binding.incomingClipId);
    }
  }
  for (const track of tracks.values()) for (const segment of track.summary?.segments ?? []) {
    if (options.counters) options.counters.segments++;
    if (segment.transitionId || !segment.nodeId) continue;
    const ids = clipTracks.get(segment.nodeId) ?? [];
    if (!ids.includes(track.id)) ids.push(track.id);
    clipTracks.set(segment.nodeId, ids);
  }
  for (const [id, ids] of clipTracks) {
    const primary = compositionNodeId.track(String(nodes.get(id)?.params?.trackId));
    const index = ids.indexOf(primary); if (index > 0) { ids.splice(index, 1); ids.unshift(primary); }
  }
  for (const node of graph.nodes) {
    const binding = node.binding;
    if (binding?.kind === 'composition-clip') {
      const expand = options.expandedClipIds?.has(binding.clipId) || (binding.linkedClipId && options.expandedClipIds?.has(binding.linkedClipId));
      if (expand) opened.add(node.id);
      // Selection itself only highlights the strip segment. Cards appear for clips revealed by a
      // timeline pick, expanded clips/strips and selected transitions; graph clicks never fold them.
      if (expand || options.revealedClipIds?.has(binding.clipId) || (binding.linkedClipId && options.revealedClipIds?.has(binding.linkedClipId))
        || requiredParticipants.has(binding.clipId) || (binding.linkedClipId && requiredParticipants.has(binding.linkedClipId))
        || (clipTracks.get(node.id) ?? []).some(id => options.collapsed?.[`${id}:pieces`] === false)
        || !clipTracks.has(node.id)) visible.add(node.id);
    } else if (binding?.kind === 'composition-time-chain') continue;
    else if (binding?.kind !== 'composition-transition' || selected.has(node.id) || options.revealedNodeIds?.has(node.id)) visible.add(node.id);
  }
  // Slice → Speed → Place cards belong to their reference card: shown with it, placed under it.
  const chainReference = new Map<string, string>();
  for (const node of graph.nodes) if (node.binding?.kind === 'composition-time-chain') {
    const reference = compositionNodeId.clip(node.binding.clipId);
    chainReference.set(node.id, reference);
    if (visible.has(reference)) visible.add(node.id);
  }
  const chainedReferences = new Set([...chainReference].filter(([id]) => visible.has(id)).map(([, reference]) => reference));
  // Stack offsets per chain card, measured from its reference card's top edge.
  const height = options.nodeHeight ?? (() => 170);
  const stackOffset = new Map<string, number>();
  const stackHeight = new Map<string, number>();
  for (const reference of chainedReferences) {
    let y = height(nodes.get(reference)!) + CHAIN_GAP;
    for (const stage of ['slice', 'speed', 'place'] as const) {
      const node = nodes.get(`${reference}:${stage}`); if (!node) continue;
      stackOffset.set(node.id, y); y += height(node) + CHAIN_GAP;
    }
    stackHeight.set(reference, y);
  }
  const trackByNode = new Map([...tracks.values()].map(track => [track.id, track]));
  const mediaPorts = new Map<string, Set<string>>();
  const edges = new Map<string, NodeGraphEdge>();
  const add = (edge: NodeGraphEdge) => { edges.set(edge.id, edge); };
  const socket = (trackId: string, id: string, label: string, type: 'clip' | 'time', direction: 'input' | 'output') => {
    const track = trackByNode.get(trackId);
    const ports = direction === 'input' ? track?.inputs : track?.outputs;
    if (ports && !ports.some(port => port.id === id)) ports.push(compositionPort(id, label, type, direction));
  };
  for (const edge of graph.edges) {
    if (options.counters) options.counters.edges++;
    const from = nodes.get(edge.fromNodeId), to = nodes.get(edge.toNodeId);
    if (!from || !to) continue;
    const sourceClip = from.binding?.kind === 'composition-clip';
    const targetClip = to.binding?.kind === 'composition-clip';
    if (targetClip && (from.binding?.kind === 'composition-media' || from.binding?.kind === 'operator-group')) {
      // Bundle by source identity and track even when Media is expanded (piece sockets differ).
      const sourcePort = from.binding.kind === 'composition-media' ? 'track-pieces' : edge.fromPortId;
      const destinations = clipTracks.get(to.id) ?? [];
      const separateAudio = to.inputs.some(port => port.id === 'audio-source');
      const mediaTracks = separateAudio ? edge.toPortId === 'audio-source' ? destinations.slice(1) : destinations.slice(0, 1) : destinations;
      for (const trackId of mediaTracks) add(compositionEdge(from.id, sourcePort, trackId, 'clips', 'clip'));
      if (opened.has(to.id)) {
        add(edge); const ports = mediaPorts.get(from.id) ?? new Set<string>(); ports.add(edge.fromPortId); mediaPorts.set(from.id, ports);
      }
      continue;
    }
    if ((sourceClip && (to.binding?.kind === 'composition-rule' || to.binding?.kind === 'composition-beat-source'))
      || (targetClip && from.binding?.kind === 'composition-rule')) {
      const reference = sourceClip ? from : to;
      for (const trackId of clipTracks.get(reference.id) ?? []) {
        if (sourceClip) {
          socket(trackId, 'rule-members', 'Rule members', 'clip', 'output');
          add(compositionEdge(trackId, 'rule-members', to.id, edge.toPortId, edge.type));
        } else {
          socket(trackId, 'rule-place', 'Rule placement', 'time', 'input');
          add(compositionEdge(from.id, edge.fromPortId, trackId, 'rule-place', edge.type));
        }
      }
      continue;
    }
    if (!visible.has(from.id) || !visible.has(to.id)) continue;
    // A collapsed linked reference has one attachment; an embedded processing graph keeps both seams.
    if (sourceClip && to.binding?.kind === 'composition-track' && !opened.has(from.id)
      && to.id !== clipTracks.get(from.id)?.[0]) continue;
    add(edge);
  }
  const groups = [...graph.groups ?? []];
  const displayNodes = graph.nodes.filter(node => visible.has(node.id)).map(node => {
    if (node.binding?.kind === 'composition-track') {
      const track = tracks.get(node.binding.trackId)!;
      const groupId = trackStripGroupId(node.binding.trackId);
      const collapsed = options.collapsed?.[groupId] !== false;
      groups.push({ id: groupId, proxyId: node.id, label: `${node.label} clips`, color: '#55a6c4',
        collapsed, collapsedByDefault: true, nodeIds: [node.id] });
      return { ...track, groupId, summary: { ...track.summary, segments: track.summary?.segments?.map(segment => ({ ...segment,
        selected: segment.transitionId ? !!segment.nodeId && selected.has(segment.nodeId) : options.selectedClipIds?.has(segment.clipId) })) } };
    }
    if (node.binding?.kind === 'composition-media') return { ...node,
      outputs: [compositionPort('track-pieces', 'Track pieces', 'clip', 'output'),
        ...node.outputs.filter(port => mediaPorts.get(node.id)?.has(port.id))] };
    return node;
  });
  const offsets = new Map<string, number>();
  let offset = 0;
  const references = new Map<string, NodeGraphNode[]>();
  for (const node of displayNodes) if (node.binding?.kind === 'composition-clip') {
    const track = clipTracks.get(node.id)?.[0]; if (!track) continue;
    const row = references.get(track) ?? []; row.push(node); references.set(track, row);
  }
  const transitionRows = new Map<string, NodeGraphNode[]>();
  for (const node of displayNodes) if (node.binding?.kind === 'composition-transition') {
    const participant = compositionNodeId.clip(node.binding.outgoingClipId);
    const track = clipTracks.get(participant)?.[0]; if (!track) continue;
    const row = transitionRows.get(track) ?? []; row.push(node); transitionRows.set(track, row);
  }
  const transitionPositions = new Map<string, { x: number; y: number }>();
  const referenceOffsets = new Map<string, number>();
  const referenceShifts = new Map<string, number>();
  const rowEnds: (() => number)[] = [];
  for (const track of [...tracks.values()].toSorted((a, b) => a.defaultLayout!.y - b.defaultLayout!.y)) {
    offsets.set(track.id, offset);
    // One row in timeline order: keep the time position while it fits, otherwise push right.
    const laneEnds: number[] = [];
    let rowEnd = -Infinity;
    rowEnds.push(() => rowEnd);
    for (const node of (references.get(track.id) ?? []).toSorted((a, b) => a.layout.x - b.layout.x || a.id.localeCompare(b.id))) {
      const x = Math.max(node.layout.x, rowEnd + 24);
      rowEnd = x + 184; laneEnds[0] = rowEnd;
      referenceOffsets.set(node.id, offset);
      if (x !== node.layout.x) referenceShifts.set(node.id, x - node.layout.x);
    }
    // Reserve enough lanes for the tallest stacked Slice/Speed/Place column of this track.
    const stack = Math.max(0, ...(references.get(track.id) ?? []).map(node => stackHeight.get(node.id) ?? 0));
    for (let lanes = laneEnds.length; lanes * LANE_PITCH < stack; lanes++) laneEnds.push(0);
    const transitions = transitionRows.get(track.id) ?? [];
    transitions.forEach((node, index) => {
      const segment = track.summary?.segments?.find(segment => segment.nodeId === node.id);
      transitionPositions.set(node.id, { x: track.layout.x + 10 + (segment?.start ?? 0) * (track.summary!.timeAxis!.width - 20),
        y: track.layout.y + 216 + offset + (laneEnds.length + index) * 230 });
    });
    offset += (laneEnds.length + transitions.length) * LANE_PITCH;
  }
  const compositionOffsets: Record<string, { x: number; y: number }> = {};
  // Long expanded rows grow past the strips: keep Stack/Master/Output right of the widest row.
  const widest = Math.max(-Infinity, ...rowEnds.map(end => end()));
  const busIds = new Set([compositionNodeId.videoStack(), compositionNodeId.audioMaster(), compositionNodeId.output()]);
  const busLeft = Math.min(...[...busIds].map(id => nodes.get(id)?.defaultLayout?.x ?? nodes.get(id)?.layout.x ?? Infinity));
  const busShift = Number.isFinite(widest) && Number.isFinite(busLeft) ? Math.max(0, widest + 80 - busLeft) : 0;
  for (const id of busIds) if (busShift) referenceShifts.set(id, busShift);
  const positioned = displayNodes.map(node => {
    const transitionPosition = transitionPositions.get(node.id);
    if (transitionPosition) {
      const dy = transitionPosition.y - (node.defaultLayout?.y ?? node.layout.y);
      compositionOffsets[node.id] = { x: transitionPosition.x - (node.defaultLayout?.x ?? node.layout.x), y: dy };
      return { ...node, layout: { x: node.layout.x + compositionOffsets[node.id].x, y: node.layout.y + dy } };
    }
    const reference = chainReference.get(node.id);
    if (reference && node.binding?.kind === 'composition-time-chain') {
      // Stack Slice, Speed and Place in the clip's own column so neighbouring chains never overlap.
      const base = nodes.get(reference)?.defaultLayout ?? nodes.get(reference)?.layout ?? node.layout;
      const own = node.defaultLayout ?? node.layout;
      const x = base.x + (referenceShifts.get(reference) ?? 0) - own.x;
      const y = base.y + (referenceOffsets.get(reference) ?? offsets.get(reference) ?? 0) + (stackOffset.get(node.id) ?? 0) - own.y;
      compositionOffsets[node.id] = { x, y };
      return { ...node, layout: { x: node.layout.x + x, y: node.layout.y + y } };
    }
    const owner = node.id;
    const dy = referenceOffsets.get(owner) ?? offsets.get(owner) ?? 0;
    const dx = referenceShifts.get(owner) ?? 0;
    if (dy || dx) compositionOffsets[node.id] = { x: dx, y: dy };
    return dy || dx ? { ...node, layout: { x: node.layout.x + dx, y: node.layout.y + dy } } : node;
  });
  return { ...graph, workspace: { clips: {}, defaultNodes: Object.fromEntries(graph.nodes.map(node => [node.id, node.defaultLayout ?? node.layout])), compositionOffsets }, nodes: positioned, edges: [...edges.values()], groups,
    expandedNodes: [...new Map([...(graph.expandedNodes ?? []), ...graph.nodes].map(node => [node.id, node])).values()] };
}
