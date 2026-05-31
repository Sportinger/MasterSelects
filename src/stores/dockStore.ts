// Zustand store for dock layout state management

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import type {
  DockLayout,
  DockNode,
  DockPanel,
  DockDragState,
  DropTarget,
  FloatingPanel,
  PanelType,
  DockTabGroup,
  PanelData,
  PreviewPanelData,
  HoveredDockTabTarget,
  SavedDockLayout,
  SavedDockTimelineLayout,
  SavedDockTimelineTrackSlotLayout,
  PanelConfig,
} from '../types/dock';
import { DEPRECATED_PANEL_TYPES, PANEL_CONFIGS } from '../types/dock';
import {
  removePanel,
  insertPanelAtTarget,
  collapseSingleChildSplits,
  adjustDropTargetForMovedPanel,
} from '../utils/dockLayout';
import { Logger } from '../services/logger';
import { createPreviewPanelDataPatch, createPreviewPanelSource } from '../utils/previewPanelSource';
import { useMediaStore } from './mediaStore';
import { useTimelineStore } from './timeline';

const log = Logger.create('DockStore');
const LEGACY_DEFAULT_LAYOUT_STORAGE_KEY = 'webvj-dock-layout-default';
const DEFAULT_TIMELINE_LAYOUT_STORAGE_KEY = 'webvj-dock-layout-default-timeline';
export const DOCK_LAYOUT_TRANSITION_EVENT = 'masterselects:dock-layout-transition';
const DOCK_LAYOUT_TRANSITION_DURATION_MS = 500;

// Valid panel types (used to filter out removed panels from saved layouts)
const DEPRECATED_PANEL_TYPE_SET = new Set<PanelType>(DEPRECATED_PANEL_TYPES);
const BUILT_IN_PANEL_TYPES: PanelType[] = [
  'preview',
  'multi-preview',
  'timeline',
  'clip-properties',
  'history',
  'audio-mixer',
  'node-workspace',
  'media',
  'export',
  'midi-mapping',
  'multicam',
  'ai-chat',
  'ai-segment',
  'scene-description',
  'download',
  'transitions',
  'scope-waveform',
  'scope-histogram',
  'scope-vectorscope',
];
const VALID_PANEL_TYPES = new Set(BUILT_IN_PANEL_TYPES.filter((type) => !DEPRECATED_PANEL_TYPE_SET.has(type)));
const PANEL_CONFIG_LOOKUP = PANEL_CONFIGS as Partial<Record<PanelType, PanelConfig>>;
const VALID_TIMELINE_AUDIO_DISPLAY_MODES = new Set(['compact', 'detailed', 'spectral']);
const VALID_TIMELINE_TRACK_FOCUS_MODES = new Set(['balanced', 'audio', 'video']);
const TIMELINE_TRACK_TYPES = ['video', 'audio'] as const;
type TimelineTrackType = (typeof TIMELINE_TRACK_TYPES)[number];
const MAX_SAVED_TIMELINE_TRACKS_PER_TYPE = 64;
const LEGACY_PANEL_TYPE_ALIASES: Partial<Record<PanelType, PanelType>> = {
  youtube: 'download',
};
const COLLAPSED_LEGACY_ALIAS_TYPES = new Set<PanelType>(['download']);
const LEGACY_PANEL_TITLES: Partial<Record<PanelType, Set<string>>> = {
  'ai-video': new Set(['AI Video']),
};

interface NormalizedDockPanel {
  panel: DockPanel;
  sourceType: PanelType;
}

interface NormalizedFloatingPanel {
  floatingPanel: FloatingPanel;
  sourceType: PanelType;
}

function resolvePanelType(type: PanelType): PanelType {
  return LEGACY_PANEL_TYPE_ALIASES[type] ?? type;
}

function getPanelConfig(type: PanelType): PanelConfig {
  return PANEL_CONFIG_LOOKUP[type] ?? {
    type,
    title: type
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    closable: false,
  };
}

function normalizeDockPanel(panel: DockPanel): NormalizedDockPanel | null {
  const normalizedType = resolvePanelType(panel.type);
  if (!VALID_PANEL_TYPES.has(normalizedType)) {
    return null;
  }
  const configTitle = getPanelConfig(normalizedType).title;
  const legacyTitles = LEGACY_PANEL_TITLES[normalizedType];
  const title = normalizedType === panel.type && !legacyTitles?.has(panel.title)
    ? panel.title
    : configTitle;

  return {
    sourceType: panel.type,
    panel: {
      ...panel,
      type: normalizedType,
      title,
    },
  };
}

function collapseAliasedPanels(panels: NormalizedDockPanel[]): DockPanel[] {
  const preferredPanelIds = new Map<PanelType, string>();

  for (const panelType of COLLAPSED_LEGACY_ALIAS_TYPES) {
    const candidates = panels.filter((candidate) => candidate.panel.type === panelType);
    if (candidates.length <= 1) {
      continue;
    }

    const preferredCandidate = candidates.find((candidate) => candidate.sourceType === panelType) ?? candidates[0];
    preferredPanelIds.set(panelType, preferredCandidate.panel.id);
  }

  return panels
    .filter((candidate) => {
      const preferredPanelId = preferredPanelIds.get(candidate.panel.type);
      return preferredPanelId === undefined || candidate.panel.id === preferredPanelId;
    })
    .map((candidate) => candidate.panel);
}

function normalizeFloatingPanel(floatingPanel: FloatingPanel): NormalizedFloatingPanel | null {
  const normalizedDockPanel = normalizeDockPanel(floatingPanel.panel);
  if (!normalizedDockPanel) {
    return null;
  }

  return {
    sourceType: normalizedDockPanel.sourceType,
    floatingPanel: {
      ...floatingPanel,
      panel: normalizedDockPanel.panel,
    },
  };
}

function collapseAliasedFloatingPanels(floatingPanels: NormalizedFloatingPanel[]): FloatingPanel[] {
  const preferredPanelIds = new Map<PanelType, string>();

  for (const panelType of COLLAPSED_LEGACY_ALIAS_TYPES) {
    const candidates = floatingPanels.filter((candidate) => candidate.floatingPanel.panel.type === panelType);
    if (candidates.length <= 1) {
      continue;
    }

    const preferredCandidate = candidates.find((candidate) => candidate.sourceType === panelType) ?? candidates[0];
    preferredPanelIds.set(panelType, preferredCandidate.floatingPanel.panel.id);
  }

  return floatingPanels
    .filter((candidate) => {
      const preferredPanelId = preferredPanelIds.get(candidate.floatingPanel.panel.type);
      return preferredPanelId === undefined || candidate.floatingPanel.panel.id === preferredPanelId;
    })
    .map((candidate) => candidate.floatingPanel);
}

// Normalize legacy aliases and filter out invalid panel types from a layout node
function filterInvalidPanels(node: DockNode): DockNode | null {
  if (node.kind === 'tab-group') {
    const validPanels = collapseAliasedPanels(
      node.panels
        .map(normalizeDockPanel)
        .filter((panel): panel is NormalizedDockPanel => panel !== null)
    );
    if (validPanels.length === 0) return null;
    return {
      ...node,
      panels: validPanels,
      activeIndex: Math.min(node.activeIndex, validPanels.length - 1),
    };
  } else {
    const [left, right] = node.children;
    const filteredLeft = filterInvalidPanels(left);
    const filteredRight = filterInvalidPanels(right);
    if (!filteredLeft && !filteredRight) return null;
    if (!filteredLeft) return filteredRight;
    if (!filteredRight) return filteredLeft;
    return { ...node, children: [filteredLeft, filteredRight] };
  }
}

// Clean up a persisted layout by removing invalid panels
function cleanupPersistedLayout(layout: DockLayout): DockLayout {
  const cleanedRoot = filterInvalidPanels(layout.root);
  return {
    ...layout,
    root: cleanedRoot || DEFAULT_LAYOUT.root,
    floatingPanels: collapseAliasedFloatingPanels(
      layout.floatingPanels
        .map(normalizeFloatingPanel)
        .filter((panel): panel is NormalizedFloatingPanel => panel !== null)
    ),
  };
}

function cloneDockLayout(layout: DockLayout): DockLayout {
  return JSON.parse(JSON.stringify(layout)) as DockLayout;
}

function getLayoutMaxZIndex(layout: DockLayout): number {
  return layout.floatingPanels.reduce((maxZIndex, floatingPanel) => (
    Math.max(maxZIndex, floatingPanel.zIndex)
  ), 1000);
}

function requestDockLayoutTransition(durationMs = DOCK_LAYOUT_TRANSITION_DURATION_MS): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(DOCK_LAYOUT_TRANSITION_EVENT, {
    detail: { durationMs },
  }));
}

function cleanupSavedTrackTypeCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(MAX_SAVED_TIMELINE_TRACKS_PER_TYPE, Math.floor(value)));
}

