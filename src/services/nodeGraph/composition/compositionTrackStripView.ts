import type { NodeGraph, NodeGraphEdge, NodeGraphNode } from '../../../types/nodeGraph';
import { compositionEdge, compositionPort } from './compositionGraphPrimitives';
import { compositionNodeId } from './compositionGraphProjection';

export const trackStripGroupId = (trackId: string) => `comp:track:${trackId}:lanes`;
/** Clip lanes (plan 3.1e): one compact row per clip under its strip, in timeline order. */
export const LANE_WIDTH = 760;
export const LANE_PITCH = 46;
const LANE_INDENT = 10, STRIP_TO_LANES = 14, TRACK_GAP = 84, RULE_GAP = 60;
export interface TrackStripViewOptions {
  selectedNodeIds?: ReadonlySet<string>;
  selectedClipIds?: ReadonlySet<string>;
  /** Clips whose lane is open: the embedded processing graph replaces the row. */
  expandedClipIds?: ReadonlySet<string>;
  /** Card height as painted (canvas geometry); strips use it to place their lanes. */
  nodeHeight?: (node: NodeGraphNode) => number;
  collapsed?: Readonly<Record<string, boolean>>;
  /** Deterministic operation counts for scale regression tests; no clocks or global state. */
  counters?: { nodes: number; edges: number; segments: number };
}

const seconds = (value: unknown) => `${(Number(value) || 0).toFixed(1)} s`;
const count = (value: number, one: string, many = `${one}s`) => `${value} ${value === 1 ? one : many}`;

/** 'source ▸ in–out · speed ▸ effects ▸ track @ start', plus the linked audio target. */
export function describeClipLane(node: NodeGraphNode, trackName: (trackId: string) => string): string {
  const params = node.params ?? {};
  const speed = Number(params.speed ?? 1);
  const retime = typeof params.retime === 'string' ? params.retime : undefined;
  const timing = retime ? retime[0].toUpperCase() + retime.slice(1)
    : params.reversed ? 'reverse' : `${Number(Math.abs(speed).toFixed(3))}×`;
  const effects = Number(params.effectCount) || 0, masks = Number(params.maskCount) || 0;
  const processing = [effects ? count(effects, 'effect') : 'no effects', ...(masks ? [count(masks, 'mask')] : [])].join(' · ');
  const start = seconds(params.startTime);
  const audio = typeof params.audioTrackId === 'string' ? ` + audio ▸ ${trackName(params.audioTrackId)} @ ${start}` : '';
  const range = `${(Number(params.inPoint) || 0).toFixed(1)}–${seconds(params.outPoint)}`;
  return `${String(params.sourceName ?? node.label)} ▸ ${range} · ${timing} ▸ ${processing} ▸ ${trackName(String(params.trackId))} @ ${start}${audio}`;
}

