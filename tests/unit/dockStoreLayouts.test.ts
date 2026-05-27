import { beforeEach, describe, expect, it } from 'vitest';
import {
  FACTORY_AUDIO_EDIT_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  getFactoryDockLayouts,
  useDockStore,
} from '../../src/stores/dockStore';
import { DEFAULT_TRACKS, useTimelineStore } from '../../src/stores/timeline';
import type { DockNode, DockTabGroup, PanelType } from '../../src/types/dock';

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
    useDockStore.setState({
      savedLayouts: getFactoryDockLayouts(),
      defaultSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      activeSavedLayoutId: null,
    });
    useDockStore.getState().resetLayout();
    useTimelineStore.setState({
      tracks: DEFAULT_TRACKS.map((track) => ({ ...track })),
      audioDisplayMode: 'detailed',
      audioLayerAdvancedMode: true,
      audioFocusMode: false,
      trackFocusMode: 'balanced',
    });
  });

  it('uses the hardcoded video and audio editing layout as the default', () => {
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

    expect(panelTypes(leftGroup)).toEqual(['media']);
    expect(panelTypes(previewGroup)).toEqual(['preview']);
    expect(panelTypes(rightGroup)).toEqual(['clip-properties']);
    expect(rightGroup?.activeIndex).toBe(0);
    expect(panelTypes(timelineGroup)).toEqual(['timeline']);
  });

  it('keeps the built-in video and audio layouts as default favorites', () => {
    const savedLayouts = useDockStore.getState().savedLayouts;
    const videoLayout = savedLayouts.find((layout) => layout.id === FACTORY_VIDEO_EDIT_LAYOUT_ID);
    const audioLayout = savedLayouts.find((layout) => layout.id === FACTORY_AUDIO_EDIT_LAYOUT_ID);

    expect(videoLayout).toMatchObject({
      name: 'VIDEO EDIT',
      favorite: true,
      factory: true,
    });
    expect(audioLayout).toMatchObject({
      name: 'AUDIO EDIT',
      favorite: true,
      factory: true,
    });
    expect(useDockStore.getState().defaultSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
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

  it('uses the first saved video and audio track layout for tracks with different ids', () => {
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
        { ...audioTemplate, id: 'other-audio-1', name: 'Other Audio 1', height: 24, visible: true },
        { ...audioTemplate, id: 'other-audio-2', name: 'Other Audio 2', height: 36, visible: true },
      ],
    });

    useDockStore.getState().loadSavedLayout(savedLayout!.id);

    const restoredTracks = useTimelineStore.getState().tracks;
    expect(restoredTracks.filter((track) => track.type === 'video').map((track) => track.height)).toEqual([132, 132]);
    expect(restoredTracks.filter((track) => track.type === 'audio').map((track) => track.height)).toEqual([76, 76]);
    expect(restoredTracks.filter((track) => track.type === 'video').map((track) => track.visible)).toEqual([false, false]);
    expect(restoredTracks.filter((track) => track.type === 'audio').map((track) => track.visible)).toEqual([false, false]);
  });

  it('saves over the current named layout without prompting for a new name', () => {
    const savedLayout = useDockStore.getState().saveNamedLayout('Current Layout');
    expect(savedLayout).not.toBeNull();

    useDockStore.getState().setSplitRatio('root-split', 0.42);
    useTimelineStore.getState().setTrackFocusMode('audio');
    useTimelineStore.getState().setTrackHeight('audio-1', 96);

    const updatedLayout = useDockStore.getState().saveCurrentNamedLayout();

    expect(updatedLayout?.id).toBe(savedLayout!.id);
    expect(updatedLayout?.name).toBe('Current Layout');
    expect(updatedLayout?.timeline?.trackFocusMode).toBe('audio');
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
});