function cleanupSavedTimelineLayout(timeline: SavedDockTimelineLayout | undefined): SavedDockTimelineLayout | undefined {
  if (!timeline || typeof timeline !== 'object') {
    return undefined;
  }

  const cleaned: SavedDockTimelineLayout = {};
  if (
    typeof timeline.audioDisplayMode === 'string'
    && VALID_TIMELINE_AUDIO_DISPLAY_MODES.has(timeline.audioDisplayMode)
  ) {
    cleaned.audioDisplayMode = timeline.audioDisplayMode;
  }
  if (typeof timeline.audioLayerAdvancedMode === 'boolean') {
    cleaned.audioLayerAdvancedMode = timeline.audioLayerAdvancedMode;
  }
  if (typeof timeline.audioFocusMode === 'boolean') {
    cleaned.audioFocusMode = timeline.audioFocusMode;
  }
  if (
    typeof timeline.trackFocusMode === 'string'
    && VALID_TIMELINE_TRACK_FOCUS_MODES.has(timeline.trackFocusMode)
  ) {
    cleaned.trackFocusMode = timeline.trackFocusMode;
  }
  if (typeof timeline.trackHeaderWidth === 'number' && Number.isFinite(timeline.trackHeaderWidth)) {
    cleaned.trackHeaderWidth = timeline.trackHeaderWidth;
  }
  if (timeline.timelineSplitRatio === null) {
    cleaned.timelineSplitRatio = null;
  } else if (typeof timeline.timelineSplitRatio === 'number' && Number.isFinite(timeline.timelineSplitRatio)) {
    cleaned.timelineSplitRatio = Math.max(0, Math.min(1, timeline.timelineSplitRatio));
  }

  if (
    timeline.trackHeights
    && typeof timeline.trackHeights === 'object'
    && !Array.isArray(timeline.trackHeights)
  ) {
    const trackHeights: Record<string, number> = {};
    for (const [trackId, height] of Object.entries(timeline.trackHeights)) {
      if (typeof height === 'number' && Number.isFinite(height)) {
        trackHeights[trackId] = height;
      }
    }
    if (Object.keys(trackHeights).length > 0) {
      cleaned.trackHeights = trackHeights;
    }
  }
  if (
    timeline.trackTypeHeights
    && typeof timeline.trackTypeHeights === 'object'
    && !Array.isArray(timeline.trackTypeHeights)
  ) {
    const trackTypeHeights: Partial<Record<'video' | 'audio', number>> = {};
    if (typeof timeline.trackTypeHeights.video === 'number' && Number.isFinite(timeline.trackTypeHeights.video)) {
      trackTypeHeights.video = timeline.trackTypeHeights.video;
    }
    if (typeof timeline.trackTypeHeights.audio === 'number' && Number.isFinite(timeline.trackTypeHeights.audio)) {
      trackTypeHeights.audio = timeline.trackTypeHeights.audio;
    }
    if (Object.keys(trackTypeHeights).length > 0) {
      cleaned.trackTypeHeights = trackTypeHeights;
    }
  }
  if (
    timeline.trackVisibility
    && typeof timeline.trackVisibility === 'object'
    && !Array.isArray(timeline.trackVisibility)
  ) {
    const trackVisibility: Record<string, boolean> = {};
    for (const [trackId, visible] of Object.entries(timeline.trackVisibility)) {
      if (typeof visible === 'boolean') {
        trackVisibility[trackId] = visible;
      }
    }
    if (Object.keys(trackVisibility).length > 0) {
      cleaned.trackVisibility = trackVisibility;
    }
  }
  if (
    timeline.trackTypeVisibility
    && typeof timeline.trackTypeVisibility === 'object'
    && !Array.isArray(timeline.trackTypeVisibility)
  ) {
    const trackTypeVisibility: Partial<Record<'video' | 'audio', boolean>> = {};
    if (typeof timeline.trackTypeVisibility.video === 'boolean') {
      trackTypeVisibility.video = timeline.trackTypeVisibility.video;
    }
    if (typeof timeline.trackTypeVisibility.audio === 'boolean') {
      trackTypeVisibility.audio = timeline.trackTypeVisibility.audio;
    }
    if (Object.keys(trackTypeVisibility).length > 0) {
      cleaned.trackTypeVisibility = trackTypeVisibility;
    }
  }
  if (
    timeline.trackTypeCounts
    && typeof timeline.trackTypeCounts === 'object'
    && !Array.isArray(timeline.trackTypeCounts)
  ) {
    const trackTypeCounts: Partial<Record<TimelineTrackType, number>> = {};
    for (const type of TIMELINE_TRACK_TYPES) {
      const count = cleanupSavedTrackTypeCount(timeline.trackTypeCounts[type]);
      if (count !== null) {
        trackTypeCounts[type] = count;
      }
    }
    if (Object.keys(trackTypeCounts).length > 0) {
      cleaned.trackTypeCounts = trackTypeCounts;
    }
  }
  if (
    timeline.trackTypeLayouts
    && typeof timeline.trackTypeLayouts === 'object'
    && !Array.isArray(timeline.trackTypeLayouts)
  ) {
    const trackTypeLayouts: Partial<Record<TimelineTrackType, SavedDockTimelineTrackSlotLayout[]>> = {};
    for (const type of TIMELINE_TRACK_TYPES) {
      const slots = timeline.trackTypeLayouts[type];
      if (!Array.isArray(slots)) {
        continue;
      }

      const cleanedSlots = slots
        .slice(0, MAX_SAVED_TIMELINE_TRACKS_PER_TYPE)
        .map((slot): SavedDockTimelineTrackSlotLayout => {
          const cleanedSlot: SavedDockTimelineTrackSlotLayout = {};
          if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
            return cleanedSlot;
          }
          if (typeof slot.height === 'number' && Number.isFinite(slot.height)) {
            cleanedSlot.height = slot.height;
          }
          if (typeof slot.visible === 'boolean') {
            cleanedSlot.visible = slot.visible;
          }
          return cleanedSlot;
        });

      if (cleanedSlots.length > 0) {
        trackTypeLayouts[type] = cleanedSlots;
      }
    }
    if (Object.keys(trackTypeLayouts).length > 0) {
      cleaned.trackTypeLayouts = trackTypeLayouts;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function captureTimelineLayout(): SavedDockTimelineLayout {
  const timelineState = useTimelineStore.getState();
  const videoTracks = timelineState.tracks.filter((track) => track.type === 'video');
  const audioTracks = timelineState.tracks.filter((track) => track.type === 'audio');
  const firstVideoTrack = videoTracks[0];
  const firstAudioTrack = audioTracks[0];
  const toTrackSlotLayouts = (tracks: typeof timelineState.tracks): SavedDockTimelineTrackSlotLayout[] => (
    tracks.map((track) => ({
      height: track.height,
      visible: track.visible !== false,
    }))
  );

  return {
    audioDisplayMode: timelineState.audioDisplayMode,
    audioLayerAdvancedMode: timelineState.audioLayerAdvancedMode !== false,
    audioFocusMode: timelineState.audioFocusMode,
    trackFocusMode: timelineState.trackFocusMode,
    trackHeaderWidth: timelineState.trackHeaderWidth,
    timelineSplitRatio: timelineState.timelineSplitRatio,
    trackHeights: Object.fromEntries(
      timelineState.tracks.map((track) => [track.id, track.height]),
    ),
    trackTypeHeights: {
      ...(firstVideoTrack ? { video: firstVideoTrack.height } : {}),
      ...(firstAudioTrack ? { audio: firstAudioTrack.height } : {}),
    },
    trackVisibility: Object.fromEntries(
      timelineState.tracks.map((track) => [track.id, track.visible !== false]),
    ),
    trackTypeVisibility: {
      ...(firstVideoTrack ? { video: firstVideoTrack.visible !== false } : {}),
      ...(firstAudioTrack ? { audio: firstAudioTrack.visible !== false } : {}),
    },
    trackTypeCounts: {
      video: videoTracks.length,
      audio: audioTracks.length,
    },
    trackTypeLayouts: {
      video: toTrackSlotLayouts(videoTracks),
      audio: toTrackSlotLayouts(audioTracks),
    },
  };
}

function getTimelineTrackTypeTargetCount(
  timeline: SavedDockTimelineLayout,
  type: TimelineTrackType,
): number {
  return Math.max(
    timeline.trackTypeCounts?.[type] ?? 0,
    timeline.trackTypeLayouts?.[type]?.length ?? 0,
  );
}

function ensureTimelineTrackTypeCounts(timeline: SavedDockTimelineLayout): void {
  for (const type of TIMELINE_TRACK_TYPES) {
    const targetCount = getTimelineTrackTypeTargetCount(timeline, type);
    if (targetCount <= 0) {
      continue;
    }

    let currentCount = useTimelineStore.getState().tracks.filter((track) => track.type === type).length;
    while (currentCount < targetCount) {
      useTimelineStore.getState().addTrack(type);
      const nextCount = useTimelineStore.getState().tracks.filter((track) => track.type === type).length;
      if (nextCount <= currentCount) {
        break;
      }
      currentCount = nextCount;
    }
  }
}

function applySavedTimelineLayout(timeline: SavedDockTimelineLayout | undefined): void {
  const cleaned = cleanupSavedTimelineLayout(timeline);
  if (!cleaned) {
    return;
  }

  ensureTimelineTrackTypeCounts(cleaned);

  const timelineStore = useTimelineStore.getState();
  if (cleaned.audioDisplayMode) {
    timelineStore.setAudioDisplayMode(cleaned.audioDisplayMode);
  }
  if (typeof cleaned.audioLayerAdvancedMode === 'boolean') {
    timelineStore.setAudioLayerAdvancedMode(cleaned.audioLayerAdvancedMode);
  }
  if (cleaned.trackFocusMode) {
    timelineStore.setTrackFocusMode(cleaned.trackFocusMode);
  } else if (typeof cleaned.audioFocusMode === 'boolean') {
    timelineStore.setAudioFocusMode(cleaned.audioFocusMode);
  }
  if (typeof cleaned.trackHeaderWidth === 'number') {
    timelineStore.setTrackHeaderWidth(cleaned.trackHeaderWidth);
  }
  if ('timelineSplitRatio' in cleaned) {
    timelineStore.setTimelineSplitRatio(cleaned.timelineSplitRatio ?? null);
  }

  const exactTrackHeightIds = new Set(Object.keys(cleaned.trackHeights ?? {}));
  if (cleaned.trackHeights) {
    const currentTrackIds = new Set(useTimelineStore.getState().tracks.map((track) => track.id));
    for (const [trackId, height] of Object.entries(cleaned.trackHeights)) {
      if (currentTrackIds.has(trackId)) {
        useTimelineStore.getState().setTrackHeight(trackId, height);
      }
    }
  }

  const indexedTrackHeightIds = new Set<string>();
  if (cleaned.trackTypeLayouts) {
    for (const type of TIMELINE_TRACK_TYPES) {
      const slots = cleaned.trackTypeLayouts[type] ?? [];
      if (slots.length === 0) {
        continue;
      }

      const currentTracks = useTimelineStore.getState().tracks.filter((track) => track.type === type);
      slots.forEach((slot, index) => {
        const track = currentTracks[index];
        if (!track || exactTrackHeightIds.has(track.id) || typeof slot.height !== 'number') {
          return;
        }
        useTimelineStore.getState().setTrackHeight(track.id, slot.height);
        indexedTrackHeightIds.add(track.id);
      });
    }
  }

  if (cleaned.trackTypeHeights) {
    const currentTracks = useTimelineStore.getState().tracks;
    for (const track of currentTracks) {
      if (exactTrackHeightIds.has(track.id) || indexedTrackHeightIds.has(track.id)) {
        continue;
      }
      const typeHeight = cleaned.trackTypeHeights[track.type];
      if (typeof typeHeight === 'number') {
        useTimelineStore.getState().setTrackHeight(track.id, typeHeight);
      }
    }
  }

  const exactTrackVisibilityIds = new Set(Object.keys(cleaned.trackVisibility ?? {}));
  if (cleaned.trackVisibility) {
    const currentTrackIds = new Set(useTimelineStore.getState().tracks.map((track) => track.id));
    for (const [trackId, visible] of Object.entries(cleaned.trackVisibility)) {
      if (currentTrackIds.has(trackId)) {
        useTimelineStore.getState().setTrackVisible(trackId, visible);
      }
    }
  }

  const indexedTrackVisibilityIds = new Set<string>();
  if (cleaned.trackTypeLayouts) {
    for (const type of TIMELINE_TRACK_TYPES) {
      const slots = cleaned.trackTypeLayouts[type] ?? [];
      if (slots.length === 0) {
        continue;
      }

      const currentTracks = useTimelineStore.getState().tracks.filter((track) => track.type === type);
      slots.forEach((slot, index) => {
        const track = currentTracks[index];
        if (!track || exactTrackVisibilityIds.has(track.id) || typeof slot.visible !== 'boolean') {
          return;
        }
        useTimelineStore.getState().setTrackVisible(track.id, slot.visible);
        indexedTrackVisibilityIds.add(track.id);
      });
    }
  }

  if (cleaned.trackTypeVisibility) {
    const currentTracks = useTimelineStore.getState().tracks;
    for (const track of currentTracks) {
      if (exactTrackVisibilityIds.has(track.id) || indexedTrackVisibilityIds.has(track.id)) {
        continue;
      }
      const typeVisible = cleaned.trackTypeVisibility[track.type];
      if (typeof typeVisible === 'boolean') {
        useTimelineStore.getState().setTrackVisible(track.id, typeVisible);
      }
    }
  }
}

function cleanupSavedLayout(savedLayout: SavedDockLayout): SavedDockLayout {
  return {
    ...savedLayout,
    layout: cleanupPersistedLayout(savedLayout.layout),
    favorite: savedLayout.favorite === true,
    factory: savedLayout.factory === true || isFactoryDockLayoutId(savedLayout.id),
    timeline: cleanupSavedTimelineLayout(savedLayout.timeline),
  };
}

function areDockLayoutsEqual(left: DockLayout, right: DockLayout): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getMatchingEditableSavedLayout(
  savedLayouts: SavedDockLayout[],
  layout: DockLayout,
): SavedDockLayout | null {
  return savedLayouts.find((savedLayout) => (
    areDockLayoutsEqual(savedLayout.layout, layout) && !isProtectedFactoryDockLayout(savedLayout)
  )) ?? null;
}

// Default editing layout: Media left, Preview center, Properties right, Timeline bottom.
const DEFAULT_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'root-split',
    direction: 'vertical',
    ratio: 0.6698039215686274,
    children: [
      {
        kind: 'split',
        id: 'top-split',
        direction: 'horizontal',
        ratio: 0.29449423815621,
        children: [
          {
            kind: 'tab-group',
            id: 'left-group',
            panels: [
              { id: 'media', type: 'media', title: 'Media' },
            ],
            activeIndex: 0,
          },
          {
                kind: 'split',
                id: 'center-right-split',
                direction: 'horizontal',
                ratio: 0.7109300593133233,
                children: [
                  {
                    kind: 'tab-group',
                id: 'preview-group',
                panels: [
                  { id: 'preview', type: 'preview', title: 'Preview' },
                ],
                activeIndex: 0,
              },
              {
                kind: 'tab-group',
                id: 'right-group',
                panels: [
                  { id: 'clip-properties', type: 'clip-properties', title: 'Properties' },
                  { id: 'history', type: 'history', title: 'History' },
                ],
                activeIndex: 0,
              },
            ],
          },
        ],
      },
      {
        kind: 'tab-group',
        id: 'timeline-group',
        panels: [{ id: 'timeline', type: 'timeline', title: 'Timeline' }],
        activeIndex: 0,
      },
    ],
  },
  floatingPanels: [],
  panelZoom: {
    'clip-properties': 1,
    history: 1,
  },
};

