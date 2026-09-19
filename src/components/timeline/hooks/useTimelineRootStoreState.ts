import { useShallow } from 'zustand/react/shallow';

import { useTimelineStore } from '../../../stores/timeline';
import {
  selectCoreData,
  selectKeyframeState,
  selectPlaybackState,
  selectPreviewExportState,
  selectUISettings,
  selectViewState,
} from '../../../stores/timeline/selectors';
import { useMediaStore } from '../../../stores/mediaStore';
import { useDockStore } from '../../../stores/dockStore';
import { isMobileLayoutId } from '../../dock/mobileLayoutOrientation';
import { getTimelineToolCursor } from '../tools/pointer/timelineToolPointerDispatcher';

export const MOBILE_TIMELINE_TRACK_HEADER_WIDTH = 76;

export function resolveTimelineTrackHeaderWidth(
  configuredWidth: number,
  activeDockLayoutId: string | null,
): number {
  return isMobileLayoutId(activeDockLayoutId)
    ? MOBILE_TIMELINE_TRACK_HEADER_WIDTH
    : configuredWidth;
}

export function useTimelineRootStoreState() {
  const coreData = useTimelineStore(useShallow(selectCoreData));
  const playbackState = useTimelineStore(useShallow(selectPlaybackState));
  const viewState = useTimelineStore(useShallow(selectViewState));
  const uiSettings = useTimelineStore(useShallow(selectUISettings));
  const previewExportState = useTimelineStore(useShallow(selectPreviewExportState));
  const keyframeState = useTimelineStore(useShallow(selectKeyframeState));
  const slotGridProgress = useTimelineStore(state => state.slotGridProgress);
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const clipDragPreview = useTimelineStore(state => state.clipDragPreview);
  const timelineRangeSelection = useTimelineStore(state => state.timelineRangeSelection);
  const timelineToolPreview = useTimelineStore(state => state.timelineToolPreview);
  const audioRegionSelection = useTimelineStore(state => state.audioRegionSelection);
  const audioRegionGainPreview = useTimelineStore(state => state.audioRegionGainPreview);
  const audioSpectralRegionSelection = useTimelineStore(state => state.audioSpectralRegionSelection);
  const videoBakeRegions = useTimelineStore(state => state.videoBakeRegions);
  const videoBakeRegionSelection = useTimelineStore(state => state.videoBakeRegionSelection);
  const expandedTracks = useTimelineStore(state => state.expandedTracks);
  const clipStemSeparationJobs = useTimelineStore(state => state.clipStemSeparationJobs);
  const getActiveComposition = useMediaStore(state => state.getActiveComposition);
  const getOpenCompositions = useMediaStore(state => state.getOpenCompositions);
  const openCompositionTab = useMediaStore(state => state.openCompositionTab);
  const proxyEnabled = useMediaStore(state => state.proxyEnabled);
  const mediaFiles = useMediaStore(state => state.files);
  const currentlyGeneratingProxyId = useMediaStore(state => state.currentlyGeneratingProxyId);
  const showInExplorer = useMediaStore(state => state.showInExplorer);
  const activeDockLayoutId = useDockStore(state => state.activeSavedLayoutId);
  const activeComposition = getActiveComposition() ?? null;
  const openCompositions = getOpenCompositions();
  const timelineToolCursor = getTimelineToolCursor(uiSettings.activeTimelineToolId);
  const effectiveAudioLayerAdvancedMode = uiSettings.audioLayerAdvancedMode !== false;

  return {
    ...coreData,
    ...playbackState,
    ...viewState,
    ...uiSettings,
    ...previewExportState,
    ...keyframeState,
    activeComposition,
    audioRegionGainPreview,
    audioRegionSelection,
    audioSpectralRegionSelection,
    clipDragPreview,
    clipStemSeparationJobs,
    currentlyGeneratingProxyId,
    effectiveAudioLayerAdvancedMode,
    expandedTracks,
    mediaFiles,
    openCompositionTab,
    openCompositions,
    propertiesSelection,
    proxyEnabled,
    showInExplorer,
    slotGridProgress,
    timelineRangeSelection,
    trackHeaderWidth: resolveTimelineTrackHeaderWidth(
      viewState.trackHeaderWidth,
      activeDockLayoutId,
    ),
    timelineToolCursor,
    timelineToolPreview,
    timelineTrackColorsVisible: effectiveAudioLayerAdvancedMode,
    videoBakeRegionSelection,
    videoBakeRegions,
  };
}
