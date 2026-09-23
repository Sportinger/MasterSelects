import { useTimelineStore } from '../../../stores/timeline';
import { FACTORY_START_LAYOUT_ID, useDockStore } from '../../../stores/dockStore';
import { findFirstTabGroup, findPanelAndGroup, findTabGroupById } from '../../../stores/dockStore/layoutTree';
import type { DockNode, DockPanel, NodeWorkspacePanelData } from '../../../types/dock';
import { requestNodeWorkspaceView } from '../../nodeGraph/nodeWorkspaceNavigation';
import type { ToolResult } from '../types';

function assignedClip(panel: DockPanel): string | undefined {
  return (panel.data as NodeWorkspacePanelData | undefined)?.nodeClipId ?? undefined;
}
function preferredPanel(panels: DockPanel[], clipId: string): DockPanel | undefined {
  const nodes = panels.filter(panel => panel.type === 'node-workspace');
  return nodes.find(panel => assignedClip(panel) === clipId)
    ?? nodes.find(panel => !assignedClip(panel))
    ?? nodes[0];
}
function findDockedNodes(node: DockNode): { panel: DockPanel; groupId: string }[] {
  if (node.kind === 'tab-group') {
    return node.panels.filter(panel => panel.type === 'node-workspace')
      .map(panel => ({ panel, groupId: node.id }));
  }
  return [...findDockedNodes(node.children[0]), ...findDockedNodes(node.children[1])];
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
  let preview = findPanelAndGroup(dock.layout.root, 'preview');
  if (!preview) {
    const group = findFirstTabGroup(dock.layout.root);
    if (!group) return { success: false, error: 'An editor panel group is required to show Preview and Nodes.' };
    dock.addPanelTypeToGroup('preview', group.id);
    preview = findPanelAndGroup(useDockStore.getState().layout.root, 'preview');
    if (!preview) return { success: false, error: 'Could not create a docked Preview panel.' };
  }
  const target = { groupId: preview.groupId, position: 'center' as const };
  const current = useDockStore.getState();
  const docked = findDockedNodes(current.layout.root);
  const nodes = docked.find(item => item.groupId === preview.groupId && assignedClip(item.panel) === clip.id)
    ?? docked.find(item => assignedClip(item.panel) === clip.id)
    ?? docked.find(item => item.groupId === preview.groupId && !assignedClip(item.panel))
    ?? docked.find(item => !assignedClip(item.panel))
    ?? docked.find(item => item.groupId === preview.groupId)
    ?? docked[0];
  const floatingNodes = dock.layout.floatingPanels.filter(p => p.panel.type === 'node-workspace');
  const floating = floatingNodes.find(p => assignedClip(p.panel) === clip.id)
    ?? floatingNodes.find(p => !assignedClip(p.panel))
    ?? floatingNodes[0];
  if (nodes && nodes.groupId !== preview.groupId) dock.movePanel(nodes.panel.id, nodes.groupId, target);
  else if (!nodes && floating) dock.dockFloatingPanel(floating.id, target);
  else if (!nodes) dock.addPanelTypeToGroup('node-workspace', preview.groupId);
  const group = findTabGroupById(useDockStore.getState().layout.root, preview.groupId)!;
  const panel = preferredPanel(group.panels, clip.id);
  if (!panel) return { success: false, error: 'Could not create the clip-bound Nodes panel.' };
  useDockStore.getState().updatePanelData(panel.id, { nodeClipId: clip.id });
  useTimelineStore.getState().selectClips([clip.id]);
  requestNodeWorkspaceView(clip.id, 'general', panel.id);
  useDockStore.getState().setMaximizedPanel(null);
  useDockStore.getState().setActiveTab(preview.groupId, group.panels.findIndex(candidate => candidate.id === panel.id));
  return { success: true, data: { clipId: clip.id, selectedClipIds: [clip.id], panel: 'node-workspace', panelId: panel.id, pinnedClipId: clip.id, groupId: preview.groupId, view: 'general' } };
}