const AUDIO_EDIT_LAYOUT: DockLayout = {
  root: {
    kind: 'split',
    id: 'root-split',
    direction: 'vertical',
    ratio: 0.61,
    children: [
      {
        kind: 'tab-group',
        id: 'timeline-group',
        panels: [{ id: 'timeline', type: 'timeline', title: 'Timeline' }],
        activeIndex: 0,
      },
      {
        kind: 'split',
        id: 'audio-edit-bottom-split',
        direction: 'horizontal',
        ratio: 0.14,
        children: [
          {
            kind: 'tab-group',
            id: 'left-group',
            panels: [
              { id: 'media', type: 'media', title: 'Media' },
            ],
            activeIndex: 0,
          },
          {
            kind: 'split',
            id: 'audio-edit-mixer-properties-split',
            direction: 'horizontal',
            ratio: 0.8,
            children: [
              {
                kind: 'tab-group',
                id: 'audio-mixer-group',
                panels: [
                  { id: 'audio-mixer', type: 'audio-mixer', title: 'Audio Mixer' },
                ],
                activeIndex: 0,
              },
              {
                kind: 'tab-group',
                id: 'right-group',
                panels: [
                  { id: 'clip-properties', type: 'clip-properties', title: 'Properties' },
                  { id: 'history', type: 'history', title: 'History' },
                ],
                activeIndex: 0,
              },
            ],
          },
        ],
      },
    ],
  },
  floatingPanels: [],
  panelZoom: {
    'clip-properties': 1,
    history: 1,
    'audio-mixer': 1,
  },
};

