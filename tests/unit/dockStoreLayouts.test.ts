import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/stores/settingsStore');

import {
  FACTORY_3D_EDIT_LAYOUT_ID,
  FACTORY_AUDIO_EDIT_LAYOUT_ID,
  FACTORY_COLOR_LAYOUT_ID,
  FACTORY_LIVE_LAYOUT_ID,
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  getFactoryDockLayouts,
  useDockStore,
} from '../../src/stores/dockStore';
import { resolveMobileLayoutForComposition } from '../../src/components/dock/mobileLayoutOrientation';
import { mergeFactoryDockLayouts } from '../../src/stores/dockStore/layoutPersistence';
import { DEFAULT_TRACKS, useTimelineStore } from '../../src/stores/timeline';
import { useSettingsStore } from '../../src/stores/settingsStore';
import type { DockLayout, DockNode, DockTabGroup, PanelType } from '../../src/types/dock';
import { createMockClip } from '../helpers/mockData';

function findTabGroup(node: DockNode, groupId: string): DockTabGroup | null {
  if (node.kind === 'tab-group') {
    return node.id === groupId ? node : null;
  }
  return findTabGroup(node.children[0], groupId) ?? findTabGroup(node.children[1], groupId);
}

function panelTypes(group: DockTabGroup | null): PanelType[] {
  return group?.panels.map((panel) => panel.type) ?? [];
}

