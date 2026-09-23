import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDockStore, FACTORY_START_LAYOUT_ID } from '../../src/stores/dockStore';
import { findPanelAndGroup, findTabGroupById } from '../../src/stores/dockStore/layoutTree';
import { useNodeWorkspaceNavigation } from '../../src/services/nodeGraph/nodeWorkspaceNavigation';
import { handleFocusNodeGraph } from '../../src/services/aiTools/handlers/focusNodeGraph';

const timeline = vi.hoisted(() => ({ clips: [{ id: 'clip-a' }], selectClips: vi.fn() }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => timeline } }));

describe('focusNodeGraph', () => {
  beforeEach(() => {
    timeline.selectClips.mockClear();
    useDockStore.setState({ activeSavedLayoutId: null, browserWindowPanels: [], maximizedPanelId: null, layout: {
      root: { kind: 'split', id: 'split', direction: 'horizontal', ratio: 0.5, children: [
        { kind: 'tab-group', id: 'chat', activeIndex: 0, panels: [
          { id: 'chat-panel', type: 'ai-studio', title: 'AI Studio' },
          { id: 'nodes-panel', type: 'node-workspace', title: 'Nodes' },
        ] },
        { kind: 'tab-group', id: 'preview', activeIndex: 0, panels: [{ id: 'preview-panel', type: 'preview', title: 'Preview' }] },
      ] }, floatingPanels: [],
    } });
  });
  it('moves Nodes next to Preview, keeps chat active and selects the owner; repeat is idempotent', async () => {
    for (let i = 0; i < 2; i++) {
      expect((await handleFocusNodeGraph({ clipId: 'clip-a' })).success).toBe(true);
      const root = useDockStore.getState().layout.root;
      const preview = findTabGroupById(root, 'preview')!;
      expect(preview.panels.map(p => p.type)).toEqual(['preview', 'node-workspace']);
      expect(preview.panels[preview.activeIndex].type).toBe('node-workspace');
      expect(findTabGroupById(root, 'chat')?.panels[0].type).toBe('ai-studio');
      expect(findPanelAndGroup(root, 'node-workspace')?.groupId).toBe('preview');
      expect(preview.panels.find(p => p.type === 'node-workspace')?.data).toMatchObject({ nodeClipId: 'clip-a' });
    }
    expect(timeline.selectClips).toHaveBeenLastCalledWith(['clip-a']);
    expect(useNodeWorkspaceNavigation.getState().request).toMatchObject({ clipId: 'clip-a', theme: 'general', panelId: 'nodes-panel' });
  });
  it('creates a missing Nodes tab in the Preview group', async () => {
    useDockStore.getState().closePanel('nodes-panel', 'chat');
    expect((await handleFocusNodeGraph({ clipId: 'clip-a' })).success).toBe(true);
    expect(findPanelAndGroup(useDockStore.getState().layout.root, 'node-workspace')?.groupId).toBe('preview');
  });
  it('fails without changing selection for missing clips or a Start layout', async () => {
    expect((await handleFocusNodeGraph({ clipId: 'missing' })).success).toBe(false);
    useDockStore.setState({ activeSavedLayoutId: FACTORY_START_LAYOUT_ID });
    expect((await handleFocusNodeGraph({ clipId: 'clip-a' })).success).toBe(false);
    expect(timeline.selectClips).not.toHaveBeenCalled();
  });
  it('reuses an existing pinned Nodes tab for the working clip and brings it forward', async () => {
    useDockStore.getState().updatePanelData('nodes-panel', { nodeClipId: 'clip-other' });
    const detached = { id: 'window', returnGroupId: null, panel: { id: 'detached', type: 'node-workspace' as const, title: 'Nodes' } };
    useDockStore.setState({ browserWindowPanels: [detached], maximizedPanelId: 'chat-panel' });
    expect((await handleFocusNodeGraph({ clipId: 'clip-a' })).success).toBe(true);
    const state = useDockStore.getState();
    expect(findTabGroupById(state.layout.root, 'chat')?.panels.map(p => p.id)).toEqual(['chat-panel']);
    const preview = findTabGroupById(state.layout.root, 'preview')!;
    expect(preview.panels.map(p => p.id)).toEqual(['preview-panel', 'nodes-panel']);
    expect(preview.panels[preview.activeIndex].id).toBe('nodes-panel');
    expect(preview.panels[preview.activeIndex].data).toMatchObject({ nodeClipId: 'clip-a' });
    expect(state.maximizedPanelId).toBeNull();
    expect(state.browserWindowPanels).toEqual([detached]);
  });
  it('prefers an already matching Nodes tab over one pinned beside Preview', async () => {
    useDockStore.getState().updatePanelData('nodes-panel', { nodeClipId: 'clip-a' });
    useDockStore.getState().addPanelTypeToGroup('node-workspace', 'preview');
    const before = findTabGroupById(useDockStore.getState().layout.root, 'preview')!;
    const other = before.panels.find(panel => panel.type === 'node-workspace')!;
    useDockStore.getState().updatePanelData(other.id, { nodeClipId: 'clip-other' });
    expect((await handleFocusNodeGraph({ clipId: 'clip-a' })).success).toBe(true);
    const preview = findTabGroupById(useDockStore.getState().layout.root, 'preview')!;
    expect(preview.panels[preview.activeIndex].id).toBe('nodes-panel');
    expect(preview.panels.find(panel => panel.id === other.id)?.data).toMatchObject({ nodeClipId: 'clip-other' });
  });
  it('creates a Preview group partner when Preview was closed', async () => {
    useDockStore.getState().closePanel('preview-panel', 'preview');
    expect((await handleFocusNodeGraph({ clipId: 'clip-a' })).success).toBe(true);
    const root = useDockStore.getState().layout.root;
    const preview = findPanelAndGroup(root, 'preview');
    expect(preview).not.toBeNull();
    const group = findTabGroupById(root, preview!.groupId)!;
    expect(group.panels.map(panel => panel.type)).toEqual(expect.arrayContaining(['preview', 'node-workspace']));
    expect(group.panels[group.activeIndex].type).toBe('node-workspace');
  });
});
