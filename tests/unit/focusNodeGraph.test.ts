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
    useDockStore.setState({ activeSavedLayoutId: null, browserWindowPanels: [], layout: {
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
  it('preserves another pinned graph and detached windows while opening its own panel', async () => {
    useDockStore.getState().updatePanelData('nodes-panel', { nodeClipId: 'clip-other' });
    const detached = { id: 'window', returnGroupId: null, panel: { id: 'detached', type: 'node-workspace' as const, title: 'Nodes' } };
    useDockStore.setState({ browserWindowPanels: [detached] });
    expect((await handleFocusNodeGraph({ clipId: 'clip-a' })).success).toBe(true);
    const state = useDockStore.getState();
    expect(findTabGroupById(state.layout.root, 'chat')?.panels.find(p => p.id === 'nodes-panel')?.data).toMatchObject({ nodeClipId: 'clip-other' });
    expect(findTabGroupById(state.layout.root, 'preview')?.panels.find(p => p.type === 'node-workspace')?.data).toMatchObject({ nodeClipId: 'clip-a' });
    expect(state.browserWindowPanels).toEqual([detached]);
  });
});
