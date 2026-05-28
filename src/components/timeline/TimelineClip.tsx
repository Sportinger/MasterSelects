// TimelineClip component - Clip rendering within tracks

import './TimelineClip.css';
import { memo, type CSSProperties, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { TimelineClipProps } from './types';
import { THUMB_WIDTH } from './constants';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { getLabelHex } from '../panels/media/labelColors';
import { getTimelineTrackColor, TIMELINE_TRACK_COLOR_HIDDEN } from './trackColor';
// PickWhip disabled
import {
  isVectorAnimationSourceType,
  shouldLoopVectorAnimation,
} from '../../types/vectorAnimation';
import { ClipSpectrogram } from './components/ClipSpectrogram';
import { ClipWaveform } from './components/ClipWaveform';
import { ClipAnalysisOverlay } from './components/ClipAnalysisOverlay';
import { FadeCurve } from './components/FadeCurve';
import { useThumbnailCache } from '../../hooks/useThumbnailCache';
import { useContextMenuPosition } from '../../hooks/useContextMenuPosition';
import { Logger } from '../../services/logger';
import { useTimelineSpectrogramTileSetState } from './hooks/useTimelineSpectrogramTileSet';
import { useTimelineWaveformPyramidState } from './hooks/useTimelineWaveformPyramid';
import {
  clipRequiresProcessedWaveformPyramid,
  createProcessedClipAudioStateHash,
} from '../../services/audio/processedWaveformEligibility';
import { canDeriveProcessedWaveformPyramid } from '../../services/audio/DerivedWaveformPyramidService';
import {
  collectAudioEffectInstanceRouteSettings,
  collectLegacyAudioEffectRouteSettings,
} from '../../services/audio/audioGraphRouteSettings';
import { getAudioRegionEffectLabel } from '../../services/audio/audioRegionEffectOperation';
import {
  moveTimelineAudioRegionSelection,
  resizeTimelineAudioRegionSelection,
  resolveTimelineAudioRegionSelection,
} from './utils/audioEditSelection';
import { resolveProcessedAudioAnalysisDisplayStatus } from './utils/audioAnalysisDisplayStatus';
import { resolveAudioWaveformDiagnostics } from './utils/audioWaveformDiagnostics';
import { resolveAudioVolumeAutomationCurveKeyframes } from './utils/audioAutomationCurve';
import {
  frequencyHzFromSpectralY,
  getSpectralMaxFrequencyHz,
  resolveTimelineSpectralBrushSelection,
  resolveTimelineSpectralRegionSelection,
  spectralYFromFrequencyHz,
} from './utils/spectralSelection';
import type {
  TimelineAudioRegionSelection,
  TimelineSpectralRegionEditType,
  TimelineVideoBakeRegionSelection,
} from '../../stores/timeline/types';
import {
  dispatchTimelineClipPointerClick,
  dispatchTimelineClipPointerMove,
  getTimelineToolCursor,
  isTimelineBladeTool,
  isTimelinePointerTool,
} from './tools/pointer/timelineToolPointerDispatcher';
import { getTrimHandleArrowDirections } from './utils/trimHandleDirections';
import type { ClipAudioEditOperation, VideoBakeRegion } from '../../types';

const KEYFRAME_TICK_SNAP_THRESHOLD_PX = 10;
const TIMELINE_VIEWPORT_FALLBACK_PX = 1600;
const TIMELINE_VIEWPORT_MIN_PX = 1600;
const TIMELINE_RENDER_OVERSCAN_PX = 512;
const THUMBNAIL_RENDER_OVERSCAN_PX = THUMB_WIDTH * 3;
const CLIP_RIGHT_STICKY_PADDING_PX = 8;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM = 250;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH = 16_384;
const AUDIO_REGION_TIMELINE_EPSILON = 0.001;
const AUDIO_REGION_GAIN_MIN_DB = -24;
const AUDIO_REGION_GAIN_MAX_DB = 24;
const AUDIO_REGION_GAIN_SILENCE_DB = -120;
const AUDIO_REGION_GAIN_SILENCE_THRESHOLD_DB = -96;
const AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT = 2;
const AUDIO_REGION_GAIN_DEFAULT_FADE_SECONDS = 0.035;
const VIDEO_BAKE_REGION_TIMELINE_EPSILON = 0.001;
const log = Logger.create('TimelineClip');
const ACTIVE_STEM_JOB_PHASES = new Set([
  'queued',
  'preparing',
  'downloading-model',
  'loading-model',
  'separating',
  'storing',
]);

function formatStemJobPhase(phase: string): string {
  switch (phase) {
    case 'queued':
      return 'Queued';
    case 'preparing':
      return 'Preparing audio';
    case 'downloading-model':
      return 'Downloading stem model';
    case 'loading-model':
      return 'Loading stem model';
    case 'separating':
      return 'Separating stems';
    case 'storing':
      return 'Storing stems';
    default:
      return 'Stem separation';
  }
}
const AUDIO_REGION_FX_PRESETS: Array<{
  key: string;
  label: string;
  descriptorId: string;
  params: ClipAudioEditOperation['params'];
}> = [
  {
    key: 'fx-high-pass',
    label: 'High Pass',
    descriptorId: 'audio-high-pass',
    params: { frequencyHz: 80, q: 0.707 },
  },
  {
    key: 'fx-low-pass',
    label: 'Low Pass',
    descriptorId: 'audio-low-pass',
    params: { frequencyHz: 8000, q: 0.707 },
  },
  {
    key: 'fx-presence',
    label: 'Presence Boost',
    descriptorId: 'audio-parametric-eq',
    params: { frequencyHz: 3200, gainDb: 3, q: 1.15 },
  },
  {
    key: 'fx-compressor',
    label: 'Compressor',
    descriptorId: 'audio-compressor',
    params: { thresholdDb: -18, ratio: 3, kneeDb: 6, attackMs: 8, releaseMs: 120, makeupGainDb: 0 },
  },
  {
    key: 'fx-de-esser',
    label: 'De-esser',
    descriptorId: 'audio-de-esser',
    params: { frequencyHz: 6500, thresholdDb: -24, ratio: 4, kneeDb: 6, attackMs: 1, releaseMs: 90, makeupGainDb: 0 },
  },
  {
    key: 'fx-noise-gate',
    label: 'Noise Gate',
    descriptorId: 'audio-noise-gate',
    params: { thresholdDb: -48, floorDb: -80, attackMs: 4, releaseMs: 120 },
  },
  {
    key: 'fx-saturation',
    label: 'Saturation',
    descriptorId: 'audio-saturation',
    params: { driveDb: 6, toneHz: 12000, mix: 0.35 },
  },
];
const inFlightSourceWaveformPyramidUpgrades = new Set<string>();
const inFlightProcessedWaveformPyramidUpgrades = new Set<string>();
const inFlightSpectrogramTileSetUpgrades = new Set<string>();
const EMPTY_CLIP_KEYFRAMES = [] as const;
const EMPTY_AUDIO_EDIT_STACK = [] as const;
type LabelableMediaStoreItem = {
  id?: string;
  name?: string;
  labelColor?: string;
  meshType?: string;
};
const EMPTY_LABELABLE_MEDIA_ITEMS: LabelableMediaStoreItem[] = [];

function canLoopExtendVectorClip(clip: TimelineClipProps['clip']): boolean {
  return isVectorAnimationSourceType(clip.source?.type) &&
    shouldLoopVectorAnimation(clip.source.vectorAnimationSettings);
}

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isAudioRegionModifierPressed(
  event: Pick<MouseEvent | React.MouseEvent, 'ctrlKey' | 'metaKey'>,
): boolean {
  return event.ctrlKey || event.metaKey;
}

function isVideoBakeRegionModifierPressed(
  event: Pick<MouseEvent | React.MouseEvent, 'ctrlKey' | 'metaKey'>,
): boolean {
  return event.ctrlKey || event.metaKey;
}

function isAudioRegionSilenceGainDb(gainDb: number): boolean {
  return gainDb <= AUDIO_REGION_GAIN_SILENCE_THRESHOLD_DB;
}

function sourceTimeToAudioRegionTimelineTime(
  clip: Pick<TimelineClipProps['clip'], 'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'reversed'>,
  sourceTime: number,
): number {
  const clipDuration = Math.max(AUDIO_REGION_TIMELINE_EPSILON, clip.duration);
  const sourceStart = clip.inPoint ?? 0;
  const sourceEnd = Math.max(sourceStart, clip.outPoint ?? sourceStart + clipDuration);
  const sourceSpan = Math.max(AUDIO_REGION_TIMELINE_EPSILON, sourceEnd - sourceStart);
  const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / sourceSpan));
  const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
  return clip.startTime + timelineRatio * clipDuration;
}

function resolveAudioRegionTimelineRangeForClip(
  clip: Pick<TimelineClipProps['clip'], 'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'reversed'>,
  selection: TimelineAudioRegionSelection,
): { start: number; end: number; duration: number } | null {
  const clipStart = clip.startTime;
  const clipEnd = clip.startTime + Math.max(AUDIO_REGION_TIMELINE_EPSILON, clip.duration);
  let start = Math.min(selection.startTime, selection.endTime);
  let end = Math.max(selection.startTime, selection.endTime);
  const overlapsClip = end > clipStart + AUDIO_REGION_TIMELINE_EPSILON &&
    start < clipEnd - AUDIO_REGION_TIMELINE_EPSILON;

  if (!overlapsClip) {
    const sourceStart = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
    const sourceEnd = Math.max(selection.sourceInPoint, selection.sourceOutPoint);
    start = Math.min(
      sourceTimeToAudioRegionTimelineTime(clip, sourceStart),
      sourceTimeToAudioRegionTimelineTime(clip, sourceEnd),
    );
    end = Math.max(
      sourceTimeToAudioRegionTimelineTime(clip, sourceStart),
      sourceTimeToAudioRegionTimelineTime(clip, sourceEnd),
    );
  }

  const clampedStart = Math.max(clipStart, Math.min(clipEnd, start));
  const clampedEnd = Math.max(clampedStart, Math.min(clipEnd, end));
  const duration = clampedEnd - clampedStart;
  return duration > AUDIO_REGION_TIMELINE_EPSILON
    ? { start: clampedStart, end: clampedEnd, duration }
    : null;
}

function formatAudioRegionGainLabel(gainDb: number): string {
  if (isAudioRegionSilenceGainDb(gainDb)) return '-∞ dB';
  return `${gainDb > 0 ? '+' : ''}${gainDb.toFixed(1)} dB`;
}

function getInlineAudioEditLabel(type: string, params: Record<string, unknown> | undefined): string {
  if (typeof params?.label === 'string' && params.label.trim().length > 0) {
    return params.label.trim();
  }

  switch (type) {
    case 'gain':
      return typeof params?.gainDb === 'number' ? formatAudioRegionGainLabel(params.gainDb) : 'Gain';
    case 'silence':
    case 'cut':
      return 'Silence';
    case 'insert-silence':
      return 'Insert silence';
    case 'delete-silence':
      return 'Delete silence';
    case 'reverse':
      return 'Reverse';
    case 'invert-polarity':
      return 'Invert polarity';
    case 'swap-channels':
      return 'Swap L/R';
    case 'mono-sum':
      return 'Mono sum';
    case 'split-stereo':
      return params?.sourceChannel === 1 ? 'Right to mono' : 'Left to mono';
    case 'paste':
      return 'Paste';
    case 'repair':
      return 'Repair';
    case 'effect':
      return getAudioRegionEffectLabel({
        type: 'effect',
        params: (params ?? {}) as ClipAudioEditOperation['params'],
      });
    case 'room-tone-fill':
      return 'Room tone';
    case 'spectral-mask':
      return 'Spectral mask';
    case 'spectral-resynthesis':
      return 'Resynthesis';
    default:
      return type;
  }
}

function clampAudioRegionGainDb(value: number): number {
  return Math.max(AUDIO_REGION_GAIN_SILENCE_DB, Math.min(AUDIO_REGION_GAIN_MAX_DB, value));
}

function audioRegionGainDbToYPercent(gainDb: number): number {
  const clamped = clampAudioRegionGainDb(gainDb);
  if (clamped <= AUDIO_REGION_GAIN_MIN_DB) {
    const silenceRange = AUDIO_REGION_GAIN_MIN_DB - AUDIO_REGION_GAIN_SILENCE_DB;
    const silenceProgress = silenceRange > 0
      ? (AUDIO_REGION_GAIN_MIN_DB - clamped) / silenceRange
      : 1;
    return 100 - AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT +
      Math.max(0, Math.min(1, silenceProgress)) * AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT;
  }

  const audibleRangePercent = 100 - AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT;
  const normalized = (clamped - AUDIO_REGION_GAIN_MIN_DB) /
    (AUDIO_REGION_GAIN_MAX_DB - AUDIO_REGION_GAIN_MIN_DB);
  return (1 - normalized) * audibleRangePercent;
}

function audioRegionGainDbFromClientY(clientY: number, rect: Pick<DOMRect, 'top' | 'height'>): number {
  const yPercent = Math.max(0, Math.min(100, ((clientY - rect.top) / Math.max(1, rect.height)) * 100));
  const audibleRangePercent = 100 - AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT;
  if (yPercent >= audibleRangePercent) {
    const bottomProgress = Math.max(
      0,
      Math.min(1, (yPercent - audibleRangePercent) / AUDIO_REGION_GAIN_SILENCE_ZONE_PERCENT),
    );
    if (bottomProgress >= 0.995) return AUDIO_REGION_GAIN_SILENCE_DB;
    const minGain = 10 ** (AUDIO_REGION_GAIN_MIN_DB / 20);
    const silenceGain = 10 ** (AUDIO_REGION_GAIN_SILENCE_DB / 20);
    const gain = minGain * ((silenceGain / minGain) ** bottomProgress);
    return clampAudioRegionGainDb(20 * Math.log10(Math.max(silenceGain, gain)));
  }

  const normalized = 1 - (yPercent / audibleRangePercent);
  return clampAudioRegionGainDb(
    AUDIO_REGION_GAIN_MIN_DB + normalized * (AUDIO_REGION_GAIN_MAX_DB - AUDIO_REGION_GAIN_MIN_DB),
  );
}

function getClipSourceDuration(clip: TimelineClipProps['clip']): number {
  const naturalDuration = clip.source?.naturalDuration;
  if (Number.isFinite(naturalDuration) && naturalDuration && naturalDuration > 0) {
    return naturalDuration;
  }
  return Math.max(clip.outPoint, clip.inPoint + clip.duration, clip.duration, 0.1);
}

function getSlippedSourceWindow(
  clip: TimelineClipProps['clip'],
  sourceDelta: number,
): { inPoint: number; outPoint: number } {
  const visibleSourceDuration = clip.outPoint - clip.inPoint;
  const maxInPoint = Math.max(0, getClipSourceDuration(clip) - visibleSourceDuration);
  const inPoint = Math.max(0, Math.min(maxInPoint, clip.inPoint + sourceDelta));
  return {
    inPoint,
    outPoint: inPoint + visibleSourceDuration,
  };
}

type StaticClipIconKind = 'camera' | 'gaussian-splat' | 'model';
type ClipKeyframeTickGroup = NonNullable<TimelineClipProps['keyframeTimeGroups']>[number];
type KeyframeGroupDragState = {
  keyframeIds: string[];
  startX: number;
  startTime: number;
  clipWidth: number;
  clipDuration: number;
};
type AudioRegionDragState = {
  anchorTimelineTime: number;
  startClientX: number;
  rectLeft: number;
  rectWidth: number;
};
type VideoBakeRegionDragState = {
  anchorTimelineTime: number;
  startClientX: number;
  rectLeft: number;
  rectWidth: number;
};
type ClipVideoBakeRegionOverlay = {
  id: string;
  left: number;
  width: number;
  status: VideoBakeRegion['status'];
  selection?: boolean;
};
type AudioRegionMoveDragState = {
  startClientX: number;
  clipWidth: number;
  clipDuration: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
};
type AudioRegionResizeDragState = {
  edge: 'left' | 'right';
  rectLeft: number;
  rectWidth: number;
  initialSelection: TimelineAudioRegionSelection;
  operationIds: string[];
};
type SpectralRegionDragState = AudioRegionDragState & {
  anchorFrequencyHz: number;
  startClientY: number;
  rectTop: number;
  rectHeight: number;
  maxFrequencyHz: number;
  mode: 'rectangle' | 'brush';
  brushTimeRadiusSeconds?: number;
  brushFrequencyRadiusHz?: number;
};
type AudioRegionGainDragState = {
  mode: 'gain' | 'fade-in' | 'fade-out';
  regionLeft: number;
  regionWidth: number;
  regionTop: number;
  regionHeight: number;
  regionDuration: number;
  startGainDb: number;
  startFadeInSeconds: number;
  startFadeOutSeconds: number;
  currentGainDb: number;
  currentFadeInSeconds: number;
  currentFadeOutSeconds: number;
};
type AudioEditOperationOverlay = {
  id: string;
  left: number;
  width: number;
  top: number;
  height: number;
  label: string;
  type: string;
  selection: TimelineAudioRegionSelection;
};
type AudioRegionContextMenuCommand = {
  key: string;
  label: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
};
type AudioRegionContextMenuGroup = {
  key: string;
  label: string;
  commands: AudioRegionContextMenuCommand[];
};
type AudioRegionContextMenuState = {
  x: number;
  y: number;
  selection: TimelineAudioRegionSelection;
};

function TrimHandleArrows({ directions }: { directions: Array<'left' | 'right'> }) {
  return (
    <span className="trim-handle-arrows" aria-hidden="true">
      {directions.includes('left') && <span className="trim-handle-arrow left" />}
      {directions.includes('right') && <span className="trim-handle-arrow right" />}
    </span>
  );
}

