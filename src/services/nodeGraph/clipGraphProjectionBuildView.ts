import { resolveLinkedAudioClip } from './clipGraphProjectionAudio';
import type { TimelineClip, TimelineTrack } from './clipGraphProjectionDomain';
import { edge } from './clipGraphProjectionGraph';
import {
  appendAudioProcessingNodes,
  appendProcessingNode,
  createColorNode,
  createCustomNode,
  createEffectNode,
  createMaskNode,
  createOutputNode,
  createSourceNode,
  createTransformNode,
  customNodeLaneY,
  hasActiveMasks,
  hasColorGraph,
  hasForcedBuiltInNode,
  isAudioEffect,
  isMainSignalCustomNode,
  isVisualSource,
  sourceOutputType,
  transformIsDefault,
} from './clipGraphProjectionNodeFactory';
import {
  AUDIO_LANE_Y,
  MAIN_LANE_Y,
  type ClipNodeGraphBuildOptions,
  type NodeGraphChainHead,
} from './clipGraphProjectionShared';
import type { ClipCustomNodeDefinition, NodeGraph, NodeGraphEdge, NodeGraphNode } from './types';

export function buildClipNodeGraphView(
  clip: TimelineClip,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): NodeGraph {
  const nodes: NodeGraphNode[] = [];
  const edges: NodeGraphEdge[] = [];
  const sourceNode = createSourceNode(clip, track, options);
  nodes.push(sourceNode);

  const primarySignal = sourceOutputType(clip);
  const audioClip = resolveLinkedAudioClip(clip, options.linkedClip);
  const hasAudioOutput = Boolean(audioClip);
  let depth = 1;
  let chain: NodeGraphChainHead = { nodeId: sourceNode.id, portId: primarySignal };

  if (isVisualSource(clip) && (!transformIsDefault(clip) || hasForcedBuiltInNode(clip, 'transform'))) {
    chain = appendProcessingNode(
      nodes,
      edges,
      chain.nodeId,
      chain.portId,
      createTransformNode(depth, primarySignal, clip),
      primarySignal,
    );
    depth += 1;
  }

  if (isVisualSource(clip) && (hasActiveMasks(clip) || hasForcedBuiltInNode(clip, 'mask'))) {
    chain = appendProcessingNode(
      nodes,
      edges,
      chain.nodeId,
      chain.portId,
      createMaskNode(depth, primarySignal, clip),
      primarySignal,
    );
    depth += 1;
  }

  if (isVisualSource(clip) && (hasColorGraph(clip) || hasForcedBuiltInNode(clip, 'color'))) {
    chain = appendProcessingNode(
      nodes,
      edges,
      chain.nodeId,
      chain.portId,
      createColorNode(depth, primarySignal, clip),
      primarySignal,
    );
    depth += 1;
  }

  for (const effect of clip.effects.filter((candidate) => !isAudioEffect(candidate))) {
    chain = appendProcessingNode(
      nodes,
      edges,
      chain.nodeId,
      chain.portId,
      createEffectNode(effect, depth, MAIN_LANE_Y, primarySignal),
      primarySignal,
    );
    depth += 1;
  }

  if (primarySignal === 'audio' && audioClip) {
    const audioResult = appendAudioProcessingNodes(nodes, edges, chain, audioClip, depth, MAIN_LANE_Y);
    chain = audioResult.chain;
    depth = audioResult.depth;
  }

  const standaloneCustomNodes: ClipCustomNodeDefinition[] = [];
  for (const customNode of clip.nodeGraph?.customNodes ?? []) {
    if (!isMainSignalCustomNode(customNode, primarySignal)) {
      standaloneCustomNodes.push(customNode);
      continue;
    }

    chain = appendProcessingNode(
      nodes,
      edges,
      chain.nodeId,
      chain.portId,
      createCustomNode(customNode, depth),
      primarySignal,
    );
    depth += 1;
  }

  const outputNode = createOutputNode(depth, clip, primarySignal, hasAudioOutput && primarySignal !== 'audio');
  nodes.push(outputNode);
  edges.push(edge(chain.nodeId, chain.portId, outputNode.id, 'input', primarySignal));
  edges.push(edge(sourceNode.id, 'time', outputNode.id, 'time', 'time'));
  edges.push(edge(sourceNode.id, 'metadata', outputNode.id, 'metadata', 'metadata'));

  standaloneCustomNodes.forEach((customNode, index) => {
    nodes.push(createCustomNode(customNode, depth + index + 1, customNodeLaneY(customNode)));
  });

  if (audioClip && primarySignal !== 'audio') {
    const audioResult = appendAudioProcessingNodes(
      nodes,
      edges,
      { nodeId: sourceNode.id, portId: 'audio' },
      audioClip,
      1,
      AUDIO_LANE_Y,
    );
    edges.push(edge(audioResult.chain.nodeId, audioResult.chain.portId, outputNode.id, 'audio', 'audio'));
  }

  return {
    id: `clip-graph:${clip.id}`,
    owner: {
      kind: 'clip',
      id: clip.id,
      name: clip.name,
    },
    nodes,
    edges,
  };
}