export const FACTORY_VIDEO_EDIT_LAYOUT_ID = 'factory-video-edit';
export const FACTORY_AUDIO_EDIT_LAYOUT_ID = 'factory-audio-edit';
const FACTORY_DOCK_LAYOUT_IDS = new Set([FACTORY_VIDEO_EDIT_LAYOUT_ID, FACTORY_AUDIO_EDIT_LAYOUT_ID]);
const FACTORY_DOCK_LAYOUT_NAMES = new Map<string, string>([
  [FACTORY_VIDEO_EDIT_LAYOUT_ID, 'VIDEO EDIT'],
  [FACTORY_AUDIO_EDIT_LAYOUT_ID, 'AUDIO EDIT'],
]);
const FACTORY_DOCK_LAYOUT_NAME_TO_ID = new Map<string, string>(
  Array.from(FACTORY_DOCK_LAYOUT_NAMES.entries()).map(([id, name]) => [name.toLowerCase(), id]),
);
export const CAN_EDIT_FACTORY_DOCK_LAYOUTS = import.meta.env.DEV;

const VIDEO_EDIT_TIMELINE_LAYOUT: SavedDockTimelineLayout = {
  audioDisplayMode: 'detailed',
  audioLayerAdvancedMode: true,
  audioFocusMode: false,
  trackFocusMode: 'balanced',
  trackHeaderWidth: 210,
  timelineSplitRatio: null,
  trackTypeHeights: {
    video: 70,
    audio: 48,
  },
  trackTypeVisibility: {
    video: true,
    audio: true,
  },
  trackTypeCounts: {
    video: 2,
    audio: 1,
  },
  trackTypeLayouts: {
    video: [
      { height: 70, visible: true },
      { height: 70, visible: true },
    ],
    audio: [
      { height: 48, visible: true },
    ],
  },
};

const AUDIO_EDIT_TIMELINE_LAYOUT: SavedDockTimelineLayout = {
  audioDisplayMode: 'detailed',
  audioLayerAdvancedMode: true,
  audioFocusMode: true,
  trackFocusMode: 'audio',
  trackHeaderWidth: 210,
  timelineSplitRatio: null,
  trackTypeHeights: {
    video: 40,
    audio: 96,
  },
  trackTypeVisibility: {
    video: true,
    audio: true,
  },
  trackTypeCounts: {
    video: 2,
    audio: 1,
  },
  trackTypeLayouts: {
    video: [
      { height: 40, visible: true },
      { height: 40, visible: true },
    ],
    audio: [
      { height: 96, visible: true },
    ],
  },
};

const FACTORY_SAVED_DOCK_LAYOUTS: SavedDockLayout[] = [
  {
    id: FACTORY_VIDEO_EDIT_LAYOUT_ID,
    name: 'VIDEO EDIT',
    layout: DEFAULT_LAYOUT,
    timeline: VIDEO_EDIT_TIMELINE_LAYOUT,
    createdAt: 0,
    updatedAt: 3,
    favorite: true,
    factory: true,
  },
  {
    id: FACTORY_AUDIO_EDIT_LAYOUT_ID,
    name: 'AUDIO EDIT',
    layout: AUDIO_EDIT_LAYOUT,
    timeline: AUDIO_EDIT_TIMELINE_LAYOUT,
    createdAt: 0,
    updatedAt: 3,
    favorite: true,
    factory: true,
  },
];

export function isFactoryDockLayoutId(layoutId: string | null | undefined): boolean {
  return typeof layoutId === 'string' && FACTORY_DOCK_LAYOUT_IDS.has(layoutId);
}

export function isFactoryDockLayout(savedLayout: SavedDockLayout | null | undefined): boolean {
  return savedLayout?.factory === true || isFactoryDockLayoutId(savedLayout?.id);
}

export function isProtectedFactoryDockLayout(savedLayout: SavedDockLayout | null | undefined): boolean {
  return isFactoryDockLayout(savedLayout) && !CAN_EDIT_FACTORY_DOCK_LAYOUTS;
}

function getFactoryDockLayoutIdByName(name: string): string | null {
  return FACTORY_DOCK_LAYOUT_NAME_TO_ID.get(name.trim().toLowerCase()) ?? null;
}

function getFactoryDockLayoutIdForSavedLayout(savedLayout: SavedDockLayout): string | null {
  return isFactoryDockLayoutId(savedLayout.id)
    ? savedLayout.id
    : getFactoryDockLayoutIdByName(savedLayout.name);
}

function cloneSavedDockLayout(savedLayout: SavedDockLayout): SavedDockLayout {
  return JSON.parse(JSON.stringify(savedLayout)) as SavedDockLayout;
}

export function getFactoryDockLayouts(): SavedDockLayout[] {
  return FACTORY_SAVED_DOCK_LAYOUTS.map(cloneSavedDockLayout);
}

function mergeFactoryDockLayouts(savedLayouts: SavedDockLayout[]): SavedDockLayout[] {
  const devOverrides = new Map<string, SavedDockLayout>();
  const factoryFavoriteOverrides = new Map<string, boolean>();
  const userLayouts: SavedDockLayout[] = [];

  for (const savedLayout of savedLayouts) {
    const factoryId = getFactoryDockLayoutIdForSavedLayout(savedLayout);
    if (factoryId) {
      factoryFavoriteOverrides.set(factoryId, savedLayout.favorite === true);
      if (CAN_EDIT_FACTORY_DOCK_LAYOUTS) {
        devOverrides.set(factoryId, {
          ...savedLayout,
          id: factoryId,
          name: FACTORY_DOCK_LAYOUT_NAMES.get(factoryId) ?? savedLayout.name,
          factory: true,
          favorite: savedLayout.favorite === true,
        });
      }
      continue;
    }

    userLayouts.push(savedLayout);
  }

  const factoryLayouts = FACTORY_SAVED_DOCK_LAYOUTS.map((factoryLayout) => {
    const override = devOverrides.get(factoryLayout.id);
    if (override) {
      return cloneSavedDockLayout({
        ...override,
        factory: true,
      });
    }

    return cloneSavedDockLayout({
      ...factoryLayout,
      favorite: factoryFavoriteOverrides.get(factoryLayout.id) ?? factoryLayout.favorite,
    });
  });

  return [...factoryLayouts, ...userLayouts];
}

function panelTypesForGroup(layout: DockLayout, groupId: string): PanelType[] | null {
  const group = findTabGroupById(layout.root, groupId);
  if (!group) {
    return null;
  }
  return group.panels.map((panel) => resolvePanelType(panel.type));
}

function arePanelTypeListsEqual(left: PanelType[] | null, right: PanelType[]): boolean {
  return left !== null
    && left.length === right.length
    && left.every((type, index) => type === right[index]);
}

function isLegacyFactoryDefaultLayout(layout: DockLayout): boolean {
  if (layout.floatingPanels.length > 0 || Object.keys(layout.panelZoom ?? {}).length > 0) {
    return false;
  }
  const root = layout.root;
  if (root.kind !== 'split' || root.id !== 'root-split' || root.direction !== 'vertical' || root.ratio !== 0.6) {
    return false;
  }
  const top = root.children[0];
  if (top.kind !== 'split' || top.id !== 'top-split' || top.direction !== 'horizontal' || top.ratio !== 0.15) {
    return false;
  }
  const centerRight = top.children[1];
  if (
    centerRight.kind !== 'split'
    || centerRight.id !== 'center-right-split'
    || centerRight.direction !== 'horizontal'
    || centerRight.ratio !== 0.67
  ) {
    return false;
  }

  const leftGroup = findTabGroupById(layout.root, 'left-group');
  const previewGroup = findTabGroupById(layout.root, 'preview-group');
  const rightGroup = findTabGroupById(layout.root, 'right-group');
  const timelineGroup = findTabGroupById(layout.root, 'timeline-group');
  const leftPanelTypes = panelTypesForGroup(layout, 'left-group');
  return (
    (
      arePanelTypeListsEqual(leftPanelTypes, ['media', 'ai-chat', 'download'])
      || arePanelTypeListsEqual(leftPanelTypes, ['media', 'ai-chat'])
    )
    && arePanelTypeListsEqual(panelTypesForGroup(layout, 'preview-group'), ['preview'])
    && arePanelTypeListsEqual(panelTypesForGroup(layout, 'timeline-group'), ['timeline'])
    && leftGroup?.activeIndex === 0
    && previewGroup?.activeIndex === 0
    && rightGroup?.activeIndex === 3
    && timelineGroup?.activeIndex === 0
    && arePanelTypeListsEqual(panelTypesForGroup(layout, 'right-group'), [
      'export',
      'clip-properties',
      'node-workspace',
      'scope-waveform',
      'scope-histogram',
      'scope-vectorscope',
    ])
  );
}

