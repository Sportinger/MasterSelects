import { buildClipNodeGraphView } from './clipGraphProjectionBuildView';
export {
  addClipCustomNodeDefinition,
  createClipAICustomNodeDefinition,
  hideClipBuiltInNode,
  removeClipCustomNodeDefinition,
  showClipBuiltInNode,
  updateClipCustomNodeDefinition,
} from './clipGraphProjectionCustomNodes';
import type { TimelineClip, TimelineTrack } from './clipGraphProjectionDomain';
import { applyClipNodeGraphState } from './clipGraphProjectionState';
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

export function buildClipNodeGraph(
  clip: TimelineClip,
  track?: TimelineTrack,
  options: ClipNodeGraphBuildOptions = {},
): NodeGraph {
  return applyClipNodeGraphState(buildClipNodeGraphView(clip, track, options), clip.nodeGraph);
}
