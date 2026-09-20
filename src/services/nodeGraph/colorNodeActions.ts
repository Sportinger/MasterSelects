import { useTimelineStore } from '../../stores/timeline';
import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { startBatch, endBatch } from '../../stores/historyStore';
import { buildClipColorNodeGraph } from './clipGraphDocument';
import { checkGraphConnection } from './graphConnections';
import type { NodeGraphConnectionRequest, NodeGraphLayout } from '../../types/nodeGraph';
import { getActiveColorVersion, type ColorNodeType } from '../../types/colorCorrection';
import type { TimelineClip } from '../../types/timeline';

/** Color's saved versions are one owner, whether edited in Color or Nodes. */
export function createColorNodeActions(clipId: string) {
  const edit = (label: string, action: (state: ReturnType<typeof read>, clip: TimelineClip) => void) => {
    assertExclusiveTimelineMutationAllowed();
    const state = read(), clip = state.clips.find(candidate => candidate.id === clipId);
    if (!clip || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) throw new Error('The clip is locked or exporting.');
    const batch = startBatch(label);
    try { action(state, clip); } finally { if (batch.opened) endBatch(); }
  };
  return {
    addNode: (type: ColorNodeType) => {
      let id = '';
      edit('Add color node', state => { id = state.addColorNode(clipId, type); });
      return id;
    },
    moveNode: (id: string, layout: NodeGraphLayout) => edit('Move color node', state => state.moveColorNode(clipId, id, layout)),
    connectPorts: (connection: NodeGraphConnectionRequest) => edit('Connect color ports', (state, clip) => {
      const graph = buildClipColorNodeGraph(clip);
      if (!graph) throw new Error('Color graph unavailable.');
      const check = checkGraphConnection(graph, connection);
      if (!check.ok) { if (check.code === 'duplicate-edge') return; throw new Error(check.message); }
      state.connectColorNodes(clipId, connection.fromNodeId, connection.toNodeId, connection.fromPortId, connection.toPortId);
    }),
    disconnectEdge: (id: string) => edit('Disconnect color link', state => state.removeColorEdge(clipId, id)),
    deleteNode: (id: string) => edit('Delete color node', state => state.removeColorNode(clipId, id)),
    toggleBypass: (id: string) => edit('Toggle color node bypass', (state, clip) => {
      const node = clip.colorCorrection && getActiveColorVersion(clip.colorCorrection)?.nodes.find(candidate => candidate.id === id);
      if (node && !['input', 'output', 'source', 'alpha-output'].includes(node.type)) state.setColorNodeEnabled(clipId, id, node.enabled === false);
    }),
  };
}

function read() { return readTimelineRuntimeState(useTimelineStore); }