/** Display-only folding. The complete stable projection stays available to agents and inspectors. */
export function compositionTrackStripView(graph: NodeGraph, options: TrackStripViewOptions = {}): NodeGraph {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const tracks = new Map<string, NodeGraphNode>();
  const clipTracks = new Map<string, string[]>();
  const selected = options.selectedNodeIds ?? new Set<string>();
  for (const node of graph.nodes) {
    if (options.counters) options.counters.nodes++;
    const binding = node.binding;
    if (binding?.kind === 'composition-track') tracks.set(binding.trackId, { ...node, inputs: [...node.inputs], outputs: [...node.outputs] });
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
  const stripCollapsed = (trackNodeId?: string) => !!trackNodeId && options.collapsed?.[`${trackNodeId}:lanes`] === true;
  const transitionTrack = (node: NodeGraphNode) => node.binding?.kind === 'composition-transition'
    ? clipTracks.get(compositionNodeId.clip(node.binding.outgoingClipId))?.[0] ?? clipTracks.get(compositionNodeId.clip(node.binding.incomingClipId))?.[0]
    : undefined;
  const opened = new Set<string>();
  const visible = new Set<string>();
  for (const node of graph.nodes) {
    const binding = node.binding;
    if (binding?.kind === 'composition-time-chain') continue;
    if (binding?.kind === 'composition-clip') {
      const expand = options.expandedClipIds?.has(binding.clipId) || (!!binding.linkedClipId && options.expandedClipIds?.has(binding.linkedClipId));
      if (expand) opened.add(node.id);
      // Every clip is a lane; a folded strip hides its lanes unless one is open.
      if (expand || !stripCollapsed(clipTracks.get(node.id)?.[0])) visible.add(node.id);
    } else if (binding?.kind !== 'composition-transition' || selected.has(node.id) || !stripCollapsed(transitionTrack(node))) visible.add(node.id);
  }
  const rows = new Set([...visible].filter(id => {
    const kind = nodes.get(id)?.binding?.kind;
    return kind === 'composition-transition' || (kind === 'composition-clip' && !opened.has(id));
  }));
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
    // Rows carry no cables: the lane text names its source and target, the strip shows the timing.
    if (!visible.has(from.id) || !visible.has(to.id) || rows.has(from.id) || rows.has(to.id)) continue;
    // An open linked lane has one attachment per seam; the audio seam stays on the audio track.
    if (sourceClip && to.binding?.kind === 'composition-track' && !opened.has(from.id)
      && to.id !== clipTracks.get(from.id)?.[0]) continue;
    add(edge);
  }
  const trackName = (trackId: string) => tracks.get(trackId)?.label ?? trackId;
  const groups = [...graph.groups ?? []];
  const displayNodes = graph.nodes.filter(node => visible.has(node.id)).map(node => {
    if (node.binding?.kind === 'composition-track') {
      const track = tracks.get(node.binding.trackId)!;
      const groupId = trackStripGroupId(node.binding.trackId);
      groups.push({ id: groupId, proxyId: node.id, label: `${node.label} lanes`, color: '#55a6c4',
        collapsed: stripCollapsed(node.id), collapsedByDefault: false, nodeIds: [node.id] });
      return { ...track, groupId, summary: { ...track.summary, segments: track.summary?.segments?.map(segment => ({ ...segment,
        selected: segment.transitionId ? !!segment.nodeId && selected.has(segment.nodeId) : options.selectedClipIds?.has(segment.clipId) })) } };
    }
    if (node.binding?.kind === 'composition-media') return { ...node,
      outputs: [compositionPort('track-pieces', 'Track pieces', 'clip', 'output'),
        ...node.outputs.filter(port => mediaPorts.get(node.id)?.has(port.id))] };
    return node;
  });
  // Lane order per strip: clips by start, each transition right before its incoming clip.
  const start = (node: NodeGraphNode) => {
    const binding = node.binding;
    if (binding?.kind !== 'composition-transition') return Number(node.params?.startTime) || 0;
    const incoming = nodes.get(compositionNodeId.clip(binding.incomingClipId)) ?? nodes.get(compositionNodeId.clip(binding.outgoingClipId));
    return (Number(incoming?.params?.startTime) || 0) - 1e-6;
  };
  const lanesByTrack = new Map<string, NodeGraphNode[]>();
  const unassigned: NodeGraphNode[] = [];
  for (const node of displayNodes) {
    const kind = node.binding?.kind;
    if (kind !== 'composition-clip' && kind !== 'composition-transition') continue;
    const track = kind === 'composition-clip' ? clipTracks.get(node.id)?.[0] : transitionTrack(node);
    if (!track) { unassigned.push(node); continue; }
    const lanes = lanesByTrack.get(track) ?? []; lanes.push(node); lanesByTrack.set(track, lanes);
  }
  const height = options.nodeHeight ?? (() => 170);
  const targets = new Map<string, { x: number; y: number }>();
  const laneRows = new Map<string, NonNullable<NonNullable<NodeGraphNode['summary']>['laneRow']>>();
  const sortedTracks = [...tracks.values()].toSorted((a, b) => (a.defaultLayout ?? a.layout).y - (b.defaultLayout ?? b.layout).y);
  let cursor = sortedTracks.length ? (sortedTracks[0].defaultLayout ?? sortedTracks[0].layout).y : 80;
  const placeLanes = (lanes: readonly NodeGraphNode[], x: number, tone: 'video' | 'audio') => {
    const ordered = lanes.toSorted((a, b) => start(a) - start(b) || a.id.localeCompare(b.id));
    const indexes = new Map<string, number>();
    for (const node of ordered) if (node.binding?.kind === 'composition-clip') indexes.set(node.binding.clipId, indexes.size + 1);
    for (const node of ordered) {
      targets.set(node.id, { x, y: cursor }); cursor += LANE_PITCH;
      const binding = node.binding;
      if (binding?.kind === 'composition-transition') {
        const pair = `${indexes.get(binding.outgoingClipId) ?? '?'} → ${indexes.get(binding.incomingClipId) ?? '?'}`;
        laneRows.set(node.id, { width: LANE_WIDTH, index: '⇄', title: node.label, tone: 'transition',
          text: `${seconds(node.params?.duration)} between clips ${pair} · double-click opens its body` });
      } else if (binding?.kind === 'composition-clip') {
        laneRows.set(node.id, { width: LANE_WIDTH, index: String(indexes.get(binding.clipId) ?? ''), title: node.label, tone,
          text: describeClipLane(node, trackName) });
      }
    }
  };
  for (const track of sortedTracks) {
    targets.set(track.id, { x: (track.defaultLayout ?? track.layout).x, y: cursor });
    cursor += height(track) + STRIP_TO_LANES;
    placeLanes(lanesByTrack.get(track.id) ?? [], (track.defaultLayout ?? track.layout).x + LANE_INDENT,
      track.params?.trackType === 'audio' ? 'audio' : 'video');
    cursor += TRACK_GAP;
  }
  // The strip frame encloses its lane rows; open lanes keep their own clip frame.
  for (const [trackId, lanes] of lanesByTrack) {
    const index = groups.findIndex(group => group.proxyId === trackId && group.id === `${trackId}:lanes`);
    if (index >= 0) groups[index] = { ...groups[index], nodeIds: [trackId, ...lanes.filter(node => rows.has(node.id)).map(node => node.id)] };
  }
  if (unassigned.length) placeLanes(unassigned, (sortedTracks[0]?.defaultLayout ?? sortedTracks[0]?.layout ?? { x: 300 }).x + LANE_INDENT, 'video');
  // Rules and their beat sources sit below the last lane.
  const ruleTop = Math.min(Infinity, ...displayNodes.filter(node => node.binding?.kind === 'composition-rule' || node.binding?.kind === 'composition-beat-source')
    .map(node => (node.defaultLayout ?? node.layout).y));
  const ruleShift = Number.isFinite(ruleTop) ? Math.max(0, cursor + RULE_GAP - ruleTop) : 0;
  const compositionOffsets: Record<string, { x: number; y: number }> = {};
  const positioned = displayNodes.map(node => {
    const target = targets.get(node.id);
    // Strips and lanes are fixed slots: a stored drag position never displaces them.
    const offset = target ? { x: target.x - node.layout.x, y: target.y - node.layout.y }
      : ruleShift && (node.binding?.kind === 'composition-rule' || node.binding?.kind === 'composition-beat-source') ? { x: 0, y: ruleShift } : undefined;
    const row = laneRows.get(node.id);
    const shown = row && rows.has(node.id) ? { ...node, inputs: [], outputs: [], summary: { ...node.summary, laneRow: row } }
      : row ? { ...node, summary: { ...node.summary, laneRow: row } } : node;
    if (!offset || (!offset.x && !offset.y)) return shown;
    compositionOffsets[node.id] = offset;
    return { ...shown, layout: { x: node.layout.x + offset.x, y: node.layout.y + offset.y } };
  });
  return { ...graph, workspace: { clips: {}, defaultNodes: Object.fromEntries(graph.nodes.map(node => [node.id, node.defaultLayout ?? node.layout])), compositionOffsets }, nodes: positioned, edges: [...edges.values()], groups,
    expandedNodes: [...new Map([...(graph.expandedNodes ?? []), ...graph.nodes].map(node => [node.id, node])).values()] };
}
