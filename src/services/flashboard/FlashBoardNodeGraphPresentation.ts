import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { buildClipNodeGraphDocument } from '../nodeGraph';
import { buildUnifiedClipGraph } from '../nodeGraph/unifiedClipGraph';
import { NODE_GRAPH_STREAM_TOOLS } from '../nodeGraph/nodeGraphStream';
import { Logger } from '../logger';
import type { FlashBoardExecutedToolCall } from './FlashBoardChatTypes';

const log = Logger.create('AgentNodePresentation');
const nodeTools = new Set<string>([...NODE_GRAPH_STREAM_TOOLS, 'getOperatorGraph']);

/** Browser presentation only: show actual tool work, then fold the finished graph. */
export class FlashBoardNodeGraphPresentation {
  private clips = new Set<string>();
  private failed = false;
  private readonly enabled: boolean;
  constructor(enabled = true) { this.enabled = enabled; }

  observe(calls: FlashBoardExecutedToolCall[]): void {
    if (!this.enabled) return;
    for (const call of calls) {
      if (!call.result.success) { this.failed = true; continue; }
      if (!nodeTools.has(call.toolCall.name)) continue;
      try {
        const args = JSON.parse(call.toolCall.arguments) as Record<string, unknown>;
        if (typeof args.clipId !== 'string') continue;
        const data = call.result.data as Record<string, unknown> | undefined;
        const effectId = typeof args.effectId === 'string' ? args.effectId
          : typeof data?.effectId === 'string' ? data.effectId : undefined;
        this.clips.add(args.clipId);
        const root = effectId ? `effect:${effectId}` : call.toolCall.name.includes('Flock') ? 'flock' : undefined;
        this.setCollapsed(args.clipId, false, root);
      } catch (error) { log.warn('Could not reveal agent node work', error); }
    }
  }

  complete(): void {
    if (!this.enabled || this.failed) return;
    for (const clipId of this.clips) {
      try { this.setCollapsed(clipId, true); }
      catch (error) { log.warn('Could not fold completed agent node work', error); }
    }
  }

  private setCollapsed(clipId: string, collapsed: boolean, root?: string): void {
    assertExclusiveTimelineMutationAllowed();
    const state = useTimelineStore.getState(), clip = state.clips.find(item => item.id === clipId);
    if (!clip || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) return;
    const expanded = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, state.clips, [], undefined, true);
    const groups = { ...clip.nodeGraph?.groups };
    let changed = false;
    for (const group of expanded.groups ?? []) {
      if (root && group.id !== root && !group.id.startsWith(`${root}/`)) continue;
      if (groups[group.id]?.collapsed === collapsed) continue;
      groups[group.id] = { ...groups[group.id], collapsed };
      changed = true;
    }
    if (!changed) return;
    const batch = startBatch(collapsed ? 'Collapse completed node graph' : 'Show agent node work');
    try { state.updateClip(clip.id, { nodeGraph: { version: 1, nodes: [], ...clip.nodeGraph, groups } }); }
    finally { if (batch.opened) endBatch(); }
  }
}
