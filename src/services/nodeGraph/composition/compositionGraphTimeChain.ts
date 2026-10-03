import type { NodeGraph, NodeGraphNode } from '../../../types/nodeGraph';
import type { TimelineClip } from '../../../types/timeline';
import { compositionNodeId, type CompositionGraphProjectionInput } from './compositionGraphProjection';
import { compositionEdge, compositionGroupId, compositionNode, compositionPort } from './compositionGraphPrimitives';

/** The reference card is the cheap folded proxy; processing cards exist only when expanded. */
export function projectCompositionTimeChain(
  input: CompositionGraphProjectionInput, graph: NodeGraph, clip: TimelineClip, reference: NodeGraphNode,
): { nodeId: string; portId: string } {
  const groupId = compositionGroupId.timeChain(clip.id);
  const linkedClipId = reference.binding?.kind === 'composition-clip' ? reference.binding.linkedClipId : undefined;
  const collapsed = !input.expandedTimeChains?.has(clip.id)
    && !(linkedClipId && input.expandedTimeChains?.has(linkedClipId));
  reference.groupId = groupId;
  const group = { id: groupId, label: 'Slice → Speed → Place', color: '#a58bc7', collapsed,
    collapsedByDefault: true, proxyId: reference.id, nodeIds: [reference.id] };
  graph.groups!.push(group);
  if (collapsed) return { nodeId: reference.id, portId: 'source' };

  const sourceMap = clip.transitionSourceMap;
  const mapped = !!sourceMap;
  const parent = sourceMap?.version === 2 ? sourceMap.parent : undefined;
  let sourceStart = parent?.inPoint ?? clip.inPoint;
  let sourceEnd = parent?.outPoint ?? clip.outPoint;
  if (sourceMap?.version === 1 && sourceMap.segments.length) {
    sourceStart = Infinity;
    sourceEnd = -Infinity;
    for (const segment of sourceMap.segments) {
      const start = segment.kind === 'hold' ? segment.sourceTime : segment.sourceStart;
      const end = segment.kind === 'hold' ? segment.sourceTime : segment.sourceEnd;
      sourceStart = Math.min(sourceStart, start, end);
      sourceEnd = Math.max(sourceEnd, start, end);
    }
  }
  const stages = ['slice', 'speed', 'place'] as const;
  const nodes = stages.map((stage, index) => {
    const node = compositionNode(input.state, compositionNodeId.timeChain(clip.id, stage),
      stage === 'slice' ? 'Slice' : stage === 'speed' ? 'Speed' : 'Place',
      { kind: 'composition-time-chain', clipId: clip.id, stage },
      { x: reference.layout.x + index * 280, y: reference.layout.y + 230 },
      [compositionPort('clip', 'Clip', 'clip', 'input')],
      [compositionPort('clip', 'Clip', 'clip', 'output')]);
    node.groupId = groupId;
    node.params = { readOnly: mapped, ...(mapped ? { sourceMapVersion: sourceMap.version,
      segments: sourceMap.segments.length, timeDomain: stage === 'slice' ? 'source-time'
        : stage === 'speed' ? sourceMap.version === 2 ? 'parent-animation-time' : 'source-time' : 'recipe-time' } : {}) };
    if (stage === 'slice') {
      node.params = { ...node.params, inPoint: sourceStart, outPoint: sourceEnd };
      node.inputs.push(compositionPort('in', 'In', 'time', 'input', { readOnly: mapped,
        contract: { typeLabel: 'Source seconds', description: 'Trim bounds in source media time.',
          formats: ['seconds'], constraints: ['unit: seconds', 'time-domain: source-time'] } }));
      node.inputs.push(compositionPort('out', 'Out', 'time', 'input', { ...node.inputs[1].metadata }));
    } else if (stage === 'speed') {
      node.params = { ...node.params, speed: parent?.defaultSpeed ?? clip.speed ?? 1,
        reversed: clip.reversed === true || (parent?.defaultSpeed ?? clip.speed ?? 1) < 0 };
      if (clip.timeRemap?.kind === 'freeze') {
        node.params.freezeSourceTime = clip.timeRemap.sourceTime;
        node.summary = { badges: ['Freeze'] };
      }
      if (clip.timeRemap?.kind === 'loop') {
        node.params.loopPhase = clip.timeRemap.phase ?? 0;
        node.summary = { badges: ['Loop'] };
      }
      if (clip.timeRemap?.kind === 'warp') {
        node.params.warpPoints = clip.timeRemap.points.length;
        node.summary = { badges: ['Warp'] };
      }
      if (mapped) node.params.mapping = sourceMap.version === 2 ? 'Parent speed curve and holds' : 'Segment source rates and holds';
      node.inputs.push(compositionPort('factor', 'Speed', 'number', 'input', { readOnly: mapped,
        contract: { typeLabel: 'Speed factor', description: 'Signed source seconds per timeline second.',
          formats: ['number'], constraints: ['unit: factor'] } }));
    } else {
      node.params = { ...node.params, startTime: clip.startTime, duration: clip.duration, trackId: clip.trackId };
      node.inputs.push(compositionPort('place', 'Place', 'time', 'input', { readOnly: mapped }));
    }
    node.description = mapped
      ? 'Read-only TransitionSourceMap: source media time, parent animation time, and local recipe time. Edit the parent clip or transition duration/offset.'
      : 'Projection of existing timeline timing; changes use the owning timeline action.';
    if (mapped) node.summary = { badges: ['Read-only', `Mapped v${sourceMap.version}`] };
    return node;
  });
  graph.nodes.push(...nodes);
  group.nodeIds.push(...nodes.map(node => node.id));
  graph.edges.push(
    compositionEdge(nodes[0].id, 'clip', nodes[1].id, 'clip', 'clip'),
    compositionEdge(nodes[1].id, 'clip', nodes[2].id, 'clip', 'clip'),
    compositionEdge(nodes[2].id, 'clip', reference.id, 'source', 'clip'),
  );
  return { nodeId: nodes[0].id, portId: 'clip' };
}
