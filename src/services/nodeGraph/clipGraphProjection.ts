import {
  buildClipColorNodeGraph,
  buildClipNodeGraphDocument,
  clipSupportsColorGraph,
  getClipColorGraphId,
  getNodeGraphDocumentGraph,
  getNodeGraphView,
} from './clipGraphDocument';
export {
  addClipCustomNodeDefinition,
  createClipAICustomNodeDefinition,
  hideClipBuiltInNode,
  removeClipCustomNodeDefinition,
  showClipBuiltInNode,
  updateClipCustomNodeDefinition,
} from './clipGraphProjectionCustomNodes';
import type { TimelineClip, TimelineTrack } from './clipGraphProjectionDomain';
export type { ClipNodeGraphBuildOptions } from './clipGraphProjectionShared';
import type { ClipNodeGraphBuildOptions } from './clipGraphProjectionShared';
export {
  cloneClipNodeGraph,
  connectClipNodeGraphPorts,
  createClipNodeGraphState,
  disconnectClipNodeGraphEdge,
  reconcileClipNodeGraphState,
  remapClipNodeGraphEffectIds,
  updateClipNodeGraphLayout,
} from './clipGraphProjectionState';
import type { NodeGraph } from './types';
export {
  buildClipFlockNodeGraph,
  clipSupportsFlockGraph,
  getClipFlockGraphId,
  getFlockPortType,
  getNodeGraphPortCompatibilityKey,
} from './clipGraphFlockProjection';

export {
  buildClipColorNodeGraph,
  buildClipNodeGraphDocument,
  clipSupportsColorGraph,
  getClipColorGraphId,
  getNodeGraphDocumentGraph,
  getNodeGraphView,
};

export function buildClipNodeGraph(
  clip: TimelineClip,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): NodeGraph {
  return getNodeGraphView(buildClipNodeGraphDocument(clip, track, options), 'general');
}
