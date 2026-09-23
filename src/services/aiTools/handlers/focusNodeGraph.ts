import { useTimelineStore } from '../../../stores/timeline';
import { FACTORY_START_LAYOUT_ID, useDockStore } from '../../../stores/dockStore';
import { findPanelAndGroup, findTabGroupById } from '../../../stores/dockStore/layoutTree';
import type { DockNode, DockPanel, NodeWorkspacePanelData } from '../../../types/dock';
import { requestNodeWorkspaceView } from '../../nodeGraph/nodeWorkspaceNavigation';
import type { ToolResult } from '../types';

function availablePanel(panel: DockPanel, clipId: string) {
  const assigned = (panel.data as NodeWorkspacePanelData | undefined)?.nodeClipId;
  return panel.type === 'node-workspace' && (!assigned || assigned === clipId);
}
function findAvailable(node: DockNode, clipId: string): { panel: DockPanel; groupId: string } | undefined {
  if (node.kind === 'tab-group') {
    const panel = node.panels.find(panel => availablePanel(panel, clipId));
    return panel ? { panel, groupId: node.id } : undefined;
  }
  return findAvailable(node.children[0], clipId) ?? findAvailable(node.children[1], clipId);
}

/** Select the graph owner and reveal Nodes alongside Preview, keeping chat visible. */
export async function handleFocusNodeGraph(args: Record<string, unknown>): Promise<ToolResult> {
  if (Object.keys(args).some(key => key !== 'clipId') || typeof args.clipId !== 'string' || !args.clipId || args.clipId.length > 200) {
    return { success: false, error: 'A clipId of 1..200 characters is required.' };
  }
  const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === args.clipId);
  if (!clip) return { success: false, error: 'Clip not found in the active timeline.' };
  const dock = useDockStore.getState();
  if (dock.activeSavedLayoutId === FACTORY_START_LAYOUT_ID) {
    return { success: false, error: 'Open the editor first to show a node graph.' };
  }
  const preview = findPanelAndGroup(dock.layout.root, 'preview');
  if (!preview) return { success: false, error: 'A docked Preview panel is required to place Nodes beside it.' };
  const target = { groupId: preview.groupId, position: 'center' as const };
  const previewGroup = findTabGroupById(dock.layout.root, preview.groupId)!;
  const nearby = previewGroup.panels.find(panel => availablePanel(panel, clip.id));
  const nodes = nearby ? { panel: nearby, groupId: preview.groupId } : findAvailable(dock.layout.root, clip.id);
  const floating = dock.layout.floatingPanels.find(p => availablePanel(p.panel, clip.id));
  if (nodes && nodes.groupId !== preview.groupId) dock.movePanel(nodes.panel.id, nodes.groupId, target);
  else if (!nodes && floating) dock.dockFloatingPanel(floating.id, target);
  else if (!nodes) dock.addPanelTypeToGroup('node-workspace', preview.groupId);
  const group = findTabGroupById(useDockStore.getState().layout.root, preview.groupId)!;
  const panel = group.panels.find(candidate => availablePanel(candidate, clip.id));
  if (!panel) return { success: false, error: 'Could not create the clip-bound Nodes panel.' };
  useDockStore.getState().updatePanelData(panel.id, { nodeClipId: clip.id });
  useTimelineStore.getState().selectClips([clip.id]);
  requestNodeWorkspaceView(clip.id, 'general', panel.id);
  useDockStore.getState().setActiveTab(preview.groupId, group.panels.findIndex(candidate => candidate.id === panel.id));
  return { success: true, data: { clipId: clip.id, selectedClipIds: [clip.id], panel: 'node-workspace', panelId: panel.id, pinnedClipId: clip.id, groupId: preview.groupId, view: 'general' } };
}