function cleanupRestoredCurrentLayout(layout: DockLayout): DockLayout {
  const cleanedLayout = cleanupPersistedLayout(layout);
  return isLegacyFactoryDefaultLayout(cleanedLayout)
    ? cloneDockLayout(DEFAULT_LAYOUT)
    : cleanedLayout;
}

const DEFAULT_DRAG_STATE: DockDragState = {
  isDragging: false,
  draggedPanel: null,
  sourceGroupId: null,
  dropTarget: null,
  dragOffset: { x: 0, y: 0 },
  currentPos: { x: 0, y: 0 },
};

interface DockState {
  layout: DockLayout;
  dragState: DockDragState;
  maxZIndex: number;
  hoveredTabTarget: HoveredDockTabTarget | null;
  maximizedPanelId: string | null;
  savedLayouts: SavedDockLayout[];
  defaultSavedLayoutId: string | null;
  activeSavedLayoutId: string | null;

  // Layout mutations
  setActiveTab: (groupId: string, index: number) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
  movePanel: (panelId: string, sourceGroupId: string, target: DropTarget) => void;
  closePanel: (panelId: string, groupId: string) => void;
  closePanelById: (panelId: string) => void;
  changePanelType: (panelId: string, type: PanelType) => void;

  // Floating panel actions
  floatPanel: (panelId: string, groupId: string, position: { x: number; y: number }) => void;
  dockFloatingPanel: (floatingId: string, target: DropTarget) => void;
  updateFloatingPosition: (floatingId: string, position: { x: number; y: number }) => void;
  updateFloatingSize: (floatingId: string, size: { width: number; height: number }) => void;
  bringToFront: (floatingId: string) => void;

  // Drag state actions
  startDrag: (panel: DockPanel, sourceGroupId: string, offset: { x: number; y: number }, initialPos?: { x: number; y: number }) => void;
  updateDrag: (pos: { x: number; y: number }, dropTarget: DropTarget | null) => void;
  endDrag: () => void;
  cancelDrag: () => void;

  // Hovered/maximized dock tabs
  setHoveredTabTarget: (target: HoveredDockTabTarget | null) => void;
  clearHoveredTabTarget: (panelId?: string) => void;
  setMaximizedPanel: (panelId: string | null) => void;
  toggleHoveredTabMaximized: () => void;

  // Panel zoom
  setPanelZoom: (panelId: string, zoom: number) => void;
  getPanelZoom: (panelId: string) => number;

  // Panel visibility
  getVisiblePanelTypes: () => PanelType[];
  isPanelTypeVisible: (type: PanelType) => boolean;
  togglePanelType: (type: PanelType) => void;
  showPanelType: (type: PanelType) => void;
  hidePanelType: (type: PanelType) => void;
  activatePanelType: (type: PanelType) => void;
  // Add a panel type as a tab into a specific group (used by the per-panel "+" button)
  addPanelTypeToGroup: (type: PanelType, groupId: string) => void;

  // Multiple preview panels
  addPreviewPanel: (compositionId: string | null) => void;
  updatePanelData: (panelId: string, data: Partial<import('../types/dock').PanelData>) => void;

  // Layout management
  saveNamedLayout: (name: string) => SavedDockLayout | null;
  saveCurrentNamedLayout: () => SavedDockLayout | null;
  loadSavedLayout: (layoutId: string) => void;
  setDefaultSavedLayout: (layoutId: string | null) => void;
  toggleFavoriteSavedLayout: (layoutId: string) => void;
  resetLayout: () => void;
  saveLayoutAsDefault: () => void;

  // Project persistence (for saving/loading layout from project file)
  getLayoutForProject: () => DockLayout;
  setLayoutFromProject: (layout: DockLayout) => void;
}