function StaticClipIcon({
  kind,
  className,
}: {
  kind: StaticClipIconKind;
  className?: string;
}) {
  if (kind === 'camera') {
    return (
      <svg
        viewBox="0 0 48 48"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15 12h18l3 5h4a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V21a4 4 0 0 1 4-4h4l3-5Z" />
        <circle cx="24" cy="26" r="7" />
        <path d="M37 21h3" />
      </svg>
    );
  }

  if (kind === 'gaussian-splat') {
    return (
      <svg
        viewBox="0 0 48 48"
        className={className}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M24 11v26M11 24h26M15 15l18 18M33 15 15 33" opacity="0.5" />
        <circle cx="24" cy="24" r="6" fill="currentColor" stroke="none" />
        <circle cx="24" cy="10" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="38" cy="24" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="24" cy="38" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="10" cy="24" r="3.5" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="14.5" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="33.5" cy="14.5" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="33.5" cy="33.5" r="2.5" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="33.5" r="2.5" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M24 6 38 14v20L24 42 10 34V14z" />
      <path d="M24 6v16m14-8-14 8-14-8m14 8v20" />
    </svg>
  );
}

function TimelineClipComponent({
  clip,
  trackId,
  track,
  trackBaseHeight,
  tracks,
  clips,
  isSelected,
  isInLinkedGroup,
  isDragging,
  isTrimming,
  isFading,
  isLinkedToDragging,
  isLinkedToTrimming,
  clipDrag,
  clipTrim,
  clipFade: _clipFade,
  zoom,
  scrollX,
  timelineViewportWidth,
  proxyEnabled,
  proxyStatus,
  proxyProgress,
  audioProxyStatus,
  audioProxyProgress,
  showTranscriptMarkers,
  snappingEnabled,
  onMouseDown,
  onDoubleClick,
  onContextMenu,
  onTrimStart,
  onFadeStart,
  hasKeyframes,
  fadeInDuration,
  fadeOutDuration,
  opacityKeyframes,
  allKeyframeTimes,
  keyframeTimeGroups,
  onMoveKeyframeGroup,
  timeToPixel,
  pixelToTime,
  formatTime,
}: TimelineClipProps) {
  const thumbnailsEnabled = useTimelineStore(s => s.thumbnailsEnabled);
  const waveformsEnabled = useTimelineStore(s => s.waveformsEnabled);
  const audioDisplayMode = useTimelineStore(s => s.audioDisplayMode);
  const audioFocusMode = useTimelineStore(s => s.audioFocusMode);
  const trackFocusMode = useTimelineStore(s => s.trackFocusMode);
  const showAudioRegionEditMarkers = useTimelineStore(s => s.showAudioRegionEditMarkers);
  const activeTimelineToolId = useTimelineStore(s => s.activeTimelineToolId);
  const timelineToolPreview = useTimelineStore(s => s.timelineToolPreview);
  const clipStemSeparationJob = useTimelineStore(s => {
    const directJob = s.clipStemSeparationJobs[clip.id];
    if (directJob && (directJob.clipId === clip.id || directJob.requestedClipId === clip.id)) {
      return directJob;
    }

    const linkedJob = clip.linkedClipId ? s.clipStemSeparationJobs[clip.linkedClipId] : undefined;
    if (linkedJob && (linkedJob.clipId === clip.id || linkedJob.requestedClipId === clip.id)) {
      return linkedJob;
    }

    return null;
  });
  const setTimelineToolPreview = useTimelineStore(s => s.setTimelineToolPreview);
  const applyTimelineEditOperation = useTimelineStore(s => s.applyTimelineEditOperation);
  const setActiveTimelineTool = useTimelineStore(s => s.setActiveTimelineTool);
  const timelineTrackColorsVisible = useTimelineStore(s => s.audioLayerAdvancedMode !== false);
  const audioRegionSelection = useTimelineStore(s =>
    s.audioRegionSelection?.clipId === clip.id ? s.audioRegionSelection : null
  );
  const audioRegionGainPreview = useTimelineStore(s =>
    s.audioRegionGainPreview?.clipId === clip.id ? s.audioRegionGainPreview : null
  );
  const audioSpectralRegionSelection = useTimelineStore(s =>
    s.audioSpectralRegionSelection?.clipId === clip.id ? s.audioSpectralRegionSelection : null
  );
  const videoBakeRegionSelection = useTimelineStore(s =>
    s.videoBakeRegionSelection?.scope === 'clip' && s.videoBakeRegionSelection.clipId === clip.id
      ? s.videoBakeRegionSelection
      : null
  );
  const setAudioRegionSelection = useTimelineStore(s => s.setAudioRegionSelection);
  const clearAudioRegionSelection = useTimelineStore(s => s.clearAudioRegionSelection);
  const setVideoBakeRegionSelection = useTimelineStore(s => s.setVideoBakeRegionSelection);
  const clearVideoBakeRegionSelection = useTimelineStore(s => s.clearVideoBakeRegionSelection);
  const addClipVideoBakeRegion = useTimelineStore(s => s.addClipVideoBakeRegion);
  const bakeClipVideoBakeRegion = useTimelineStore(s => s.bakeClipVideoBakeRegion);
  const unbakeClipVideoBakeRegion = useTimelineStore(s => s.unbakeClipVideoBakeRegion);
  const removeClipVideoBakeRegion = useTimelineStore(s => s.removeClipVideoBakeRegion);
  const setAudioSpectralRegionSelection = useTimelineStore(s => s.setAudioSpectralRegionSelection);
  const clearAudioSpectralRegionSelection = useTimelineStore(s => s.clearAudioSpectralRegionSelection);
  const hasAudioRegionClipboard = useTimelineStore(s => s.audioRegionClipboard !== null);
  const applyAudioRegionEdit = useTimelineStore(s => s.applyAudioRegionEdit);
  const setAudioRegionGainPreview = useTimelineStore(s => s.setAudioRegionGainPreview);
  const clearAudioRegionGainPreview = useTimelineStore(s => s.clearAudioRegionGainPreview);
  const setAudioRegionGainEdit = useTimelineStore(s => s.setAudioRegionGainEdit);
  const applySpectralRegionEdit = useTimelineStore(s => s.applySpectralRegionEdit);
  const addClipSpectralImageLayer = useTimelineStore(s => s.addClipSpectralImageLayer);
  const copySelectedAudioRegion = useTimelineStore(s => s.copySelectedAudioRegion);
  const pasteAudioRegionToSelection = useTimelineStore(s => s.pasteAudioRegionToSelection);
  const setClipAudioEditOperationEnabled = useTimelineStore(s => s.setClipAudioEditOperationEnabled);
  const setClipAudioEditOperationRange = useTimelineStore(s => s.setClipAudioEditOperationRange);
  const removeClipAudioEditOperation = useTimelineStore(s => s.removeClipAudioEditOperation);
  const clearClipAudioEditStack = useTimelineStore(s => s.clearClipAudioEditStack);
  const bakeClipAudioEditStack = useTimelineStore(s => s.bakeClipAudioEditStack);
  const unbakeClipAudioEditStack = useTimelineStore(s => s.unbakeClipAudioEditStack);
  const selectClip = useTimelineStore(s => s.selectClip);
  const clipAudioKeyframes = useTimelineStore(s => s.clipKeyframes.get(clip.id) ?? EMPTY_CLIP_KEYFRAMES);
  const processedWaveformPyramidRef = clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId;
  const sourceWaveformPyramidRef = clip.audioState?.sourceAnalysisRefs?.waveformPyramidId;
  const processedSpectrogramTileSetRef = clip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0];
  const sourceSpectrogramTileSetRef = clip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0];
  const processedWaveformState = useTimelineWaveformPyramidState(processedWaveformPyramidRef);
  const sourceWaveformState = useTimelineWaveformPyramidState(sourceWaveformPyramidRef);
  const processedSpectrogramState = useTimelineSpectrogramTileSetState(processedSpectrogramTileSetRef);
  const sourceSpectrogramState = useTimelineSpectrogramTileSetState(sourceSpectrogramTileSetRef);
  const processedWaveformPyramid = processedWaveformState.pyramid;
  const sourceWaveformPyramid = sourceWaveformState.pyramid;
  const audioEditStack = clip.audioState?.editStack ?? EMPTY_AUDIO_EDIT_STACK;
  const activeAudioEditCount = audioEditStack.filter(operation => operation.enabled !== false).length;
  const latestAudioBake = clip.audioState?.bakeHistory?.at(-1);
  const canUnbakeAudioEditStack = Boolean(latestAudioBake?.restore);
  const usePredictiveAudioWaveform = audioRegionGainPreview !== null || (!processedWaveformPyramid && audioEditStack.length > 0);
  const waveformPyramid = usePredictiveAudioWaveform && sourceWaveformPyramid
    ? sourceWaveformPyramid
    : processedWaveformPyramid ?? sourceWaveformPyramid;
  const waveformUsesProcessedPyramid = Boolean(waveformPyramid && processedWaveformPyramid && waveformPyramid === processedWaveformPyramid);
  const waveformUsesSourcePyramid = Boolean(waveformPyramid && sourceWaveformPyramid && waveformPyramid === sourceWaveformPyramid);
  const processedSpectrogramTileSet = processedSpectrogramState.tileSet;
  const sourceSpectrogramTileSet = sourceSpectrogramState.tileSet;
  const spectrogramTileSet = processedSpectrogramTileSet ?? sourceSpectrogramTileSet;
  const spectrogramVariant = processedSpectrogramTileSet ? 'processed' : 'source';
  const spectralMaxFrequencyHz = getSpectralMaxFrequencyHz(spectrogramTileSet?.sampleRate);
  const selectedSpectralImageFileId = useMediaStore(s => {
    for (const id of s.selectedIds) {
      const file = s.files.find(candidate => candidate.id === id);
      if (file?.type === 'image') return file.id;
    }
    return null;
  });
  const spectralImageMediaFiles = useMediaStore(s => s.files);
  const spectralImageFilesById = useMemo(() => {
    const entries = spectralImageMediaFiles
      .filter(file => file.type === 'image')
      .map(file => [file.id, file] as const);
    return new Map(entries);
  }, [spectralImageMediaFiles]);
  const selectedSpectralImageFile = selectedSpectralImageFileId
    ? spectralImageFilesById.get(selectedSpectralImageFileId) ?? null
    : null;
  const waveformVariant = waveformUsesProcessedPyramid
    ? 'processed'
    : waveformUsesSourcePyramid
      ? 'source'
      : 'legacy';
  const waveformDisplayGain = useMemo(() => {
    const clipAudioEffectIds = new Set((clip.audioState?.effectStack ?? []).map(effect => effect.id));
    const graphSettings = collectAudioEffectInstanceRouteSettings(clip.audioState?.effectStack);
    const legacySettings = collectLegacyAudioEffectRouteSettings(clip.effects, clipAudioEffectIds);
    return Math.max(0, Math.min(8, graphSettings.volume * legacySettings.volume));
  }, [clip.audioState?.effectStack, clip.effects]);
  const rawWaveformProcessingState = processedWaveformPyramidRef && !processedWaveformState.pyramid
    ? `waveform-processed-${processedWaveformState.status}`
    : '';
  const spectrogramProcessingState = audioDisplayMode === 'spectral'
    && processedSpectrogramTileSetRef
    && !processedSpectrogramState.tileSet
    ? `spectrogram-processed-${processedSpectrogramState.status}`
    : '';
  const needsProcessedAudioAnalysis = useMemo(
    () => clipRequiresProcessedWaveformPyramid(clip, clipAudioKeyframes),
    [clip, clipAudioKeyframes],
  );
  const canDeriveVisibleProcessedWaveform = useMemo(
    () => canDeriveProcessedWaveformPyramid(clip, clipAudioKeyframes),
    [clip, clipAudioKeyframes],
  );
  const hasWaveformDisplayFallback = Boolean(
    sourceWaveformPyramid ||
    (clip.waveform?.length ?? 0) > 0 ||
    clip.waveformChannels?.some(channel => channel.length > 0),
  );
  const shouldSuppressBackgroundProcessedWaveformUi = audioDisplayMode !== 'spectral' &&
    needsProcessedAudioAnalysis &&
    hasWaveformDisplayFallback &&
    (canDeriveVisibleProcessedWaveform || usePredictiveAudioWaveform);
  const waveformProcessingState = shouldSuppressBackgroundProcessedWaveformUi
    ? ''
    : rawWaveformProcessingState;
  const canResolveAudioSourceForAnalysis = Boolean(
    clip.isComposition ||
    clip.file ||
    clip.mediaFileId ||
    clip.source?.mediaFileId,
  );
  const processedWaveformStatus = shouldSuppressBackgroundProcessedWaveformUi
    ? null
    : resolveProcessedAudioAnalysisDisplayStatus({
        artifactLabel: 'waveform',
        needsProcessed: needsProcessedAudioAnalysis,
        processedRef: processedWaveformPyramidRef,
        processedReady: Boolean(processedWaveformPyramid),
        fallbackAvailable: hasWaveformDisplayFallback,
        loadStatus: processedWaveformState.status,
        jobActive: clip.audioAnalysisJob?.artifactKinds.includes('processed-waveform-pyramid') === true,
        autoGenerateEligible: canResolveAudioSourceForAnalysis,
      });
  const processedSpectrogramStatus = resolveProcessedAudioAnalysisDisplayStatus({
    artifactLabel: 'spectrogram',
    needsProcessed: needsProcessedAudioAnalysis,
    processedRef: processedSpectrogramTileSetRef,
    processedReady: Boolean(processedSpectrogramTileSet),
    fallbackAvailable: Boolean(sourceSpectrogramTileSet),
    loadStatus: processedSpectrogramState.status,
    jobActive: clip.audioAnalysisJob?.artifactKinds.includes('spectrogram-tiles') === true,
    autoGenerateEligible: canResolveAudioSourceForAnalysis,
  });
  const audioAnalysisDisplayStatus = audioDisplayMode === 'spectral'
    ? processedSpectrogramStatus
    : processedWaveformStatus;
  const isBackgroundProcessedWaveformJob = clip.audioAnalysisJob?.processed === true &&
    clip.audioAnalysisJob.artifactKinds.includes('processed-waveform-pyramid');
  const showWaveformGenerationIndicator = clip.waveformGenerating &&
    !(isBackgroundProcessedWaveformJob && shouldSuppressBackgroundProcessedWaveformUi);
  const isBladeToolActive = isTimelineBladeTool(activeTimelineToolId);
  const isPointerToolActive = isTimelinePointerTool(activeTimelineToolId);
  const timelineToolCursor = getTimelineToolCursor(activeTimelineToolId);
  const canUseTrimHandles =
    activeTimelineToolId === 'select' ||
    activeTimelineToolId === 'edge-trim' ||
    activeTimelineToolId === 'ripple-trim' ||
    activeTimelineToolId === 'rolling-edit' ||
    activeTimelineToolId === 'rate-stretch';
  const canUseFadeHandles = activeTimelineToolId === 'select';
  const canUseBodyToolGesture = activeTimelineToolId === 'slip' || activeTimelineToolId === 'slide';
  const leftTrimHandleDirections = getTrimHandleArrowDirections(clip, 'left');
  const rightTrimHandleDirections = getTrimHandleArrowDirections(clip, 'right');

  // Subscribe to playhead position only when blade tool is active (avoids re-renders during playback)
  const playheadPosition = useTimelineStore((state) =>
    isBladeToolActive ? state.playheadPosition : 0
  );

  // Look up media label color from mediaStore
  const mediaLabelHex = useMediaStore(s => {
    const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
    if (clip.compositionId) {
      const comp = s.compositions.find(c => c.id === clip.compositionId);
      if (comp?.labelColor && comp.labelColor !== 'none') return getLabelHex(comp.labelColor);
    }
    if (mediaFileId) {
      const file = s.files.find(f => f.id === mediaFileId);
      if (file?.labelColor && file.labelColor !== 'none') return getLabelHex(file.labelColor);
    }
    // Check special item types — by mediaFileId first, then fallback by name/type
    if (clip.source?.type === 'solid') {
      const solidItems = s.solidItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
      const solid = mediaFileId
        ? solidItems.find(si => si.id === mediaFileId)
        : solidItems.find(si => si.name === clip.name);
      if (solid?.labelColor && solid.labelColor !== 'none') return getLabelHex(solid.labelColor);
    }
    if (clip.source?.type === 'text') {
      const textItems = s.textItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
      const text = mediaFileId
        ? textItems.find(ti => ti.id === mediaFileId)
        : textItems.find(ti => ti.name === clip.name);
      if (text?.labelColor && text.labelColor !== 'none') return getLabelHex(text.labelColor);
    }
    if (clip.source?.type === 'model') {
      const meshItems = s.meshItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
      const mesh = mediaFileId
        ? meshItems.find(m => m.id === mediaFileId)
        : meshItems.find(m => m.name === clip.name || m.meshType === clip.meshType);
      if (mesh?.labelColor && mesh.labelColor !== 'none') return getLabelHex(mesh.labelColor);
    }
    if (clip.source?.type === 'camera') {
      const cameraItems = s.cameraItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
      const cam = mediaFileId
        ? cameraItems.find(c => c.id === mediaFileId)
        : cameraItems[0];
      if (cam?.labelColor && cam.labelColor !== 'none') return getLabelHex(cam.labelColor);
    }
    if (clip.source?.type === 'splat-effector') {
      const splatEffectorItems = s.splatEffectorItems ?? EMPTY_LABELABLE_MEDIA_ITEMS;
      const effector = mediaFileId
        ? splatEffectorItems.find(e => e.id === mediaFileId)
        : splatEffectorItems.find(e => e.name === clip.name);
      if (effector?.labelColor && effector.labelColor !== 'none') return getLabelHex(effector.labelColor);
    }
    return null;
  });

  // Animation phase for enter/exit transitions
  const clipAnimationPhase = useTimelineStore(s => s.clipAnimationPhase);
  const compositionSwitchDirection = useTimelineStore(s => s.compositionSwitchDirection);
  const clipEntranceKey = useTimelineStore(s => s.clipEntranceAnimationKey);
  const aiMove = useTimelineStore(s => s.aiMovingClips.get(clip.id));
  const [mountEntranceKey] = useState(clipEntranceKey);

  // Only compute stagger order during composition entrance animation. Doing a
  // full clips sort inside every TimelineClip render gets very expensive once
  // AI splits create hundreds of clips.
  const animationDelay = clipAnimationPhase === 'entering'
    ? Math.max(0, (() => {
        const sorted = [...clips].sort((a, b) => {
          const aTrack = tracks.findIndex(t => t.id === a.trackId);
          const bTrack = tracks.findIndex(t => t.id === b.trackId);
          if (aTrack !== bTrack) return aTrack - bTrack;
          return a.startTime - b.startTime;
        });
        return sorted.findIndex(c => c.id === clip.id);
      })()) * 0.02
    : 0;

  // Determine animation class:
  // - 'exiting': apply exit animation
  // - 'entering' + new clips: apply entrance animation (only during composition switch)
  // - Otherwise: no animation
  const isNewClip = mountEntranceKey === clipEntranceKey && clipEntranceKey > 0;
  const exitAnimationClass = compositionSwitchDirection === 'backward'
    ? 'exit-animate exit-animate-left'
    : 'exit-animate exit-animate-right';
  const entranceAnimationClass = compositionSwitchDirection === 'backward'
    ? 'entrance-animate entrance-animate-right'
    : 'entrance-animate entrance-animate-left';
  const animationClass = clipAnimationPhase === 'exiting'
    ? exitAnimationClass
    : (clipAnimationPhase === 'entering' && isNewClip)
      ? entranceAnimationClass
      : '';

  // AI move animation (FLIP technique)
  const [aiMovePhase, setAiMovePhase] = useState<'idle' | 'initial' | 'animating'>('idle');
  const aiMoveRef = useRef<number | null>(null);
  const aiMoveStartedAt = aiMove?.startedAt;
  const aiMoveDuration = aiMove?.animationDuration ?? 200;

  useEffect(() => {
    if (aiMoveStartedAt !== undefined) {
      // Double-rAF to ensure the initial transform is painted before starting transition
      const raf1 = requestAnimationFrame(() => {
        setAiMovePhase('initial');
        const raf2 = requestAnimationFrame(() => {
          setAiMovePhase('animating');
        });
        aiMoveRef.current = raf2;
      });
      const timer = setTimeout(() => {
        setAiMovePhase('idle');
      }, aiMoveDuration + 50);
      return () => {
        cancelAnimationFrame(raf1);
        if (aiMoveRef.current) cancelAnimationFrame(aiMoveRef.current);
        clearTimeout(timer);
      };
    } else {
      const frame = requestAnimationFrame(() => setAiMovePhase('idle'));
      return () => cancelAnimationFrame(frame);
    }
  }, [aiMoveDuration, aiMoveStartedAt]);

  // Check if this clip should show blade indicator (either directly hovered or linked to hovered clip)
  const isDirectlyHovered = timelineToolPreview?.clipId === clip.id;
  const linkedClip = clip.linkedClipId ? clips.find(c => c.id === clip.linkedClipId) : null;
  const isLinkedToHovered = linkedClip && timelineToolPreview?.clipId === linkedClip.id;
  // Also check reverse link - if another clip links to this one
  const reverseLinkedClip = clips.find(c => c.linkedClipId === clip.id);
  const isReverseLinkedToHovered = reverseLinkedClip && timelineToolPreview?.clipId === reverseLinkedClip.id;
  const shouldShowCutIndicator = isBladeToolActive &&
    timelineToolPreview &&
    isTimelineBladeTool(timelineToolPreview.toolId) &&
    timelineToolPreview.plane === 'clip-local' &&
    !timelineToolPreview.blocked &&
    (isDirectlyHovered || isLinkedToHovered || isReverseLinkedToHovered);

  // Determine if this is an audio clip (check source type, MIME type, or extension as fallback)
  const audioExtensions = ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus'];
  const fileExt = (clip.file?.name || clip.name || '').split('.').pop()?.toLowerCase() || '';
  const isAudioClip = clip.source?.type === 'audio' ||
    clip.file?.type?.startsWith('audio/') ||
    audioExtensions.includes(fileExt);

  // Determine if this is a text clip
  const isTextClip = clip.source?.type === 'text';
  const meshType = clip.meshType ?? clip.source?.meshType;
  const isText3DClip = clip.source?.type === 'model' && meshType === 'text3d';
  const isModelClip = clip.source?.type === 'model' && !isText3DClip;
  const text3DProperties = clip.text3DProperties ?? clip.source?.text3DProperties;

  // Determine if this is a solid clip
  const isSolidClip = clip.source?.type === 'solid';
  const isMathSceneClip = clip.source?.type === 'math-scene';
  const isVectorAnimationClip = isVectorAnimationSourceType(clip.source?.type);
  const vectorAnimationIcon = clip.source?.type === 'rive' ? 'R' : 'L';
  const vectorAnimationTitle = clip.source?.type === 'rive' ? 'Rive Clip' : 'Lottie Clip';
  const isCameraClip = clip.source?.type === 'camera';
  const isGaussianSplatClip = clip.source?.type === 'gaussian-splat';
  const isSplatEffectorClip = clip.source?.type === 'splat-effector';
  const staticClipIconKind: StaticClipIconKind | null = isCameraClip
    ? 'camera'
    : isGaussianSplatClip
      ? 'gaussian-splat'
      : isModelClip
        ? 'model'
        : null;
  const showsStaticClipArtwork = staticClipIconKind !== null;

  const isGeneratingProxy = proxyStatus === 'generating';
  const hasProxy = proxyStatus === 'ready';
  const hasProxyError = proxyStatus === 'error';
  const isGeneratingAudioProxy = audioProxyStatus === 'generating';
  const hasAudioProxy = audioProxyStatus === 'ready';
  const hasAudioProxyError = audioProxyStatus === 'error';
  const hasStemSeparation = Boolean(clip.audioState?.stemSeparation?.stems.length);
  const activeStemSeparationJob = clipStemSeparationJob && ACTIVE_STEM_JOB_PHASES.has(clipStemSeparationJob.phase)
    ? clipStemSeparationJob
    : null;
  const failedStemSeparationJob = clipStemSeparationJob?.phase === 'failed'
    ? clipStemSeparationJob
    : null;
  const activeStemProgressPercent = activeStemSeparationJob
    ? Math.round(Math.max(0, Math.min(1, activeStemSeparationJob.progress)) * 100)
    : 0;
  const activeStemStatusLabel = activeStemSeparationJob
    ? activeStemSeparationJob.message ?? formatStemJobPhase(activeStemSeparationJob.phase)
    : '';
  const activeStemStatusTitle = activeStemSeparationJob
    ? `${activeStemStatusLabel}: ${activeStemProgressPercent}%`
    : undefined;

  // Check if this clip is linked to the dragging/trimming clip
  const draggedClip = clipDrag
    ? clips.find((c) => c.id === clipDrag.clipId)
    : null;
  const trimmedClip = clipTrim
    ? clips.find((c) => c.id === clipTrim.clipId)
    : null;

  // Calculate live trim values (including inPoint/outPoint for waveform/thumbnail rendering)
  let displayStartTime = clip.startTime;
  let displayDuration = clip.duration;
  let displayInPoint = clip.inPoint;
  let displayOutPoint = clip.outPoint;

  if (isTrimming && clipTrim) {
    const deltaX = clipTrim.currentX - clipTrim.startX;
    const deltaTime = pixelToTime(deltaX);
    const sourceType = clip.source?.type;
    const isInfiniteClip = sourceType === 'text' || sourceType === 'image' || sourceType === 'solid' || sourceType === 'camera' || sourceType === 'splat-effector' || sourceType === 'math-scene';
    const canLoopExtendRight = canLoopExtendVectorClip(clip);
    const maxDuration = isInfiniteClip
      ? Number.MAX_SAFE_INTEGER
      : (clip.source?.naturalDuration || clip.duration);

    if (clipTrim.edge === 'left') {
      const maxTrim = clipTrim.originalDuration - 0.1;
      const minTrim = isInfiniteClip
        ? -clipTrim.originalStartTime
        : -clipTrim.originalInPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      displayStartTime = clipTrim.originalStartTime + clampedDelta;
      displayDuration = clipTrim.originalDuration - clampedDelta;
      // Update inPoint when trimming left edge
      displayInPoint = clipTrim.originalInPoint + clampedDelta;
    } else {
      const maxExtend = canLoopExtendRight
        ? Number.MAX_SAFE_INTEGER
        : maxDuration - clipTrim.originalOutPoint;
      const minTrim = -(clipTrim.originalDuration - 0.1);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      displayDuration = clipTrim.originalDuration + clampedDelta;
      // Update outPoint when trimming right edge
      displayOutPoint = clipTrim.originalOutPoint + clampedDelta;
    }
  } else if (isLinkedToTrimming && clipTrim && trimmedClip) {
    // Apply same trim to linked clip visually
    const deltaX = clipTrim.currentX - clipTrim.startX;
    const deltaTime = pixelToTime(deltaX);
    const canLoopExtendRight = canLoopExtendVectorClip(clip);
    const maxDuration = clip.source?.naturalDuration || clip.duration;

    if (clipTrim.edge === 'left') {
      const maxTrim = clip.duration - 0.1;
      const minTrim = -clip.inPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      displayStartTime = clip.startTime + clampedDelta;
      displayDuration = clip.duration - clampedDelta;
      displayInPoint = clip.inPoint + clampedDelta;
    } else {
      const maxExtend = canLoopExtendRight
        ? Number.MAX_SAFE_INTEGER
        : maxDuration - clip.outPoint;
      const minTrim = -(clip.duration - 0.1);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      displayDuration = clip.duration + clampedDelta;
      displayOutPoint = clip.outPoint + clampedDelta;
    }
  }

  const isSlipPreview =
    clipDrag?.toolGesture === 'slip' &&
    clipDrag.sourceTimeDelta !== undefined &&
    (isDragging || (!clipDrag.altKeyPressed && isLinkedToDragging));
  if (isSlipPreview) {
    const sourceWindow = getSlippedSourceWindow(clip, clipDrag.sourceTimeDelta ?? 0);
    displayInPoint = sourceWindow.inPoint;
    displayOutPoint = sourceWindow.outPoint;
  }

  const width = timeToPixel(displayDuration);

  // Calculate position - if dragging, use the computed position (with snapping/resistance)
  let left = timeToPixel(displayStartTime);
  if (isDragging && clipDrag) {
    // Always use snappedTime when available - it contains the position with snapping and resistance applied
    if (clipDrag.snappedTime !== null) {
      left = timeToPixel(clipDrag.snappedTime);
    }
  } else if (isLinkedToDragging && clipDrag && draggedClip) {
    // Move linked clip in sync - use computed position (snapped + resistance) if available
    if (clipDrag.snappedTime !== null) {
      const newDragTime = clipDrag.snappedTime;
      const timeDelta = newDragTime - draggedClip.startTime;
      left = timeToPixel(Math.max(0, clip.startTime + timeDelta));
    }
  } else if (clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined) {
    // This clip is part of multi-select drag (but not the primary dragged clip)
    left = timeToPixel(Math.max(0, clip.startTime + clipDrag.multiSelectTimeDelta));
  }
  const visibleTimelineViewportWidth = timelineViewportWidth > 0
    ? timelineViewportWidth
    : TIMELINE_VIEWPORT_FALLBACK_PX;
  const renderTimelineViewportWidth = Math.max(
    TIMELINE_VIEWPORT_MIN_PX,
    visibleTimelineViewportWidth
  );
  const waveformRenderStartPx = Math.max(0, scrollX - left - TIMELINE_RENDER_OVERSCAN_PX);
  const waveformRenderEndPx = Math.min(width, scrollX - left + renderTimelineViewportWidth + TIMELINE_RENDER_OVERSCAN_PX);
  const waveformRenderWindow = {
    startPx: waveformRenderStartPx,
    width: Math.max(0, waveformRenderEndPx - waveformRenderStartPx),
  };
  const thumbnailRenderStartPx = Math.max(0, scrollX - left - THUMBNAIL_RENDER_OVERSCAN_PX);
  const thumbnailRenderEndPx = Math.min(width, scrollX - left + renderTimelineViewportWidth + THUMBNAIL_RENDER_OVERSCAN_PX);
  const thumbnailRenderWindow = {
    startPx: thumbnailRenderStartPx,
    width: Math.max(0, thumbnailRenderEndPx - thumbnailRenderStartPx),
  };
  const sourceSpan = Math.max(0, displayOutPoint - displayInPoint);
  const thumbnailVisibleInPoint = displayInPoint + sourceSpan * (thumbnailRenderWindow.startPx / Math.max(1, width));
  const thumbnailVisibleOutPoint = displayInPoint + sourceSpan * (
    (thumbnailRenderWindow.startPx + thumbnailRenderWindow.width) / Math.max(1, width)
  );

  useEffect(() => {
    if (!waveformsEnabled || !isAudioClip || sourceWaveformPyramidRef || clip.waveformGenerating) {
      return;
    }

    const shouldUpgrade =
      audioDisplayMode === 'detailed' ||
      (audioDisplayMode === 'compact' && (zoom >= WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM || width > WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH));

    if (!shouldUpgrade) return;

    const sourceKey = clip.file
      ? [
          clip.id,
          clip.file.name,
          clip.file.size,
          clip.file.lastModified,
        ].join(':')
      : [
          clip.id,
          clip.mediaFileId ?? clip.source?.mediaFileId ?? 'no-media-file',
          clip.name,
        ].join(':');

    const fileKey = [
      clip.id,
      sourceKey,
      audioDisplayMode,
    ].join(':');

    if (inFlightSourceWaveformPyramidUpgrades.has(fileKey)) return;
    inFlightSourceWaveformPyramidUpgrades.add(fileKey);

    const timer = window.setTimeout(() => {
      const { clips: currentClips, generateWaveformForClip } = useTimelineStore.getState();
      const currentClip = currentClips.find(current => current.id === clip.id);
      if (
        !currentClip ||
        currentClip.waveformGenerating ||
        currentClip.audioState?.sourceAnalysisRefs?.waveformPyramidId
      ) {
        inFlightSourceWaveformPyramidUpgrades.delete(fileKey);
        return;
      }

      void generateWaveformForClip(clip.id)
        .finally(() => {
          inFlightSourceWaveformPyramidUpgrades.delete(fileKey);
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      inFlightSourceWaveformPyramidUpgrades.delete(fileKey);
    };
  }, [
    audioDisplayMode,
    clip.file,
    clip.mediaFileId,
    clip.name,
    clip.source?.mediaFileId,
    clip.id,
    clip.waveformGenerating,
    isAudioClip,
    sourceWaveformPyramidRef,
    waveformsEnabled,
    width,
    zoom,
  ]);

  const processedWaveformRequestKey = useMemo(
    () => `${clip.id}:${createProcessedClipAudioStateHash(clip, { keyframes: clipAudioKeyframes })}`,
    [clip, clipAudioKeyframes],
  );

  useEffect(() => {
    if (
      !waveformsEnabled ||
      !isAudioClip ||
      audioDisplayMode === 'spectral' ||
      processedWaveformPyramidRef ||
      clip.waveformGenerating ||
      inFlightProcessedWaveformPyramidUpgrades.has(processedWaveformRequestKey)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      const store = useTimelineStore.getState();
      const currentClip = store.clips.find(current => current.id === clip.id);
      if (
        !currentClip ||
        currentClip.waveformGenerating ||
        currentClip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId
      ) {
        return;
      }

      const keyframes = store.clipKeyframes.get(currentClip.id) ?? [];
      if (!clipRequiresProcessedWaveformPyramid(currentClip, keyframes)) {
        return;
      }

      inFlightProcessedWaveformPyramidUpgrades.add(processedWaveformRequestKey);
      void store.generateProcessedWaveformForClip(currentClip.id)
        .finally(() => {
          inFlightProcessedWaveformPyramidUpgrades.delete(processedWaveformRequestKey);
        });
    }, 500);

    return () => window.clearTimeout(timer);
  }, [
    clip.id,
    clip.waveformGenerating,
    audioDisplayMode,
    isAudioClip,
    processedWaveformPyramidRef,
    processedWaveformRequestKey,
    waveformsEnabled,
  ]);

  const spectrogramRequestKey = [
    'spectrogram',
    processedWaveformRequestKey,
    sourceSpectrogramTileSetRef ?? '',
    processedSpectrogramTileSetRef ?? '',
  ].join(':');

  useEffect(() => {
    if (
      !waveformsEnabled ||
      !isAudioClip ||
      audioDisplayMode !== 'spectral' ||
      clip.waveformGenerating ||
      inFlightSpectrogramTileSetUpgrades.has(spectrogramRequestKey)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      const store = useTimelineStore.getState();
      const currentClip = store.clips.find(current => current.id === clip.id);
      if (!currentClip || currentClip.waveformGenerating) {
        return;
      }

      const keyframes = store.clipKeyframes.get(currentClip.id) ?? [];
      const needsProcessedSpectrogram = clipRequiresProcessedWaveformPyramid(currentClip, keyframes);
      const requiredRef = needsProcessedSpectrogram
        ? currentClip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0]
        : currentClip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0];

      if (requiredRef) {
        return;
      }
      if (!currentClip.isComposition && !currentClip.file) {
        return;
      }

      inFlightSpectrogramTileSetUpgrades.add(spectrogramRequestKey);
      void store.generateSpectrogramForClip(currentClip.id)
        .finally(() => {
          inFlightSpectrogramTileSetUpgrades.delete(spectrogramRequestKey);
        });
    }, 650);

    return () => window.clearTimeout(timer);
  }, [
    audioDisplayMode,
    clip.id,
    clip.waveformGenerating,
    isAudioClip,
    processedSpectrogramTileSetRef,
    sourceSpectrogramTileSetRef,
    spectrogramRequestKey,
    waveformsEnabled,
  ]);

  const waveformNaturalDuration = processedWaveformPyramid
    ? Math.max(0.001, processedWaveformPyramid.duration)
    : (clip.source?.naturalDuration || clip.duration);
  const waveformInPoint = processedWaveformPyramid ? 0 : displayInPoint;
  const waveformOutPoint = processedWaveformPyramid
    ? Math.max(0.001, processedWaveformPyramid.duration)
    : displayOutPoint;
  const spectrogramNaturalDuration = processedSpectrogramTileSet
    ? Math.max(0.001, processedSpectrogramTileSet.duration)
    : (clip.source?.naturalDuration || clip.duration);
  const spectrogramInPoint = processedSpectrogramTileSet ? 0 : displayInPoint;
  const spectrogramOutPoint = processedSpectrogramTileSet
    ? Math.max(0.001, processedSpectrogramTileSet.duration)
    : displayOutPoint;
  const audioWaveformDiagnostics = useMemo(() => {
    if (!isAudioClip || !waveformsEnabled) return null;
    if (!waveformPyramid && (!clip.waveform || clip.waveform.length === 0)) return null;

    return resolveAudioWaveformDiagnostics({
      waveform: clip.waveform,
      pyramid: waveformPyramid,
      inPoint: waveformInPoint,
      outPoint: waveformOutPoint,
      naturalDuration: waveformNaturalDuration,
      gain: waveformVariant === 'processed' ? 1 : waveformDisplayGain,
    });
  }, [
    clip.waveform,
    isAudioClip,
    waveformDisplayGain,
    waveformInPoint,
    waveformNaturalDuration,
    waveformOutPoint,
    waveformPyramid,
    waveformVariant,
    waveformsEnabled,
  ]);
  const audioVolumeAutomationKeyframes = useMemo(() => {
    if (!isAudioClip) return [];

    return resolveAudioVolumeAutomationCurveKeyframes({
      keyframes: clipAudioKeyframes,
      legacyEffects: clip.effects,
      audioEffectStack: clip.audioState?.effectStack,
      clipDuration: displayDuration,
    });
  }, [
    clip.audioState?.effectStack,
    clip.effects,
    clipAudioKeyframes,
    displayDuration,
    isAudioClip,
  ]);
  const visibleFadeCurveKeyframes = isAudioClip ? audioVolumeAutomationKeyframes : opacityKeyframes;
  const visibleFadeCurveKey = visibleFadeCurveKeyframes
    .map(k => `${k.id}:${k.time.toFixed(3)}:${k.value}:${k.handleIn?.x ?? ''}:${k.handleIn?.y ?? ''}:${k.handleOut?.x ?? ''}:${k.handleOut?.y ?? ''}`)
    .join('|');

  const clipMetaOffset = clip.isLoading
    ? 0
    : Math.min(
        Math.max(0, scrollX - left),
        Math.max(0, width - 48)
      );
  const clipRightOverflow = left + width - (scrollX + visibleTimelineViewportWidth);
  const clipRightStickyOffset = Math.max(
    0,
    Math.min(
      Math.max(0, width - 18),
      clipRightOverflow > 0 ? clipRightOverflow + CLIP_RIGHT_STICKY_PADDING_PX : 0
    )
  );

  // Render only the visible filmstrip window. At deep zoom the full clip can be
  // hundreds of thousands of pixels wide, so tying thumbnails to full clip width
  // makes the entire timeline unresponsive.
  const visibleThumbs = thumbnailRenderWindow.width > 0
    ? Math.max(1, Math.ceil(thumbnailRenderWindow.width / THUMB_WIDTH) + 1)
    : 0;

  // Source-based thumbnail cache: pull thumbnails from cache by mediaFileId
  const sourceMediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
  const isCompositionWithSegments = clip.isComposition && clip.clipSegments && clip.clipSegments.length > 0;
  const useSourceCache = clip.source?.type === 'video' && !!sourceMediaFileId && !isCompositionWithSegments;
  const cachedThumbnails = useThumbnailCache(
    useSourceCache ? sourceMediaFileId : undefined,
    thumbnailVisibleInPoint,
    thumbnailVisibleOutPoint,
    visibleThumbs,
    clip.reversed
  );
  // Fallback to clip.thumbnails for compositions/legacy clips without mediaFileId
  const legacyThumbnails = clip.thumbnails || [];
  const compositionSegments = clip.clipSegments ?? [];
  const showSegmentThumbnails = thumbnailsEnabled &&
    clip.isComposition &&
    compositionSegments.length > 0 &&
    !isAudioClip &&
    !showsStaticClipArtwork;
  const showRegularThumbnails = thumbnailsEnabled &&
    !isAudioClip &&
    !showsStaticClipArtwork &&
    !isCompositionWithSegments &&
    (useSourceCache ? cachedThumbnails.some(Boolean) : legacyThumbnails.length > 0);

  const keyframeTickGroups: ClipKeyframeTickGroup[] = keyframeTimeGroups ?? allKeyframeTimes.map(time => ({
    time,
    keyframeIds: [],
  }));
  const [keyframeGroupDrag, setKeyframeGroupDrag] = useState<KeyframeGroupDragState | null>(null);
  const [audioRegionDrag, setAudioRegionDrag] = useState<AudioRegionDragState | null>(null);
  const [videoBakeRegionDrag, setVideoBakeRegionDrag] = useState<VideoBakeRegionDragState | null>(null);
  const [audioRegionMoveDrag, setAudioRegionMoveDrag] = useState<AudioRegionMoveDragState | null>(null);
  const [audioRegionResizeDrag, setAudioRegionResizeDrag] = useState<AudioRegionResizeDragState | null>(null);
  const [spectralRegionDrag, setSpectralRegionDrag] = useState<SpectralRegionDragState | null>(null);
  const [audioRegionGainDrag, setAudioRegionGainDrag] = useState<AudioRegionGainDragState | null>(null);
  const [audioRegionContextMenu, setAudioRegionContextMenu] = useState<AudioRegionContextMenuState | null>(null);
  const audioRegionCommandHandledRef = useRef(false);
  const { menuRef: audioRegionContextMenuRef, adjustedPosition: audioRegionContextMenuPosition } =
    useContextMenuPosition(audioRegionContextMenu);
  const [audioBakePending, setAudioBakePending] = useState(false);

  const getMatchingAudioRegionOperationIds = useCallback((selection: TimelineAudioRegionSelection): string[] => {
    const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
    const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);
    return audioEditStack
      .filter(operation => {
        if (!operation.timeRange) return false;
        const operationStart = Math.min(operation.timeRange.start, operation.timeRange.end);
        const operationEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
        return Math.abs(operationStart - start) <= 0.001 &&
          Math.abs(operationEnd - end) <= 0.001;
      })
      .map(operation => operation.id);
  }, [audioEditStack]);

  const activeAudioRegionOperationDrag = audioRegionMoveDrag ?? audioRegionResizeDrag;
  const displayAudioEditStack = useMemo(() => {
    if (!audioRegionSelection || !activeAudioRegionOperationDrag?.operationIds.length) {
      return audioEditStack;
    }

    const operationIds = new Set(activeAudioRegionOperationDrag.operationIds);
    const start = Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const end = Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const timelineStart = Math.min(audioRegionSelection.startTime, audioRegionSelection.endTime);
    const timelineEnd = Math.max(audioRegionSelection.startTime, audioRegionSelection.endTime);

    return audioEditStack.map(operation => {
      if (!operationIds.has(operation.id) || !operation.timeRange) return operation;
      return {
        ...operation,
        params: {
          ...operation.params,
          timelineStart,
          timelineEnd,
        },
        timeRange: { start, end },
      };
    });
  }, [activeAudioRegionOperationDrag, audioEditStack, audioRegionSelection]);
  const waveformPyramidForRender = activeAudioRegionOperationDrag?.operationIds.length && sourceWaveformPyramid
    ? sourceWaveformPyramid
    : waveformPyramid;
  const waveformVariantForRender = activeAudioRegionOperationDrag?.operationIds.length && sourceWaveformPyramid
    ? 'source'
    : waveformVariant;
  const waveformUsesProcessedPyramidForRender = Boolean(
    waveformPyramidForRender &&
    processedWaveformPyramid &&
    waveformPyramidForRender === processedWaveformPyramid,
  );
  const processedWaveformPyramidForRender = waveformUsesProcessedPyramidForRender
    ? processedWaveformPyramid
    : null;
  const waveformNaturalDurationForRender = processedWaveformPyramidForRender
    ? Math.max(0.001, processedWaveformPyramidForRender.duration)
    : (clip.source?.naturalDuration || clip.duration);
  const waveformInPointForRender = processedWaveformPyramidForRender ? 0 : displayInPoint;
  const waveformOutPointForRender = processedWaveformPyramidForRender
    ? Math.max(0.001, processedWaveformPyramidForRender.duration)
    : displayOutPoint;
  const canApplyPredictiveAudioWaveform = waveformVariantForRender !== 'processed';
  const predictiveAudioEditStack = canApplyPredictiveAudioWaveform
    ? displayAudioEditStack
    : EMPTY_AUDIO_EDIT_STACK;
  const predictiveAudioRegionGainPreview = canApplyPredictiveAudioWaveform
    ? audioRegionGainPreview
    : null;

  const commitAudioRegionOperationRange = useCallback((
    operationIds: string[],
    selection: TimelineAudioRegionSelection,
    historyLabel: string,
  ) => {
    if (operationIds.length === 0) return;
    setClipAudioEditOperationRange(clip.id, operationIds, selection, {
      captureHistory: true,
      historyLabel,
    });
  }, [clip.id, setClipAudioEditOperationRange]);

  const handleKeyframeTickMouseDown = (
    e: React.MouseEvent<HTMLButtonElement>,
    group: ClipKeyframeTickGroup
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!onMoveKeyframeGroup || group.keyframeIds.length === 0) return;

    setKeyframeGroupDrag({
      keyframeIds: group.keyframeIds,
      startX: e.clientX,
      startTime: group.time,
      clipWidth: Math.max(1, width),
      clipDuration: Math.max(0.001, displayDuration),
    });
  };

  useEffect(() => {
    if (!keyframeGroupDrag || !onMoveKeyframeGroup) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const deltaX = e.clientX - keyframeGroupDrag.startX;
      const deltaTime = (deltaX / keyframeGroupDrag.clipWidth) * keyframeGroupDrag.clipDuration;
      let newTime = Math.max(
        0,
        Math.min(keyframeGroupDrag.clipDuration, keyframeGroupDrag.startTime + deltaTime)
      );

      if (e.shiftKey) {
        const movingIds = new Set(keyframeGroupDrag.keyframeIds);
        let bestDistancePx = KEYFRAME_TICK_SNAP_THRESHOLD_PX;

        for (const group of keyframeTickGroups) {
          if (group.keyframeIds.some(id => movingIds.has(id))) continue;

          const distancePx = Math.abs(
            ((group.time - newTime) / keyframeGroupDrag.clipDuration) * keyframeGroupDrag.clipWidth
          );

          if (distancePx <= bestDistancePx) {
            bestDistancePx = distancePx;
            newTime = group.time;
          }
        }
      }

      onMoveKeyframeGroup(keyframeGroupDrag.keyframeIds, newTime);
    };

    const handleDocumentMouseUp = () => {
      setKeyframeGroupDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [keyframeGroupDrag, keyframeTickGroups, onMoveKeyframeGroup]);

  const canSelectAudioRegion = audioFocusMode &&
    isAudioClip &&
    audioDisplayMode === 'detailed' &&
    activeTimelineToolId === 'select' &&
    track.locked !== true;
  const canSelectSpectralRegion = audioFocusMode &&
    isAudioClip &&
    audioDisplayMode === 'spectral' &&
    activeTimelineToolId === 'select' &&
    track.locked !== true;
  const canSelectVideoBakeRegion = trackFocusMode === 'video' &&
    !isAudioClip &&
    activeTimelineToolId === 'select' &&
    track.locked !== true;

  const timelineTimeFromAudioRegionClientX = useCallback((
    clientX: number,
    drag: Pick<AudioRegionDragState, 'rectLeft' | 'rectWidth'>,
  ): number => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    return displayStartTime + (x / Math.max(1, drag.rectWidth)) * Math.max(0.001, displayDuration);
  }, [displayDuration, displayStartTime]);

  const timelineTimeFromVideoBakeClientX = useCallback((
    clientX: number,
    drag: Pick<VideoBakeRegionDragState, 'rectLeft' | 'rectWidth'>,
  ): number => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    return displayStartTime + (x / Math.max(1, drag.rectWidth)) * Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
  }, [displayDuration, displayStartTime]);

  const sourceTimeFromVideoBakeTimelineTime = useCallback((timelineTime: number): number => {
    const clipDuration = Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayOutPoint ?? sourceStart + clipDuration);
    const timelineRatio = Math.max(0, Math.min(1, (timelineTime - displayStartTime) / clipDuration));
    const sourceRatio = clip.reversed ? 1 - timelineRatio : timelineRatio;
    return sourceStart + sourceRatio * (sourceEnd - sourceStart);
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);

  const sourceTimeToVideoBakeTimelineTime = useCallback((sourceTime: number): number => {
    const clipDuration = Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration);
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayOutPoint ?? sourceStart + clipDuration);
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
    return displayStartTime + timelineRatio * clipDuration;
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);

  const resolveVideoBakeRegionDragSelection = useCallback((
    drag: VideoBakeRegionDragState,
    clientX: number,
  ): TimelineVideoBakeRegionSelection => {
    const focusTimelineTime = timelineTimeFromVideoBakeClientX(clientX, drag);
    return {
      scope: 'clip',
      clipId: clip.id,
      trackId: track.id,
      startTime: drag.anchorTimelineTime,
      endTime: focusTimelineTime,
      sourceInPoint: sourceTimeFromVideoBakeTimelineTime(drag.anchorTimelineTime),
      sourceOutPoint: sourceTimeFromVideoBakeTimelineTime(focusTimelineTime),
    };
  }, [
    clip.id,
    sourceTimeFromVideoBakeTimelineTime,
    timelineTimeFromVideoBakeClientX,
    track.id,
  ]);

  const resolveAudioRegionDragSelection = useCallback((
    drag: AudioRegionDragState,
    clientX: number,
  ) => resolveTimelineAudioRegionSelection({
    clip: {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    },
    anchorTimelineTime: drag.anchorTimelineTime,
    focusTimelineTime: timelineTimeFromAudioRegionClientX(clientX, drag),
    snapThresholdSeconds: Math.min(0.035, Math.max(0.002, 7 / Math.max(1, zoom))),
  }), [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    timelineTimeFromAudioRegionClientX,
    zoom,
  ]);

  const resolveAudioRegionMoveSelection = useCallback((
    drag: AudioRegionMoveDragState,
    clientX: number,
  ) => {
    const deltaX = clientX - drag.startClientX;
    const deltaTimelineSeconds = (deltaX / Math.max(1, drag.clipWidth)) * Math.max(0.001, drag.clipDuration);
    return moveTimelineAudioRegionSelection({
      clip: {
        ...clip,
        startTime: displayStartTime,
        duration: displayDuration,
        inPoint: displayInPoint,
        outPoint: displayOutPoint,
        waveform: clip.waveform,
      },
      selection: drag.initialSelection,
      deltaTimelineSeconds,
    });
  }, [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
  ]);

  const resolveAudioRegionResizeSelection = useCallback((
    drag: AudioRegionResizeDragState,
    clientX: number,
  ) => resizeTimelineAudioRegionSelection({
    clip: {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    },
    selection: drag.initialSelection,
    edge: drag.edge,
    focusTimelineTime: timelineTimeFromAudioRegionClientX(clientX, drag),
    snapThresholdSeconds: Math.min(0.035, Math.max(0.002, 7 / Math.max(1, zoom))),
  }), [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    timelineTimeFromAudioRegionClientX,
    zoom,
  ]);

  const resolveSpectralRegionDragSelection = useCallback((
    drag: SpectralRegionDragState,
    clientX: number,
    clientY: number,
  ) => {
    const selectionClip = {
      ...clip,
      startTime: displayStartTime,
      duration: displayDuration,
      inPoint: displayInPoint,
      outPoint: displayOutPoint,
      waveform: clip.waveform,
    };
    const focusTimelineTime = timelineTimeFromAudioRegionClientX(clientX, drag);
    const focusFrequencyHz = frequencyHzFromSpectralY(clientY - drag.rectTop, drag.rectHeight, drag.maxFrequencyHz);

    if (drag.mode === 'brush') {
      return resolveTimelineSpectralBrushSelection({
        clip: selectionClip,
        centerTimelineTime: focusTimelineTime,
        centerFrequencyHz: focusFrequencyHz,
        timeRadiusSeconds: drag.brushTimeRadiusSeconds ?? 0.08,
        frequencyRadiusHz: drag.brushFrequencyRadiusHz ?? drag.maxFrequencyHz * 0.04,
        maxFrequencyHz: drag.maxFrequencyHz,
      });
    }

    return resolveTimelineSpectralRegionSelection({
      clip: selectionClip,
      anchorTimelineTime: drag.anchorTimelineTime,
      focusTimelineTime,
      anchorFrequencyHz: drag.anchorFrequencyHz,
      focusFrequencyHz,
      maxFrequencyHz: drag.maxFrequencyHz,
    });
  }, [
    clip,
    displayDuration,
    displayInPoint,
    displayOutPoint,
    displayStartTime,
    timelineTimeFromAudioRegionClientX,
  ]);

  const handleAudioRegionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || e.button !== 0 || !isAudioRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const drag: AudioRegionDragState = {
      anchorTimelineTime: timelineTimeFromAudioRegionClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      startClientX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
    };

    setAudioRegionDrag(drag);
    setAudioRegionSelection(resolveAudioRegionDragSelection(drag, e.clientX));
  };
  const handleAudioRegionDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setAudioRegionContextMenu(null);
    setAudioRegionSelection(resolveTimelineAudioRegionSelection({
      clip: {
        ...clip,
        startTime: displayStartTime,
        duration: displayDuration,
        inPoint: displayInPoint,
        outPoint: displayOutPoint,
        waveform: clip.waveform,
      },
      anchorTimelineTime: displayStartTime,
      focusTimelineTime: displayStartTime + Math.max(0.001, displayDuration),
      snapThresholdSeconds: 0,
    }));
  };

  const handleVideoBakeRegionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectVideoBakeRegion || e.button !== 0 || !isVideoBakeRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const drag: VideoBakeRegionDragState = {
      anchorTimelineTime: timelineTimeFromVideoBakeClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      startClientX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
    };

    setVideoBakeRegionDrag(drag);
    setVideoBakeRegionSelection(resolveVideoBakeRegionDragSelection(drag, e.clientX));
  };

  const handleVideoBakeRegionDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectVideoBakeRegion || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    addClipVideoBakeRegion(clip.id, {
      trackId: track.id,
      startTime: displayStartTime,
      endTime: displayStartTime + Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration),
      sourceInPoint: displayInPoint,
      sourceOutPoint: displayOutPoint,
    });
  };

  const handleAudioRegionSelectionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectAudioRegion || !audioRegionSelection || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setAudioRegionContextMenu(null);
    setAudioRegionMoveDrag({
      startClientX: e.clientX,
      clipWidth: Math.max(1, width),
      clipDuration: Math.max(0.001, displayDuration),
      initialSelection: audioRegionSelection,
      operationIds: getMatchingAudioRegionOperationIds(audioRegionSelection),
    });
  };

  const handleAudioRegionEdgeMouseDown = useCallback((
    edge: AudioRegionResizeDragState['edge'],
  ) => (e: React.MouseEvent<HTMLSpanElement>) => {
    if (!canSelectAudioRegion || !audioRegionSelection || e.button !== 0) return;
    const clipElement = e.currentTarget.closest('.timeline-clip');
    if (!clipElement) return;

    e.preventDefault();
    e.stopPropagation();
    setAudioRegionContextMenu(null);
    const rect = clipElement.getBoundingClientRect();
    setAudioRegionResizeDrag({
      edge,
      rectLeft: rect.left,
      rectWidth: Math.max(1, rect.width),
      initialSelection: audioRegionSelection,
      operationIds: getMatchingAudioRegionOperationIds(audioRegionSelection),
    });
  }, [
    audioRegionSelection,
    canSelectAudioRegion,
    getMatchingAudioRegionOperationIds,
    setAudioRegionContextMenu,
  ]);

  const handleSpectralRegionMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion || e.button !== 0 || !isAudioRegionModifierPressed(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const brushMode = e.shiftKey || e.altKey;
    const drag: SpectralRegionDragState = {
      anchorTimelineTime: timelineTimeFromAudioRegionClientX(e.clientX, {
        rectLeft: rect.left,
        rectWidth: rect.width,
      }),
      anchorFrequencyHz: frequencyHzFromSpectralY(e.clientY - rect.top, rect.height, spectralMaxFrequencyHz),
      startClientX: e.clientX,
      startClientY: e.clientY,
      rectLeft: rect.left,
      rectWidth: rect.width,
      rectTop: rect.top,
      rectHeight: rect.height,
      maxFrequencyHz: spectralMaxFrequencyHz,
      mode: brushMode ? 'brush' : 'rectangle',
      brushTimeRadiusSeconds: brushMode ? Math.max(0.025, Math.min(0.5, 18 / Math.max(1, zoom))) : undefined,
      brushFrequencyRadiusHz: brushMode ? Math.max(80, spectralMaxFrequencyHz * 0.045) : undefined,
    };

    setSpectralRegionDrag(drag);
    setAudioSpectralRegionSelection(resolveSpectralRegionDragSelection(drag, e.clientX, e.clientY));
  };

  useEffect(() => {
    if (!audioRegionDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isAudioRegionModifierPressed(e)) {
        setAudioRegionDrag(null);
        return;
      }
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionDragSelection(audioRegionDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      if (Math.abs(e.clientX - audioRegionDrag.startClientX) < 3) {
        clearAudioRegionSelection();
      }
      setAudioRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionDrag,
    canSelectAudioRegion,
    clearAudioRegionSelection,
    resolveAudioRegionDragSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!videoBakeRegionDrag || !canSelectVideoBakeRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isVideoBakeRegionModifierPressed(e)) {
        setVideoBakeRegionDrag(null);
        clearVideoBakeRegionSelection();
        return;
      }
      e.preventDefault();
      setVideoBakeRegionSelection(resolveVideoBakeRegionDragSelection(videoBakeRegionDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const draggedFarEnough = Math.abs(e.clientX - videoBakeRegionDrag.startClientX) >= 3;
      if (draggedFarEnough) {
        const selection = resolveVideoBakeRegionDragSelection(videoBakeRegionDrag, e.clientX);
        addClipVideoBakeRegion(clip.id, selection);
      } else {
        clearVideoBakeRegionSelection();
      }
      setVideoBakeRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    addClipVideoBakeRegion,
    canSelectVideoBakeRegion,
    clearVideoBakeRegionSelection,
    clip.id,
    resolveVideoBakeRegionDragSelection,
    setVideoBakeRegionSelection,
    videoBakeRegionDrag,
  ]);

  useEffect(() => {
    if (!audioRegionMoveDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionMoveSelection(audioRegionMoveDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const nextSelection = resolveAudioRegionMoveSelection(audioRegionMoveDrag, e.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(
        audioRegionMoveDrag.operationIds,
        nextSelection,
        'Move audio region edit',
      );
      setAudioRegionMoveDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionMoveDrag,
    canSelectAudioRegion,
    commitAudioRegionOperationRange,
    resolveAudioRegionMoveSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!audioRegionResizeDrag || !canSelectAudioRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      setAudioRegionSelection(resolveAudioRegionResizeSelection(audioRegionResizeDrag, e.clientX));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const nextSelection = resolveAudioRegionResizeSelection(audioRegionResizeDrag, e.clientX);
      setAudioRegionSelection(nextSelection);
      commitAudioRegionOperationRange(
        audioRegionResizeDrag.operationIds,
        nextSelection,
        'Resize audio region edit',
      );
      setAudioRegionResizeDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    audioRegionResizeDrag,
    canSelectAudioRegion,
    commitAudioRegionOperationRange,
    resolveAudioRegionResizeSelection,
    setAudioRegionSelection,
  ]);

  useEffect(() => {
    if (!audioRegionSelection) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.clip-audio-region-selection')) return;
      if (target.closest('.clip-audio-region-context-menu')) return;
      if (target.closest('.clip-audio-edit-operation-overlay')) return;

      setAudioRegionContextMenu(null);
      clearAudioRegionSelection();
    };

    document.addEventListener('mousedown', handleDocumentMouseDown, true);

    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true);
    };
  }, [audioRegionSelection, clearAudioRegionSelection]);

  useEffect(() => {
    if (!spectralRegionDrag || !canSelectSpectralRegion) return;

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isAudioRegionModifierPressed(e)) {
        setSpectralRegionDrag(null);
        return;
      }
      e.preventDefault();
      setAudioSpectralRegionSelection(resolveSpectralRegionDragSelection(spectralRegionDrag, e.clientX, e.clientY));
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      if (
        spectralRegionDrag.mode !== 'brush' &&
        Math.abs(e.clientX - spectralRegionDrag.startClientX) < 3 &&
        Math.abs(e.clientY - spectralRegionDrag.startClientY) < 3
      ) {
        clearAudioSpectralRegionSelection();
      }
      setSpectralRegionDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canSelectSpectralRegion,
    clearAudioSpectralRegionSelection,
    resolveSpectralRegionDragSelection,
    setAudioSpectralRegionSelection,
    spectralRegionDrag,
  ]);

  // Determine clip type class (audio, video, text, or image)
  const clipTypeClass = isSolidClip ? 'solid' : isMathSceneClip ? 'math-scene' : (isTextClip || isText3DClip) ? 'text' : isCameraClip ? 'camera' : isSplatEffectorClip ? 'splat-effector' : isAudioClip ? 'audio' : (clip.source?.type || 'video');

  // Check if this clip is part of a multi-select drag
  const isInMultiSelectDrag = clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined;
  const isTrackLocked = track.locked === true;
  const trackTypeIndex = useMemo(
    () => tracks.filter(candidate => candidate.type === track.type).findIndex(candidate => candidate.id === track.id),
    [track.id, track.type, tracks],
  );
  const trackColor = timelineTrackColorsVisible ? getTimelineTrackColor(track, trackTypeIndex) : TIMELINE_TRACK_COLOR_HIDDEN;

  const clipClass = [
    'timeline-clip',
    isSelected ? 'selected' : '',
    isInLinkedGroup ? 'linked-group' : '',
    isDragging ? 'dragging' : '',
    clipDrag?.toolGesture === 'slip' && (isDragging || isLinkedToDragging) ? 'slipping' : '',
    clipDrag?.toolGesture === 'slide' && (isDragging || isLinkedToDragging) ? 'sliding' : '',
    isInMultiSelectDrag ? 'dragging multiselect-dragging' : '',
    isLinkedToDragging ? 'linked-dragging' : '',
    isTrimming ? 'trimming' : '',
    isLinkedToTrimming ? 'linked-trimming' : '',
    isFading ? 'fading' : '',
    isDragging && clipDrag?.forcingOverlap ? 'forcing-overlap' : '',
    clipTypeClass,
    isAudioClip ? `audio-mode-${audioDisplayMode}` : '',
    isAudioClip && audioFocusMode ? 'audio-focus-active' : '',
    audioRegionSelection ? 'audio-region-selected' : '',
    audioSpectralRegionSelection ? 'spectral-region-selected' : '',
    videoBakeRegionSelection ? 'video-bake-region-selected' : '',
    clip.videoState?.bakeRegions?.length ? 'has-video-bake-regions' : '',
    clip.isLoading ? 'loading' : '',
    clip.needsReload ? 'needs-reload' : '',
    hasProxy ? 'has-proxy' : '',
    isGeneratingProxy ? 'generating-proxy' : '',
    hasProxyError ? 'proxy-error' : '',
    hasAudioProxy ? 'has-audio-proxy' : '',
    isGeneratingAudioProxy ? 'generating-audio-proxy' : '',
    hasAudioProxyError ? 'audio-proxy-error' : '',
    hasStemSeparation ? 'has-stems' : '',
    hasKeyframes(clip.id) ? 'has-keyframes' : '',
    clip.reversed ? 'reversed' : '',
    clip.transcriptStatus === 'ready' ? 'has-transcript' : '',
    showWaveformGenerationIndicator ? 'generating-waveform' : '',
    activeStemSeparationJob ? 'separating-stems' : '',
    waveformProcessingState,
    spectrogramProcessingState,
    audioDisplayMode === 'spectral' ? '' : (processedWaveformStatus?.className ?? ''),
    audioDisplayMode === 'spectral' ? (processedSpectrogramStatus?.className ?? '') : '',
    ...(audioWaveformDiagnostics?.classNames ?? []),
    clip.parentClipId ? 'has-parent' : '',
    clip.isPendingDownload ? 'pending-download' : '',
    clip.downloadError ? 'download-error' : '',
    clip.isComposition ? 'composition' : '',
    aiMovePhase !== 'idle' ? 'ai-moving' : '',
    isTrackLocked ? 'track-locked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const getClipPointerContext = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      toolId: activeTimelineToolId,
      clip,
      track,
      clips,
      playheadPosition,
      snappingEnabled,
      displayStartTime,
      displayDuration,
      width,
      clientX: e.clientX,
      rectLeft: rect.left,
      altKey: e.altKey,
    };
  };

  // Timeline tool pointer handlers
  const handleMouseMove = (e: React.MouseEvent) => {
    const result = dispatchTimelineClipPointerMove(getClipPointerContext(e));
    if (!result.handled) {
      if (timelineToolPreview?.clipId === clip.id) setTimelineToolPreview(null);
      return;
    }
    setTimelineToolPreview(result.preview ?? null);
  };

  const handleMouseLeave = () => {
    if (timelineToolPreview?.clipId === clip.id) setTimelineToolPreview(null);
  };

  const handleClick = (e: React.MouseEvent) => {
    const result = dispatchTimelineClipPointerClick(getClipPointerContext(e));
    if (!result.handled) return;
    e.preventDefault();
    e.stopPropagation();

    if (result.operation) {
      applyTimelineEditOperation(result.operation, {
        source: 'ui',
      historyLabel: result.operation.type === 'select-clips-from-time'
        ? 'Track select'
        : result.operation.type === 'split-all-at-time'
          ? 'Blade all tracks'
          : 'Blade clip',
      });
    }
    if (result.nextToolId) setActiveTimelineTool(result.nextToolId);
    setTimelineToolPreview(null);
  };

  // Calculate cut indicator position for this clip
  const cutIndicatorX = shouldShowCutIndicator && timelineToolPreview?.time !== undefined
    ? ((timelineToolPreview.time - displayStartTime) / displayDuration) * width
    : null;
  const audioRegionOverlay = audioRegionSelection && audioRegionSelection.endTime - audioRegionSelection.startTime > 0.001
    ? (() => {
        const regionStart = Math.max(displayStartTime, audioRegionSelection.startTime);
        const regionEnd = Math.min(displayStartTime + displayDuration, audioRegionSelection.endTime);
        if (regionEnd <= regionStart) return null;
        return {
          left: ((regionStart - displayStartTime) / Math.max(0.001, displayDuration)) * width,
          width: ((regionEnd - regionStart) / Math.max(0.001, displayDuration)) * width,
        };
      })()
    : null;
  const selectedAudioRegionGainOperation = useMemo(() => {
    if (!audioRegionSelection) return null;
    const start = Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const end = Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);

    for (let index = displayAudioEditStack.length - 1; index >= 0; index -= 1) {
      const operation = displayAudioEditStack[index];
      if (
        operation?.type === 'gain' &&
        operation.enabled !== false &&
        operation.timeRange &&
        Math.abs(Math.min(operation.timeRange.start, operation.timeRange.end) - start) <= 0.001 &&
        Math.abs(Math.max(operation.timeRange.start, operation.timeRange.end) - end) <= 0.001
      ) {
        return operation;
      }
    }

    return null;
  }, [displayAudioEditStack, audioRegionSelection]);
  const audioRegionGainControl = audioRegionOverlay && audioRegionSelection
    ? (() => {
        const regionDuration = Math.max(
          0.001,
          Math.abs(audioRegionSelection.sourceOutPoint - audioRegionSelection.sourceInPoint),
        );
        const gainDb = audioRegionGainDrag?.currentGainDb ??
          finiteNumberOr(selectedAudioRegionGainOperation?.params.gainDb, 0);
        const fadeInSeconds = audioRegionGainDrag?.currentFadeInSeconds ??
          finiteNumberOr(selectedAudioRegionGainOperation?.params.fadeInSeconds, AUDIO_REGION_GAIN_DEFAULT_FADE_SECONDS);
        const fadeOutSeconds = audioRegionGainDrag?.currentFadeOutSeconds ??
          finiteNumberOr(selectedAudioRegionGainOperation?.params.fadeOutSeconds, AUDIO_REGION_GAIN_DEFAULT_FADE_SECONDS);
        const maxFadeSeconds = regionDuration / 2;

        return {
          regionDuration,
          gainDb: Number(clampAudioRegionGainDb(gainDb).toFixed(1)),
          fadeInSeconds: Math.max(0, Math.min(maxFadeSeconds, fadeInSeconds)),
          fadeOutSeconds: Math.max(0, Math.min(maxFadeSeconds, fadeOutSeconds)),
          yPercent: audioRegionGainDbToYPercent(gainDb),
          fadeInPx: Math.max(0, Math.min(audioRegionOverlay.width / 2, (fadeInSeconds / regionDuration) * audioRegionOverlay.width)),
          fadeOutPx: Math.max(0, Math.min(audioRegionOverlay.width / 2, (fadeOutSeconds / regionDuration) * audioRegionOverlay.width)),
        };
      })()
    : null;
  const commitAudioRegionGainEdit = useCallback((input: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    setAudioRegionGainEdit({
      gainDb: input.gainDb,
      fadeInSeconds: input.fadeInSeconds,
      fadeOutSeconds: input.fadeOutSeconds,
      keepSelection: true,
    });
  }, [setAudioRegionGainEdit]);
  const publishAudioRegionGainPreview = useCallback((input: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    if (!audioRegionSelection) return;
    setAudioRegionGainPreview({
      clipId: clip.id,
      trackId: audioRegionSelection.trackId,
      startTime: audioRegionSelection.startTime,
      endTime: audioRegionSelection.endTime,
      sourceInPoint: audioRegionSelection.sourceInPoint,
      sourceOutPoint: audioRegionSelection.sourceOutPoint,
      gainDb: input.gainDb,
      fadeInSeconds: input.fadeInSeconds,
      fadeOutSeconds: input.fadeOutSeconds,
    });
  }, [audioRegionSelection, clip.id, setAudioRegionGainPreview]);
  const handleAudioRegionGainMouseDown = useCallback((
    mode: AudioRegionGainDragState['mode'],
  ) => (e: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => {
    if (!audioRegionGainControl) return;
    const regionElement = e.currentTarget.closest('.clip-audio-region-selection');
    if (!regionElement) return;

    e.preventDefault();
    e.stopPropagation();
    const rect = regionElement.getBoundingClientRect();
    const startGainDb = mode === 'gain'
      ? Number(audioRegionGainDbFromClientY(e.clientY, rect).toFixed(1))
      : audioRegionGainControl.gainDb;
    publishAudioRegionGainPreview({
      gainDb: startGainDb,
      fadeInSeconds: audioRegionGainControl.fadeInSeconds,
      fadeOutSeconds: audioRegionGainControl.fadeOutSeconds,
    });

    setAudioRegionGainDrag({
      mode,
      regionLeft: rect.left,
      regionWidth: rect.width,
      regionTop: rect.top,
      regionHeight: rect.height,
      regionDuration: audioRegionGainControl.regionDuration,
      startGainDb,
      startFadeInSeconds: audioRegionGainControl.fadeInSeconds,
      startFadeOutSeconds: audioRegionGainControl.fadeOutSeconds,
      currentGainDb: startGainDb,
      currentFadeInSeconds: audioRegionGainControl.fadeInSeconds,
      currentFadeOutSeconds: audioRegionGainControl.fadeOutSeconds,
    });
  }, [audioRegionGainControl, publishAudioRegionGainPreview]);
  const handleAudioRegionContextMenu = useCallback((e: React.MouseEvent) => {
    if (!audioRegionSelection) return;
    e.preventDefault();
    e.stopPropagation();
    const expectedExpandedHeight = 340;
    const y = typeof window === 'undefined'
      ? e.clientY
      : Math.min(
          e.clientY,
          Math.max(8, window.innerHeight - expectedExpandedHeight - 8),
        );
    audioRegionCommandHandledRef.current = false;
    setAudioRegionContextMenu({ x: e.clientX, y, selection: audioRegionSelection });
  }, [audioRegionSelection, setAudioRegionContextMenu]);
  const closeAudioRegionContextMenu = useCallback(() => {
    setAudioRegionContextMenu(null);
  }, [setAudioRegionContextMenu]);
  useEffect(() => {
    if (!audioRegionGainDrag) return;

    const getNextDragState = (e: MouseEvent): AudioRegionGainDragState => {
      if (audioRegionGainDrag.mode === 'gain') {
        return {
          ...audioRegionGainDrag,
          currentGainDb: Number(audioRegionGainDbFromClientY(e.clientY, {
            top: audioRegionGainDrag.regionTop,
            height: audioRegionGainDrag.regionHeight,
          }).toFixed(1)),
        };
      }

      const localX = Math.max(0, Math.min(audioRegionGainDrag.regionWidth, e.clientX - audioRegionGainDrag.regionLeft));
      const secondsAtPointer = (localX / Math.max(1, audioRegionGainDrag.regionWidth)) * audioRegionGainDrag.regionDuration;
      const maxFadeSeconds = audioRegionGainDrag.regionDuration / 2;

      return {
        ...audioRegionGainDrag,
        currentFadeInSeconds: audioRegionGainDrag.mode === 'fade-in'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, secondsAtPointer)).toFixed(4))
          : audioRegionGainDrag.currentFadeInSeconds,
        currentFadeOutSeconds: audioRegionGainDrag.mode === 'fade-out'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, audioRegionGainDrag.regionDuration - secondsAtPointer)).toFixed(4))
          : audioRegionGainDrag.currentFadeOutSeconds,
      };
    };

    const handleDocumentMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const next = getNextDragState(e);
      publishAudioRegionGainPreview({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      setAudioRegionGainDrag(next);
    };

    const handleDocumentMouseUp = (e: MouseEvent) => {
      const next = getNextDragState(e);
      commitAudioRegionGainEdit({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      clearAudioRegionGainPreview();
      setAudioRegionGainDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [audioRegionGainDrag, clearAudioRegionGainPreview, commitAudioRegionGainEdit, publishAudioRegionGainPreview]);

  useEffect(() => () => {
    const preview = useTimelineStore.getState().audioRegionGainPreview;
    if (preview?.clipId === clip.id) {
      useTimelineStore.getState().clearAudioRegionGainPreview();
    }
  }, [clip.id]);

  useEffect(() => {
    if (!audioRegionContextMenu) return;

    const handlePointerDown = () => closeAudioRegionContextMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAudioRegionContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [audioRegionContextMenu, closeAudioRegionContextMenu]);
  const spectralRegionOverlay = audioSpectralRegionSelection &&
    audioSpectralRegionSelection.endTime - audioSpectralRegionSelection.startTime > 0.001 &&
    audioSpectralRegionSelection.frequencyMaxHz - audioSpectralRegionSelection.frequencyMinHz > 1
    ? (() => {
        const regionStart = Math.max(displayStartTime, audioSpectralRegionSelection.startTime);
        const regionEnd = Math.min(displayStartTime + displayDuration, audioSpectralRegionSelection.endTime);
        if (regionEnd <= regionStart) return null;

        const laneTop = 18;
        const laneHeight = Math.max(1, trackBaseHeight - laneTop - 4);
        const top = laneTop + spectralYFromFrequencyHz(
          audioSpectralRegionSelection.frequencyMaxHz,
          laneHeight,
          spectralMaxFrequencyHz,
        );
        const bottom = laneTop + spectralYFromFrequencyHz(
          audioSpectralRegionSelection.frequencyMinHz,
          laneHeight,
          spectralMaxFrequencyHz,
        );

        return {
          left: ((regionStart - displayStartTime) / Math.max(0.001, displayDuration)) * width,
          width: ((regionEnd - regionStart) / Math.max(0.001, displayDuration)) * width,
          top,
          height: Math.max(2, bottom - top),
        };
      })()
    : null;
  const sourceTimeToDisplayTimelineTime = useCallback((sourceTime: number): number => {
    const sourceStart = Math.max(0, displayInPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + 0.001, displayOutPoint ?? sourceStart + displayDuration);
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
    return displayStartTime + timelineRatio * displayDuration;
  }, [clip.reversed, displayDuration, displayInPoint, displayOutPoint, displayStartTime]);
  const spectralImageLayerOverlays = useMemo(() => {
    if (!canSelectSpectralRegion && audioDisplayMode !== 'spectral') return [];
    const layers = clip.audioState?.spectralLayers ?? [];
    if (layers.length === 0) return [];

    const laneTop = 18;
    const laneHeight = Math.max(1, trackBaseHeight - laneTop - 4);
    return layers.flatMap(layer => {
      const layerDuration = finiteNumberOr(layer.duration, 0);
      if (layer.enabled === false || layerDuration <= 0) return [];

      const layerTimeStart = finiteNumberOr(layer.timeStart, 0);
      const layerFrequencyMin = finiteNumberOr(layer.frequencyMin, 0);
      const layerFrequencyMax = finiteNumberOr(layer.frequencyMax, spectralMaxFrequencyHz);
      const timelineStart = sourceTimeToDisplayTimelineTime(layerTimeStart);
      const timelineEnd = sourceTimeToDisplayTimelineTime(layerTimeStart + layerDuration);
      const regionStart = Math.max(displayStartTime, Math.min(timelineStart, timelineEnd));
      const regionEnd = Math.min(displayStartTime + displayDuration, Math.max(timelineStart, timelineEnd));
      if (regionEnd <= regionStart) return [];

      const top = laneTop + spectralYFromFrequencyHz(layerFrequencyMax, laneHeight, spectralMaxFrequencyHz);
      const bottom = laneTop + spectralYFromFrequencyHz(layerFrequencyMin, laneHeight, spectralMaxFrequencyHz);
      const mediaFile = spectralImageFilesById.get(layer.imageMediaFileId);
      return [{
        id: layer.id,
        left: ((regionStart - displayStartTime) / Math.max(0.001, displayDuration)) * width,
        width: ((regionEnd - regionStart) / Math.max(0.001, displayDuration)) * width,
        top,
        height: Math.max(8, bottom - top),
        layer,
        mediaFile,
      }];
    });
  }, [
    audioDisplayMode,
    canSelectSpectralRegion,
    clip.audioState?.spectralLayers,
    displayDuration,
    displayStartTime,
    sourceTimeToDisplayTimelineTime,
    spectralImageFilesById,
    spectralMaxFrequencyHz,
    trackBaseHeight,
    width,
  ]);
  const audioEditOperationOverlays = useMemo<AudioEditOperationOverlay[]>(() => {
    if (!isAudioClip || !audioFocusMode || !showAudioRegionEditMarkers || displayAudioEditStack.length === 0) return [];

    const baseOverlays = displayAudioEditStack.flatMap((operation) => {
      if (operation.enabled === false || !operation.timeRange) return [];
      const sourceStart = Math.min(operation.timeRange.start, operation.timeRange.end);
      const sourceEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
      if (
        audioRegionSelection &&
        Math.abs(audioRegionSelection.sourceInPoint - sourceStart) <= 0.001 &&
        Math.abs(audioRegionSelection.sourceOutPoint - sourceEnd) <= 0.001
      ) {
        return [];
      }

      const timelineStart = sourceTimeToDisplayTimelineTime(sourceStart);
      const timelineEnd = sourceTimeToDisplayTimelineTime(sourceEnd);
      const selectionStartTime = Math.min(timelineStart, timelineEnd);
      const selectionEndTime = Math.max(timelineStart, timelineEnd);
      const regionStart = Math.max(displayStartTime, Math.min(timelineStart, timelineEnd));
      const regionEnd = Math.min(displayStartTime + displayDuration, Math.max(timelineStart, timelineEnd));
      if (regionEnd <= regionStart && operation.type !== 'insert-silence') return [];

      const nominalLeft = ((regionStart - displayStartTime) / Math.max(0.001, displayDuration)) * width;
      const nominalWidth = ((regionEnd - regionStart) / Math.max(0.001, displayDuration)) * width;
      const overlayWidth = Math.max(operation.type === 'insert-silence' ? 6 : 3, nominalWidth);
      const left = Math.max(0, Math.min(width - overlayWidth, nominalLeft));

      return [{
        id: operation.id,
        left,
        width: overlayWidth,
        top: 0,
        height: 0,
        label: getInlineAudioEditLabel(operation.type, operation.params as Record<string, unknown>),
        type: operation.type,
        selection: {
          clipId: clip.id,
          trackId: clip.trackId,
          startTime: selectionStartTime,
          endTime: selectionEndTime,
          sourceInPoint: sourceStart,
          sourceOutPoint: sourceEnd,
        },
      }];
    });

    const laneRightEdges: number[] = [];
    const laneHeight = Math.max(14, Math.min(18, Math.round(trackBaseHeight * 0.16)));
    const laneGap = 2;
    const topPadding = 4;
    const bottomPadding = 4;
    const maxTop = Math.max(topPadding, trackBaseHeight - bottomPadding - laneHeight);
    const topForLane = (lane: number) => Math.min(maxTop, topPadding + lane * (laneHeight + laneGap));

    return baseOverlays
      .toSorted((a, b) => a.left - b.left || b.width - a.width || a.id.localeCompare(b.id))
      .map((overlay) => {
        let lane = 0;
        while (lane < laneRightEdges.length && overlay.left < laneRightEdges[lane] - 1) {
          lane += 1;
        }
        laneRightEdges[lane] = Math.max(laneRightEdges[lane] ?? 0, overlay.left + overlay.width);
        return {
          ...overlay,
          top: topForLane(lane),
          height: laneHeight,
        };
      });
  }, [
    audioRegionSelection,
    clip.id,
    clip.trackId,
    displayAudioEditStack,
    audioFocusMode,
    displayDuration,
    displayStartTime,
    isAudioClip,
    showAudioRegionEditMarkers,
    sourceTimeToDisplayTimelineTime,
    trackBaseHeight,
    width,
  ]);
  const clipVideoBakeRegionOverlays = useMemo<ClipVideoBakeRegionOverlay[]>(() => {
    if (isAudioClip) return [];

    const buildOverlay = (
      id: string,
      startTime: number,
      endTime: number,
      status: VideoBakeRegion['status'],
      selection = false,
    ): ClipVideoBakeRegionOverlay | null => {
      const timelineStart = Math.min(startTime, endTime);
      const timelineEnd = Math.max(startTime, endTime);
      const regionStart = Math.max(displayStartTime, timelineStart);
      const regionEnd = Math.min(displayStartTime + displayDuration, timelineEnd);
      if (regionEnd <= regionStart) return null;

      return {
        id,
        status,
        selection,
        left: ((regionStart - displayStartTime) / Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration)) * width,
        width: Math.max(3, ((regionEnd - regionStart) / Math.max(VIDEO_BAKE_REGION_TIMELINE_EPSILON, displayDuration)) * width),
      };
    };

    const persistentOverlays = (clip.videoState?.bakeRegions ?? []).flatMap((region) => {
      const hasSourceRange = Number.isFinite(region.sourceInPoint) && Number.isFinite(region.sourceOutPoint);
      const startTime = hasSourceRange
        ? sourceTimeToVideoBakeTimelineTime(region.sourceInPoint as number)
        : region.startTime;
      const endTime = hasSourceRange
        ? sourceTimeToVideoBakeTimelineTime(region.sourceOutPoint as number)
        : region.endTime;
      const overlay = buildOverlay(region.id, startTime, endTime, region.status);
      return overlay ? [overlay] : [];
    });

    if (videoBakeRegionSelection) {
      const selectionOverlay = buildOverlay(
        'clip-video-bake-selection',
        videoBakeRegionSelection.startTime,
        videoBakeRegionSelection.endTime,
        'marked',
        true,
      );
      if (selectionOverlay) persistentOverlays.push(selectionOverlay);
    }

    return persistentOverlays;
  }, [
    clip.videoState?.bakeRegions,
    displayDuration,
    displayStartTime,
    isAudioClip,
    sourceTimeToVideoBakeTimelineTime,
    videoBakeRegionSelection,
    width,
  ]);
  const handleAudioEditOperationOverlayMouseDown = useCallback((
    overlay: AudioEditOperationOverlay,
  ) => (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setAudioRegionContextMenu(null);
    setAudioRegionSelection(overlay.selection);
  }, [setAudioRegionContextMenu, setAudioRegionSelection]);
  const handleApplySpectralRegionEdit = (type: TimelineSpectralRegionEditType) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    applySpectralRegionEdit(type);
  };
  const addSpectralImageLayerFromSelection = useCallback((imageMediaFileId: string) => {
    if (!audioSpectralRegionSelection) return null;
    const start = Math.min(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint);
    const end = Math.max(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint);
    if (end - start <= 0.0005) return null;

    return addClipSpectralImageLayer(clip.id, {
      imageMediaFileId,
      timeStart: start,
      duration: end - start,
      frequencyMin: audioSpectralRegionSelection.frequencyMinHz,
      frequencyMax: audioSpectralRegionSelection.frequencyMaxHz,
      opacity: 0.85,
      blendMode: 'attenuate',
      gainDb: -18,
      featherTime: 0.02,
      featherFrequency: 80,
    });
  }, [addClipSpectralImageLayer, audioSpectralRegionSelection, clip.id]);
  const handleAddSelectedImageSpectralLayer = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedSpectralImageFile) return;
    addSpectralImageLayerFromSelection(selectedSpectralImageFile.id);
  };
  const getDroppedImageMediaFileId = (dataTransfer: DataTransfer): string | null => {
    const mediaFileId = dataTransfer.getData('application/x-media-file-id');
    if (!mediaFileId) return null;
    const file = useMediaStore.getState().files.find(candidate => candidate.id === mediaFileId);
    return file?.type === 'image' ? file.id : null;
  };
  const handleSpectralImageLayerDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion || !getDroppedImageMediaFileId(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleSpectralImageLayerDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion) return;
    const imageMediaFileId = getDroppedImageMediaFileId(e.dataTransfer);
    if (!imageMediaFileId) return;

    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const centerTime = timelineTimeFromAudioRegionClientX(e.clientX, {
      rectLeft: rect.left,
      rectWidth: rect.width,
    });
    const layerDuration = Math.max(0.15, Math.min(displayDuration, Math.max(0.65, 160 / Math.max(1, zoom))));
    const centerFrequency = frequencyHzFromSpectralY(e.clientY - rect.top, rect.height, spectralMaxFrequencyHz);
    const frequencySpan = Math.max(120, spectralMaxFrequencyHz * 0.16);
    const selection = resolveTimelineSpectralRegionSelection({
      clip: {
        ...clip,
        startTime: displayStartTime,
        duration: displayDuration,
        inPoint: displayInPoint,
        outPoint: displayOutPoint,
        waveform: clip.waveform,
      },
      anchorTimelineTime: centerTime - layerDuration / 2,
      focusTimelineTime: centerTime + layerDuration / 2,
      anchorFrequencyHz: centerFrequency - frequencySpan / 2,
      focusFrequencyHz: centerFrequency + frequencySpan / 2,
      maxFrequencyHz: spectralMaxFrequencyHz,
    });

    addClipSpectralImageLayer(clip.id, {
      imageMediaFileId,
      timeStart: selection.sourceInPoint,
      duration: Math.max(0.001, selection.sourceOutPoint - selection.sourceInPoint),
      frequencyMin: selection.frequencyMinHz,
      frequencyMax: selection.frequencyMaxHz,
      opacity: 0.85,
      blendMode: 'attenuate',
      gainDb: -18,
      featherTime: 0.02,
      featherFrequency: 80,
    });
    setAudioSpectralRegionSelection(selection);
  };
  const handleAudioEditStackMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleBakeAudioEditStack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (audioBakePending) return;
    setAudioBakePending(true);
    void bakeClipAudioEditStack(clip.id).finally(() => {
      setAudioBakePending(false);
    });
  };
  const handleUnbakeAudioEditStack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (audioBakePending || !canUnbakeAudioEditStack) return;
    unbakeClipAudioEditStack(clip.id);
  };
  const handleClearAudioEditStack = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearClipAudioEditStack(clip.id);
  };
  const handleSplitAudioRegionAtSelection = (selectionSnapshot?: TimelineAudioRegionSelection | null) => {
    const store = useTimelineStore.getState();
    const selection = selectionSnapshot?.clipId === clip.id
      ? selectionSnapshot
      : store.audioRegionSelection?.clipId === clip.id
      ? store.audioRegionSelection
      : audioRegionSelection;
    const currentClip = store.clips.find(candidate => candidate.id === clip.id) ?? clip;
    if (!selection) {
      log.warn('Cannot split audio region without an active selection', { clipId: clip.id });
      return;
    }

    const range = resolveAudioRegionTimelineRangeForClip(currentClip, selection);
    if (!range) {
      log.warn('Cannot split audio region outside clip bounds', { clipId: clip.id, selection });
      return;
    }

    const clipStart = currentClip.startTime;
    const clipEnd = currentClip.startTime + Math.max(AUDIO_REGION_TIMELINE_EPSILON, currentClip.duration);
    const splitTimes = [range.start, range.end].filter(time =>
      time > clipStart + AUDIO_REGION_TIMELINE_EPSILON &&
      time < clipEnd - AUDIO_REGION_TIMELINE_EPSILON
    );
    const result = splitTimes.length > 0
      ? applyTimelineEditOperation({
        id: `split-audio-region:${clip.id}:${range.start}:${range.end}`,
        type: 'split-at-times',
        clipId: currentClip.id,
        times: splitTimes,
        includeLinked: false,
      }, {
        source: 'context-menu',
        historyLabel: 'Split audio region',
      })
      : { success: true };

    if (result.success) {
      const middleClip = useTimelineStore.getState().clips.find(candidate =>
        candidate.trackId === currentClip.trackId &&
        Math.abs(candidate.startTime - range.start) <= AUDIO_REGION_TIMELINE_EPSILON &&
        Math.abs(candidate.duration - range.duration) <= AUDIO_REGION_TIMELINE_EPSILON
      );
      if (middleClip) {
        selectClip(middleClip.id);
      }
    } else {
      log.warn('Split audio region operation failed', { clipId: currentClip.id, range, result });
    }
    clearAudioRegionSelection();
  };
  const handleCutAudioRegion = (selectionSnapshot?: TimelineAudioRegionSelection | null) => {
    const store = useTimelineStore.getState();
    const selection = selectionSnapshot?.clipId === clip.id
      ? selectionSnapshot
      : store.audioRegionSelection?.clipId === clip.id
      ? store.audioRegionSelection
      : audioRegionSelection;
    const currentClip = store.clips.find(candidate => candidate.id === clip.id) ?? clip;
    if (!selection) {
      log.warn('Cannot cut audio region without an active selection', { clipId: clip.id });
      return;
    }

    const range = resolveAudioRegionTimelineRangeForClip(currentClip, selection);
    if (!range) {
      log.warn('Cannot cut audio region outside clip bounds', { clipId: clip.id, selection });
      return;
    }

    if (store.audioRegionSelection?.clipId !== currentClip.id) {
      setAudioRegionSelection(selection);
    }
    copySelectedAudioRegion();
    const result = applyTimelineEditOperation({
      id: `cut-audio-region:${clip.id}:${range.start}:${range.end}`,
      type: 'lift-range',
      range: {
        startTime: range.start,
        endTime: range.end,
        trackIds: [currentClip.trackId],
      },
      includeLinked: false,
    }, {
      source: 'context-menu',
      historyLabel: 'Cut audio region',
    });
    if (result.success) {
      clearAudioRegionSelection();
    } else {
      log.warn('Cut audio region operation failed', { clipId: currentClip.id, range, result });
    }
  };
  const contextMenuAudioRegionSelection = audioRegionContextMenu?.selection ?? audioRegionSelection;
  const audioRegionDirectMenuCommands: AudioRegionContextMenuCommand[] = [
    { key: 'split', label: 'Split', action: () => handleSplitAudioRegionAtSelection(contextMenuAudioRegionSelection) },
    { key: 'cut', label: 'Cut', action: () => handleCutAudioRegion(contextMenuAudioRegionSelection), danger: true },
    { key: 'copy', label: 'Copy', action: copySelectedAudioRegion },
    { key: 'paste', label: 'Paste', action: pasteAudioRegionToSelection, disabled: !hasAudioRegionClipboard },
  ];
  const audioRegionContextMenuGroups: AudioRegionContextMenuGroup[] = [
    {
      key: 'clipboard',
      label: 'Clipboard',
      commands: [
      { key: 'copy-region', label: 'Copy Region', action: copySelectedAudioRegion },
      { key: 'paste-region', label: 'Paste Into Region', action: pasteAudioRegionToSelection, disabled: !hasAudioRegionClipboard },
      ],
    },
    {
      key: 'time',
      label: 'Time',
      commands: [
      { key: 'silence', label: 'Silence', action: () => applyAudioRegionEdit('silence', { keepSelection: true }) },
      { key: 'insert-silence', label: 'Insert Silence', action: () => applyAudioRegionEdit('insert-silence', { keepSelection: true }) },
      { key: 'delete-silence', label: 'Delete Audio', action: () => applyAudioRegionEdit('delete-silence', { keepSelection: true }), danger: true },
      ],
    },
    {
      key: 'polarity',
      label: 'Direction',
      commands: [
      { key: 'reverse', label: 'Reverse', action: () => applyAudioRegionEdit('reverse', { keepSelection: true }) },
      { key: 'invert-polarity', label: 'Invert Polarity', action: () => applyAudioRegionEdit('invert-polarity', { keepSelection: true }) },
      ],
    },
    {
      key: 'channels',
      label: 'Channels',
      commands: [
      { key: 'swap-channels', label: 'Swap L/R', action: () => applyAudioRegionEdit('swap-channels', { keepSelection: true }) },
      { key: 'mono-sum', label: 'Mono Sum', action: () => applyAudioRegionEdit('mono-sum', { keepSelection: true }) },
      {
        key: 'left-mono',
        label: 'Left To Mono',
        action: () => applyAudioRegionEdit('split-stereo', { keepSelection: true, params: { sourceChannel: 0, label: 'Left to mono' } }),
      },
      {
        key: 'right-mono',
        label: 'Right To Mono',
        action: () => applyAudioRegionEdit('split-stereo', { keepSelection: true, params: { sourceChannel: 1, label: 'Right to mono' } }),
      },
      ],
    },
    {
      key: 'fx',
      label: 'Region FX',
      commands: AUDIO_REGION_FX_PRESETS.map(preset => ({
        key: preset.key,
        label: preset.label,
        action: () => applyAudioRegionEdit('effect', {
          keepSelection: true,
          params: {
            label: preset.label,
            effectLabel: preset.label,
            effectDescriptorId: preset.descriptorId,
            featherTime: 0.015,
            ...preset.params,
          },
        }),
      })),
    },
    {
      key: 'repair',
      label: 'Repair',
      commands: [
      {
        key: 'hum-notch',
        label: '50 Hz Notch',
        action: () => applyAudioRegionEdit('repair', {
          keepSelection: true,
          params: { label: '50 Hz notch', repairType: 'hum-notch', baseFrequencyHz: 50, harmonicCount: 6, q: 35, featherTime: 0.02 },
        }),
      },
      {
        key: 'de-click',
        label: 'De-click',
        action: () => applyAudioRegionEdit('repair', {
          keepSelection: true,
          params: { label: 'De-click', repairType: 'de-click', threshold: 0.35, ratio: 4 },
        }),
      },
      {
        key: 'splice-smooth',
        label: 'Smooth Edge',
        action: () => applyAudioRegionEdit('repair', {
          keepSelection: true,
          params: { label: 'Smooth edge', repairType: 'splice-smooth', edgeSeconds: 0.008 },
        }),
      },
      {
        key: 'loudness-match',
        label: 'Match RMS',
        action: () => applyAudioRegionEdit('repair', {
          keepSelection: true,
          params: { label: 'Match RMS', repairType: 'loudness-match', targetDb: -20, minGainDb: -24, maxGainDb: 24, featherTime: 0.01 },
        }),
      },
      ],
    },
  ];
  const findAudioRegionContextMenuCommand = (key: string): AudioRegionContextMenuCommand | undefined =>
    audioRegionDirectMenuCommands.find(command => command.key === key) ??
    audioRegionContextMenuGroups
      .flatMap(group => group.commands)
      .find(command => command.key === key);
  const runAudioRegionContextMenuCommand = (
    command: AudioRegionContextMenuCommand,
    selection: TimelineAudioRegionSelection,
  ) => {
    if (audioRegionCommandHandledRef.current) return;
    if (command.disabled) return;
    audioRegionCommandHandledRef.current = true;
    log.info('Audio region context command', {
      command: command.key,
      clipId: clip.id,
      selection,
    });
    setAudioRegionSelection(selection);
    command.action();
    closeAudioRegionContextMenu();
  };

  // Track filtering must stay after all hooks so React sees a stable hook order
  // while clips move between tracks during drag and linked edits.
  if (isDragging && clipDrag && clipDrag.currentTrackId !== trackId) {
    return null;
  }
  if (!isDragging && !isLinkedToDragging && clip.trackId !== trackId) {
    return null;
  }
  if (clip.trackId !== trackId && !isDragging) {
    return null;
  }
  const clipStyle = {
    left,
    width,
    cursor: isTrackLocked ? 'not-allowed' : timelineToolCursor,
    animationDelay: `${animationDelay}s`,
    '--track-color': trackColor,
    '--clip-right-sticky-offset': `${clipRightStickyOffset}px`,
    // FLIP move animation: initial phase applies offset transform, animating phase transitions to 0
    ...(aiMovePhase === 'initial' && aiMove ? {
      transform: `translateX(${timeToPixel(aiMove.fromStartTime) - left}px)`,
    } : aiMovePhase === 'animating' && aiMove ? {
      transform: 'translateX(0)',
      transition: `transform ${aiMove.animationDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
    } : {}),
    ...(isAudioClip && audioFocusMode ? {
      background: `linear-gradient(180deg, color-mix(in srgb, ${trackColor} 72%, #202020), color-mix(in srgb, ${trackColor} 34%, #101010))`,
      borderColor: trackColor,
    } : isSolidClip && clip.solidColor ? {
      background: clip.solidColor,
      borderColor: clip.solidColor,
    } : mediaLabelHex ? {
      background: mediaLabelHex,
      borderColor: mediaLabelHex,
    } : {}),
  } as CSSProperties & {
    '--track-color'?: string;
    '--clip-right-sticky-offset'?: string;
  };
  const audioRegionContextMenuPortalTarget = typeof document === 'undefined'
    ? null
    : document.body;
  const sourceExtensionGhosts = (() => {
    if ((!isTrimming && !isLinkedToTrimming) || !clipTrim || width <= 0) return [];

    const originalStart = clip.startTime;
    const originalEnd = clip.startTime + clip.duration;
    const displayEnd = displayStartTime + displayDuration;
    const ghosts: Array<{ edge: 'left' | 'right'; left: number; width: number }> = [];

    const visibleStartPx = scrollX - left - TIMELINE_RENDER_OVERSCAN_PX;
    const visibleEndPx = scrollX - left + renderTimelineViewportWidth + TIMELINE_RENDER_OVERSCAN_PX;
    const pushVisibleGhost = (edge: 'left' | 'right', startTime: number, endTime: number) => {
      const ghostStartTime = Math.max(0, Math.min(startTime, endTime));
      const ghostEndTime = Math.max(ghostStartTime, Math.max(startTime, endTime));
      if (ghostEndTime - ghostStartTime <= 0.001) return;

      const rawLeft = timeToPixel(ghostStartTime - displayStartTime);
      const rawRight = timeToPixel(ghostEndTime - displayStartTime);
      const clippedLeft = Math.max(rawLeft, visibleStartPx);
      const clippedRight = Math.min(rawRight, visibleEndPx);
      if (clippedRight - clippedLeft < 1) return;

      ghosts.push({
        edge,
        left: clippedLeft,
        width: Math.max(1, clippedRight - clippedLeft),
      });
    };

    const sourceDuration = getClipSourceDuration(clip);
    if (clipTrim.edge === 'left') {
      const availableLeftDuration = Math.min(Math.max(0, displayInPoint), Math.max(0, displayStartTime));
      if (availableLeftDuration > 0.001) {
        pushVisibleGhost('left', displayStartTime - availableLeftDuration, displayStartTime);
      }
    }

    if (clipTrim.edge === 'right') {
      const availableRightDuration = Math.max(0, sourceDuration - displayOutPoint);
      if (availableRightDuration > 0.001) {
        pushVisibleGhost('right', displayEnd, displayEnd + availableRightDuration);
      }
    }

    if (ghosts.length === 0 && clipTrim.edge === 'left' && Math.abs(displayStartTime - originalStart) > 0.001) {
      pushVisibleGhost('left', Math.min(displayStartTime, originalStart), Math.max(displayStartTime, originalStart));
    }

    if (ghosts.length === 0 && clipTrim.edge === 'right' && Math.abs(displayEnd - originalEnd) > 0.001) {
      pushVisibleGhost('right', Math.min(displayEnd, originalEnd), Math.max(displayEnd, originalEnd));
    }

    return ghosts;
  })();

  return (
    <div
      className={`${clipClass}${isBladeToolActive ? ' cut-mode' : ''} ${animationClass}`}
      style={clipStyle}
      data-clip-id={clip.id}
      data-dock-layout-child-anim-id={`timeline-clip:${clip.id}`}
      onMouseDown={isTrackLocked || (isPointerToolActive && !canUseBodyToolGesture) ? undefined : onMouseDown}
      onDoubleClick={isPointerToolActive ? undefined : onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseMove={isTrackLocked ? undefined : handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={isTrackLocked ? undefined : handleClick}
    >
      {/* Cut indicator line */}
      {shouldShowCutIndicator && cutIndicatorX !== null && cutIndicatorX >= 0 && cutIndicatorX <= width && (
        <div
          className="cut-indicator"
          style={{ left: cutIndicatorX }}
        />
      )}
      {sourceExtensionGhosts.map((ghost) => (
        <div
          key={ghost.edge}
          className={`clip-source-extension-ghost ${ghost.edge}`}
          style={{ left: ghost.left, width: ghost.width }}
        />
      ))}
      {/* YouTube pending download preview */}
      {clip.isPendingDownload && clip.youtubeThumbnail && (
        <div
          className="clip-youtube-preview"
          style={{ backgroundImage: `url(${clip.youtubeThumbnail})` }}
        />
      )}
      {/* Download progress bar */}
      {clip.isPendingDownload && !clip.downloadError && (
        <>
          <div className="clip-download-progress">
            <div
              className="clip-download-progress-bar"
              style={{ width: `${clip.downloadProgress || 0}%` }}
            />
          </div>
          <div className="clip-download-status">
            <div className="download-spinner" />
            <span>Downloading {Math.round(clip.downloadProgress || 0)}%{clip.downloadSpeed ? ` \u00B7 ${clip.downloadSpeed}` : ''}</span>
          </div>
        </>
      )}
      {/* Download error badge */}
      {clip.downloadError && (
        <div className="clip-download-error-badge" title={clip.downloadError}>
          Error
        </div>
      )}
      {/* Proxy generating indicator - fill badge */}
      {isGeneratingProxy && (
        <div className="clip-proxy-generating" title={`Generating proxy: ${proxyProgress}%`}>
          <span className="proxy-fill-badge">
            <span className="proxy-fill-bg">P</span>
            <span
              className="proxy-fill-progress"
              style={{ height: `${proxyProgress}%` }}
            >P</span>
          </span>
          <span className="proxy-percent">{proxyProgress}%</span>
        </div>
      )}
      {isGeneratingAudioProxy && (
        <div className="clip-audio-proxy-generating" title={`Preparing WAV audio proxy: ${audioProxyProgress}%`}>
          <span className="audio-proxy-fill-badge">
            <span className="audio-proxy-fill-bg">A</span>
            <span
              className="audio-proxy-fill-progress"
              style={{ height: `${audioProxyProgress}%` }}
            >A</span>
          </span>
          <span className="audio-proxy-percent">{audioProxyProgress}%</span>
        </div>
      )}
      {/* Stem separation indicator - fill badge */}
      {activeStemSeparationJob && (
        <div className="clip-stem-generating" title={activeStemStatusTitle}>
          <span className="stem-fill-badge">
            <span className="stem-fill-bg">S</span>
            <span
              className="stem-fill-progress"
              style={{ height: `${activeStemProgressPercent}%` }}
            >S</span>
          </span>
          <span className="stem-percent">{activeStemProgressPercent}%</span>
        </div>
      )}
      {hasStemSeparation && !activeStemSeparationJob && (
        <div className="clip-stem-badge" title="Stems ready">
          S
        </div>
      )}
      {failedStemSeparationJob && !activeStemSeparationJob && (
        <div
          className="clip-stem-error"
          title={failedStemSeparationJob.error ?? failedStemSeparationJob.message ?? 'Stem separation failed'}
        >
          S!
        </div>
      )}
      {/* Proxy ready indicator */}
      {hasProxy && proxyEnabled && !isGeneratingProxy && (
        <div className="clip-proxy-badge" title="Proxy ready">
          P
        </div>
      )}
      {hasProxyError && (
        <div className="clip-proxy-error" title="Proxy generation failed">
          P!
        </div>
      )}
      {hasAudioProxy && !isGeneratingAudioProxy && (
        <div className="clip-audio-proxy-badge" title="WAV audio proxy ready">
          A
        </div>
      )}
      {hasAudioProxyError && (
        <div className="clip-audio-proxy-error" title="WAV audio proxy failed">
          A!
        </div>
      )}
      {/* Reversed indicator */}
      {clip.reversed && (
        <div className="clip-reversed-badge" title="Reversed playback">
          {'\u27F2'}
        </div>
      )}
      {/* Linked group indicator */}
      {isInLinkedGroup && (
        <div className="clip-linked-group-badge" title="Multicam linked group">
          {'\u26D3'}
        </div>
      )}
      {/* Transcript badge with coverage fill */}
      {clip.transcriptStatus === 'ready' && clip.transcript && clip.transcript.length > 0 && (() => {
        const clipIn = clip.inPoint ?? 0;
        const clipOut = clip.outPoint ?? clip.duration;
        const clipDur = clipOut - clipIn;
        if (clipDur <= 0) return null;
        // Use transcribedRanges from MediaFile for coverage (silence still counts as transcribed)
        const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
        const mediaFile = mediaFileId ? useMediaStore.getState().files.find(f => f.id === mediaFileId) : null;
        const ranges = mediaFile?.transcribedRanges ?? [];
        let pct = 0;
        if (ranges.length > 0) {
          // Intersect transcribed ranges with clip's [inPoint, outPoint]
          let covered = 0;
          for (const [rs, re] of ranges) {
            const s = Math.max(rs, clipIn);
            const e = Math.min(re, clipOut);
            if (s < e) covered += e - s;
          }
          pct = Math.min(100, Math.round((covered / clipDur) * 100));
        } else {
          // Fallback: use word envelope for old data without transcribedRanges
          const wordsInRange = clip.transcript!.filter(w => w.end > clipIn && w.start < clipOut);
          if (wordsInRange.length > 0) {
            const minStart = Math.max(clipIn, Math.min(...wordsInRange.map(w => w.start)));
            const maxEnd = Math.min(clipOut, Math.max(...wordsInRange.map(w => w.end)));
            pct = Math.min(100, Math.round(((maxEnd - minStart) / clipDur) * 100));
          }
        }
        if (pct <= 0) return null;
        return pct >= 100 ? (
          <div className="clip-transcript-badge" title="Fully transcribed">T</div>
        ) : (
          <div className="clip-transcript-badge clip-badge-fill" title={`${pct}% transcribed`}>
            <span className="clip-badge-bg">T</span>
            <span className="clip-badge-progress clip-badge-transcript-fill" style={{ height: `${pct}%` }}>T</span>
          </div>
        );
      })()}
      {/* Analysis badge with coverage fill */}
      {!isAudioClip && (clip.analysisStatus === 'ready' || clip.sceneDescriptionStatus === 'ready') && (() => {
        const clipIn = clip.inPoint ?? 0;
        const clipOut = clip.outPoint ?? clip.duration;
        const clipDur = clipOut - clipIn;
        if (clipDur <= 0) return null;
        // Calculate coverage from analysis frame timestamps
        let pct = 100;
        if (clip.analysis?.frames?.length) {
          const frames = clip.analysis.frames;
          const interval = (clip.analysis.sampleInterval || 500) / 1000;
          const framesInRange = frames.filter((f) => f.timestamp >= clipIn && f.timestamp < clipOut);
          const coveredTime = framesInRange.length * interval;
          pct = Math.min(100, Math.round((coveredTime / clipDur) * 100));
        }
        return pct >= 100 ? (
          <div className="clip-analysis-badge" title="Fully analyzed">A</div>
        ) : (
          <div className="clip-analysis-badge clip-badge-fill" title={`${pct}% analyzed`}>
            <span className="clip-badge-bg">A</span>
            <span className="clip-badge-progress clip-badge-analysis-fill" style={{ height: `${pct}%` }}>A</span>
          </div>
        );
      })()}
      {/* Waveform generation progress indicator */}
      {showWaveformGenerationIndicator && (
        <div
          className="clip-waveform-indicator"
          title={clip.audioAnalysisJob ? `${clip.audioAnalysisJob.label}: ${clip.audioAnalysisJob.phase}` : undefined}
        >
          <div
            className="waveform-progress"
            style={{ width: `${clip.audioAnalysisJob?.progress ?? clip.waveformProgress ?? 50}%` }}
          />
        </div>
      )}
      {/* Stem separation progress indicator */}
      {activeStemSeparationJob && (
        <div
          className={`clip-stem-progress phase-${activeStemSeparationJob.phase}`}
          title={activeStemSeparationJob.message ?? formatStemJobPhase(activeStemSeparationJob.phase)}
        >
          <div
            className="clip-stem-progress-bar"
            style={{ width: `${activeStemProgressPercent}%` }}
          />
          <div className="clip-stem-progress-label">
            <span>{activeStemStatusLabel}</span>
            <strong>{activeStemProgressPercent}%</strong>
          </div>
        </div>
      )}
      {/* Audio waveform / spectrogram */}
      {waveformsEnabled && isAudioClip && (
        audioDisplayMode === 'spectral'
        || waveformPyramidForRender
        || (clip.waveform && clip.waveform.length > 0)
        || clip.waveformChannels?.some(channel => channel.length > 0)
      ) && (
        <div className="clip-waveform">
          {audioDisplayMode === 'spectral' && spectrogramTileSet ? (
            <ClipSpectrogram
              tileSet={spectrogramTileSet}
              width={width}
              height={Math.max(20, trackBaseHeight - 12)}
              inPoint={spectrogramInPoint}
              outPoint={spectrogramOutPoint}
              naturalDuration={spectrogramNaturalDuration}
              renderStartPx={waveformRenderWindow.startPx}
              renderWidth={waveformRenderWindow.width}
              variant={spectrogramVariant}
            />
          ) : audioDisplayMode === 'spectral' ? (
            <div className="spectrogram-pending" />
          ) : waveformPyramid || (clip.waveform && clip.waveform.length > 0) || clip.waveformChannels?.some(channel => channel.length > 0) ? (
            <ClipWaveform
              clipId={clip.id}
              waveform={clip.waveform ?? []}
              waveformChannels={clip.waveformChannels}
              width={width}
              height={Math.max(20, trackBaseHeight - 12)}
              inPoint={waveformInPointForRender}
              outPoint={waveformOutPointForRender}
              naturalDuration={waveformNaturalDurationForRender}
              clipDuration={displayDuration}
              displayMode={audioDisplayMode}
              pixelsPerSecond={zoom}
              pyramid={waveformPyramidForRender}
              waveformVariant={waveformVariantForRender}
              displayGain={waveformDisplayGain}
              volumeAutomationKeyframes={audioVolumeAutomationKeyframes}
              audioEditStack={predictiveAudioEditStack}
              audioRegionGainPreview={predictiveAudioRegionGainPreview}
              renderStartPx={waveformRenderWindow.startPx}
              renderWidth={waveformRenderWindow.width}
            />
          ) : null}
          {(audioAnalysisDisplayStatus || (audioWaveformDiagnostics?.badges.length ?? 0) > 0) && (
            <div className="clip-audio-status-stack">
              {audioAnalysisDisplayStatus && (
                <div
                  className={`clip-audio-analysis-status clip-audio-analysis-status-${audioAnalysisDisplayStatus.kind}`}
                  title={audioAnalysisDisplayStatus.title}
                  data-audio-analysis-status={audioAnalysisDisplayStatus.kind}
                >
                  {audioAnalysisDisplayStatus.label}
                </div>
              )}
              {audioWaveformDiagnostics?.badges.map((badge) => (
                <div
                  key={badge.kind}
                  className={`clip-audio-diagnostic-badge ${badge.className}`}
                  title={badge.title}
                  data-audio-diagnostic={badge.kind}
                  data-audio-diagnostic-source={audioWaveformDiagnostics.source}
                >
                  {badge.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {audioRegionOverlay && (
        <div
          className={`clip-audio-region-selection ${audioRegionSelection?.snappedToZeroCrossing ? 'snapped' : ''} ${audioRegionMoveDrag ? 'moving' : ''} ${audioRegionResizeDrag ? 'resizing' : ''}`}
          style={{
            left: audioRegionOverlay.left,
            width: audioRegionOverlay.width,
          }}
          onMouseDown={handleAudioRegionSelectionMouseDown}
          onContextMenu={handleAudioRegionContextMenu}
          title="Drag to move the selected audio region; drag edges to resize"
        >
          <span
            className="clip-audio-region-edge left"
            onMouseDown={handleAudioRegionEdgeMouseDown('left')}
            title="Drag to resize the selected audio region start"
          />
          <span
            className="clip-audio-region-edge right"
            onMouseDown={handleAudioRegionEdgeMouseDown('right')}
            title="Drag to resize the selected audio region end"
          />
          {audioRegionGainControl && (
            <div
              className="clip-audio-region-gain-control"
              style={{ top: `${audioRegionGainControl.yPercent}%` }}
            >
              <div
                className="clip-audio-region-gain-line"
                onMouseDown={handleAudioRegionGainMouseDown('gain')}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  commitAudioRegionGainEdit({
                    gainDb: 0,
                    fadeInSeconds: 0,
                    fadeOutSeconds: 0,
                  });
                }}
                title="Drag to set region gain; double-click to reset"
              />
              <button
                type="button"
                className="clip-audio-region-fade-handle fade-in"
                style={{ left: audioRegionGainControl.fadeInPx }}
                onMouseDown={handleAudioRegionGainMouseDown('fade-in')}
                title={`Fade in gain change: ${audioRegionGainControl.fadeInSeconds.toFixed(2)}s`}
              />
              <button
                type="button"
                className="clip-audio-region-fade-handle fade-out"
                style={{ right: audioRegionGainControl.fadeOutPx }}
                onMouseDown={handleAudioRegionGainMouseDown('fade-out')}
                title={`Fade out gain change: ${audioRegionGainControl.fadeOutSeconds.toFixed(2)}s`}
              />
              <span className="clip-audio-region-gain-value">
                {formatAudioRegionGainLabel(audioRegionGainControl.gainDb)}
              </span>
            </div>
          )}
        </div>
      )}
      {clipVideoBakeRegionOverlays.map((overlay) => (
        <div
          key={overlay.id}
          className={`clip-video-bake-region ${overlay.selection ? 'selection' : ''} status-${overlay.status ?? 'marked'}`}
          style={{
            left: overlay.left,
            width: overlay.width,
          }}
          title={overlay.selection ? 'Video bake selection' : 'Video bake region'}
        >
          {!overlay.selection && (
            <div className="clip-video-bake-region-controls">
              <button
                type="button"
                className="clip-video-bake-btn"
                disabled={overlay.status === 'baking'}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (overlay.status === 'baked') {
                    unbakeClipVideoBakeRegion(clip.id, overlay.id);
                    return;
                  }
                  void bakeClipVideoBakeRegion(clip.id, overlay.id);
                }}
                title={overlay.status === 'baked' ? 'Unbake video region' : 'Bake video region'}
              >
                {overlay.status === 'baked' ? 'Unbake' : overlay.status === 'baking' ? '...' : 'Bake'}
              </button>
              <button
                type="button"
                className="clip-video-bake-btn remove"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  removeClipVideoBakeRegion(clip.id, overlay.id);
                }}
                title="Remove video bake region"
              >
                x
              </button>
            </div>
          )}
        </div>
      ))}
      {audioEditOperationOverlays.map((overlay) => (
        <div
          key={overlay.id}
          className="clip-audio-edit-operation-overlay"
          data-audio-edit-type={overlay.type}
          role="button"
          tabIndex={0}
          style={{
            left: overlay.left,
            width: overlay.width,
            top: overlay.top,
            height: overlay.height,
          }}
          onMouseDown={handleAudioEditOperationOverlayMouseDown(overlay)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            setAudioRegionContextMenu(null);
            setAudioRegionSelection(overlay.selection);
          }}
          title={overlay.label}
        >
          <span>{overlay.label}</span>
        </div>
      ))}
      {audioRegionContextMenu && audioRegionContextMenuPortalTarget && createPortal((
        <div
          ref={audioRegionContextMenuRef}
          className="timeline-context-menu clip-audio-region-context-menu"
          style={{
            position: 'fixed',
            left: audioRegionContextMenuPosition?.x ?? audioRegionContextMenu.x,
            top: audioRegionContextMenuPosition?.y ?? audioRegionContextMenu.y,
            zIndex: 10000,
          }}
          onPointerDownCapture={(e) => {
            if (e.button !== 0) return;
            const target = e.target;
            if (!(target instanceof Element)) return;
            const commandElement = target.closest<HTMLElement>('[data-audio-region-command]');
            const commandKey = commandElement?.dataset.audioRegionCommand;
            if (!commandKey) return;
            const command = findAudioRegionContextMenuCommand(commandKey);
            if (!command) return;
            e.preventDefault();
            e.stopPropagation();
            runAudioRegionContextMenuCommand(command, audioRegionContextMenu.selection);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="context-menu-title">Audio Region</div>
          <div className="clip-audio-region-direct-actions">
            {audioRegionDirectMenuCommands.map(command => (
              <div
                key={command.key}
                data-audio-region-command={command.key}
                className={`context-menu-item ${command.disabled ? 'disabled' : ''} ${command.danger ? 'danger' : ''}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  runAudioRegionContextMenuCommand(command, audioRegionContextMenu.selection);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  runAudioRegionContextMenuCommand(command, audioRegionContextMenu.selection);
                }}
              >
                {command.label}
              </div>
            ))}
          </div>
          <div className="context-menu-separator" />
          {audioRegionContextMenuGroups.map(group => (
            <div
              key={group.key}
              className="context-menu-item has-submenu clip-audio-region-submenu-trigger"
            >
                <span>{group.label}</span>
              <span className="submenu-arrow" aria-hidden="true">▶</span>
              <div className="context-submenu clip-audio-region-submenu-panel">
                {group.commands.map(command => (
                <div
                  key={command.key}
                  data-audio-region-command={command.key}
                  className={`context-menu-item ${command.disabled ? 'disabled' : ''} ${command.danger ? 'danger' : ''}`}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    runAudioRegionContextMenuCommand(command, audioRegionContextMenu.selection);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    runAudioRegionContextMenuCommand(command, audioRegionContextMenu.selection);
                  }}
                >
                  {command.label}
                </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ), audioRegionContextMenuPortalTarget)}
      {spectralRegionOverlay && (
        <div
          className={`clip-spectral-region-selection ${audioSpectralRegionSelection?.selectionMode === 'brush' ? 'brush' : 'rectangle'}`}
          style={{
            left: spectralRegionOverlay.left,
            width: spectralRegionOverlay.width,
            top: spectralRegionOverlay.top,
            height: spectralRegionOverlay.height,
          }}
        >
          <span className="clip-spectral-region-corner tl" />
          <span className="clip-spectral-region-corner tr" />
          <span className="clip-spectral-region-corner bl" />
          <span className="clip-spectral-region-corner br" />
        </div>
      )}
      {spectralImageLayerOverlays.map(({ id, left: overlayLeft, width: overlayWidth, top, height, layer, mediaFile }) => {
        const blendMode = layer.blendMode ?? 'attenuate';
        const opacity = finiteNumberOr(layer.opacity, 0.85);
        const gainDb = finiteNumberOr(layer.gainDb, -18);
        const imageUrl = mediaFile?.thumbnailUrl || mediaFile?.url;

        return (
          <div
            key={id}
            className={`clip-spectral-image-layer blend-${blendMode} ${layer.enabled === false ? 'disabled' : ''}`}
            style={{
              left: overlayLeft,
              width: overlayWidth,
              top,
              height,
              opacity: Math.max(0.18, opacity),
              backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
            }}
            title={`${mediaFile?.name ?? 'Spectral image'}: ${blendMode}, ${gainDb.toFixed(1)} dB`}
          >
            <span>{blendMode}</span>
          </div>
        );
      })}
      {spectralRegionOverlay && canSelectSpectralRegion && (
        <div
          className="clip-spectral-region-toolbar"
          style={{
            left: Math.max(4, spectralRegionOverlay.left),
            top: Math.max(20, spectralRegionOverlay.top),
          }}
          onMouseDown={handleAudioEditStackMouseDown}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={handleApplySpectralRegionEdit('spectral-mask')} title="Attenuate selected frequency region">Mask</button>
          <button type="button" onClick={handleApplySpectralRegionEdit('spectral-resynthesis')} title="Create a resynthesis operation for the selected frequency region">Resyn</button>
          <button
            type="button"
            onClick={handleAddSelectedImageSpectralLayer}
            disabled={!selectedSpectralImageFile}
            title={selectedSpectralImageFile ? `Add ${selectedSpectralImageFile.name} as a spectral image layer` : 'Select an image in the Media panel first'}
          >
            Img
          </button>
        </div>
      )}
      {isAudioClip && audioFocusMode && (audioEditStack.length > 0 || canUnbakeAudioEditStack) && (
        <div className="clip-audio-edit-stack" onMouseDown={handleAudioEditStackMouseDown}>
          <span className="clip-audio-edit-stack-count" title={`${activeAudioEditCount} active audio edits`}>
            {activeAudioEditCount}/{audioEditStack.length}
          </span>
          {audioEditStack.map(operation => (
            <button
              type="button"
              key={operation.id}
              className={operation.enabled === false ? 'disabled' : ''}
              title={`${operation.params.label ?? operation.type}: click to ${operation.enabled === false ? 'enable' : 'bypass'}, Alt-click to remove`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.altKey) {
                  removeClipAudioEditOperation(clip.id, operation.id);
                  return;
                }
                setClipAudioEditOperationEnabled(clip.id, operation.id, operation.enabled === false);
              }}
            >
              {String(operation.params.label ?? operation.type).slice(0, 3)}
            </button>
          ))}
          <button type="button" onClick={handleBakeAudioEditStack} disabled={audioBakePending || activeAudioEditCount === 0} title="Bake active audio edits into a new WAV source">
            {audioBakePending ? '...' : 'Bake'}
          </button>
          <button type="button" onClick={handleUnbakeAudioEditStack} disabled={audioBakePending || !canUnbakeAudioEditStack} title="Restore the source audio and region edits from the latest bake">
            Unbake
          </button>
          <button type="button" onClick={handleClearAudioEditStack} title="Clear audio edit stack">
            Clear
          </button>
        </div>
      )}
      {canSelectAudioRegion && (
        <div
          className="clip-audio-region-hitarea"
          onMouseDown={handleAudioRegionMouseDown}
          onDoubleClick={handleAudioRegionDoubleClick}
          title="Double-click to select the whole clip; hold Ctrl/Strg and drag to select an audio region"
        />
      )}
      {canSelectVideoBakeRegion && (
        <div
          className="clip-video-bake-region-hitarea"
          onMouseDown={handleVideoBakeRegionMouseDown}
          onDoubleClick={handleVideoBakeRegionDoubleClick}
          title="Double-click to mark the whole clip; hold Ctrl/Strg and drag to mark a video bake region"
        />
      )}
      {canSelectSpectralRegion && (
        <div
          className="clip-audio-region-hitarea clip-spectral-region-hitarea"
          onMouseDown={handleSpectralRegionMouseDown}
          onDragOver={handleSpectralImageLayerDragOver}
          onDrop={handleSpectralImageLayerDrop}
          onDoubleClick={(e) => {
            if (!isAudioRegionModifierPressed(e)) return;
            e.preventDefault();
            e.stopPropagation();
            clearAudioSpectralRegionSelection();
          }}
          title="Hold Ctrl/Strg and drag to select a spectral region; add Shift or Alt for brush"
        />
      )}
      {/* Nested composition mixdown waveform - shown overlaid on thumbnails */}
      {waveformsEnabled && clip.isComposition && clip.mixdownWaveform && clip.mixdownWaveform.length > 0 && (
        <div className="clip-mixdown-waveform">
          <ClipWaveform
            waveform={clip.mixdownWaveform}
            width={width}
            height={Math.min(42, Math.max(16, trackBaseHeight / 3))}
            inPoint={displayInPoint}
            outPoint={displayOutPoint}
            naturalDuration={clip.duration}
            displayMode={audioDisplayMode}
            pixelsPerSecond={zoom}
            renderStartPx={waveformRenderWindow.startPx}
            renderWidth={waveformRenderWindow.width}
          />
        </div>
      )}
      {/* Nested composition mixdown generating indicator */}
      {clip.isComposition && clip.mixdownGenerating && (
        <div className="clip-mixdown-indicator">
          <span>Generating audio...</span>
        </div>
      )}
      {staticClipIconKind && (
        <div className="clip-static-artwork" aria-hidden="true">
          <StaticClipIcon kind={staticClipIconKind} className="clip-static-artwork-icon" />
        </div>
      )}
      {/* Segment-based thumbnails for nested compositions */}
      {showSegmentThumbnails && (
        <div
          className="clip-thumbnails clip-thumbnails-segments clip-thumbnails-windowed"
          style={{
            left: thumbnailRenderWindow.startPx,
            width: thumbnailRenderWindow.width,
            right: 'auto',
          }}
        >
          {compositionSegments.map((segment, segIdx) => {
            const windowStartNorm = thumbnailRenderWindow.startPx / Math.max(1, width);
            const windowEndNorm = (thumbnailRenderWindow.startPx + thumbnailRenderWindow.width) / Math.max(1, width);
            if (segment.endNorm < windowStartNorm || segment.startNorm > windowEndNorm) return null;
            const windowNormSpan = Math.max(0.0001, windowEndNorm - windowStartNorm);
            const clippedSegmentStart = Math.max(segment.startNorm, windowStartNorm);
            const clippedSegmentEnd = Math.min(segment.endNorm, windowEndNorm);
            const segmentWidth = ((clippedSegmentEnd - clippedSegmentStart) / windowNormSpan) * 100;
            const segmentLeft = ((clippedSegmentStart - windowStartNorm) / windowNormSpan) * 100;
            // Calculate how many thumbnails fit in this segment
            const segmentThumbCount = Math.max(1, Math.min(
              visibleThumbs,
              Math.ceil(((clippedSegmentEnd - clippedSegmentStart) * width) / THUMB_WIDTH) + 1,
            ));

            return (
              <div
                key={segIdx}
                className="clip-segment"
                style={{
                  position: 'absolute',
                  left: `${segmentLeft}%`,
                  width: `${segmentWidth}%`,
                  height: '100%',
                  display: 'flex',
                  overflow: 'hidden',
                }}
              >
                {segment.thumbnails.length > 0 ? (
                  Array.from({ length: segmentThumbCount }).map((_, i) => {
                    const thumbIndex = Math.floor((i / segmentThumbCount) * segment.thumbnails.length);
                    const thumb = segment.thumbnails[Math.min(thumbIndex, segment.thumbnails.length - 1)];
                    return (
                      <img
                        key={i}
                        src={thumb}
                        alt=""
                        className="clip-thumb"
                        draggable={false}
                        style={{ flex: '1 0 auto', minWidth: 0, objectFit: 'cover' }}
                      />
                    );
                  })
                ) : (
                  <div className="clip-segment-empty" style={{ width: '100%', height: '100%', background: '#1a1a1a' }} />
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Regular thumbnail filmstrip - source-based cache or legacy fallback */}
      {showRegularThumbnails && (
        <div
          className="clip-thumbnails clip-thumbnails-windowed"
          style={{
            left: thumbnailRenderWindow.startPx,
            width: thumbnailRenderWindow.width,
            right: 'auto',
          }}
        >
          {useSourceCache ? (
            // Source-based cache: thumbnails already mapped to visible range by hook
            cachedThumbnails.map((thumb, i) => thumb ? (
              <img
                key={i}
                src={thumb}
                alt=""
                className="clip-thumb"
                draggable={false}
              />
            ) : (
              <div key={i} className="clip-thumb clip-thumb-placeholder" />
            ))
          ) : (
            // Legacy fallback for clips without mediaFileId (compositions, old projects)
            Array.from({ length: visibleThumbs }).map((_, i) => {
              const naturalDuration = clip.source?.naturalDuration || clip.duration;
              const startRatio = displayInPoint / naturalDuration;
              const endRatio = displayOutPoint / naturalDuration;
              const positionInTrimmed = Math.min(1, Math.max(
                0,
                (thumbnailRenderWindow.startPx + i * THUMB_WIDTH) / Math.max(1, width),
              ));
              const sourceRatio = startRatio + positionInTrimmed * (endRatio - startRatio);
              const thumbIndex = Math.floor(sourceRatio * legacyThumbnails.length);
              const thumb = legacyThumbnails[Math.min(Math.max(0, thumbIndex), legacyThumbnails.length - 1)];
              return (
                <img
                  key={i}
                  src={thumb}
                  alt=""
                  className="clip-thumb"
                  draggable={false}
                />
              );
            })
          )}
        </div>
      )}
      {/* Nested composition clip boundary markers */}
      {clip.isComposition && clip.nestedClipBoundaries && clip.nestedClipBoundaries.length > 0 && (
        <div className="nested-clip-boundaries">
          {clip.nestedClipBoundaries.map((boundary, i) => (
            <div
              key={i}
              className="nested-boundary-line"
              style={{ left: `${boundary * 100}%` }}
            />
          ))}
        </div>
      )}
      {/* Needs reload indicator */}
      {clip.needsReload && (
        <div className="clip-reload-badge" title="Click media file to reload">
          !
        </div>
      )}
      <div className="clip-content">
        <div
          className="clip-meta"
          style={clipMetaOffset > 0 ? { transform: `translateX(${clipMetaOffset}px)` } : undefined}
        >
          {clip.isLoading && <div className="clip-loading-spinner" />}
          <div className="clip-name-row">
            {isSolidClip && (
              <span className="clip-solid-swatch" title="Solid Clip" style={{ background: clip.solidColor || '#fff' }} />
            )}
            {(isTextClip || isText3DClip) && (
              <span className="clip-text-icon" title={isText3DClip ? '3D Text Clip' : 'Text Clip'}>
                {isText3DClip ? '3T' : 'T'}
              </span>
            )}
            {isVectorAnimationClip && (
              <span className="clip-text-icon" title={vectorAnimationTitle}>{vectorAnimationIcon}</span>
            )}
            {isMathSceneClip && (
              <span className="clip-text-icon" title="Math Scene Clip">ƒ</span>
            )}
            {staticClipIconKind && (
              <StaticClipIcon
                kind={staticClipIconKind}
                className="clip-type-icon"
              />
            )}
            {isSplatEffectorClip && (
              <span className="clip-text-icon" title="3D Effector Clip">E</span>
            )}
            <span className="clip-name">
              {isTextClip && clip.textProperties
                ? clip.textProperties.text.slice(0, 30) || 'Text'
                : isMathSceneClip && clip.mathScene
                  ? clip.mathScene.objects.find((object) => object.type === 'function')?.expression || 'Math Scene'
                : isText3DClip && text3DProperties
                  ? text3DProperties.text.slice(0, 30) || '3D Text'
                  : clip.name}
            </span>
            {/* PickWhip disabled */}
          </div>
          <span className="clip-duration">{formatTime(displayDuration)}</span>
        </div>
      </div>
      {/* Transcript word markers */}
      {showTranscriptMarkers && clip.transcript && clip.transcript.length > 0 && (
        <div className="clip-transcript-markers">
          {clip.transcript.map((word) => {
            // Word times are relative to clip's inPoint
            const wordStartInClip = word.start - clip.inPoint;
            const wordEndInClip = word.end - clip.inPoint;

            // Only show markers that are visible within the clip's current trim
            if (wordEndInClip < 0 || wordStartInClip > displayDuration) {
              return null;
            }

            // Calculate marker position and width
            const markerStart = Math.max(0, wordStartInClip);
            const markerEnd = Math.min(displayDuration, wordEndInClip);
            const markerLeft = (markerStart / displayDuration) * 100;
            const markerWidth = ((markerEnd - markerStart) / displayDuration) * 100;

            return (
              <div
                key={word.id}
                className="transcript-marker"
                style={{
                  left: `${markerLeft}%`,
                  width: `${Math.max(0.5, markerWidth)}%`,
                }}
                title={word.text}
              />
            );
          })}
        </div>
      )}
      {/* Transcribing indicator */}
      {clip.transcriptStatus === 'transcribing' && (
        <div className="clip-transcribing-indicator">
          <div className="transcribing-progress" style={{ width: `${clip.transcriptProgress || 0}%` }} />
        </div>
      )}
      {/* Analysis overlay - graph showing focus/motion (renders during analysis and when ready) */}
      {/* Only show analysis overlay for video clips, not audio */}
      {!isAudioClip && clip.analysis && (clip.analysisStatus === 'ready' || clip.analysisStatus === 'analyzing') && (
        <>
          <div className="analysis-legend-labels">
            <span className="legend-focus">Focus</span>
            <span className="legend-motion">Motion</span>
            {clip.analysisStatus === 'analyzing' && (
              <span className="legend-progress">{clip.analysisProgress || 0}%</span>
            )}
          </div>
          <div className="clip-analysis-overlay">
            <ClipAnalysisOverlay
              analysis={clip.analysis}
              clipDuration={displayDuration}
              clipInPoint={clip.inPoint}
              clipStartTime={displayStartTime}
              width={width}
              height={trackBaseHeight}
            />
          </div>
        </>
      )}
      {/* Analyzing indicator (thin progress bar at bottom) */}
      {clip.analysisStatus === 'analyzing' && (
        <div className="clip-analyzing-indicator">
          <div className="analyzing-progress" style={{ width: `${clip.analysisProgress || 0}%` }} />
        </div>
      )}
      {/* Keyframe tick marks on clip bar */}
      {keyframeTickGroups.length > 0 && (
        <div className="clip-keyframe-ticks">
          {keyframeTickGroups.map((group, i) => {
            const xPercent = (group.time / displayDuration) * 100;
            if (xPercent < 0 || xPercent > 100) return null;
            const isDraggingKeyframeGroup = keyframeGroupDrag
              ? group.keyframeIds.some(id => keyframeGroupDrag.keyframeIds.includes(id))
              : false;
            const keyframeCount = group.keyframeIds.length || 1;
            return (
              <button
                type="button"
                key={`${group.time}:${group.keyframeIds.join('|') || i}`}
                className={`keyframe-tick${isDraggingKeyframeGroup ? ' dragging' : ''}${group.hasStateChange ? ' state-change' : ''}`}
                style={{ left: `${xPercent}%` }}
                onMouseDown={isTrackLocked ? undefined : (e) => handleKeyframeTickMouseDown(e, group)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Move ${keyframeCount} keyframe${keyframeCount === 1 ? '' : 's'} at ${formatTime(group.time)}`}
                title={`Drag to move ${keyframeCount} keyframe${keyframeCount === 1 ? '' : 's'} at ${formatTime(group.time)} (Shift snaps to clip keyframes)`}
              />
            );
          })}
        </div>
      )}
      {/* Fade curve - SVG bezier curve showing opacity or audio-volume automation */}
      {visibleFadeCurveKeyframes.length >= 2 && (
        <div
          className={`fade-curve-container ${isAudioClip ? 'audio-automation-curve-container' : ''}`}
          data-audio-automation-curve={isAudioClip ? 'volume' : undefined}
        >
          <FadeCurve
            key={visibleFadeCurveKey}
            keyframes={visibleFadeCurveKeyframes}
            clipDuration={displayDuration}
            width={width}
            height={trackBaseHeight}
          />
        </div>
      )}
      {!isTrackLocked && (
        <>
          {/* Fade handles - corner handles for adjusting fade-in/out */}
          <div
            className={`fade-handle left${fadeInDuration > 0 ? ' active' : ''}`}
            style={fadeInDuration > 0 ? { left: timeToPixel(fadeInDuration) - 6 } : undefined}
            onMouseDown={(e) => {
              if (!canUseFadeHandles) return;
              e.stopPropagation();
              onFadeStart(e, 'left');
            }}
            title={fadeInDuration > 0 ? `Fade In: ${fadeInDuration.toFixed(2)}s` : 'Drag to add fade in'}
          />
          <div
            className={`fade-handle right${fadeOutDuration > 0 ? ' active' : ''}`}
            style={fadeOutDuration > 0 ? { right: timeToPixel(fadeOutDuration) - 6 } : undefined}
            onMouseDown={(e) => {
              if (!canUseFadeHandles) return;
              e.stopPropagation();
              onFadeStart(e, 'right');
            }}
            title={fadeOutDuration > 0 ? `Fade Out: ${fadeOutDuration.toFixed(2)}s` : 'Drag to add fade out'}
          />
          {/* Trim handles */}
          <div
            className={`trim-handle left arrows-${leftTrimHandleDirections.length}`}
            onMouseDown={(e) => {
              if (!canUseTrimHandles) return;
              e.stopPropagation();
              onTrimStart(e, 'left');
            }}
          >
            <TrimHandleArrows directions={leftTrimHandleDirections} />
          </div>
          <div
            className={`trim-handle right arrows-${rightTrimHandleDirections.length}`}
            onMouseDown={(e) => {
              if (!canUseTrimHandles) return;
              e.stopPropagation();
              onTrimStart(e, 'right');
            }}
          >
            <TrimHandleArrows directions={rightTrimHandleDirections} />
          </div>
        </>
      )}
    </div>
  );
}

export const TimelineClip = memo(TimelineClipComponent);
