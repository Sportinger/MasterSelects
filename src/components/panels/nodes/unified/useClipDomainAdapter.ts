import { useMemo } from 'react';
import type { NodeGraphConnectionRequest, NodeGraphLayout } from '../../../../types/nodeGraph';
import { useTimelineStore } from '../../../../stores/timeline';
import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { canDeleteNodeFromClip } from '../workspace/nodeWorkspaceUtils';
import type { NodeGraphClipSubject } from '../useNodeGraphSubject';

export function clipWorkspaceBatch(label: string, run: () => void) {
  const batch = startBatch(label);
  try { run(); } finally { if (batch.opened) endBatch(); }
}

/** All writes resolve the current clip; a composition id is never accepted here. */
export function useClipDomainAdapter(subject: NodeGraphClipSubject | null, afterDelete: (ids: string[]) => void) {
  return useMemo(() => {
    if (!subject) return null;
    const clipId = subject.id;
    const current = () => {
      const state = readTimelineRuntimeState(useTimelineStore);
      const clip = state.clips.find(candidate => candidate.id === clipId);
      if (!clip || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) return null;
      return { state, clip };
    };
    return {
      moveNode: (nodeId: string, layout: NodeGraphLayout) => current()?.state.moveClipNodeGraphNode(clipId, nodeId, layout),
      connectPorts: (connection: NodeGraphConnectionRequest) => clipWorkspaceBatch('Connect node ports', () => current()?.state.connectClipNodeGraphPorts(clipId, connection)),
      disconnectEdge: (edgeId: string) => clipWorkspaceBatch('Disconnect node link', () => current()?.state.disconnectClipNodeGraphEdge(clipId, edgeId)),
      deleteNode: (nodeId: string) => {
        const context = current();
        const node = subject.graph.nodes.find(candidate => candidate.id === nodeId);
        if (!context || !canDeleteNodeFromClip(context.clip, node)) return;
        clipWorkspaceBatch('Delete node', () => context.state.removeClipNodeGraphNode(clipId, nodeId));
        afterDelete([nodeId]);
      },
      toggleBypass: (nodeId: string) => {
        const context = current(), node = subject.graph.nodes.find(candidate => candidate.id === nodeId);
        if (!context || !node) return;
        const targetClipId = typeof node.params?.targetClipId === 'string' ? node.params.targetClipId : clipId;
        clipWorkspaceBatch('Toggle node bypass', () => {
          if (node.kind === 'effect' && nodeId.startsWith('effect-')) {
            const effectId = nodeId.slice(7), target = context.state.clips.find(clip => clip.id === targetClipId);
            context.state.setClipEffectEnabled(targetClipId, effectId, !target?.effects.find(effect => effect.id === effectId)?.enabled);
          } else if (node.binding?.kind === 'clip-audio-effect-instance') {
            context.state.setClipAudioEffectInstanceEnabled(targetClipId, node.binding.effectId, node.params?.enabled === false);
          } else if (node.kind === 'custom') {
            context.state.updateClipAICustomNode(clipId, nodeId, { bypassed: node.params?.bypassed !== true });
          }
        });
      },
      supportsAddMenu: true, supportsMultiSelection: false, layoutScaleX: 1,
    };
  }, [subject, afterDelete]);
}
