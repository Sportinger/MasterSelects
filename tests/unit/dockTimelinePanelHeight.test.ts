import { beforeEach, describe, expect, it } from 'vitest';
import {
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  getFactoryDockLayouts,
  useDockStore,
} from '../../src/stores/dockStore';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  getTimelinePanelHeightRatio,
  preserveTimelinePanelHeightRatio,
} from '../../src/stores/dockStore/timelinePanelHeight';
import {
  DEFAULT_LAYOUT,
  MOBILE_LAYOUT,
  VERTICAL_MOBILE_LAYOUT,
} from '../../src/stores/dockStore/layoutDefaults';

describe('Mobile timeline panel height', () => {
  beforeEach(() => {
    useDockStore.setState({
      savedLayouts: getFactoryDockLayouts(),
      activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
      layout: structuredClone(DEFAULT_LAYOUT),
    });
  });

  it('maps the same timeline height ratio into both Mobile layout trees', () => {
    const desired = getTimelinePanelHeightRatio(DEFAULT_LAYOUT);
    const horizontal = preserveTimelinePanelHeightRatio(structuredClone(MOBILE_LAYOUT), desired);
    const vertical = preserveTimelinePanelHeightRatio(structuredClone(VERTICAL_MOBILE_LAYOUT), desired);

    expect(getTimelinePanelHeightRatio(horizontal)).toBeCloseTo(desired!, 8);
    expect(getTimelinePanelHeightRatio(vertical)).toBeCloseTo(desired!, 8);
  });

  it('keeps panel and track heights while switching into and out of Mobile', () => {
    useDockStore.getState().setSplitRatio('root-split', 0.57);
    const videoTrack = useTimelineStore.getState().tracks.find((track) => track.type === 'video');
    const audioTrack = useTimelineStore.getState().tracks.find((track) => track.type === 'audio');
    expect(videoTrack).toBeDefined();
    expect(audioTrack).toBeDefined();
    useTimelineStore.getState().setTrackHeight(videoTrack!.id, 83);
    useTimelineStore.getState().setTrackHeight(audioTrack!.id, 61);
    const initialPanelHeight = getTimelinePanelHeightRatio(useDockStore.getState().layout);

    useDockStore.getState().loadSavedLayout(FACTORY_VERTICAL_MOBILE_LAYOUT_ID, {
      transitionDurationMs: 0,
    });
    expect(getTimelinePanelHeightRatio(useDockStore.getState().layout)).toBeCloseTo(initialPanelHeight!, 8);
    expect(useTimelineStore.getState().tracks.find((track) => track.id === videoTrack!.id)?.height).toBe(83);
    expect(useTimelineStore.getState().tracks.find((track) => track.id === audioTrack!.id)?.height).toBe(61);

    useDockStore.getState().loadSavedLayout(FACTORY_MOBILE_LAYOUT_ID, {
      transitionDurationMs: 0,
    });
    expect(getTimelinePanelHeightRatio(useDockStore.getState().layout)).toBeCloseTo(initialPanelHeight!, 8);

    useDockStore.getState().loadSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID, {
      transitionDurationMs: 0,
    });
    expect(getTimelinePanelHeightRatio(useDockStore.getState().layout)).toBeCloseTo(initialPanelHeight!, 8);
    expect(useTimelineStore.getState().tracks.find((track) => track.id === videoTrack!.id)?.height).toBe(83);
    expect(useTimelineStore.getState().tracks.find((track) => track.id === audioTrack!.id)?.height).toBe(61);
  });
});