describe('dock store saved layouts', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ theme: 'dark' });
    useDockStore.setState({
      browserWindowPanels: [],
      savedLayouts: getFactoryDockLayouts(),
      defaultSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      activeSavedLayoutId: null,
    });
    useTimelineStore.setState({
      clips: [],
      tracks: DEFAULT_TRACKS.map((track) => ({ ...track })),
      playheadPosition: 0,
      audioDisplayMode: 'detailed',
      audioLayerAdvancedMode: true,
      audioFocusMode: false,
      trackFocusMode: 'balanced',
    });
    useDockStore.getState().resetLayout();
  });

  it('uses the hardcoded video editing layout as the default', () => {
    const layout = useDockStore.getState().layout;
    expect(layout.floatingPanels).toEqual([]);
    expect(layout.root.kind).toBe('split');
    if (layout.root.kind !== 'split') return;

    expect(layout.root.direction).toBe('vertical');
    expect(layout.root.ratio).toBeCloseTo(0.6698039215686274);

    const top = layout.root.children[0];
    expect(top.kind).toBe('split');
    if (top.kind !== 'split') return;

    expect(top.direction).toBe('horizontal');
    expect(top.ratio).toBeCloseTo(0.29449423815621);

    const centerRight = top.children[1];
    expect(centerRight.kind).toBe('split');
    if (centerRight.kind !== 'split') return;

    expect(centerRight.direction).toBe('horizontal');
    expect(centerRight.ratio).toBeCloseTo(0.7109300593133233);

    const leftGroup = findTabGroup(layout.root, 'left-group');
    const previewGroup = findTabGroup(layout.root, 'preview-group');
    const rightGroup = findTabGroup(layout.root, 'right-group');
    const timelineGroup = findTabGroup(layout.root, 'timeline-group');

    expect(panelTypes(leftGroup)).toEqual(['media', 'ai-studio', 'transitions']);
    expect(panelTypes(previewGroup)).toEqual(['preview']);
    expect(panelTypes(rightGroup)).toEqual(['clip-properties', 'export', 'color-controls']);
    expect(leftGroup?.panels[1]?.title).toBe('AI Studio');
    expect(rightGroup?.panels[2]?.title).toBe('Coloring');
    expect(rightGroup?.activeIndex).toBe(1);
    expect(panelTypes(timelineGroup)).toEqual(['timeline']);

    const timeline = useTimelineStore.getState();
    expect(timeline.audioFocusMode).toBe(false);
    expect(timeline.trackFocusMode).toBe('balanced');
    expect(timeline.tracks.find((track) => track.type === 'video')?.height).toBe(70);
    expect(timeline.tracks.find((track) => track.type === 'audio')?.height).toBe(48);
    expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
  });

  it('uses the focused AI, assets, viewer, and timeline structure for Medium', () => {
    useDockStore.getState().loadSavedLayout(FACTORY_MEDIUM_EDIT_LAYOUT_ID);

    const state = useDockStore.getState();
    expect(state.activeSavedLayoutId).toBe(FACTORY_MEDIUM_EDIT_LAYOUT_ID);
    expect(state.layout.root).toMatchObject({
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.305,
    });
    expect(panelTypes(findTabGroup(state.layout.root, 'medium-ai-group'))).toEqual([
      'ai-studio',
    ]);
    expect(panelTypes(findTabGroup(state.layout.root, 'medium-assets-group'))).toEqual([
      'media',
      'discover',
    ]);
    expect(panelTypes(findTabGroup(state.layout.root, 'medium-preview-group'))).toEqual([
      'preview',
    ]);
    expect(panelTypes(findTabGroup(state.layout.root, 'medium-timeline-group'))).toEqual([
      'timeline',
    ]);
    expect(useTimelineStore.getState().trackHeaderWidth).toBe(164);
  });

  it('uses the scene-focused monitor, program, analytics, and chat structure for Live', () => {
    useDockStore.getState().loadSavedLayout(FACTORY_LIVE_LAYOUT_ID);

    const state = useDockStore.getState();
    expect(state.activeSavedLayoutId).toBe(FACTORY_LIVE_LAYOUT_ID);
    expect(state.layout.root).toMatchObject({
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.846,
      children: [
        {
          kind: 'split',
          direction: 'horizontal',
          ratio: 0.279,
          children: [
            {
              kind: 'split',
              direction: 'vertical',
              ratio: 0.24,
              children: [
                { kind: 'tab-group' },
                { kind: 'split', direction: 'vertical', ratio: 0.32 },
              ],
            },
            {
              kind: 'split',
              direction: 'vertical',
              ratio: 0.468,
              children: [
                { kind: 'tab-group' },
                { kind: 'split', direction: 'vertical', ratio: 0.425 },
              ],
            },
          ],
        },
        { kind: 'tab-group' },
      ],
    });

    const upperPreview = findTabGroup(state.layout.root, 'live-preview-video-2-group');
    const lowerPreview = findTabGroup(state.layout.root, 'live-preview-video-1-group');
    const controls = findTabGroup(state.layout.root, 'live-controls-group');
    const program = findTabGroup(state.layout.root, 'preview-group');
    const analytics = findTabGroup(state.layout.root, 'live-analytics-group');
    const scenes = findTabGroup(state.layout.root, 'timeline-group');
    const chat = findTabGroup(state.layout.root, 'live-chat-group');

    expect(panelTypes(upperPreview)).toEqual(['preview']);
    expect(upperPreview?.panels[0].data).toMatchObject({
      source: { type: 'layer-index', compositionId: null, layerIndex: 0 },
    });
    expect(panelTypes(lowerPreview)).toEqual(['preview']);
    expect(lowerPreview?.panels[0].data).toMatchObject({
      source: { type: 'layer-index', compositionId: null, layerIndex: 1 },
    });
    expect(panelTypes(controls)).toEqual(['go-live', 'media', 'clip-properties']);
    expect(controls?.activeIndex).toBe(2);
    expect(panelTypes(program)).toEqual(['preview']);
    expect(program?.panels[0]).toMatchObject({
      title: 'Program',
      data: { source: { type: 'activeComp' } },
    });
    expect(panelTypes(analytics)).toEqual(['stream-analytics']);
    expect(panelTypes(scenes)).toEqual(['timeline']);
    expect(scenes?.panels[0]).toMatchObject({
      id: 'live-timeline',
      data: { timelineSurfaceMode: 'slot-grid' },
    });
    expect(panelTypes(chat)).toEqual(['stream-chat']);
  });

  it('opens Stats beside Analytics in the Live layout', () => {
    useDockStore.getState().loadSavedLayout(FACTORY_LIVE_LAYOUT_ID);
    useDockStore.getState().activatePanelType('stats');

    const analyticsGroup = findTabGroup(useDockStore.getState().layout.root, 'live-analytics-group');
    expect(panelTypes(analyticsGroup)).toEqual(['stream-analytics', 'stats']);
    expect(analyticsGroup?.panels[analyticsGroup.activeIndex]?.type).toBe('stats');
  });

  it('activates the history tab when requested from the panels menu', () => {
    const initialRightGroup = findTabGroup(useDockStore.getState().layout.root, 'right-group');
    expect(initialRightGroup?.panels[initialRightGroup.activeIndex]?.type).toBe('export');

    useDockStore.getState().activatePanelType('history');

    const rightGroup = findTabGroup(useDockStore.getState().layout.root, 'right-group');
    expect(rightGroup?.panels[rightGroup.activeIndex]?.type).toBe('history');
  });

  it('reopens and activates the history tab after it has been hidden', () => {
    useDockStore.getState().hidePanelType('history');
    expect(useDockStore.getState().isPanelTypeVisible('history')).toBe(false);

    useDockStore.getState().activatePanelType('history');

    const rightGroup = findTabGroup(useDockStore.getState().layout.root, 'right-group');
    expect(rightGroup?.panels.map((panel) => panel.type)).toContain('history');
    expect(rightGroup?.panels[rightGroup.activeIndex]?.type).toBe('history');
  });

  it('undocks a panel into a floating panel and docks it back into a tab group', () => {
    useDockStore.getState().floatPanel('export', 'right-group', { x: 120, y: 90 });

    let layout = useDockStore.getState().layout;
    let rightGroup = findTabGroup(layout.root, 'right-group');
    expect(panelTypes(rightGroup)).toEqual(['clip-properties', 'color-controls']);
    expect(layout.floatingPanels).toHaveLength(1);
    expect(layout.floatingPanels[0]).toMatchObject({
      panel: { id: 'export', type: 'export' },
      position: { x: 120, y: 90 },
    });

    useDockStore.getState().dockFloatingPanel(layout.floatingPanels[0].id, {
      groupId: 'preview-group',
      position: 'center',
      tabInsertIndex: 1,
    });

    layout = useDockStore.getState().layout;
    const previewGroup = findTabGroup(layout.root, 'preview-group');
    rightGroup = findTabGroup(layout.root, 'right-group');
    expect(layout.floatingPanels).toEqual([]);
    expect(panelTypes(previewGroup)).toEqual(['preview', 'export']);
    expect(previewGroup?.activeIndex).toBe(1);
    expect(panelTypes(rightGroup)).toEqual(['clip-properties', 'color-controls']);
  });

  it('docks a floating panel when its floating tab is dragged onto a drop target', () => {
    useDockStore.getState().floatPanel('export', 'right-group', { x: 120, y: 90 });
    const floating = useDockStore.getState().layout.floatingPanels[0];

    useDockStore.getState().startDrag(
      floating.panel,
      null,
      { x: 0, y: 0 },
      { x: 200, y: 200 },
      floating.id
    );
    useDockStore.getState().updateDrag({ x: 220, y: 220 }, {
      groupId: 'preview-group',
      position: 'center',
      tabInsertIndex: 1,
    });
    useDockStore.getState().endDrag();

    const layout = useDockStore.getState().layout;
    const previewGroup = findTabGroup(layout.root, 'preview-group');
    expect(layout.floatingPanels).toEqual([]);
    expect(panelTypes(previewGroup)).toEqual(['preview', 'export']);
    expect(useDockStore.getState().dragState.sourceFloatingId).toBeNull();
  });

  it('detaches a panel for a browser window and docks it back into the layout', () => {
    const windowPanel = useDockStore.getState().detachPanelToBrowserWindow('export', 'right-group');

    let layout = useDockStore.getState().layout;
    let rightGroup = findTabGroup(layout.root, 'right-group');
    expect(windowPanel).toMatchObject({
      panel: { id: 'export', type: 'export', title: 'Export' },
      returnGroupId: 'right-group',
    });
    expect(panelTypes(rightGroup)).toEqual(['clip-properties', 'color-controls']);
    expect(layout.floatingPanels).toEqual([]);
    expect(useDockStore.getState().browserWindowPanels).toEqual([windowPanel]);

    useDockStore.getState().updateBrowserWindowPanelSize(windowPanel!.id, { width: 913.4, height: 601.8, left: 77.6, top: 44.2 });
    expect(useDockStore.getState().browserWindowPanels[0]?.size).toEqual({ width: 913, height: 602 });
    expect(useDockStore.getState().browserWindowPanels[0]?.position).toEqual({ left: 78, top: 44 });

    useDockStore.getState().dockBrowserWindowPanel(windowPanel!.id, {
      groupId: 'preview-group',
      position: 'center',
      tabInsertIndex: 1,
    });

    layout = useDockStore.getState().layout;
    const previewGroup = findTabGroup(layout.root, 'preview-group');
    rightGroup = findTabGroup(layout.root, 'right-group');
    expect(panelTypes(previewGroup)).toEqual(['preview', 'export']);
    expect(previewGroup?.activeIndex).toBe(1);
    expect(panelTypes(rightGroup)).toEqual(['clip-properties', 'color-controls']);
    expect(useDockStore.getState().browserWindowPanels).toEqual([]);
  });

  it('docks a browser-window panel without duplicating an already visible panel id', () => {
    const existingExport = useDockStore.getState().detachPanelToBrowserWindow('export', 'right-group');
    expect(existingExport).not.toBeNull();
    useDockStore.getState().dockBrowserWindowPanel(existingExport!.id);

    useDockStore.getState().dockBrowserWindowPanel(existingExport!.id);

    const layout = useDockStore.getState().layout;
    const rightGroup = findTabGroup(layout.root, 'right-group');
    expect(panelTypes(rightGroup).filter((type) => type === 'export')).toHaveLength(1);
  });

  it('keeps browser-window panels open when hydrating a project layout', () => {
    const projectLayout = JSON.parse(JSON.stringify(useDockStore.getState().layout)) as DockLayout;
    const windowPanel = useDockStore.getState().detachPanelToBrowserWindow('export', 'right-group');

    expect(windowPanel).not.toBeNull();

    useDockStore.getState().setLayoutFromProject(projectLayout);

    const rightGroup = findTabGroup(useDockStore.getState().layout.root, 'right-group');
    expect(useDockStore.getState().browserWindowPanels).toEqual([windowPanel]);
    expect(panelTypes(rightGroup)).toEqual(['clip-properties', 'color-controls']);
  });

  it('loads the authored full-height media layout only for Resolve Video', () => {
    useSettingsStore.setState({ theme: 'resolve' });
    useDockStore.getState().loadSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID);

    const layout = useDockStore.getState().layout;
    expect(layout.root).toMatchObject({
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.335889,
    });
    expect(panelTypes(findTabGroup(layout.root, 'left-group'))).toEqual([
      'media',
      'ai-studio',
      'transitions',
    ]);
    expect(panelTypes(findTabGroup(layout.root, 'right-group'))).toEqual([
      'clip-properties',
      'color-controls',
      'export',
    ]);
    expect(findTabGroup(layout.root, 'right-group')?.panels[1]?.title).toBe('Coloring');
    expect(layout.panelZoom['clip-properties']).toBe(1);

    useSettingsStore.setState({ theme: 'dark' });
    useDockStore.getState().loadSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    expect(useDockStore.getState().layout.root).toMatchObject({
      kind: 'split',
      direction: 'vertical',
      ratio: 0.6698039215686274,
    });
  });

  it('adds independent Color Controls instances to the same tab group', () => {
    useDockStore.getState().addPanelTypeToGroup('color-controls', 'right-group');
    useDockStore.getState().addPanelTypeToGroup('color-controls', 'right-group');

    const rightGroup = findTabGroup(useDockStore.getState().layout.root, 'right-group');
    const controls = rightGroup?.panels.filter(panel => panel.type === 'color-controls') ?? [];
    expect(controls).toHaveLength(3);
    expect(new Set(controls.map(panel => panel.id)).size).toBe(3);
  });

  it('does not restore the optional Start layout from a project', () => {
    const startLayout = getFactoryDockLayouts()
      .find((savedLayout) => savedLayout.id === FACTORY_START_LAYOUT_ID);
    expect(startLayout).toBeDefined();

    useDockStore.getState().setLayoutFromProject(startLayout!.layout);

    const state = useDockStore.getState();
    expect(state.activeSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    expect(findTabGroup(state.layout.root, 'left-group')).not.toBeNull();
    expect(panelTypes(findTabGroup(state.layout.root, 'start-group'))).toEqual([]);
  });

  it('does not restore the optional Start layout from browser persistence', async () => {
    const startLayout = getFactoryDockLayouts()
      .find((savedLayout) => savedLayout.id === FACTORY_START_LAYOUT_ID);
    expect(startLayout).toBeDefined();
    localStorage.setItem('webvj-dock-layout', JSON.stringify({
      state: {
        layout: startLayout!.layout,
        activeSavedLayoutId: FACTORY_START_LAYOUT_ID,
      },
      version: 0,
    }));

    await useDockStore.persist.rehydrate();

    const state = useDockStore.getState();
    expect(state.activeSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    expect(findTabGroup(state.layout.root, 'left-group')).not.toBeNull();
    expect(findTabGroup(state.layout.root, 'start-group')).toBeNull();
  });

  it('drops retired dock panel payload ids from restored project layouts', () => {
    const legacyLayout = {
      root: {
        kind: 'tab-group',
        id: 'legacy-group',
        activeIndex: 2,
        panels: [
          { id: 'media', type: 'media', title: 'Media' },
          { id: 'youtube', type: 'youtube', title: 'YouTube' },
          { id: 'download', type: 'download', title: 'Downloads' },
          { id: 'ai-video', type: 'ai-video', title: 'AI Generative' },
        ],
      },
      floatingPanels: [
        {
          id: 'floating-download',
          panel: { id: 'floating-download-panel', type: 'download', title: 'Downloads' },
          position: { x: 0, y: 0 },
          size: { width: 320, height: 400 },
          zIndex: 1001,
        },
      ],
      panelZoom: {},
    } as unknown as DockLayout;

    useDockStore.getState().setLayoutFromProject(legacyLayout);

    const group = findTabGroup(useDockStore.getState().layout.root, 'legacy-group');
    expect(panelTypes(group)).toEqual(['media']);
    expect(group?.activeIndex).toBe(0);
    expect(useDockStore.getState().layout.floatingPanels).toEqual([]);
  });

  it('changes a dock tab to another panel type in the same slot', () => {
    useDockStore.getState().changePanelType('clip-properties', 'audio-mixer');

    const rightGroup = findTabGroup(useDockStore.getState().layout.root, 'right-group');
    expect(panelTypes(rightGroup)).toEqual(['audio-mixer', 'export', 'color-controls']);
    expect(rightGroup?.activeIndex).toBe(0);
    expect(useDockStore.getState().isPanelTypeVisible('clip-properties')).toBe(false);
    expect(useDockStore.getState().isPanelTypeVisible('audio-mixer')).toBe(true);
  });

  it('changes a dock tab by moving an already visible panel instead of duplicating it', () => {
    useDockStore.getState().changePanelType('clip-properties', 'discover');

    const rightGroup = findTabGroup(useDockStore.getState().layout.root, 'right-group');
    expect(panelTypes(rightGroup)).toEqual(['discover', 'export', 'color-controls']);
    expect(rightGroup?.activeIndex).toBe(0);
  });

  it('loads the hardcoded audio editing layout with the timeline above mixer panels', () => {
    useDockStore.getState().loadSavedLayout(FACTORY_AUDIO_EDIT_LAYOUT_ID);

    const layout = useDockStore.getState().layout;
    expect(layout.floatingPanels).toEqual([]);
    expect(layout.root.kind).toBe('split');
    if (layout.root.kind !== 'split') return;

    expect(layout.root.direction).toBe('vertical');
    expect(layout.root.ratio).toBeCloseTo(0.61);

    const timelineGroup = findTabGroup(layout.root.children[0], 'timeline-group');
    expect(panelTypes(timelineGroup)).toEqual(['timeline']);

    const bottom = layout.root.children[1];
    expect(bottom.kind).toBe('split');
    if (bottom.kind !== 'split') return;

    expect(bottom.direction).toBe('horizontal');
    expect(bottom.ratio).toBeCloseTo(0.14);

    const mixerProperties = bottom.children[1];
    expect(mixerProperties.kind).toBe('split');
    if (mixerProperties.kind !== 'split') return;

    expect(mixerProperties.direction).toBe('horizontal');
    expect(mixerProperties.ratio).toBeCloseTo(0.8);

    expect(panelTypes(findTabGroup(bottom.children[0], 'left-group'))).toEqual([
      'media',
      'discover',
      'transitions',
    ]);
    expect(panelTypes(findTabGroup(mixerProperties.children[0], 'audio-mixer-group'))).toEqual(['audio-mixer']);
    const rightGroup = findTabGroup(mixerProperties.children[1], 'right-group');
    expect(panelTypes(rightGroup)).toEqual(['clip-properties', 'export', 'ai-studio']);
    expect(rightGroup?.activeIndex).toBe(1);

    const timeline = useTimelineStore.getState();
    expect(timeline.audioFocusMode).toBe(true);
    expect(timeline.trackFocusMode).toBe('audio');
    expect(timeline.tracks.find((track) => track.type === 'video')?.height).toBe(40);
    expect(timeline.tracks.find((track) => track.type === 'audio')?.height).toBe(96);
  });

  it('loads the hardcoded 3D editing layout with four independent edit views', () => {
    useDockStore.getState().loadSavedLayout(FACTORY_3D_EDIT_LAYOUT_ID);

    const layout = useDockStore.getState().layout;
    expect(layout.root).toMatchObject({ kind: 'split', direction: 'horizontal', ratio: 0.77 });
    if (layout.root.kind !== 'split') return;

    const workspace = layout.root.children[0];
    const sidebar = layout.root.children[1];
    expect(workspace).toMatchObject({ kind: 'split', direction: 'vertical', ratio: 0.74 });
    expect(sidebar).toMatchObject({ kind: 'split', direction: 'vertical', ratio: 0.62 });
    if (workspace.kind !== 'split' || sidebar.kind !== 'split') return;

    expect(panelTypes(findTabGroup(workspace, 'timeline-group'))).toEqual(['timeline']);
    expect(panelTypes(findTabGroup(sidebar, 'left-group'))).toEqual([
      'media',
      'discover',
      'transitions',
    ]);
    const rightGroup = findTabGroup(sidebar, 'right-group');
    expect(panelTypes(rightGroup)).toEqual(['clip-properties', 'export', 'ai-studio']);
    expect(rightGroup?.activeIndex).toBe(1);

    const previewPanels = ['front', 'side', 'top', 'perspective'].map((view) => (
      findTabGroup(workspace, `3d-edit-${view}-group`)?.panels[0]
    ));
    expect(previewPanels.map((panel) => panel?.id)).toEqual([
      '3d-preview-front',
      '3d-preview-side',
      '3d-preview-top',
      '3d-preview-perspective',
    ]);
    expect(previewPanels.map((panel) => panel?.data)).toEqual([
      { initialEditMode: true, initialEditCameraView: 'front' },
      { initialEditMode: true, initialEditCameraView: 'side' },
      { initialEditMode: true, initialEditCameraView: 'top' },
      { initialEditMode: true, initialEditCameraView: 'camera' },
    ]);
    expect(useTimelineStore.getState().clips.filter((clip) => clip.source?.type === 'camera')).toHaveLength(1);

    useDockStore.getState().loadSavedLayout(FACTORY_3D_EDIT_LAYOUT_ID);
    expect(useTimelineStore.getState().clips.filter((clip) => clip.source?.type === 'camera')).toHaveLength(1);
  });

  it('jumps to an existing camera instead of creating another one', () => {
    const trackId = useTimelineStore.getState().tracks.find((track) => track.type === 'video')!.id;
    const cameraId = useTimelineStore.getState().addCameraClip(trackId, 12, 5, true);
    useTimelineStore.getState().setPlayheadPosition(0);

    useDockStore.getState().loadSavedLayout(FACTORY_3D_EDIT_LAYOUT_ID);

    expect(useTimelineStore.getState().playheadPosition).toBe(12);
    expect(useTimelineStore.getState().clips.filter((clip) => clip.source?.type === 'camera')).toHaveLength(1);
    expect(useTimelineStore.getState().clips.find((clip) => clip.source?.type === 'camera')?.id).toBe(cameraId);

    useTimelineStore.getState().setPlayheadPosition(13);
    useDockStore.getState().loadSavedLayout(FACTORY_3D_EDIT_LAYOUT_ID);
    expect(useTimelineStore.getState().playheadPosition).toBe(13);
  });

  it('creates the automatic 3D camera on a new top layer when the top layer is occupied', () => {
    const occupiedTrack = useTimelineStore.getState().tracks.find((track) => track.type === 'video')!;
    const occupiedClip = createMockClip({
      id: 'existing-video',
      trackId: occupiedTrack.id,
      startTime: 0,
      duration: 8,
      outPoint: 8,
    });
    useTimelineStore.setState({ clips: [occupiedClip], duration: 8 });
    const videoTrackCountBefore = useTimelineStore.getState().tracks.filter((track) => track.type === 'video').length;

    useDockStore.getState().loadSavedLayout(FACTORY_3D_EDIT_LAYOUT_ID);

    const timeline = useTimelineStore.getState();
    const camera = timeline.clips.find((clip) => clip.source?.type === 'camera');
    const videoTracks = timeline.tracks.filter((track) => track.type === 'video');
    expect(videoTracks).toHaveLength(videoTrackCountBefore + 1);
    expect(camera).toMatchObject({
      trackId: videoTracks[0]?.id,
      startTime: 0,
      duration: 8,
    });
    expect(camera?.trackId).not.toBe(occupiedTrack.id);
    expect(timeline.clips.filter((clip) => clip.trackId === camera?.trackId)).toEqual([camera]);
  });

  it('reuses an empty top video layer above occupied lower layers', () => {
    const lowerTrack = useTimelineStore.getState().tracks.find((track) => track.type === 'video')!;
    const emptyTopTrackId = useTimelineStore.getState().addTrack('video');
    useTimelineStore.setState({
      clips: [createMockClip({
        id: 'lower-video',
        trackId: lowerTrack.id,
        startTime: 0,
        duration: 6,
        outPoint: 6,
      })],
      duration: 6,
    });
    const videoTrackCountBefore = useTimelineStore.getState().tracks.filter((track) => track.type === 'video').length;

    useDockStore.getState().loadSavedLayout(FACTORY_3D_EDIT_LAYOUT_ID);

    const timeline = useTimelineStore.getState();
    const camera = timeline.clips.find((clip) => clip.source?.type === 'camera');
    expect(timeline.tracks.filter((track) => track.type === 'video')).toHaveLength(videoTrackCountBefore);
    expect(camera?.trackId).toBe(emptyTopTrackId);
    expect(timeline.tracks.findIndex((track) => track.id === camera?.trackId))
      .toBeLessThan(timeline.tracks.findIndex((track) => track.id === lowerTrack.id));
  });

  it('loads the Chat layout as a single full-size panel', () => {
    useDockStore.getState().loadSavedLayout(FACTORY_START_LAYOUT_ID);

    const state = useDockStore.getState();
    expect(state.activeSavedLayoutId).toBe(FACTORY_START_LAYOUT_ID);
    expect(state.layout).toMatchObject({
      root: {
        kind: 'tab-group',
        id: 'start-group',
        activeIndex: 0,
        panels: [{ id: 'start', type: 'start', title: 'Chat' }],
      },
      floatingPanels: [],
    });
  });

  it('loads H Mobile with preview above tools and timeline', () => {
    useDockStore.getState().loadSavedLayout(FACTORY_MOBILE_LAYOUT_ID);

    const state = useDockStore.getState();
    expect(state.activeSavedLayoutId).toBe(FACTORY_MOBILE_LAYOUT_ID);
    expect(state.layout.root.kind).toBe('split');
    if (state.layout.root.kind !== 'split') return;

    expect(state.layout.root.direction).toBe('vertical');
    expect(state.layout.root.ratio).toBeCloseTo(0.36);
    expect(panelTypes(findTabGroup(state.layout.root, 'preview-group'))).toEqual(['preview']);
    expect(panelTypes(findTabGroup(state.layout.root, 'left-group'))).toEqual([
      'media',
      'ai-studio',
      'transitions',
    ]);
    const rightGroup = findTabGroup(state.layout.root, 'right-group');
    expect(panelTypes(rightGroup)).toEqual(['clip-properties', 'export', 'color-controls']);
    expect(rightGroup?.panels[2]?.title).toBe('Coloring');
    expect(rightGroup?.activeIndex).toBe(1);
    expect(panelTypes(findTabGroup(state.layout.root, 'timeline-group'))).toEqual(['timeline']);
  });

  it('loads V Mobile with preview left, ordered tools right, and timeline below', () => {
    const previousRoot = useDockStore.getState().layout.root;
    const previousTimelineHeightRatio = previousRoot.kind === 'split'
      ? 1 - previousRoot.ratio
      : null;
    useDockStore.getState().loadSavedLayout(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);

    const state = useDockStore.getState();
    expect(state.activeSavedLayoutId).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    expect(state.layout.root.kind).toBe('split');
    if (state.layout.root.kind !== 'split') return;

    expect(state.layout.root.direction).toBe('vertical');
    expect(1 - state.layout.root.ratio).toBeCloseTo(previousTimelineHeightRatio!);
    const top = state.layout.root.children[0];
    expect(top.kind).toBe('split');
    if (top.kind !== 'split') return;
    expect(top.direction).toBe('horizontal');
    expect(top.ratio).toBeCloseTo(0.42);
    expect(panelTypes(findTabGroup(state.layout.root, 'mobile-v-preview-group'))).toEqual(['preview']);
    expect(panelTypes(findTabGroup(state.layout.root, 'mobile-v-tools-group'))).toEqual([
      'media',
      'ai-studio',
      'transitions',
      'clip-properties',
      'export',
      'color-controls',
    ]);
    expect(findTabGroup(state.layout.root, 'mobile-v-tools-group')?.panels[5]?.title).toBe('Coloring');
    expect(panelTypes(findTabGroup(state.layout.root, 'mobile-v-timeline-group'))).toEqual(['timeline']);
  });

  it('chooses the matching Mobile layout only while a Mobile layout is active', () => {
    expect(resolveMobileLayoutForComposition({
      activeLayoutId: FACTORY_MOBILE_LAYOUT_ID,
      compositionWidth: 1080,
      compositionHeight: 1920,
    })).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    expect(resolveMobileLayoutForComposition({
      activeLayoutId: FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
      compositionWidth: 1920,
      compositionHeight: 1080,
    })).toBe(FACTORY_MOBILE_LAYOUT_ID);
    expect(resolveMobileLayoutForComposition({
      activeLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      compositionWidth: 1080,
      compositionHeight: 1920,
    })).toBeNull();
    expect(resolveMobileLayoutForComposition({
      activeLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      compositionWidth: 1080,
      compositionHeight: 1920,
      enterMobileLayout: true,
    })).toBe(FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
  });

  it('keeps the Start facade active while project state restores in the background', () => {
    useDockStore.getState().loadSavedLayout(FACTORY_START_LAYOUT_ID);
    const videoLayout = getFactoryDockLayouts()
      .find((savedLayout) => savedLayout.id === FACTORY_VIDEO_EDIT_LAYOUT_ID);
    expect(videoLayout).toBeDefined();

    useDockStore.getState().setLayoutFromProject(videoLayout!.layout);

    const state = useDockStore.getState();
    expect(state.activeSavedLayoutId).toBe(FACTORY_START_LAYOUT_ID);
    expect(panelTypes(findTabGroup(state.layout.root, 'start-group'))).toEqual(['start']);
  });

  it('keeps the device-managed Mobile layout active while project state restores', () => {
    useDockStore.getState().loadSavedLayout(FACTORY_MOBILE_LAYOUT_ID);
    const videoLayout = getFactoryDockLayouts()
      .find((savedLayout) => savedLayout.id === FACTORY_VIDEO_EDIT_LAYOUT_ID);
    expect(videoLayout).toBeDefined();

    useDockStore.getState().setLayoutFromProject(videoLayout!.layout);

    const state = useDockStore.getState();
    expect(state.activeSavedLayoutId).toBe(FACTORY_MOBILE_LAYOUT_ID);
    expect(panelTypes(findTabGroup(state.layout.root, 'left-group'))).toEqual([
      'media',
      'ai-studio',
      'transitions',
    ]);
    expect(panelTypes(findTabGroup(state.layout.root, 'right-group'))).toEqual([
      'clip-properties',
      'export',
      'color-controls',
    ]);
  });

  it('keeps Chat as a factory favorite immediately after 3D Edit', () => {
    const savedLayouts = useDockStore.getState().savedLayouts;
    const videoLayout = savedLayouts.find((layout) => layout.id === FACTORY_VIDEO_EDIT_LAYOUT_ID);
    const audioLayout = savedLayouts.find((layout) => layout.id === FACTORY_AUDIO_EDIT_LAYOUT_ID);
    const mobileLayout = savedLayouts.find((layout) => layout.id === FACTORY_MOBILE_LAYOUT_ID);
    const mediumLayout = savedLayouts.find((layout) => layout.id === FACTORY_MEDIUM_EDIT_LAYOUT_ID);
    const verticalMobileLayout = savedLayouts.find((layout) => layout.id === FACTORY_VERTICAL_MOBILE_LAYOUT_ID);
    const threeDLayout = savedLayouts.find((layout) => layout.id === FACTORY_3D_EDIT_LAYOUT_ID);
    const startLayout = savedLayouts.find((layout) => layout.id === FACTORY_START_LAYOUT_ID);

    expect(videoLayout).toMatchObject({
      name: 'Video',
      favorite: true,
      factory: true,
    });
    expect(audioLayout).toMatchObject({
      name: 'Audio',
      favorite: true,
      factory: true,
    });
    expect(threeDLayout).toMatchObject({
      name: '3D',
      favorite: true,
      factory: true,
    });
    expect(mediumLayout).toMatchObject({
      name: 'Medium',
      favorite: true,
      factory: true,
    });
    expect(mobileLayout).toMatchObject({
      name: 'Mobile',
      favorite: true,
      factory: true,
    });
    expect(verticalMobileLayout).toMatchObject({
      name: 'Mobile',
      favorite: true,
      factory: true,
    });
    expect(startLayout).toMatchObject({
      name: 'Chat',
      favorite: true,
      factory: true,
    });
    expect(savedLayouts.map((layout) => layout.id)).toEqual([
      FACTORY_VIDEO_EDIT_LAYOUT_ID,
      FACTORY_MEDIUM_EDIT_LAYOUT_ID,
      FACTORY_MOBILE_LAYOUT_ID,
      FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
      FACTORY_AUDIO_EDIT_LAYOUT_ID,
      FACTORY_3D_EDIT_LAYOUT_ID,
      FACTORY_COLOR_LAYOUT_ID,
      FACTORY_LIVE_LAYOUT_ID,
      FACTORY_START_LAYOUT_ID,
    ]);
    expect(useDockStore.getState().defaultSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
  });

  it('refreshes Audio, 3D, and Live factory panels when stale dev overrides are restored', () => {
    const staleLayouts = getFactoryDockLayouts();
    const audioLayout = staleLayouts.find((layout) => layout.id === FACTORY_AUDIO_EDIT_LAYOUT_ID)!;
    const audioLeftGroup = findTabGroup(audioLayout.layout.root, 'left-group')!;
    const audioRightGroup = findTabGroup(audioLayout.layout.root, 'right-group')!;
    audioLeftGroup.panels = [{ id: 'media', type: 'media', title: 'Media' }];
    audioRightGroup.panels = [{ id: 'clip-properties', type: 'clip-properties', title: 'Properties' }];

    const threeDLayout = staleLayouts.find((layout) => layout.id === FACTORY_3D_EDIT_LAYOUT_ID)!;
    const threeDLeftGroup = findTabGroup(threeDLayout.layout.root, 'left-group')!;
    const threeDRightGroup = findTabGroup(threeDLayout.layout.root, 'right-group')!;
    threeDLeftGroup.panels = [{ id: 'media', type: 'media', title: 'Media' }];
    threeDRightGroup.panels = [{ id: 'clip-properties', type: 'clip-properties', title: 'Properties' }];

    const liveLayout = staleLayouts.find((layout) => layout.id === FACTORY_LIVE_LAYOUT_ID)!;
    const liveControlsGroup = findTabGroup(liveLayout.layout.root, 'live-controls-group')!;
    liveControlsGroup.panels = [{ id: 'live-go-live', type: 'go-live', title: 'Go Live' }];

    const mergedLayouts = mergeFactoryDockLayouts(staleLayouts);
    const mergedAudio = mergedLayouts.find((layout) => layout.id === FACTORY_AUDIO_EDIT_LAYOUT_ID)!;
    const mergedThreeD = mergedLayouts.find((layout) => layout.id === FACTORY_3D_EDIT_LAYOUT_ID)!;
    const mergedLive = mergedLayouts.find((layout) => layout.id === FACTORY_LIVE_LAYOUT_ID)!;

    expect(mergedAudio.updatedAt).toBe(5);
    expect(panelTypes(findTabGroup(mergedAudio.layout.root, 'left-group'))).toEqual([
      'media',
      'discover',
      'transitions',
    ]);
    expect(panelTypes(findTabGroup(mergedAudio.layout.root, 'right-group'))).toEqual([
      'clip-properties',
      'export',
      'ai-studio',
    ]);
    expect(panelTypes(findTabGroup(mergedThreeD.layout.root, 'left-group'))).toEqual([
      'media',
      'discover',
      'transitions',
    ]);
    expect(panelTypes(findTabGroup(mergedThreeD.layout.root, 'right-group'))).toEqual([
      'clip-properties',
      'export',
      'ai-studio',
    ]);
    expect(mergedLive.updatedAt).toBe(2);
    expect(panelTypes(findTabGroup(mergedLive.layout.root, 'live-controls-group'))).toEqual([
      'go-live',
      'media',
      'clip-properties',
    ]);
  });

  it('allows built-in layouts to be removed from and restored to favorites', () => {
    useDockStore.getState().toggleFavoriteSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    let videoLayout = useDockStore.getState().savedLayouts.find((layout) => layout.id === FACTORY_VIDEO_EDIT_LAYOUT_ID);
    expect(videoLayout).toMatchObject({
      favorite: false,
      factory: true,
    });

    useDockStore.getState().toggleFavoriteSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    videoLayout = useDockStore.getState().savedLayouts.find((layout) => layout.id === FACTORY_VIDEO_EDIT_LAYOUT_ID);
    expect(videoLayout).toMatchObject({
      favorite: true,
      factory: true,
    });
  });

  it('toggles favorite state for saved layouts', () => {
    const savedLayout = useDockStore.getState().saveNamedLayout('Custom Video Edit');

    expect(savedLayout).not.toBeNull();
    expect(useDockStore.getState().activeSavedLayoutId).toBe(savedLayout!.id);
    useDockStore.getState().toggleFavoriteSavedLayout(savedLayout!.id);
    expect(useDockStore.getState().savedLayouts[0].favorite).toBe(true);

    useDockStore.getState().toggleFavoriteSavedLayout(savedLayout!.id);
    expect(useDockStore.getState().savedLayouts[0].favorite).toBe(false);
  });

  it('preserves favorite state when an existing saved layout is overwritten', () => {
    const savedLayout = useDockStore.getState().saveNamedLayout('Custom Audio Edit');
    expect(savedLayout).not.toBeNull();

    useDockStore.getState().toggleFavoriteSavedLayout(savedLayout!.id);
    const updatedLayout = useDockStore.getState().saveNamedLayout('Custom Audio Edit');

    expect(updatedLayout?.id).toBe(savedLayout!.id);
    expect(updatedLayout?.favorite).toBe(true);
    expect(useDockStore.getState().savedLayouts[0].favorite).toBe(true);
  });

  it('stores and restores timeline focus state, track heights, and track visibility in saved layouts', () => {
    const timeline = useTimelineStore.getState();
    timeline.setAudioDisplayMode('spectral');
    timeline.setAudioLayerAdvancedMode(false);
    timeline.setTrackFocusMode('audio');
    timeline.setTrackHeight('video-2', 132);
    timeline.setTrackHeight('video-1', 120);
    timeline.setTrackHeight('audio-1', 88);
    timeline.setTrackVisible('video-2', false);
    timeline.setTrackVisible('video-1', false);
    timeline.setTrackVisible('audio-1', false);

    const savedLayout = useDockStore.getState().saveNamedLayout('Audio Focus');

    expect(savedLayout?.timeline).toMatchObject({
      audioDisplayMode: 'spectral',
      audioLayerAdvancedMode: false,
      audioFocusMode: true,
      trackFocusMode: 'audio',
      trackHeaderWidth: 210,
      timelineSplitRatio: null,
      trackHeights: {
        'video-1': 120,
        'audio-1': 88,
      },
      trackTypeHeights: {
        video: 132,
        audio: 88,
      },
      trackVisibility: {
        'video-1': false,
        'audio-1': false,
      },
      trackTypeVisibility: {
        video: false,
        audio: false,
      },
      trackTypeCounts: {
        video: 2,
        audio: 1,
      },
      trackTypeLayouts: {
        video: [
          { height: 132, visible: false },
          { height: 120, visible: false },
        ],
        audio: [
          { height: 88, visible: false },
        ],
      },
    });

    timeline.setAudioDisplayMode('compact');
    timeline.setAudioLayerAdvancedMode(true);
    timeline.setTrackFocusMode('video');
    timeline.setTrackHeight('video-1', 20);
    timeline.setTrackHeight('audio-1', 20);
    timeline.setTrackVisible('video-1', true);
    timeline.setTrackVisible('audio-1', true);

    useDockStore.getState().loadSavedLayout(savedLayout!.id);

    const restoredTimeline = useTimelineStore.getState();
    expect(restoredTimeline.audioDisplayMode).toBe('spectral');
    expect(restoredTimeline.audioLayerAdvancedMode).toBe(false);
    expect(restoredTimeline.trackFocusMode).toBe('audio');
    expect(restoredTimeline.audioFocusMode).toBe(true);
    expect(restoredTimeline.tracks.find((track) => track.id === 'video-1')?.height).toBe(120);
    expect(restoredTimeline.tracks.find((track) => track.id === 'audio-1')?.height).toBe(88);
    expect(restoredTimeline.tracks.find((track) => track.id === 'video-1')?.visible).toBe(false);
    expect(restoredTimeline.tracks.find((track) => track.id === 'audio-1')?.visible).toBe(false);
  });

  it('uses indexed track type layouts for tracks with different ids and falls back for extras', () => {
    const timeline = useTimelineStore.getState();
    timeline.setTrackHeight('video-2', 132);
    timeline.setTrackHeight('audio-1', 76);
    timeline.setTrackVisible('video-2', false);
    timeline.setTrackVisible('audio-1', false);

    const savedLayout = useDockStore.getState().saveNamedLayout('Type Fallback');
    expect(savedLayout?.timeline?.trackTypeHeights).toEqual({
      video: 132,
      audio: 76,
    });
    expect(savedLayout?.timeline?.trackTypeVisibility).toEqual({
      video: false,
      audio: false,
    });

    const videoTemplate = DEFAULT_TRACKS.find((track) => track.type === 'video')!;
    const audioTemplate = DEFAULT_TRACKS.find((track) => track.type === 'audio')!;
    useTimelineStore.setState({
      tracks: [
        { ...videoTemplate, id: 'other-video-1', name: 'Other Video 1', height: 20, visible: true },
        { ...videoTemplate, id: 'other-video-2', name: 'Other Video 2', height: 40, visible: true },
        { ...videoTemplate, id: 'other-video-3', name: 'Other Video 3', height: 60, visible: true },
        { ...audioTemplate, id: 'other-audio-1', name: 'Other Audio 1', height: 24, visible: true },
        { ...audioTemplate, id: 'other-audio-2', name: 'Other Audio 2', height: 36, visible: true },
      ],
    });

    useDockStore.getState().loadSavedLayout(savedLayout!.id);

    const restoredTracks = useTimelineStore.getState().tracks;
    expect(restoredTracks.filter((track) => track.type === 'video').map((track) => track.height)).toEqual([132, 70, 132]);
    expect(restoredTracks.filter((track) => track.type === 'audio').map((track) => track.height)).toEqual([76, 76]);
    expect(restoredTracks.filter((track) => track.type === 'video').map((track) => track.visible)).toEqual([false, true, false]);
    expect(restoredTracks.filter((track) => track.type === 'audio').map((track) => track.visible)).toEqual([false, false]);
  });

  it('creates missing tracks when a saved layout has more track slots', () => {
    const timeline = useTimelineStore.getState();
    timeline.addTrack('video');
    timeline.addTrack('audio');

    const savedVideoHeights = [110, 90, 70];
    const savedAudioHeights = [80, 100];
    const savedVideoVisibility = [false, true, false];
    const savedAudioVisibility = [false, true];
    useTimelineStore.getState().tracks
      .filter((track) => track.type === 'video')
      .forEach((track, index) => {
        timeline.setTrackHeight(track.id, savedVideoHeights[index]);
        timeline.setTrackVisible(track.id, savedVideoVisibility[index]);
      });
    useTimelineStore.getState().tracks
      .filter((track) => track.type === 'audio')
      .forEach((track, index) => {
        timeline.setTrackHeight(track.id, savedAudioHeights[index]);
        timeline.setTrackVisible(track.id, savedAudioVisibility[index]);
      });

    const savedLayout = useDockStore.getState().saveNamedLayout('Track Slots');
    expect(savedLayout?.timeline?.trackTypeCounts).toEqual({ video: 3, audio: 2 });

    const videoTemplate = DEFAULT_TRACKS.find((track) => track.type === 'video')!;
    const audioTemplate = DEFAULT_TRACKS.find((track) => track.type === 'audio')!;
    useTimelineStore.setState({
      tracks: [
        { ...videoTemplate, id: 'fresh-video-1', name: 'Fresh Video 1', height: 20, visible: true },
        { ...audioTemplate, id: 'fresh-audio-1', name: 'Fresh Audio 1', height: 24, visible: true },
      ],
    });

    useDockStore.getState().loadSavedLayout(savedLayout!.id);

    const restoredTracks = useTimelineStore.getState().tracks;
    expect(restoredTracks.filter((track) => track.type === 'video')).toHaveLength(3);
    expect(restoredTracks.filter((track) => track.type === 'audio')).toHaveLength(2);
    expect(restoredTracks.filter((track) => track.type === 'video').map((track) => track.height)).toEqual(savedVideoHeights);
    expect(restoredTracks.filter((track) => track.type === 'audio').map((track) => track.height)).toEqual(savedAudioHeights);
    expect(restoredTracks.filter((track) => track.type === 'video').map((track) => track.visible)).toEqual(savedVideoVisibility);
    expect(restoredTracks.filter((track) => track.type === 'audio').map((track) => track.visible)).toEqual(savedAudioVisibility);
  });

  it('saves over the current named layout without prompting for a new name', () => {
    const savedLayout = useDockStore.getState().saveNamedLayout('Current Layout');
    expect(savedLayout).not.toBeNull();

    useDockStore.getState().setSplitRatio('root-split', 0.42);
    useTimelineStore.getState().setTrackFocusMode('audio');
    useTimelineStore.getState().setTimelineSplitRatio(0.36);
    useTimelineStore.getState().setTrackHeight('audio-1', 96);

    const updatedLayout = useDockStore.getState().saveCurrentNamedLayout();

    expect(updatedLayout?.id).toBe(savedLayout!.id);
    expect(updatedLayout?.name).toBe('Current Layout');
    expect(updatedLayout?.timeline?.trackFocusMode).toBe('audio');
    expect(updatedLayout?.timeline?.timelineSplitRatio).toBe(0.36);
    expect(updatedLayout?.timeline?.trackHeights?.['audio-1']).toBe(96);
    expect(updatedLayout?.layout.root.kind).toBe('split');
    if (updatedLayout?.layout.root.kind === 'split') {
      expect(updatedLayout.layout.root.ratio).toBe(0.42);
    }
  });

  it('returns null when there is no current named layout to overwrite', () => {
    useDockStore.setState({ activeSavedLayoutId: null });
    expect(useDockStore.getState().saveCurrentNamedLayout()).toBeNull();
  });

  it('updates the matching saved layout timeline data when setting the current layout as default', () => {
    const savedLayout = useDockStore.getState().saveNamedLayout('Default Candidate');
    expect(savedLayout).not.toBeNull();

    useTimelineStore.getState().setTrackFocusMode('video');
    useTimelineStore.getState().setTimelineSplitRatio(0.64);
    useDockStore.getState().saveLayoutAsDefault();

    const restoredLayout = useDockStore.getState().savedLayouts.find((layout) => layout.id === savedLayout!.id);
    expect(useDockStore.getState().defaultSavedLayoutId).toBe(savedLayout!.id);
    expect(restoredLayout?.timeline?.trackFocusMode).toBe('video');
    expect(restoredLayout?.timeline?.timelineSplitRatio).toBe(0.64);
  });
});
