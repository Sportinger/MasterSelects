import type { NodeGraph, NodeGraphNode } from '../../../types/nodeGraph';
import type { CompositionGraphProjectionInput } from './compositionGraphProjection';
import type { compositionGraphLayout } from './compositionGraphLayout';
import { finite } from './compositionGraphPrimitives';
import { indexCompositionClipNodes } from './compositionGraphClipPairs';

type Segment = NonNullable<NonNullable<NodeGraphNode['summary']>['segments']>[number];

/** Project actual timeline intervals, including the audio half of linked pairs. */
export function projectTrackStripSegments(input: CompositionGraphProjectionInput, graph: NodeGraph,
  layout: ReturnType<typeof compositionGraphLayout>) {
  const clips = indexCompositionClipNodes(graph);
  const timeline = new Map(input.clips.map(clip => [clip.id, clip]));
  const segments = new Map<string, Segment[]>();
  const normalized = (time: number) => finite(time) / (layout.duration > 0 ? layout.duration : 1);
  for (const clip of input.clips) {
    const node = clips.get(`comp:clip:${clip.id}`);
    if (!node) continue;
    const badges = (node.summary?.badges ?? []).filter(badge => !['Freeze', 'Loop', 'Warp', 'Reverse'].includes(badge) && !badge.startsWith('Speed'));
    const speed = clip.transitionSourceMap?.version === 2 ? clip.transitionSourceMap.parent.defaultSpeed : clip.speed ?? 1;
    if (speed !== 1) badges.push(`Speed ${speed}x`);
    if (clip.reversed || speed < 0) badges.push('Reverse');
    if (clip.timeRemap?.kind) badges.push(clip.timeRemap.kind[0].toUpperCase() + clip.timeRemap.kind.slice(1));
    if (clip.linkedClipId && !badges.includes('Linked audio')) badges.push('Linked audio');
    if (clip.isComposition) badges.push('Nested');
    const row = segments.get(clip.trackId) ?? [];
    row.push({ id: `track-piece:${clip.id}`, clipId: clip.id, nodeId: node.id,
      start: normalized(clip.startTime), end: normalized(clip.startTime + Math.max(0, finite(clip.duration))),
      label: `${clip.name} (${finite(clip.startTime)}-${finite(clip.startTime + clip.duration)} s)${badges.length ? ` / ${badges.join(', ')}` : ''}`,
      badges, highlighted: badges.includes('Rule') });
    segments.set(clip.trackId, row);
  }
  for (const node of graph.nodes) {
    const binding = node.binding;
    if (binding?.kind !== 'composition-transition') continue;
    const outgoing = timeline.get(binding.outgoingClipId), incoming = timeline.get(binding.incomingClipId);
    const anchor = outgoing ?? incoming;
    if (!anchor) continue;
    const duration = Math.max(0, Number(node.params?.duration) || 0);
    const center = (outgoing ? outgoing.startTime + outgoing.duration : anchor.startTime) + (Number(node.params?.offset) || 0);
    const row = segments.get(anchor.trackId) ?? [];
    row.push({ id: `track-transition:${binding.transitionId}`, clipId: anchor.id, nodeId: node.id,
      transitionId: binding.transitionId, start: normalized(center - duration / 2), end: normalized(center + duration / 2),
      label: `${node.label} transition (${duration} s)` });
    segments.set(anchor.trackId, row);
  }
  for (const node of graph.nodes) if (node.binding?.kind === 'composition-track') {
    node.summary = { ...node.summary, timeAxis: { width: layout.width, duration: (layout.duration > 0 ? layout.duration : 1),
      pixelsPerSecond: layout.pixelsPerSecond }, segments: (segments.get(node.binding.trackId) ?? []).toSorted((a, b) => Number(!!a.transitionId) - Number(!!b.transitionId) || a.start - b.start || a.id.localeCompare(b.id)) };
  }
}