export const useDockStore = create<DockState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        layout: cloneDockLayout(DEFAULT_LAYOUT),
        dragState: DEFAULT_DRAG_STATE,
        maxZIndex: 1000,
        hoveredTabTarget: null,
        maximizedPanelId: null,
        savedLayouts: getFactoryDockLayouts(),
        defaultSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,
        activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID,

        setActiveTab: (groupId, index) => {
          set((state) => ({
            layout: updateNodeInLayout(state.layout, groupId, (node) => {
              if (node.kind === 'tab-group') {
                return { ...node, activeIndex: Math.min(index, node.panels.length - 1) };
              }
              return node;
            }),
          }));
        },

        setSplitRatio: (splitId, ratio) => {
          set((state) => ({
            layout: updateNodeInLayout(state.layout, splitId, (node) => {
              if (node.kind === 'split') {
                return { ...node, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
              }
              return node;
            }),
          }));
        },

        movePanel: (panelId, sourceGroupId, target) => {
          const { layout } = get();
          const targetAfterRemoval = adjustDropTargetForMovedPanel(layout.root, panelId, sourceGroupId, target);

          // Remove panel from source
          let newLayout = removePanel(layout, panelId, sourceGroupId);

          // Insert at target
          const panel = findPanelById(layout, panelId);
          if (panel) {
            newLayout = insertPanelAtTarget(newLayout, panel, targetAfterRemoval);
          }

          // Clean up empty groups and single-child splits
          newLayout = {
            ...newLayout,
            root: collapseSingleChildSplits(newLayout.root),
          };

          set({ layout: newLayout });
        },

        closePanel: (panelId, groupId) => {
          const { layout } = get();
          let newLayout = removePanel(layout, panelId, groupId);
          newLayout = {
            ...newLayout,
            root: collapseSingleChildSplits(newLayout.root),
          };
          set((state) => ({
            layout: newLayout,
            hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
            maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
          }));
        },

        closePanelById: (panelId) => {
          const { layout } = get();
          // First check floating panels
          const floating = layout.floatingPanels.find(f => f.panel.id === panelId);
          if (floating) {
            set((state) => ({
              layout: {
                ...layout,
                floatingPanels: layout.floatingPanels.filter(f => f.panel.id !== panelId),
              },
              hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
              maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
            }));
            return;
          }
          // Find in docked panels
          const groupId = findGroupIdByPanelId(layout.root, panelId);
          if (groupId) {
            let newLayout = removePanel(layout, panelId, groupId);
            newLayout = {
              ...newLayout,
              root: collapseSingleChildSplits(newLayout.root),
            };
            set((state) => ({
              layout: newLayout,
              hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId ? null : state.hoveredTabTarget,
              maximizedPanelId: state.maximizedPanelId === panelId ? null : state.maximizedPanelId,
            }));
          }
        },

        changePanelType: (panelId, type) => {
          const resolvedType = resolvePanelType(type);
          if (!VALID_PANEL_TYPES.has(resolvedType)) return;

          const { layout } = get();
          const sourceGroupId = findGroupIdByPanelId(layout.root, panelId);
          if (!sourceGroupId) return;
          const sourcePanel = findPanelById(layout, panelId);
          if (!sourcePanel || resolvePanelType(sourcePanel.type) === resolvedType) return;

          let nextLayout = layout;
          let replacementPanel: DockPanel | null = null;

          const existingDockedPanel = findPanelAndGroup(nextLayout.root, resolvedType);
          if (existingDockedPanel && existingDockedPanel.panel.id !== panelId) {
            replacementPanel = existingDockedPanel.panel;
            nextLayout = removePanel(nextLayout, existingDockedPanel.panel.id, existingDockedPanel.groupId);
            nextLayout = {
              ...nextLayout,
              root: collapseSingleChildSplits(nextLayout.root),
            };
          }

          if (!replacementPanel) {
            const floatingPanel = nextLayout.floatingPanels.find((floating) => resolvePanelType(floating.panel.type) === resolvedType);
            if (floatingPanel && floatingPanel.panel.id !== panelId) {
              replacementPanel = floatingPanel.panel;
              nextLayout = {
                ...nextLayout,
                floatingPanels: nextLayout.floatingPanels.filter((floating) => floating.id !== floatingPanel.id),
              };
            }
          }

          if (!replacementPanel) {
            const config = getPanelConfig(resolvedType);
            replacementPanel = {
              id: resolvedType,
              type: resolvedType,
              title: config.title,
            };
          }

          nextLayout = replacePanelInLayout(nextLayout, panelId, replacementPanel);
          const nextPanelId = replacementPanel.id;
          set((state) => ({
            layout: nextLayout,
            hoveredTabTarget: state.hoveredTabTarget?.panelId === panelId || state.hoveredTabTarget?.panelId === nextPanelId
              ? null
              : state.hoveredTabTarget,
            maximizedPanelId: state.maximizedPanelId === panelId ? nextPanelId : state.maximizedPanelId,
          }));
        },

        floatPanel: (panelId, groupId, position) => {
          const { layout, maxZIndex } = get();
          const panel = findPanelById(layout, panelId);
          if (!panel) return;

          // Remove from dock
          let newLayout = removePanel(layout, panelId, groupId);
          newLayout = {
            ...newLayout,
            root: collapseSingleChildSplits(newLayout.root),
          };

          // Add as floating
          const floatingPanel: FloatingPanel = {
            id: `floating-${panelId}-${Date.now()}`,
            panel,
            position,
            size: { width: 400, height: 300 },
            zIndex: maxZIndex + 1,
          };

          set({
            layout: {
              ...newLayout,
              floatingPanels: [...newLayout.floatingPanels, floatingPanel],
            },
            maxZIndex: maxZIndex + 1,
          });
        },

        dockFloatingPanel: (floatingId, target) => {
          const { layout } = get();
          const floating = layout.floatingPanels.find((f) => f.id === floatingId);
          if (!floating) return;

          // Remove from floating
          const newFloating = layout.floatingPanels.filter((f) => f.id !== floatingId);

          // Insert at target
          const newLayout = insertPanelAtTarget(
            { ...layout, floatingPanels: newFloating },
            floating.panel,
            target
          );

          set({ layout: newLayout });
        },

        updateFloatingPosition: (floatingId, position) => {
          set((state) => ({
            layout: {
              ...state.layout,
              floatingPanels: state.layout.floatingPanels.map((f) =>
                f.id === floatingId ? { ...f, position } : f
              ),
            },
          }));
        },

        updateFloatingSize: (floatingId, size) => {
          set((state) => ({
            layout: {
              ...state.layout,
              floatingPanels: state.layout.floatingPanels.map((f) =>
                f.id === floatingId ? { ...f, size } : f
              ),
            },
          }));
        },

        bringToFront: (floatingId) => {
          const { maxZIndex } = get();
          set((state) => ({
            layout: {
              ...state.layout,
              floatingPanels: state.layout.floatingPanels.map((f) =>
                f.id === floatingId ? { ...f, zIndex: maxZIndex + 1 } : f
              ),
            },
            maxZIndex: maxZIndex + 1,
          }));
        },

        startDrag: (panel, sourceGroupId, offset, initialPos) => {
          set({
            dragState: {
              isDragging: true,
              draggedPanel: panel,
              sourceGroupId,
              dropTarget: null,
              dragOffset: offset,
              currentPos: initialPos || { x: 0, y: 0 },
            },
          });
        },

        updateDrag: (pos, dropTarget) => {
          set((state) => ({
            dragState: {
              ...state.dragState,
              currentPos: pos,
              dropTarget,
            },
          }));
        },

        endDrag: () => {
          const { dragState } = get();
          if (dragState.isDragging && dragState.draggedPanel && dragState.dropTarget && dragState.sourceGroupId) {
            get().movePanel(dragState.draggedPanel.id, dragState.sourceGroupId, dragState.dropTarget);
          }
          set({ dragState: DEFAULT_DRAG_STATE });
        },

        cancelDrag: () => {
          set({ dragState: DEFAULT_DRAG_STATE });
        },

        setHoveredTabTarget: (target) => {
          set({ hoveredTabTarget: target });
        },

        clearHoveredTabTarget: (panelId) => {
          set((state) => {
            if (!state.hoveredTabTarget) return {};
            if (panelId && state.hoveredTabTarget.panelId !== panelId) return {};
            return { hoveredTabTarget: null };
          });
        },

        setMaximizedPanel: (panelId) => {
          set({ maximizedPanelId: panelId });
        },

        toggleHoveredTabMaximized: () => {
          const { hoveredTabTarget, maximizedPanelId, layout, setActiveTab } = get();

          if (!hoveredTabTarget) {
            if (maximizedPanelId) {
              set({ maximizedPanelId: null });
            }
            return;
          }

          if (maximizedPanelId === hoveredTabTarget.panelId) {
            set({ maximizedPanelId: null });
            return;
          }

          if (hoveredTabTarget.kind === 'panel') {
            const group = findTabGroupById(layout.root, hoveredTabTarget.groupId);
            const panelIndex = group?.panels.findIndex(panel => panel.id === hoveredTabTarget.panelId) ?? -1;
            if (!group || panelIndex < 0) {
              set({ hoveredTabTarget: null, maximizedPanelId: null });
              return;
            }
            setActiveTab(group.id, panelIndex);
          } else if (hoveredTabTarget.compositionId) {
            useMediaStore.getState().setActiveComposition(hoveredTabTarget.compositionId);
          }

          set({ maximizedPanelId: hoveredTabTarget.panelId });
        },

        setPanelZoom: (panelId, zoom) => {
          const clampedZoom = Math.max(0.5, Math.min(2.0, zoom));
          set((state) => ({
            layout: {
              ...state.layout,
              panelZoom: {
                ...state.layout.panelZoom,
                [panelId]: clampedZoom,
              },
            },
          }));
        },

        getPanelZoom: (panelId) => {
          return get().layout.panelZoom[panelId] ?? 1.0;
        },

        getVisiblePanelTypes: () => {
          const { layout } = get();
          const types: PanelType[] = [];
          collectPanelTypes(layout.root, types);
          // Also check floating panels
          layout.floatingPanels.forEach((f) => {
            const normalizedType = resolvePanelType(f.panel.type);
            if (VALID_PANEL_TYPES.has(normalizedType) && !types.includes(normalizedType)) {
              types.push(normalizedType);
            }
          });
          return types;
        },

        isPanelTypeVisible: (type) => {
          return get().getVisiblePanelTypes().includes(resolvePanelType(type));
        },

        togglePanelType: (type) => {
          const { isPanelTypeVisible, showPanelType, hidePanelType } = get();
          if (isPanelTypeVisible(type)) {
            hidePanelType(type);
          } else {
            showPanelType(type);
          }
        },

        showPanelType: (type) => {
          const resolvedType = resolvePanelType(type);
          if (!VALID_PANEL_TYPES.has(resolvedType)) return;
          const { layout, isPanelTypeVisible } = get();
          if (isPanelTypeVisible(resolvedType)) return; // Already visible

          const config = getPanelConfig(resolvedType);
          const newPanel: DockPanel = {
            id: resolvedType,
            type: resolvedType,
            title: config.title,
          };

          // Find the right-group to add to, or create a new floating panel
          const rightGroup = findTabGroupById(layout.root, 'right-group');
          if (rightGroup) {
            const newLayout = insertPanelAtTarget(layout, newPanel, {
              groupId: 'right-group',
              position: 'center',
            });
            set({ layout: newLayout });
          } else {
            // Fallback: find any tab group
            const anyGroup = findFirstTabGroup(layout.root);
            if (anyGroup) {
              const newLayout = insertPanelAtTarget(layout, newPanel, {
                groupId: anyGroup.id,
                position: 'center',
              });
              set({ layout: newLayout });
            }
          }
        },

        hidePanelType: (type) => {
          const resolvedType = resolvePanelType(type);
          const { layout } = get();

          // Find and remove the panel from the layout
          const result = findPanelAndGroup(layout.root, resolvedType);
          if (result) {
            let newLayout = removePanel(layout, result.panel.id, result.groupId);
            newLayout = {
              ...newLayout,
              root: collapseSingleChildSplits(newLayout.root),
            };
            set((state) => ({
              layout: newLayout,
              hoveredTabTarget: state.hoveredTabTarget?.panelId === result.panel.id ? null : state.hoveredTabTarget,
              maximizedPanelId: state.maximizedPanelId === result.panel.id ? null : state.maximizedPanelId,
            }));
          }

          // Also check floating panels
          const floatingIndex = layout.floatingPanels.findIndex((f) => resolvePanelType(f.panel.type) === resolvedType);
          if (floatingIndex >= 0) {
            set((state) => ({
              layout: {
                ...layout,
                floatingPanels: layout.floatingPanels.filter((_, i) => i !== floatingIndex),
              },
              hoveredTabTarget: state.hoveredTabTarget?.panelId === layout.floatingPanels[floatingIndex]?.panel.id ? null : state.hoveredTabTarget,
              maximizedPanelId: state.maximizedPanelId === layout.floatingPanels[floatingIndex]?.panel.id ? null : state.maximizedPanelId,
            }));
          }
        },

        activatePanelType: (type) => {
          const resolvedType = resolvePanelType(type);
          if (!VALID_PANEL_TYPES.has(resolvedType)) return;
          const { setActiveTab, showPanelType, isPanelTypeVisible, bringToFront } = get();

          // First make sure the panel is visible
          if (!isPanelTypeVisible(resolvedType)) {
            showPanelType(resolvedType);
          }

          const { layout } = get();

          // Find the panel in the layout and activate it
          const result = findPanelAndGroup(layout.root, resolvedType);
          if (result) {
            // Find the actual tab group to get the panel index
            const group = findTabGroupById(layout.root, result.groupId);
            if (group) {
              const panelIndex = group.panels.findIndex((p) => resolvePanelType(p.type) === resolvedType);
              if (panelIndex >= 0) {
                setActiveTab(result.groupId, panelIndex);
              }
            }
          }

          // Also check floating panels
          const floatingPanel = layout.floatingPanels.find((f) => resolvePanelType(f.panel.type) === resolvedType);
          if (floatingPanel) {
            bringToFront(floatingPanel.id);
          }
        },

        addPanelTypeToGroup: (type, groupId) => {
          const resolvedType = resolvePanelType(type);
          if (!VALID_PANEL_TYPES.has(resolvedType)) return;
          const { layout, isPanelTypeVisible, activatePanelType } = get();

          // Built-in panels are singletons (id === type). If already visible,
          // just focus it instead of trying to create a duplicate.
          if (isPanelTypeVisible(resolvedType)) {
            activatePanelType(resolvedType);
            return;
          }

          const config = getPanelConfig(resolvedType);
          const newPanel: DockPanel = {
            id: resolvedType,
            type: resolvedType,
            title: config.title,
          };

          // Insert into the requested group, falling back to any group.
          const targetGroupId = findTabGroupById(layout.root, groupId)
            ? groupId
            : findFirstTabGroup(layout.root)?.id;
          if (!targetGroupId) return;

          const newLayout = insertPanelAtTarget(layout, newPanel, {
            groupId: targetGroupId,
            position: 'center',
          });
          set({ layout: newLayout });
        },

        addPreviewPanel: (compositionId) => {
          const { layout } = get();

          // Find the preview-group to add to
          const previewGroup = findTabGroupById(layout.root, 'preview-group');
          const newPanelId = `preview-${Date.now()}`;
          const newPanel: DockPanel = {
            id: newPanelId,
            type: 'preview',
            title: 'Preview',
            data: createPreviewPanelDataPatch(createPreviewPanelSource(compositionId)) as PreviewPanelData,
          };

          if (previewGroup) {
            // Insert to the RIGHT of the preview group (side-by-side)
            const newLayout = insertPanelAtTarget(layout, newPanel, {
              groupId: 'preview-group',
              position: 'right',
            });
            set({ layout: newLayout });
          } else {
            // Fallback: find any tab group or create floating
            const anyGroup = findFirstTabGroup(layout.root);
            if (anyGroup) {
              const newLayout = insertPanelAtTarget(layout, newPanel, {
                groupId: anyGroup.id,
                position: 'right',
              });
              set({ layout: newLayout });
            }
          }
        },

        updatePanelData: (panelId, data) => {
          set((state) => ({
            layout: updatePanelDataInLayout(state.layout, panelId, data),
          }));
        },

        saveNamedLayout: (name) => {
          const trimmedName = name.trim();
          if (!trimmedName) {
            return null;
          }

          const cleanedLayout = cleanupPersistedLayout(cloneDockLayout(get().layout));
          const timelineLayout = captureTimelineLayout();
          const now = Date.now();
          const existingLayout = get().savedLayouts.find((savedLayout) => (
            savedLayout.name.trim().toLowerCase() === trimmedName.toLowerCase()
          ));
          if (isProtectedFactoryDockLayout(existingLayout)) {
            return null;
          }
          const nextSavedLayout: SavedDockLayout = existingLayout
            ? {
                ...existingLayout,
                name: trimmedName,
                layout: cleanedLayout,
                timeline: timelineLayout,
                updatedAt: now,
              }
            : {
                id: `saved-layout-${now}-${Math.random().toString(36).slice(2, 8)}`,
                name: trimmedName,
                layout: cleanedLayout,
                timeline: timelineLayout,
                createdAt: now,
                updatedAt: now,
              };

          set((state) => ({
            savedLayouts: [
              nextSavedLayout,
              ...state.savedLayouts.filter((savedLayout) => savedLayout.id !== nextSavedLayout.id),
            ],
            activeSavedLayoutId: nextSavedLayout.id,
          }));

          return nextSavedLayout;
        },

        saveCurrentNamedLayout: () => {
          const { activeSavedLayoutId, savedLayouts, layout } = get();
          if (!activeSavedLayoutId) {
            return null;
          }

          const existingLayout = savedLayouts.find((savedLayout) => savedLayout.id === activeSavedLayoutId);
          if (!existingLayout) {
            set({ activeSavedLayoutId: null });
            return null;
          }
          if (isProtectedFactoryDockLayout(existingLayout)) {
            return null;
          }

          const nextSavedLayout: SavedDockLayout = {
            ...existingLayout,
            layout: cleanupPersistedLayout(cloneDockLayout(layout)),
            timeline: captureTimelineLayout(),
            updatedAt: Date.now(),
          };

          set((state) => ({
            savedLayouts: [
              nextSavedLayout,
              ...state.savedLayouts.filter((savedLayout) => savedLayout.id !== nextSavedLayout.id),
            ],
            activeSavedLayoutId: nextSavedLayout.id,
          }));

          return nextSavedLayout;
        },

        loadSavedLayout: (layoutId) => {
          const savedLayout = get().savedLayouts.find((candidate) => candidate.id === layoutId);
          if (!savedLayout) {
            return;
          }

          const nextLayout = cleanupPersistedLayout(cloneDockLayout(savedLayout.layout));
          requestDockLayoutTransition();
          set({
            layout: nextLayout,
            maxZIndex: getLayoutMaxZIndex(nextLayout),
            hoveredTabTarget: null,
            maximizedPanelId: null,
            activeSavedLayoutId: savedLayout.id,
          });
          applySavedTimelineLayout(savedLayout.timeline);
        },

        setDefaultSavedLayout: (layoutId) => {
          if (layoutId !== null && !get().savedLayouts.some((savedLayout) => savedLayout.id === layoutId)) {
            return;
          }

          set({ defaultSavedLayoutId: layoutId });
        },

        toggleFavoriteSavedLayout: (layoutId) => {
          set((state) => ({
            savedLayouts: state.savedLayouts.map((savedLayout) => (
              savedLayout.id === layoutId
                ? { ...savedLayout, favorite: savedLayout.favorite !== true }
                : savedLayout
            )),
          }));
        },

        resetLayout: () => {
          const { defaultSavedLayoutId, savedLayouts } = get();
          if (defaultSavedLayoutId) {
            const defaultSavedLayout = savedLayouts.find((savedLayout) => savedLayout.id === defaultSavedLayoutId);
            if (defaultSavedLayout) {
              const nextLayout = cleanupPersistedLayout(cloneDockLayout(defaultSavedLayout.layout));
              requestDockLayoutTransition();
              set({
                layout: nextLayout,
                maxZIndex: getLayoutMaxZIndex(nextLayout),
                hoveredTabTarget: null,
                maximizedPanelId: null,
                activeSavedLayoutId: defaultSavedLayout.id,
              });
              applySavedTimelineLayout(defaultSavedLayout.timeline);
              return;
            }
          }

          // Check if there's a legacy raw default layout
          const savedDefault = localStorage.getItem(LEGACY_DEFAULT_LAYOUT_STORAGE_KEY);
          if (savedDefault) {
            try {
              const parsed = cleanupPersistedLayout(JSON.parse(savedDefault) as DockLayout);
              const defaultTimeline = localStorage.getItem(DEFAULT_TIMELINE_LAYOUT_STORAGE_KEY);
              requestDockLayoutTransition();
              set({
                layout: parsed,
                maxZIndex: getLayoutMaxZIndex(parsed),
                hoveredTabTarget: null,
                maximizedPanelId: null,
                activeSavedLayoutId: null,
              });
              if (defaultTimeline) {
                try {
                  applySavedTimelineLayout(JSON.parse(defaultTimeline) as SavedDockTimelineLayout);
                } catch (e) {
                  log.warn('Failed to parse saved default timeline layout:', e);
                }
              }
              return;
            } catch (e) {
              log.error('Failed to parse saved default layout:', e);
            }
          }
          requestDockLayoutTransition();
          set({
            layout: cloneDockLayout(DEFAULT_LAYOUT),
            maxZIndex: getLayoutMaxZIndex(DEFAULT_LAYOUT),
            hoveredTabTarget: null,
            maximizedPanelId: null,
            activeSavedLayoutId: null,
          });
        },

        saveLayoutAsDefault: () => {
          const { layout } = get();
          const cleanedLayout = cleanupPersistedLayout(cloneDockLayout(layout));
          const timelineLayout = captureTimelineLayout();
          localStorage.setItem(LEGACY_DEFAULT_LAYOUT_STORAGE_KEY, JSON.stringify(cleanedLayout));
          localStorage.setItem(DEFAULT_TIMELINE_LAYOUT_STORAGE_KEY, JSON.stringify(timelineLayout));

          const matchingSavedLayout = getMatchingEditableSavedLayout(get().savedLayouts, cleanedLayout);
          if (matchingSavedLayout) {
            const updatedLayout: SavedDockLayout = {
              ...matchingSavedLayout,
              layout: cleanedLayout,
              timeline: timelineLayout,
              updatedAt: Date.now(),
            };
            set((state) => ({
              savedLayouts: [
                updatedLayout,
                ...state.savedLayouts.filter((savedLayout) => savedLayout.id !== updatedLayout.id),
              ],
              defaultSavedLayoutId: updatedLayout.id,
              activeSavedLayoutId: state.activeSavedLayoutId === matchingSavedLayout.id
                ? updatedLayout.id
                : state.activeSavedLayoutId,
            }));
            return;
          }

          set({ defaultSavedLayoutId: null });
        },

        getLayoutForProject: () => {
          return cleanupPersistedLayout(cloneDockLayout(get().layout));
        },

        setLayoutFromProject: (layout: DockLayout) => {
          // Clean up any invalid panel types from the loaded layout
          const cleanedLayout = cleanupPersistedLayout(layout);
          set({
            layout: cleanedLayout,
            maxZIndex: getLayoutMaxZIndex(cleanedLayout),
            hoveredTabTarget: null,
            maximizedPanelId: null,
            activeSavedLayoutId: null,
          });
        },
      }),
      {
        name: 'webvj-dock-layout',
        partialize: (state) => ({
          layout: state.layout,
          maxZIndex: state.maxZIndex,
          savedLayouts: state.savedLayouts,
          defaultSavedLayoutId: state.defaultSavedLayoutId,
          activeSavedLayoutId: state.activeSavedLayoutId,
        }),
        merge: (persistedState, currentState) => {
          const persisted = persistedState as Partial<DockState> | undefined;
          const savedLayouts = Array.isArray(persisted?.savedLayouts)
            ? mergeFactoryDockLayouts(persisted.savedLayouts.map(cleanupSavedLayout))
            : mergeFactoryDockLayouts(currentState.savedLayouts);
          const defaultSavedLayoutId = (
            typeof persisted?.defaultSavedLayoutId === 'string'
            && savedLayouts.some((savedLayout) => savedLayout.id === persisted.defaultSavedLayoutId)
          )
            ? persisted.defaultSavedLayoutId
            : FACTORY_VIDEO_EDIT_LAYOUT_ID;
          const persistedActiveSavedLayoutId = (
            typeof persisted?.activeSavedLayoutId === 'string'
            && savedLayouts.some((savedLayout) => savedLayout.id === persisted.activeSavedLayoutId)
          )
            ? persisted.activeSavedLayoutId
            : null;
          const activeSavedLayoutId = persistedActiveSavedLayoutId
            ?? (persisted?.layout ? null : FACTORY_VIDEO_EDIT_LAYOUT_ID);

          if (persisted?.layout) {
            // Clean up any invalid panel types from persisted layout
            const cleanedLayout = cleanupRestoredCurrentLayout(persisted.layout);
            return {
              ...currentState,
              layout: cleanedLayout,
              maxZIndex: persisted.maxZIndex ?? currentState.maxZIndex,
              savedLayouts,
              defaultSavedLayoutId,
              activeSavedLayoutId,
            };
          }
          return {
            ...currentState,
            savedLayouts,
            defaultSavedLayoutId,
            activeSavedLayoutId,
          };
        },
      }
    )
  )
);

