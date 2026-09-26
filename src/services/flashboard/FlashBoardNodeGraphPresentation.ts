import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { buildClipNodeGraphDocument } from '../nodeGraph';
import { buildUnifiedClipGraph } from '../nodeGraph/unifiedClipGraph';
import { NODE_GRAPH_STREAM_TOOLS } from '../nodeGraph/nodeGraphStream';
import { Logger } from '../logger';
import { handleFocusNodeGraph } from '../aiTools/handlers/focusNodeGraph';
import type { FlashBoardExecutedToolCall } from './FlashBoardChatTypes';

const log = Logger.create('AgentNodePresentation');
const graphEditTools = new Set<string>(NODE_GRAPH_STREAM_TOOLS.filter(tool => !['addEffect', 'updateEffect', 'removeEffect', 'addKeyframe'].includes(tool)));
const nodeTools = new Set<string>([
  ...graphEditTools, 'getOperatorGraph', 'getFlockClip', 'createFlockClip',
  'applyFlockPreset', 'exposeFlockParam', 'unexposeFlockParam',
]);

/** Inner node IDs a graph call edits; an added compound is used as a whole, not worked inside. */
function touchedNodeIds(args: Record<string, unknown>, data?: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const add = (value: unknown) => { if (typeof value === 'string' && value) ids.add(value.replace(/\./g, '-')); };
  if (args.action !== 'add') { add(args.nodeId); add(data?.nodeId); }
  add(args.fromNodeId); add(args.toNodeId);
  if (Array.isArray(args.nodeIds)) args.nodeIds.forEach(add);
  const conversion = data?.insertedConversion as Record<string, unknown> | undefined;
  add(conversion?.nodeId);
  return ids;
}

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
        const data = call.result.data as Record<string, unknown> | undefined;
        const resultClip = data?.clip as Record<string, unknown> | undefined;
        const clipId = typeof args.clipId === 'string' ? args.clipId
          : typeof data?.clipId === 'string' ? data.clipId
            : typeof resultClip?.id === 'string' ? resultClip.id : undefined;
        if (!clipId) continue;
        const effectId = typeof args.effectId === 'string' ? args.effectId
          : typeof data?.effectId === 'string' ? data.effectId : undefined;
        if (graphEditTools.has(call.toolCall.name)) this.clips.add(clipId);
        void handleFocusNodeGraph({ clipId }).then(result => {
          if (!result.success) log.warn('Could not focus agent node work', result.error);
        }).catch(error => log.warn('Could not focus agent node work', error));
        const root = effectId ? `effect:${effectId}` : call.toolCall.name.includes('Flock') ? 'flock' : undefined;
        if (graphEditTools.has(call.toolCall.name) && root) this.reveal(clipId, root, touchedNodeIds(args, data));
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

  /** Opens the graph being edited and only the nested groups (compounds, building blocks) the agent works inside. */
  private reveal(clipId: string, root: string, touched: Set<string>): void {
    this.setCollapsed(clipId, false, group => group.id === root
      || group.id.startsWith(`${root}/`) && group.nodeIds.some(id => touched.has(id.slice(id.lastIndexOf('/') + 1))));
  }

  private setCollapsed(clipId: string, collapsed: boolean, include: (group: { id: string; nodeIds: string[] }) => boolean = () => true): void {
    assertExclusiveTimelineMutationAllowed();
    const state = useTimelineStore.getState(), clip = state.clips.find(item => item.id === clipId);
    if (!clip || state.isExporting || state.tracks.find(track => track.id === clip.trackId)?.locked) return;
    const expanded = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, state.clips, [], undefined, true);
    const groups = { ...clip.nodeGraph?.groups };
    let changed = false;
    for (const group of expanded.groups ?? []) {
      if (!include(group)) continue;
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
