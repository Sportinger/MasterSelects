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
    useTimelineStore.setState({
      tracks: DEFAULT_TRACKS.map((track) => ({ ...track })),
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

    expect(panelTypes(leftGroup)).toEqual(['media']);
    expect(panelTypes(previewGroup)).toEqual(['preview']);
    expect(panelTypes(rightGroup)).toEqual(['clip-properties', 'history']);
    expect(rightGroup?.activeIndex).toBe(0);
    expect(panelTypes(timelineGroup)).toEqual(['timeline']);

    const timeline = useTimelineStore.getState();
    expect(timeline.audioFocusMode).toBe(false);
    expect(timeline.trackFocusMode).toBe('balanced');
    expect(timeline.tracks.find((track) => track.type === 'video')?.height).toBe(70);
    expect(timeline.tracks.find((track) => track.type === 'audio')?.height).toBe(48);
    expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
  });

  it('activates the history tab when requested from the panels menu', () => {
    const initialRightGroup = findTabGroup(useDockStore.getState().layout.root, 'right-group');
    expect(initialRightGroup?.panels[initialRightGroup.activeIndex]?.type).toBe('clip-properties');

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

  it('changes a dock tab to another panel type in the same slot', () => {
    useDockStore.getState().changePanelType('clip-properties', 'audio-mixer');

    const rightGroup = findTabGroup(useDockStore.getState().layout.root, 'right-group');
    expect(panelTypes(rightGroup)).toEqual(['audio-mixer', 'history']);
    expect(rightGroup?.activeIndex).toBe(0);
    expect(useDockStore.getState().isPanelTypeVisible('clip-properties')).toBe(false);
    expect(useDockStore.getState().isPanelTypeVisible('audio-mixer')).toBe(true);
  });

  it('changes a dock tab by moving an already visible panel instead of duplicating it', () => {
    useDockStore.getState().changePanelType('clip-properties', 'history');

    const rightGroup = findTabGroup(useDockStore.getState().layout.root, 'right-group');
    expect(panelTypes(rightGroup)).toEqual(['history']);
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

    expect(panelTypes(findTabGroup(bottom.children[0], 'left-group'))).toEqual(['media']);
    expect(panelTypes(findTabGroup(mixerProperties.children[0], 'audio-mixer-group'))).toEqual(['audio-mixer']);
    expect(panelTypes(findTabGroup(mixerProperties.children[1], 'right-group'))).toEqual(['clip-properties', 'history']);

    const timeline = useTimelineStore.getState();
    expect(timeline.audioFocusMode).toBe(true);
    expect(timeline.trackFocusMode).toBe('audio');
    expect(timeline.tracks.find((track) => track.type === 'video')?.height).toBe(40);
    expect(timeline.tracks.find((track) => track.type === 'audio')?.height).toBe(96);
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