// Helper: Update a node in the layout tree
function updateNodeInLayout(
  layout: DockLayout,
  nodeId: string,
  updater: (node: DockNode) => DockNode
): DockLayout {
  return {
    ...layout,
    root: updateNodeRecursive(layout.root, nodeId, updater),
  };
}

function updateNodeRecursive(
  node: DockNode,
  nodeId: string,
  updater: (node: DockNode) => DockNode
): DockNode {
  if (node.id === nodeId) {
    return updater(node);
  }
  if (node.kind === 'split') {
    return {
      ...node,
      children: [
        updateNodeRecursive(node.children[0], nodeId, updater),
        updateNodeRecursive(node.children[1], nodeId, updater),
      ] as [DockNode, DockNode],
    };
  }
  return node;
}

// Helper: Find a panel by ID in the layout
function findPanelById(layout: DockLayout, panelId: string): DockPanel | null {
  // Check floating panels
  for (const floating of layout.floatingPanels) {
    if (floating.panel.id === panelId) {
      return floating.panel;
    }
  }
  // Check docked panels
  return findPanelInNode(layout.root, panelId);
}

function findPanelInNode(node: DockNode, panelId: string): DockPanel | null {
  if (node.kind === 'tab-group') {
    return node.panels.find((p) => p.id === panelId) || null;
  }
  const left = findPanelInNode(node.children[0], panelId);
  if (left) return left;
  return findPanelInNode(node.children[1], panelId);
}

function replacePanelInLayout(layout: DockLayout, panelId: string, replacementPanel: DockPanel): DockLayout {
  return {
    ...layout,
    root: replacePanelInNode(layout.root, panelId, replacementPanel),
  };
}

function replacePanelInNode(node: DockNode, panelId: string, replacementPanel: DockPanel): DockNode {
  if (node.kind === 'tab-group') {
    const panelIndex = node.panels.findIndex((panel) => panel.id === panelId);
    if (panelIndex < 0) {
      return node;
    }

    const panels = [...node.panels];
    panels[panelIndex] = replacementPanel;
    return {
      ...node,
      panels,
      activeIndex: panelIndex,
    };
  }

  return {
    ...node,
    children: [
      replacePanelInNode(node.children[0], panelId, replacementPanel),
      replacePanelInNode(node.children[1], panelId, replacementPanel),
    ] as [DockNode, DockNode],
  };
}

// Helper: Collect all panel types in a node
function collectPanelTypes(node: DockNode, types: PanelType[]): void {
  if (node.kind === 'tab-group') {
    node.panels.forEach((p) => {
      const normalizedType = resolvePanelType(p.type);
      if (VALID_PANEL_TYPES.has(normalizedType) && !types.includes(normalizedType)) {
        types.push(normalizedType);
      }
    });
  } else {
    collectPanelTypes(node.children[0], types);
    collectPanelTypes(node.children[1], types);
  }
}

// Helper: Find a tab group by ID
function findTabGroupById(node: DockNode, groupId: string): DockTabGroup | null {
  if (node.kind === 'tab-group') {
    return node.id === groupId ? node : null;
  }
  const left = findTabGroupById(node.children[0], groupId);
  if (left) return left;
  return findTabGroupById(node.children[1], groupId);
}

// Helper: Find the first tab group in the tree
function findFirstTabGroup(node: DockNode): DockTabGroup | null {
  if (node.kind === 'tab-group') {
    return node;
  }
  const left = findFirstTabGroup(node.children[0]);
  if (left) return left;
  return findFirstTabGroup(node.children[1]);
}

// Helper: Find a panel and its group by panel type
function findPanelAndGroup(
  node: DockNode,
  panelType: PanelType
): { panel: DockPanel; groupId: string } | null {
  if (node.kind === 'tab-group') {
    const panel = node.panels.find((p) => resolvePanelType(p.type) === panelType);
    if (panel) {
      return { panel, groupId: node.id };
    }
    return null;
  }
  const left = findPanelAndGroup(node.children[0], panelType);
  if (left) return left;
  return findPanelAndGroup(node.children[1], panelType);
}

// Helper: Find a panel's group ID by panel ID
function findGroupIdByPanelId(node: DockNode, panelId: string): string | null {
  if (node.kind === 'tab-group') {
    const panel = node.panels.find((p) => p.id === panelId);
    if (panel) {
      return node.id;
    }
    return null;
  }
  const left = findGroupIdByPanelId(node.children[0], panelId);
  if (left) return left;
  return findGroupIdByPanelId(node.children[1], panelId);
}

// Helper: Update panel data in layout
function updatePanelDataInLayout(
  layout: DockLayout,
  panelId: string,
  data: Partial<PanelData>
): DockLayout {
  return {
    ...layout,
    root: updatePanelDataInNode(layout.root, panelId, data),
    floatingPanels: layout.floatingPanels.map((f) =>
      f.panel.id === panelId
        ? { ...f, panel: { ...f.panel, data: { ...f.panel.data, ...data } as PanelData } }
        : f
    ),
  };
}

function updatePanelDataInNode(
  node: DockNode,
  panelId: string,
  data: Partial<PanelData>
): DockNode {
  if (node.kind === 'tab-group') {
    const panelIndex = node.panels.findIndex((p) => p.id === panelId);
    if (panelIndex >= 0) {
      const newPanels = [...node.panels];
      newPanels[panelIndex] = {
        ...newPanels[panelIndex],
        data: { ...newPanels[panelIndex].data, ...data } as PanelData,
      };
      return { ...node, panels: newPanels };
    }
    return node;
  }
  return {
    ...node,
    children: [
      updatePanelDataInNode(node.children[0], panelId, data),
      updatePanelDataInNode(node.children[1], panelId, data),
    ] as [DockNode, DockNode],
  };
}
