// TimelineClipCanvas — issue #228 canvas clip renderer.
//
// Draws a track's visible clip bodies onto a viewport-sized <canvas> instead of
// mounting one heavy DOM component per clip. This makes large comps render in
// O(visible clips) draw calls with a Level-of-Detail scheme, instead of paying
// React reconciliation + browser layout/paint for hundreds of DOM nodes.
//
// Coordinate space: the canvas is absolutely positioned inside `.track-clip-row`
// at a finite absolute timeline X (`canvasOffsetX`). Draw code subtracts that
// offset from `timeToPixel(...)`, so high zoom never requires a giant backing
// store and never needs to switch back to visible legacy DOM clips. Interaction
// handles still use invisible DOM shells for the active/hovered clip.

import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { thumbnailCacheService, type ThumbnailCacheEvent } from '../../services/thumbnailCacheService';
import {
  reportTimelineCanvasDrawDiagnostics,
  unregisterTimelineCanvasDrawDiagnostics,
  type TimelineCanvasDrawDiagnostics,
} from '../../services/timeline/timelineCanvasDiagnostics';
import {
  collectVisibleTimelineThumbnailRefs,
  scheduleVisibleTimelineThumbnailDbWarmup,
  type VisibleTimelineThumbnailRef,
} from '../../services/timeline/timelineThumbnailDbWarmup';
import { scheduleVisibleTimelineThumbnailGeneration } from '../../services/timeline/timelineThumbnailGenerationWarmup';
import {
  collectTimelineWaveformArtifactRefs,
  getCachedTimelineWaveformArtifact,
  warmTimelineWaveformArtifacts,
} from '../../services/timeline/timelineWaveformArtifactWarmup';
import {
  collectTimelineSpectrogramArtifactRefs,
  getCachedTimelineSpectrogramArtifact,
  warmTimelineSpectrogramArtifacts,
} from '../../services/timeline/timelineSpectrogramArtifactWarmup';
import {
  collectTimelineAudioAnalysisArtifactRefs,
  warmTimelineAudioAnalysisArtifacts,
} from '../../services/timeline/timelineAudioAnalysisArtifactWarmup';
import {
  collectVisibleTimelineSourceWaveformGenerationRequests,
  scheduleVisibleTimelineSourceWaveformGeneration,
} from '../../services/timeline/timelineSourceWaveformWarmup';
import {
  scheduleTimelineProcessedWaveformDerivation,
  scheduleTimelineSpectrogramTileGeneration,
} from '../../services/timeline/timelineAudioArtifactGenerationWarmup';
import { getThumbnailBitmap, hasThumbnailBitmap, ensureThumbnailBitmap } from '../../services/timeline/thumbnailBitmapCache';
import { flags } from '../../engine/featureFlags';
import type { TimelineAudioDisplayMode, TimelineClipDragPreview } from '../../stores/timeline/types';
import { useMediaStore } from '../../stores/mediaStore';
import {
  MIN_CLIP_DURATION,
  TIMELINE_CLIP_CANVAS_LOD_BAR_PX,
  TIMELINE_CLIP_CANVAS_LOD_LABEL_PX,
} from './timelineRenderConstants';
import {
  buildWaveformLod,
  normalizeWaveformColumnsForDisplay,
  resolveWaveformDisplayReferencePeak,
  smoothWaveformColumns,
  type TimelineWaveformPyramid,
  type WaveformColumn,
} from './utils/waveformLod';
import {
  drawTimelineSpectrogram,
  resolveTimelineSpectrogramSourceRange,
  type TimelineSpectrogramSourceVariant,
} from './utils/spectrogramCanvas';
import type { ClipDragState, ClipTrimState } from './types';
import type { ClipAudioState } from '../../types/audio';
import type { AnalysisStatus, ClipAnalysis, ClipSegment, TranscriptStatus, TranscriptWord } from '../../types';
import type { TimelineSpectrogramTileSet } from '../../services/audio/timelineSpectrogramCache';
import {
  type VectorAnimationClipSettings,
} from '../../types/vectorAnimation';
import {
  getPreferredWaveformPyramidRef,
} from '../../utils/audioWaveformPresence';
import { isTimelineClipCanvasAudioClip } from './utils/timelineClipCanvasAudio';
import {
  canLoopExtendTimelineVectorClip,
  getTimelineClipSourceDuration,
  isInfiniteTimelineSourceType,
} from './utils/clipSourceTiming';
import { buildFadeCurveGeometry, buildFadeCurvePath, type FadeCurveKeyframe } from './utils/fadeCurvePath';
import {
  buildTimelineClipCanvasWorkerDrawMessage,
  getTimelineClipCanvasWorkerEligibility,
  type TimelineClipCanvasWorkerPreparedClipResources,
} from './utils/timelineClipCanvasWorkerModel';
import type {
  TimelineClipCanvasWorkerInitMessage,
  TimelineClipCanvasWorkerOutgoingMessage,
} from './utils/timelineClipCanvasWorkerContract';

// Browser 2D canvas backing-store limit is ~16384px in Chrome; stay safely under.
export const MAX_CANVAS_WIDTH_PX = 16000;

// Level-of-Detail thresholds, in CSS px of clip width.
const LOD_BAR_PX = TIMELINE_CLIP_CANVAS_LOD_BAR_PX; // below this: nothing meaningful, draw a thin bar
const LOD_LABEL_PX = TIMELINE_CLIP_CANVAS_LOD_LABEL_PX; // above this: room for a (truncated) label
const LOD_THUMB_PX = LOD_BAR_PX; // above this: draw at least one poster thumbnail
const CANVAS_THUMB_SLOT_PX = 71; // target width of one timeline filmstrip frame
const MAX_THUMB_SLOTS = 48;  // hard cap per clip
const WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM = 250;
const WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH = 16_384;
const WAVEFORM_GENERATION_DELAY_MS = 300;
const SPECTROGRAM_ARTIFACT_RETRY_MS = 2000;
const MAX_RENDERED_WAVEFORM_CHANNELS = 2;

export interface CanvasFadeVisuals {
  keyframes: readonly FadeCurveKeyframe[];
  clipDuration: number;
  isAudioClip: boolean;
}

export interface CanvasClip {
  id: string;
  trackId: string;
  trackType?: 'video' | 'audio' | 'midi';
  startTime: number;
  duration: number;
  name: string;
  inPoint?: number;
  outPoint?: number;
  reversed?: boolean;
  linkedClipId?: string;
  linkedGroupId?: string;
  isPendingDownload?: boolean;
  downloadProgress?: number;
  downloadError?: string;
  transcript?: TranscriptWord[];
  transcriptStatus?: TranscriptStatus;
  transcriptProgress?: number;
  analysis?: ClipAnalysis;
  analysisStatus?: AnalysisStatus;
  analysisProgress?: number;
  mediaFileId?: string;
  thumbnails?: string[];
  isComposition?: boolean;
  compositionId?: string;
  nestedClipBoundaries?: number[];
  clipSegments?: ClipSegment[];
  mixdownWaveform?: number[];
  mixdownGenerating?: boolean;
  hasMixdownAudio?: boolean;
  waveform?: number[];
  waveformChannels?: number[][];
  waveformGenerating?: boolean;
  waveformProgress?: number;
  file?: File;
  audioState?: ClipAudioState;
  fade?: CanvasFadeVisuals;
  source?: {
    type?: string | null;
    mediaFileId?: string;
    naturalDuration?: number;
    vectorAnimationSettings?: VectorAnimationClipSettings;
  } | null;
}

interface TimelineClipCanvasProps {
  clips: readonly CanvasClip[];
  trackId: string;
  /** Row height in CSS px (the clip body area). */
  height: number;
  /** Absolute content width in CSS px (max clip end); used for viewport slicing only. */
  contentWidth: number;
  /** Timeline px-per-second → px mapping, identical to the DOM clip path. */
  timeToPixel: (time: number) => number;
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId?: string | null;
  /** Base track color (CSS color string) used for clip fills. */
  trackColor: string;
  /** Current horizontal scroll offset in px (absolute timeline space). */
  scrollX: number;
  /** Visible viewport width in px — thumbnails are only loaded/drawn for clips inside it. */
  viewportWidth: number;
  waveformsEnabled?: boolean;
  audioDisplayMode?: TimelineAudioDisplayMode;
  clipDrag?: ClipDragState | null;
  clipDragPreview?: TimelineClipDragPreview | null;
  clipTrim?: ClipTrimState | null;
  waveformPyramids?: WaveformPyramidMap;
  spectrogramTileSets?: SpectrogramTileSetMap;
}

interface PendingTimelineClipCanvasWorkerDraw {
  requestId: number;
  trackId: string;
  inputClipCount: number;
  visibleClipCount: number;
  thumbnailClipCount: number;
  thumbnailDrawCount: number;
  message: NonNullable<ReturnType<typeof buildTimelineClipCanvasWorkerDrawMessage>['message']>;
  transferables: Transferable[];
  posted: boolean;
}

interface VisibleThumbnailSecondRange {
  startSecond: number;
  endSecond: number;
}

type VisibleThumbnailSecondRangeMap = Map<string, VisibleThumbnailSecondRange[]>;

// Only decode/draw thumbnails for clips within the visible window (+ overscan).
// Without this, opening a 100-clip comp kicks off 100+ ImageBitmap decodes at
// once and freezes the tab (issue #228).
const THUMBNAIL_VIEWPORT_OVERSCAN_PX = 600;
const CANVAS_RENDER_OVERSCAN_PX = 1200;

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    let r: number, g: number, b: number;
    if (color.length === 4) {
      r = parseInt(color[1] + color[1], 16);
      g = parseInt(color[2] + color[2], 16);
      b = parseInt(color[3] + color[3], 16);
    } else {
      r = parseInt(color.slice(1, 3), 16);
      g = parseInt(color.slice(3, 5), 16);
      b = parseInt(color.slice(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

/** A clip shows a source-cache filmstrip when it is a video clip with a media id
 *  (mirrors the DOM path's `useSourceCache`). Returns the media file id or null. */
function clipShowsThumbnails(clip: CanvasClip): string | null {
  if (clip.source?.type !== 'video') return null;
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

type WaveformPyramidMap = ReadonlyMap<string, TimelineWaveformPyramid | null>;
type SpectrogramTileSetMap = ReadonlyMap<string, TimelineSpectrogramTileSet | null>;
type MediaFileCanvasStatusMap = ReadonlyMap<string, MediaFileCanvasStatus>;

interface MediaFileCanvasStatus {
  proxyStatus?: string;
  proxyProgress?: number;
  audioProxyStatus?: string;
  audioProxyProgress?: number;
  hasProxyAudio?: boolean;
}

function isCanvasAudioClip(clip: CanvasClip): boolean {
  return isTimelineClipCanvasAudioClip(clip);
}

function getWaveformPyramidForClip(clip: CanvasClip, waveformPyramids: WaveformPyramidMap | undefined): TimelineWaveformPyramid | null {
  const refId = getPreferredWaveformPyramidRef(clip);
  if (!refId) return null;
  return waveformPyramids?.get(refId) ?? getCachedTimelineWaveformArtifact(refId) ?? null;
}

function getSpectrogramTileSetForClip(clip: CanvasClip, spectrogramTileSets: SpectrogramTileSetMap | undefined): {
  refId: string | undefined;
  tileSet: TimelineSpectrogramTileSet | null;
  variant: TimelineSpectrogramSourceVariant;
} {
  const processedRefId = clip.audioState?.processedAnalysisRefs?.spectrogramTileSetIds?.[0];
  const sourceRefId = clip.audioState?.sourceAnalysisRefs?.spectrogramTileSetIds?.[0];
  const refId = processedRefId ?? sourceRefId;
  const variant: TimelineSpectrogramSourceVariant = processedRefId ? 'processed' : 'source';
  if (!refId) return { refId, tileSet: null, variant };
  return {
    refId,
    variant,
    tileSet: spectrogramTileSets?.get(refId) ?? getCachedTimelineSpectrogramArtifact(refId) ?? null,
  };
}

function drawCanvasWaveformCenterLine(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  alpha = 0.16,
): void {
  const midY = height / 2;
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(width, midY);
  ctx.stroke();
}

function buildCanvasSignedEnvelopePath(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  minFloor = 0,
  scale = 1,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const count = columns.length;
  const normalizedScale = Math.max(0, Math.min(1, scale));

  const xAt = (index: number) => {
    if (count <= 1) return width / 2;
    return (index / (count - 1)) * width;
  };
  const topYAt = (index: number) => {
    const column = columns[index];
    return midY - Math.max(column.max, column.peak * minFloor, 0) * normalizedScale * halfHeight;
  };
  const bottomYAt = (index: number) => {
    const column = columns[index];
    return midY + Math.max(-column.min, column.peak * minFloor, 0) * normalizedScale * halfHeight;
  };

  ctx.beginPath();
  ctx.moveTo(0, topYAt(0));

  for (let index = 0; index < count - 1; index += 1) {
    const previousX = xAt(index);
    const currentX = xAt(index + 1);
    const previousY = topYAt(index);
    const currentY = topYAt(index + 1);
    ctx.quadraticCurveTo(previousX, previousY, (previousX + currentX) / 2, (previousY + currentY) / 2);
  }
  ctx.quadraticCurveTo(width, topYAt(count - 1), width, topYAt(count - 1));

  ctx.lineTo(width, bottomYAt(count - 1));

  for (let index = count - 1; index > 0; index -= 1) {
    const nextX = xAt(index);
    const currentX = xAt(index - 1);
    const nextY = bottomYAt(index);
    const currentY = bottomYAt(index - 1);
    ctx.quadraticCurveTo(nextX, nextY, (nextX + currentX) / 2, (nextY + currentY) / 2);
  }
  ctx.quadraticCurveTo(0, bottomYAt(0), 0, bottomYAt(0));
  ctx.closePath();
}

function buildCanvasSmoothEnvelopePath(
  ctx: CanvasRenderingContext2D,
  columns: WaveformColumn[],
  width: number,
  height: number,
  valueForColumn: (column: WaveformColumn) => number,
): void {
  const midY = height / 2;
  const halfHeight = Math.max(1, (height - 6) / 2);
  const count = columns.length;

  const xAt = (index: number) => {
    if (count <= 1) return width / 2;
    return (index / (count - 1)) * width;
  };
  const topYAt = (index: number) => midY - valueForColumn(columns[index]) * halfHeight;
  const bottomYAt = (index: number) => midY + valueForColumn(columns[index]) * halfHeight;

  ctx.beginPath();
  ctx.moveTo(0, topYAt(0));
  for (let index = 0; index < count - 1; index += 1) {
    const previousX = xAt(index);
    const currentX = xAt(index + 1);
    const previousY = topYAt(index);
    const currentY = topYAt(index + 1);
    ctx.quadraticCurveTo(previousX, previousY, (previousX + currentX) / 2, (previousY + currentY) / 2);
  }
  ctx.quadraticCurveTo(width, topYAt(count - 1), width, topYAt(count - 1));
  ctx.lineTo(width, bottomYAt(count - 1));
  for (let index = count - 1; index > 0; index -= 1) {
    const nextX = xAt(index);
    const currentX = xAt(index - 1);
    const nextY = bottomYAt(index);
    const currentY = bottomYAt(index - 1);
    ctx.quadraticCurveTo(nextX, nextY, (nextX + currentX) / 2, (nextY + currentY) / 2);
  }
  ctx.quadraticCurveTo(0, bottomYAt(0), 0, bottomYAt(0));
  ctx.closePath();
}

function drawDetailedCanvasWaveform(ctx: CanvasRenderingContext2D, columns: WaveformColumn[], width: number, height: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(216, 230, 240, 0.10)');
  gradient.addColorStop(0.5, 'rgba(224, 238, 248, 0.22)');
  gradient.addColorStop(1, 'rgba(216, 230, 240, 0.10)');
  buildCanvasSignedEnvelopePath(ctx, columns, width, height, 0.01, 0.82);
  ctx.fillStyle = gradient;
  ctx.fill();

  const rmsGradient = ctx.createLinearGradient(0, 0, 0, height);
  rmsGradient.addColorStop(0, 'rgba(92, 203, 255, 0.18)');
  rmsGradient.addColorStop(0.5, 'rgba(178, 230, 255, 0.44)');
  rmsGradient.addColorStop(1, 'rgba(92, 203, 255, 0.18)');
  buildCanvasSmoothEnvelopePath(ctx, columns, width, height, (column) => Math.min(column.rms * 0.84, column.peak * 0.72));
  ctx.fillStyle = rmsGradient;
  ctx.fill();

  drawCanvasWaveformCenterLine(ctx, width, height);
}

function drawCompactCanvasWaveform(ctx: CanvasRenderingContext2D, columns: WaveformColumn[], width: number, height: number): void {
  buildCanvasSignedEnvelopePath(ctx, columns, width, height, 0.08);
  ctx.fillStyle = 'rgba(235, 241, 248, 0.62)';
  ctx.fill();
  drawCanvasWaveformCenterLine(ctx, width, height, 0.12);
}

function resolveCanvasWaveformChannelIndexes(
  pyramid: TimelineWaveformPyramid | null,
  waveformChannels: readonly (readonly number[])[] | undefined,
  height: number,
): number[] {
  const pyramidIndexes = pyramid?.levels
    .find(level => level.channels.length > 0)
    ?.channels.map(channel => channel.channelIndex) ?? [];
  const legacyIndexes = waveformChannels
    ?.map((channel, index) => (channel.length > 0 ? index : -1))
    .filter(index => index >= 0) ?? [];
  const indexes = pyramidIndexes.length > 0
    ? pyramidIndexes
    : legacyIndexes.length > 0
      ? legacyIndexes
      : [0];
  const maxChannels = height < 42 ? 1 : MAX_RENDERED_WAVEFORM_CHANNELS;
  return indexes.slice(0, maxChannels);
}

function drawAudioWaveform(
  ctx: CanvasRenderingContext2D,
  clip: CanvasClip,
  pyramid: TimelineWaveformPyramid | null,
  x: number,
  top: number,
  w: number,
  h: number,
  mode: TimelineAudioDisplayMode,
  pixelsPerSecond: number,
): void {
  const channels = clip.waveformChannels?.filter(channel => channel.length > 0);
  const fallback = clip.waveform && clip.waveform.length > 0 ? [clip.waveform] : [];
  const drawableChannels = channels && channels.length > 0 ? channels : fallback;
  const hasDrawableWaveform = Boolean(pyramid || drawableChannels.length > 0);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, Math.min(4, h / 4));
  ctx.clip();

  ctx.fillStyle = mode === 'spectral' ? 'rgba(8, 14, 24, 0.44)' : 'rgba(4, 10, 18, 0.22)';
  ctx.fillRect(x, top, w, h);

  if (!hasDrawableWaveform || w < 2) {
    ctx.save();
    ctx.translate(x, top);
    drawCanvasWaveformCenterLine(ctx, w, h, clip.waveformGenerating ? 0.34 : 0.18);
    if (clip.waveformGenerating) {
      const progress = Math.max(0.04, Math.min(1, (clip.waveformProgress ?? 30) / 100));
      const progressGradient = ctx.createLinearGradient(0, 0, w, 0);
      progressGradient.addColorStop(0, 'rgba(92, 203, 255, 0.52)');
      progressGradient.addColorStop(1, 'rgba(178, 230, 255, 0.12)');
      ctx.fillStyle = progressGradient;
      ctx.fillRect(0, h - 3, w * progress, 2);
    }
    ctx.restore();
    ctx.restore();
    return;
  }

  const renderChannels = resolveCanvasWaveformChannelIndexes(pyramid, clip.waveformChannels, h);
  const laneGap = renderChannels.length > 1 ? 2 : 0;
  const laneHeight = Math.max(8, (h - laneGap * (renderChannels.length - 1)) / renderChannels.length);
  const naturalDuration = Math.max(0.001, pyramid?.duration ?? clip.source?.naturalDuration ?? clip.outPoint ?? clip.duration);
  const inPoint = Math.max(0, Math.min(naturalDuration, clip.inPoint ?? 0));
  const outPoint = Math.max(inPoint + 0.001, Math.min(naturalDuration, clip.outPoint ?? inPoint + clip.duration));

  ctx.save();
  ctx.translate(x, top);

  renderChannels.forEach((channelIndex, laneIndex) => {
    const laneTop = laneIndex * (laneHeight + laneGap);
    if (laneIndex > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(0, laneTop - laneGap / 2);
      ctx.lineTo(w, laneTop - laneGap / 2);
      ctx.stroke();
    }

    const lod = buildWaveformLod({
      waveform: clip.waveform ?? [],
      waveformChannels: clip.waveformChannels,
      pyramid,
      width: w,
      inPoint,
      outPoint,
      naturalDuration,
      pixelsPerSecond,
      channelIndex,
    });
    if (!lod || lod.columns.length === 0) {
      ctx.save();
      ctx.translate(0, laneTop);
      drawCanvasWaveformCenterLine(ctx, w, laneHeight, 0.18);
      ctx.restore();
      return;
    }

    const smoothed = smoothWaveformColumns(lod.columns, lod.source === 'pyramid' ? 1 : 2, 0.45);
    const normalized = normalizeWaveformColumnsForDisplay(smoothed, {
      targetPeak: mode === 'compact' ? 0.52 : 0.66,
      minReferencePeak: mode === 'spectral' ? 0.025 : 0.032,
      maxGain: mode === 'spectral' ? 20 : 16,
      referencePeak: resolveWaveformDisplayReferencePeak(smoothed, { minReferencePeak: mode === 'spectral' ? 0.025 : 0.032 }),
      perceptualScale: mode !== 'compact',
      noiseFloorDb: mode === 'spectral' ? -42 : -30,
    });

    ctx.save();
    ctx.translate(0, laneTop);
    if (mode === 'compact') {
      drawCompactCanvasWaveform(ctx, normalized, w, laneHeight);
    } else {
      drawDetailedCanvasWaveform(ctx, normalized, w, laneHeight);
    }
    ctx.restore();
  });

  ctx.restore();
  ctx.restore();
}

function createWorkerPreparedWaveformResource(
  clip: CanvasClip,
  waveformPyramids: WaveformPyramidMap | undefined,
  mode: TimelineAudioDisplayMode | undefined,
  height: number,
  timeToPixel: (time: number) => number,
): TimelineClipCanvasWorkerPreparedClipResources['waveform'] | undefined {
  if (!isCanvasAudioClip(clip) || mode === 'spectral') return undefined;

  const pyramid = getWaveformPyramidForClip(clip, waveformPyramids);
  const hasLegacyWaveform = (clip.waveform?.length ?? 0) > 0 || (clip.waveformChannels?.some(channel => channel.length > 0) ?? false);
  if (!pyramid && !hasLegacyWaveform) return undefined;

  const absoluteWidth = Math.max(
    1,
    Math.round(timeToPixel(clip.startTime + clip.duration) - timeToPixel(clip.startTime)),
  );
  const width = Math.max(8, Math.min(1024, absoluteWidth));
  const naturalDuration = Math.max(0.001, pyramid?.duration ?? clip.source?.naturalDuration ?? clip.outPoint ?? clip.duration);
  const inPoint = Math.max(0, Math.min(naturalDuration, clip.inPoint ?? 0));
  const outPoint = Math.max(inPoint + 0.001, Math.min(naturalDuration, clip.outPoint ?? inPoint + clip.duration));
  const channelIndex = resolveCanvasWaveformChannelIndexes(pyramid, clip.waveformChannels, height)[0] ?? 0;
  const lod = buildWaveformLod({
    waveform: clip.waveform ?? [],
    waveformChannels: clip.waveformChannels,
    pyramid,
    width,
    inPoint,
    outPoint,
    naturalDuration,
    pixelsPerSecond: Math.max(1, timeToPixel(1) - timeToPixel(0)),
    channelIndex,
  });
  if (!lod || lod.columns.length === 0) return undefined;

  const workerMode = mode === 'compact' ? 'compact' : 'detailed';
  const smoothed = smoothWaveformColumns(lod.columns, lod.source === 'pyramid' ? 1 : 2, 0.45);
  const normalized = normalizeWaveformColumnsForDisplay(smoothed, {
    targetPeak: workerMode === 'compact' ? 0.52 : 0.66,
    minReferencePeak: 0.032,
    maxGain: 16,
    referencePeak: resolveWaveformDisplayReferencePeak(smoothed, { minReferencePeak: 0.032 }),
    perceptualScale: workerMode !== 'compact',
    noiseFloorDb: -30,
  });
  if (normalized.length === 0) return undefined;

  const columns: number[] = [];
  normalized.forEach((column) => {
    columns.push(column.min, column.max, column.rms, column.peak);
  });
  return {
    kind: 'waveform',
    columns,
    columnCount: normalized.length,
    mode: workerMode,
  };
}

function createWorkerPreparedSpectrogramResource(
  clip: CanvasClip,
  spectrogramTileSets: SpectrogramTileSetMap | undefined,
  mode: TimelineAudioDisplayMode | undefined,
  height: number,
  timeToPixel: (time: number) => number,
): TimelineClipCanvasWorkerPreparedClipResources['spectrogram'] | undefined {
  if (!isCanvasAudioClip(clip) || mode !== 'spectral') return undefined;
  const { refId, tileSet, variant } = getSpectrogramTileSetForClip(clip, spectrogramTileSets);
  const channel = tileSet?.channels[0];
  if (!refId || !tileSet || !channel) return undefined;

  const absoluteWidth = Math.max(
    1,
    Math.round(timeToPixel(clip.startTime + clip.duration) - timeToPixel(clip.startTime)),
  );
  const rasterWidth = Math.max(8, Math.min(768, absoluteWidth));
  const rasterHeight = Math.max(8, Math.min(96, Math.round(height - 2)));
  const spectrogramDuration = Math.max(0.001, tileSet.duration ?? clip.source?.naturalDuration ?? clip.outPoint ?? clip.duration);
  const sourceRange = resolveTimelineSpectrogramSourceRange({
    variant,
    visibleSourceInPoint: clip.inPoint ?? 0,
    visibleSourceOutPoint: clip.outPoint ?? (clip.inPoint ?? 0) + clip.duration,
    tileDuration: spectrogramDuration,
    visibleStartRatio: 0,
    visibleEndRatio: 1,
  });
  const sourceSpan = Math.max(0.000001, sourceRange.outPoint - sourceRange.inPoint);
  const secondsPerFrame = tileSet.hopSize / Math.max(1, tileSet.sampleRate);
  const values: number[] = [];

  for (let y = 0; y < rasterHeight; y += 1) {
    const highToLow = 1 - (y / Math.max(1, rasterHeight - 1));
    const perceptual = Math.pow(Math.max(0, Math.min(1, highToLow)), 2.15);
    const binIndex = Math.max(0, Math.min(
      tileSet.frequencyBinCount - 1,
      Math.round(perceptual * (tileSet.frequencyBinCount - 1)),
    ));
    for (let x = 0; x < rasterWidth; x += 1) {
      const timeMix = rasterWidth <= 1 ? 0 : x / (rasterWidth - 1);
      const sourceTime = Math.max(0, Math.min(
        spectrogramDuration,
        sourceRange.inPoint + sourceSpan * timeMix,
      ));
      const frameIndex = tileSet.frameCount <= 1
        ? 0
        : Math.max(0, Math.min(
          tileSet.frameCount - 1,
          Math.round(sourceTime / Math.max(0.000001, secondsPerFrame)),
        ));
      values.push(channel.values[frameIndex * tileSet.frequencyBinCount + binIndex] ?? 0);
    }
  }

  return {
    kind: 'spectrogram',
    values,
    rasterWidth,
    rasterHeight,
  };
}

function createWorkerCompositionSegmentRects(clip: CanvasClip): Float32Array | undefined {
  const segments = clip.clipSegments;
  if (!segments || segments.length === 0) return undefined;
  const values: number[] = [];
  for (const segment of segments.slice(0, WORKER_COMPOSITION_SEGMENT_MAX_COUNT)) {
    const startNorm = Math.max(0, Math.min(1, segment.startNorm));
    const endNorm = Math.max(startNorm, Math.min(1, segment.endNorm));
    if (endNorm - startNorm <= 0.0001) continue;
    values.push(startNorm, endNorm);
  }
  return values.length > 0 ? Float32Array.from(values) : undefined;
}

function createWorkerCompositionNestedBoundaries(clip: CanvasClip): Float32Array | undefined {
  const boundaries = clip.nestedClipBoundaries;
  if (!boundaries || boundaries.length === 0) return undefined;
  const values = boundaries
    .filter((boundary) => Number.isFinite(boundary) && boundary > 0 && boundary < 1)
    .slice(0, WORKER_COMPOSITION_BOUNDARY_MAX_COUNT);
  return values.length > 0 ? Float32Array.from(values) : undefined;
}

type WorkerPreparedCompositionVisualsResource = NonNullable<TimelineClipCanvasWorkerPreparedClipResources['compositionVisuals']>;
type WorkerPreparedCompositionSegmentThumbnailStripResource = NonNullable<WorkerPreparedCompositionVisualsResource['segmentThumbnailStrip']>;
type WorkerPreparedCompositionMixdownWaveformResource = NonNullable<WorkerPreparedCompositionVisualsResource['mixdownWaveform']>;

function createWorkerCompositionSegmentThumbnailStripResource(
  clip: CanvasClip,
  clipWidth: number,
  height: number,
): WorkerPreparedCompositionSegmentThumbnailStripResource | undefined {
  const segments = clip.clipSegments;
  if (!segments || segments.length === 0 || clipWidth < LOD_THUMB_PX || typeof OffscreenCanvas === 'undefined') {
    return undefined;
  }
  const bitmapWidth = Math.max(1, Math.min(WORKER_THUMBNAIL_STRIP_MAX_WIDTH, Math.round(clipWidth)));
  const bitmapHeight = Math.max(1, Math.min(WORKER_THUMBNAIL_STRIP_MAX_HEIGHT, Math.round(Math.max(1, height - 2))));
  const canvas = new OffscreenCanvas(bitmapWidth, bitmapHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  let drawCount = 0;
  for (const segment of segments.slice(0, WORKER_COMPOSITION_SEGMENT_MAX_COUNT)) {
    const startNorm = Math.max(0, Math.min(1, segment.startNorm));
    const endNorm = Math.max(startNorm, Math.min(1, segment.endNorm));
    const segmentX = startNorm * bitmapWidth;
    const segmentW = Math.max(1, (endNorm - startNorm) * bitmapWidth);
    if (segmentW <= 0) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(segmentX, 0, segmentW, bitmapHeight);
    ctx.clip();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
    ctx.fillRect(segmentX, 0, segmentW, bitmapHeight);

    if (segment.thumbnails.length > 0) {
      const count = Math.max(1, Math.min(MAX_THUMB_SLOTS, Math.ceil((segmentW / bitmapWidth * clipWidth) / CANVAS_THUMB_SLOT_PX)));
      const slotW = segmentW / count;
      for (let index = 0; index < count; index += 1) {
        const thumbIndex = Math.min(
          segment.thumbnails.length - 1,
          Math.floor((index / count) * segment.thumbnails.length),
        );
        const bitmap = getThumbnailBitmap(segment.thumbnails[thumbIndex]);
        if (!bitmap) continue;
        drawCover(ctx, bitmap, segmentX + index * slotW, 0, slotW, bitmapHeight);
        drawCount += 1;
      }
    }

    ctx.fillStyle = 'rgba(251, 146, 60, 0.18)';
    ctx.fillRect(segmentX, 0, segmentW, bitmapHeight);
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(segmentX + 0.5, 0.5, Math.max(0, segmentW - 1), Math.max(0, bitmapHeight - 1));
    ctx.restore();
  }

  return {
    kind: 'thumbnail-strip',
    bitmap: canvas.transferToImageBitmap(),
    x: 0,
    width: clipWidth,
    height: Math.max(1, height - 2),
    drawCount,
  };
}

function createWorkerPreparedCompositionMixdownWaveformResource(
  clip: CanvasClip,
  height: number,
  timeToPixel: (time: number) => number,
): WorkerPreparedCompositionMixdownWaveformResource | undefined {
  const waveform = clip.mixdownWaveform && clip.mixdownWaveform.length > 0
    ? clip.mixdownWaveform
    : clip.hasMixdownAudio && clip.waveform && clip.waveform.length > 0
      ? clip.waveform
      : null;
  if (!waveform) return undefined;

  return createWorkerPreparedWaveformResource(
    {
      ...clip,
      trackType: 'audio',
      waveform,
      waveformChannels: undefined,
      inPoint: 0,
      outPoint: clip.duration,
      source: {
        ...(clip.source ?? {}),
        naturalDuration: Math.max(0.001, clip.duration),
        type: 'audio',
      },
    },
    undefined,
    'compact',
    Math.min(42, Math.max(16, height / 3)),
    timeToPixel,
  );
}

function createWorkerPreparedCompositionVisualsResource(
  clip: CanvasClip,
  clipWidth: number,
  height: number,
  timeToPixel: (time: number) => number,
): TimelineClipCanvasWorkerPreparedClipResources['compositionVisuals'] | undefined {
  if (!hasCanvasCompositionDecorations(clip)) return undefined;
  return {
    kind: 'composition-visuals',
    outline: Boolean(clip.isComposition || clip.compositionId),
    nestedBoundaries: createWorkerCompositionNestedBoundaries(clip),
    segmentRects: createWorkerCompositionSegmentRects(clip),
    segmentThumbnailStrip: createWorkerCompositionSegmentThumbnailStripResource(clip, clipWidth, height),
    mixdownWaveform: createWorkerPreparedCompositionMixdownWaveformResource(clip, height, timeToPixel),
    mixdownGenerating: clip.mixdownGenerating,
  };
}

function createWorkerPreparedResourcesByClipId(
  clips: readonly CanvasClip[],
  waveformPyramids: WaveformPyramidMap | undefined,
  spectrogramTileSets: SpectrogramTileSetMap | undefined,
  mediaFileStatusById: MediaFileCanvasStatusMap,
  waveformsEnabled: boolean | undefined,
  audioDisplayMode: TimelineAudioDisplayMode | undefined,
  height: number,
  trackId: string,
  cssWidth: number,
  canvasOffsetX: number,
  scrollX: number,
  viewportWidth: number,
  timeToPixel: (time: number) => number,
  clipDrag: ClipDragState | null | undefined,
  clipDragPreview: TimelineClipDragPreview | null | undefined,
  clipTrim: ClipTrimState | null | undefined,
): ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources> | undefined {
  const resourcesByClipId = new Map<string, TimelineClipCanvasWorkerPreparedClipResources>();
  clips.forEach((clip) => {
    const geometry = resolveClipGeometry(clip, { trackId, clipDrag, clipDragPreview, clipTrim });
    const resourceClip: CanvasClip = {
      ...clip,
      startTime: geometry.startTime,
      duration: geometry.duration,
      inPoint: geometry.inPoint,
      outPoint: geometry.outPoint,
    };
    const waveform = waveformsEnabled
      ? createWorkerPreparedWaveformResource(
        resourceClip,
        waveformPyramids,
        audioDisplayMode,
        height,
        timeToPixel,
      )
      : undefined;
    const spectrogram = waveformsEnabled
      ? createWorkerPreparedSpectrogramResource(
        resourceClip,
        spectrogramTileSets,
        audioDisplayMode,
        height,
        timeToPixel,
      )
      : undefined;
    const passiveDecorations = createWorkerPreparedPassiveDecorationsResource(
      resourceClip,
      getMediaFileCanvasStatus(resourceClip, mediaFileStatusById),
      Math.max(
        1,
        Math.round(timeToPixel(resourceClip.startTime + resourceClip.duration) - timeToPixel(resourceClip.startTime)),
      ),
    );
    const clipWidth = Math.max(
      1,
      timeToPixel(resourceClip.startTime + resourceClip.duration) - timeToPixel(resourceClip.startTime),
    );
    const compositionVisuals = createWorkerPreparedCompositionVisualsResource(
      resourceClip,
      clipWidth,
      height,
      timeToPixel,
    );
    const trimVisuals = createWorkerPreparedTrimVisualsResource(clip, {
      trackId,
      height,
      cssWidth,
      canvasOffsetX,
      scrollX,
      viewportWidth,
      timeToPixel,
      clipDrag,
      clipDragPreview,
      clipTrim,
    });
    const fadeVisuals = createWorkerPreparedFadeVisualsResource(
      clip,
      Math.max(1,
        trimVisuals?.body.width ??
          (timeToPixel(clip.startTime + clip.duration) - timeToPixel(clip.startTime)),
      ),
      height,
    );
    if (waveform || spectrogram || passiveDecorations || compositionVisuals || trimVisuals || fadeVisuals) {
      resourcesByClipId.set(clip.id, { waveform, spectrogram, passiveDecorations, compositionVisuals, trimVisuals, fadeVisuals });
    }
  });
  return resourcesByClipId.size > 0 ? resourcesByClipId : undefined;
}

function createWorkerPreparedFadeVisualsResource(
  clip: CanvasClip,
  clipWidth: number,
  height: number,
): TimelineClipCanvasWorkerPreparedClipResources['fadeVisuals'] | undefined {
  const fade = clip.fade;
  if (!fade || fade.keyframes.length < 2) return undefined;

  const bodyHeight = Math.max(1, height - 2);
  const geometry = buildFadeCurveGeometry({
    keyframes: fade.keyframes,
    clipDuration: fade.clipDuration,
    width: clipWidth,
    height: bodyHeight,
  });
  if (!geometry || geometry.segments.length === 0 || geometry.points.length < 2) return undefined;

  const curves: number[] = [];
  geometry.segments.forEach((segment) => {
    curves.push(
      segment.cp1.x,
      segment.cp1.y,
      segment.cp2.x,
      segment.cp2.y,
      segment.end.x,
      segment.end.y,
    );
  });
  const points: number[] = [];
  geometry.points.forEach((point) => {
    points.push(point.x, point.y);
  });

  return {
    kind: 'fade-visuals',
    startX: geometry.startPoint.x,
    startY: geometry.startPoint.y,
    curves: Float32Array.from(curves),
    curveCount: geometry.segments.length,
    points: Float32Array.from(points),
    pointCount: geometry.points.length,
    isAudioClip: fade.isAudioClip,
  };
}

function drawCanvasFadeCurve(
  ctx: CanvasRenderingContext2D,
  fade: CanvasFadeVisuals | undefined,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (!fade || fade.keyframes.length < 2 || typeof Path2D === 'undefined') return;
  const path = buildFadeCurvePath({
    keyframes: fade.keyframes,
    clipDuration: fade.clipDuration,
    width: w,
    height: h,
  });
  if (!path) return;

  ctx.save();
  ctx.translate(x, top);
  ctx.fillStyle = fade.isAudioClip ? 'rgba(51, 197, 255, 0.13)' : 'rgba(0, 0, 0, 0.4)';
  ctx.fill(new Path2D(path.fillPath));
  ctx.strokeStyle = fade.isAudioClip ? 'rgba(96, 217, 255, 0.86)' : 'rgba(140, 180, 220, 0.8)';
  ctx.lineWidth = fade.isAudioClip ? 1.6 : 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(path.curvePath));
  ctx.fillStyle = fade.isAudioClip ? 'rgba(96, 217, 255, 0.95)' : 'rgba(140, 180, 220, 1)';
  for (const point of path.points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

interface CanvasClipGeometry {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  visible: boolean;
  trimEdge?: 'left' | 'right';
  originalStartTime: number;
  originalEndTime: number;
  sourceDuration: number;
}

function resolveClipGeometry(
  clip: CanvasClip,
  props: Pick<TimelineClipCanvasProps, 'clipDrag' | 'clipDragPreview' | 'clipTrim' | 'trackId'>,
): CanvasClipGeometry {
  const { clipDrag, clipDragPreview, clipTrim, trackId } = props;
  let startTime = clip.startTime;
  let duration = clip.duration;
  let inPoint = clip.inPoint ?? 0;
  let outPoint = clip.outPoint ?? inPoint + duration;
  let visible = clip.trackId === trackId;
  let trimEdge: 'left' | 'right' | undefined;
  const sourceDuration = getTimelineClipSourceDuration(clip);
  const dragPreviewPatch = clipDragPreview?.patches[clip.id];
  const isPrimaryDragClip = clipDrag?.clipId === clip.id;
  const isLinkedSlipClip = Boolean(
    clipDrag?.toolGesture === 'slip' &&
      !clipDrag.altKeyPressed &&
      clip.linkedClipId === clipDrag.clipId,
  );

  if (isPrimaryDragClip) {
    visible = clipDrag.currentTrackId === trackId;
    const previewStartTime = dragPreviewPatch ? Math.max(0, dragPreviewPatch.startTime) : startTime;
    startTime = clipDrag.snappedTime !== null ? clipDrag.snappedTime : previewStartTime;
  } else if (clipDrag?.multiSelectClipIds?.includes(clip.id) && clipDrag.multiSelectTimeDelta !== undefined) {
    startTime = Math.max(0, clip.startTime + clipDrag.multiSelectTimeDelta);
  } else if (dragPreviewPatch) {
    startTime = Math.max(0, dragPreviewPatch.startTime);
    visible = (dragPreviewPatch.trackId ?? clip.trackId) === trackId;
  }

  if (
    clipDrag?.toolGesture === 'slip' &&
    (isPrimaryDragClip || isLinkedSlipClip) &&
    typeof clipDrag.sourceTimeDelta === 'number'
  ) {
    const visibleSourceDuration = Math.max(0.001, outPoint - inPoint);
    const maxInPoint = Math.max(0, sourceDuration - visibleSourceDuration);
    const nextInPoint = Math.max(0, Math.min(maxInPoint, inPoint + clipDrag.sourceTimeDelta));
    inPoint = nextInPoint;
    outPoint = nextInPoint + visibleSourceDuration;
  }

  if (clipTrim?.clipId === clip.id) {
    trimEdge = clipTrim.edge;
    const deltaTime = clipTrim.appliedDelta;
    const sourceType = clip.source?.type;
    const isInfiniteClip = isInfiniteTimelineSourceType(sourceType);
    if (clipTrim.edge === 'left') {
      const maxTrim = clipTrim.originalDuration - MIN_CLIP_DURATION;
      const minTrim = isInfiniteClip
        ? -clipTrim.originalStartTime
        : -clipTrim.originalInPoint;
      const clampedDelta = Math.max(minTrim, Math.min(maxTrim, deltaTime));
      startTime = clipTrim.originalStartTime + clampedDelta;
      duration = clipTrim.originalDuration - clampedDelta;
      inPoint = clipTrim.originalInPoint + clampedDelta;
      outPoint = clipTrim.originalOutPoint;
    } else {
      const maxExtend = isInfiniteClip || canLoopExtendTimelineVectorClip(clip)
        ? Number.MAX_SAFE_INTEGER
        : sourceDuration - clipTrim.originalOutPoint;
      const minTrim = -(clipTrim.originalDuration - MIN_CLIP_DURATION);
      const clampedDelta = Math.max(minTrim, Math.min(maxExtend, deltaTime));
      startTime = clipTrim.originalStartTime;
      duration = clipTrim.originalDuration + clampedDelta;
      inPoint = clipTrim.originalInPoint;
      outPoint = clipTrim.originalOutPoint + clampedDelta;
    }
  }

  return {
    startTime,
    duration: Math.max(0.001, duration),
    inPoint,
    outPoint,
    visible,
    trimEdge,
    originalStartTime: clip.startTime,
    originalEndTime: clip.startTime + clip.duration,
    sourceDuration,
  };
}

function createWorkerDrawableClips(
  clips: readonly CanvasClip[],
  props: Pick<TimelineClipCanvasProps, 'clipDrag' | 'clipDragPreview' | 'clipTrim' | 'trackId'>,
): readonly CanvasClip[] {
  const drawableClips: CanvasClip[] = [];
  for (const clip of clips) {
    const geometry = resolveClipGeometry(clip, props);
    if (!geometry.visible) continue;
    drawableClips.push({
      ...clip,
      startTime: geometry.startTime,
      duration: geometry.duration,
      inPoint: geometry.inPoint,
      outPoint: geometry.outPoint,
    });
  }
  return drawableClips;
}

function addVisibleThumbnailSecondRange(
  rangesByMediaId: VisibleThumbnailSecondRangeMap,
  mediaFileId: string,
  startSecond: number,
  endSecond: number,
): void {
  const normalizedRange = {
    startSecond: Math.max(0, Math.floor(Math.min(startSecond, endSecond))),
    endSecond: Math.max(0, Math.ceil(Math.max(startSecond, endSecond))),
  };
  const ranges = rangesByMediaId.get(mediaFileId);
  if (ranges) {
    ranges.push(normalizedRange);
    return;
  }
  rangesByMediaId.set(mediaFileId, [normalizedRange]);
}

function collectVisibleThumbnailSecondRanges(input: {
  clips: readonly CanvasClip[];
  trackId: string;
  scrollX: number;
  viewportWidth: number;
  timeToPixel: (time: number) => number;
  clipDrag?: ClipDragState | null;
  clipDragPreview?: TimelineClipDragPreview | null;
  clipTrim?: ClipTrimState | null;
}): VisibleThumbnailSecondRangeMap {
  const rangesByMediaId: VisibleThumbnailSecondRangeMap = new Map();
  const visibleLeft = input.scrollX - THUMBNAIL_VIEWPORT_OVERSCAN_PX;
  const visibleRight = input.scrollX + input.viewportWidth + THUMBNAIL_VIEWPORT_OVERSCAN_PX;

  for (const clip of input.clips) {
    const mediaFileId = clipShowsThumbnails(clip);
    if (!mediaFileId) continue;

    const geometry = resolveClipGeometry(clip, input);
    if (!geometry.visible) continue;

    const absoluteX = input.timeToPixel(geometry.startTime);
    const absoluteW = input.timeToPixel(geometry.duration);
    if (absoluteW <= 0) continue;

    const overlapLeft = Math.max(absoluteX, visibleLeft);
    const overlapRight = Math.min(absoluteX + absoluteW, visibleRight);
    if (overlapRight <= overlapLeft) continue;

    const sourceDuration = Math.max(0.001, geometry.outPoint - geometry.inPoint);
    const overlapStartRatio = Math.max(0, Math.min(1, (overlapLeft - absoluteX) / absoluteW));
    const overlapEndRatio = Math.max(0, Math.min(1, (overlapRight - absoluteX) / absoluteW));
    const sourceStart = geometry.inPoint + overlapStartRatio * sourceDuration;
    const sourceEnd = geometry.inPoint + overlapEndRatio * sourceDuration;

    // getThumbnailsForRange may use adjacent seconds, so include a small buffer
    // around the exact visible source interval.
    addVisibleThumbnailSecondRange(rangesByMediaId, mediaFileId, sourceStart - 1, sourceEnd + 1);
  }

  return rangesByMediaId;
}

function collectVisibleAudioArtifactClipIds(input: {
  clips: readonly CanvasClip[];
  trackId: string;
  scrollX: number;
  viewportWidth: number;
  timeToPixel: (time: number) => number;
  clipDrag?: ClipDragState | null;
  clipDragPreview?: TimelineClipDragPreview | null;
  clipTrim?: ClipTrimState | null;
}): readonly string[] {
  const ids: string[] = [];
  const visibleLeft = input.scrollX - THUMBNAIL_VIEWPORT_OVERSCAN_PX;
  const visibleRight = input.scrollX + input.viewportWidth + THUMBNAIL_VIEWPORT_OVERSCAN_PX;

  for (const clip of input.clips) {
    if (!isCanvasAudioClip(clip)) continue;

    const geometry = resolveClipGeometry(clip, input);
    if (!geometry.visible) continue;

    const absoluteX = input.timeToPixel(geometry.startTime);
    const absoluteW = input.timeToPixel(geometry.duration);
    if (absoluteW <= 0) continue;
    if (absoluteX + absoluteW < visibleLeft || absoluteX > visibleRight) continue;

    ids.push(clip.id);
  }

  return ids;
}

function getThumbnailCacheEventSeconds(event: ThumbnailCacheEvent | undefined): readonly number[] | null {
  if (!event) return null;
  if (event.secondIndices && event.secondIndices.length > 0) return event.secondIndices;
  return typeof event.secondIndex === 'number' ? [event.secondIndex] : null;
}

function thumbnailCacheEventIntersectsVisibleRanges(
  mediaFileId: string,
  event: ThumbnailCacheEvent | undefined,
  visibleRangesByMediaId: VisibleThumbnailSecondRangeMap,
): boolean {
  const ranges = visibleRangesByMediaId.get(mediaFileId);
  if (!ranges || ranges.length === 0) return false;

  const changedSeconds = getThumbnailCacheEventSeconds(event);
  if (!changedSeconds) return true;

  return changedSeconds.some((secondIndex) => (
    ranges.some((range) => secondIndex >= range.startSecond && secondIndex <= range.endSecond)
  ));
}

function drawSourceExtensionGhost(
  ctx: CanvasRenderingContext2D,
  edge: 'left' | 'right',
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (w <= 0 || h <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, top, w, h);
  ctx.clip();

  const fill = ctx.createLinearGradient(0, top, 0, top + h);
  fill.addColorStop(0, 'rgba(251, 191, 36, 0.24)');
  fill.addColorStop(1, 'rgba(251, 191, 36, 0.08)');
  ctx.fillStyle = fill;
  ctx.fillRect(x, top, w, h);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  for (let offset = -h; offset < w + h; offset += 10) {
    ctx.beginPath();
    ctx.moveTo(x + offset, top + h);
    ctx.lineTo(x + offset + h, top);
    ctx.stroke();
  }

  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.46)';
  ctx.strokeRect(x + 0.5, top + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(251, 191, 36, 0.92)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (edge === 'left') {
    ctx.moveTo(x + w - 1, top);
    ctx.lineTo(x + w - 1, top + h);
  } else {
    ctx.moveTo(x + 1, top);
    ctx.lineTo(x + 1, top + h);
  }
  ctx.stroke();

  ctx.restore();
}

function drawSourceExtensionGhosts(
  ctx: CanvasRenderingContext2D,
  props: TimelineClipCanvasProps,
  geometry: CanvasClipGeometry,
  clipTop: number,
  clipHeight: number,
  visibleLeft: number,
  visibleRight: number,
  canvasOffsetX: number,
): void {
  if (!geometry.trimEdge) return;

  const displayEnd = geometry.startTime + geometry.duration;
  let drewPrimaryGhost = false;
  const pushGhost = (edge: 'left' | 'right', startTime: number, endTime: number) => {
    const ghostStartTime = Math.max(0, Math.min(startTime, endTime));
    const ghostEndTime = Math.max(ghostStartTime, Math.max(startTime, endTime));
    if (ghostEndTime - ghostStartTime <= 0.001) return false;

    const rawLeft = props.timeToPixel(ghostStartTime);
    const rawRight = props.timeToPixel(ghostEndTime);
    const clippedLeft = Math.max(rawLeft, visibleLeft);
    const clippedRight = Math.min(rawRight, visibleRight);
    if (clippedRight - clippedLeft < 1) return false;

    drawSourceExtensionGhost(ctx, edge, clippedLeft - canvasOffsetX, clipTop, clippedRight - clippedLeft, clipHeight);
    return true;
  };

  if (geometry.trimEdge === 'left') {
    const availableLeftDuration = Math.min(
      Math.max(0, geometry.inPoint),
      Math.max(0, geometry.startTime),
    );
    if (availableLeftDuration > 0.001) {
      drewPrimaryGhost = pushGhost('left', geometry.startTime - availableLeftDuration, geometry.startTime) || drewPrimaryGhost;
    }
  }

  if (geometry.trimEdge === 'right') {
    const availableRightDuration = Math.max(0, geometry.sourceDuration - geometry.outPoint);
    if (availableRightDuration > 0.001) {
      drewPrimaryGhost = pushGhost('right', displayEnd, displayEnd + availableRightDuration) || drewPrimaryGhost;
    }
  }

  if (
    !drewPrimaryGhost &&
    geometry.trimEdge === 'left' &&
    Math.abs(geometry.startTime - geometry.originalStartTime) > 0.001
  ) {
    pushGhost('left', Math.min(geometry.startTime, geometry.originalStartTime), Math.max(geometry.startTime, geometry.originalStartTime));
  }

  if (
    !drewPrimaryGhost &&
    geometry.trimEdge === 'right' &&
    Math.abs(displayEnd - geometry.originalEndTime) > 0.001
  ) {
    pushGhost('right', Math.min(displayEnd, geometry.originalEndTime), Math.max(displayEnd, geometry.originalEndTime));
  }
}

type WorkerPreparedTrimVisualsResource = TimelineClipCanvasWorkerPreparedClipResources['trimVisuals'];

interface WorkerTrimVisualsInput {
  trackId: string;
  height: number;
  cssWidth: number;
  canvasOffsetX: number;
  scrollX: number;
  viewportWidth: number;
  timeToPixel: (time: number) => number;
  clipDrag?: ClipDragState | null;
  clipDragPreview?: TimelineClipDragPreview | null;
  clipTrim?: ClipTrimState | null;
}

function collectWorkerSourceExtensionGhosts(
  geometry: CanvasClipGeometry,
  input: WorkerTrimVisualsInput,
): NonNullable<WorkerPreparedTrimVisualsResource>['sourceExtensionGhosts'] | undefined {
  if (!geometry.trimEdge) return undefined;

  const displayEnd = geometry.startTime + geometry.duration;
  const visibleLeft = input.scrollX - CANVAS_RENDER_OVERSCAN_PX;
  const visibleRight = input.scrollX + input.viewportWidth + CANVAS_RENDER_OVERSCAN_PX;
  const ghosts: Array<{ edge: 'left' | 'right'; x: number; width: number }> = [];

  const pushGhost = (edge: 'left' | 'right', startTime: number, endTime: number): boolean => {
    const ghostStartTime = Math.max(0, Math.min(startTime, endTime));
    const ghostEndTime = Math.max(ghostStartTime, Math.max(startTime, endTime));
    if (ghostEndTime - ghostStartTime <= 0.001) return false;

    const rawLeft = input.timeToPixel(ghostStartTime);
    const rawRight = input.timeToPixel(ghostEndTime);
    const clippedLeft = Math.max(rawLeft, visibleLeft);
    const clippedRight = Math.min(rawRight, visibleRight);
    if (clippedRight - clippedLeft < 1) return false;

    ghosts.push({
      edge,
      x: clippedLeft - input.canvasOffsetX,
      width: clippedRight - clippedLeft,
    });
    return true;
  };

  let drewPrimaryGhost = false;
  if (geometry.trimEdge === 'left') {
    const availableLeftDuration = Math.min(
      Math.max(0, geometry.inPoint),
      Math.max(0, geometry.startTime),
    );
    if (availableLeftDuration > 0.001) {
      drewPrimaryGhost = pushGhost('left', geometry.startTime - availableLeftDuration, geometry.startTime) || drewPrimaryGhost;
    }
  }

  if (geometry.trimEdge === 'right') {
    const availableRightDuration = Math.max(0, geometry.sourceDuration - geometry.outPoint);
    if (availableRightDuration > 0.001) {
      drewPrimaryGhost = pushGhost('right', displayEnd, displayEnd + availableRightDuration) || drewPrimaryGhost;
    }
  }

  if (
    !drewPrimaryGhost &&
    geometry.trimEdge === 'left' &&
    Math.abs(geometry.startTime - geometry.originalStartTime) > 0.001
  ) {
    pushGhost('left', Math.min(geometry.startTime, geometry.originalStartTime), Math.max(geometry.startTime, geometry.originalStartTime));
  }

  if (
    !drewPrimaryGhost &&
    geometry.trimEdge === 'right' &&
    Math.abs(displayEnd - geometry.originalEndTime) > 0.001
  ) {
    pushGhost('right', Math.min(displayEnd, geometry.originalEndTime), Math.max(displayEnd, geometry.originalEndTime));
  }

  return ghosts.length > 0 ? ghosts : undefined;
}

function createWorkerPreparedTrimVisualsResource(
  clip: CanvasClip,
  input: WorkerTrimVisualsInput,
): WorkerPreparedTrimVisualsResource | undefined {
  if (!input.clipTrim || input.clipTrim.clipId !== clip.id) return undefined;
  const geometry = resolveClipGeometry(clip, input);
  if (!geometry.visible) return undefined;

  const absoluteX = input.timeToPixel(geometry.startTime);
  const absoluteW = input.timeToPixel(geometry.duration);
  if (absoluteW <= 0) return undefined;

  const sourceExtensionGhosts = collectWorkerSourceExtensionGhosts(geometry, input);
  return {
    kind: 'trim-visuals',
    body: {
      x: absoluteX - input.canvasOffsetX,
      width: absoluteW,
    },
    sourceExtensionGhosts,
  };
}

interface CanvasClipBadge {
  label: string;
  fill: string;
  stroke?: string;
}

function getCanvasClipMediaFileId(clip: CanvasClip): string | null {
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

function getMediaFileCanvasStatus(
  clip: CanvasClip,
  mediaFileStatusById: MediaFileCanvasStatusMap,
): MediaFileCanvasStatus | undefined {
  const mediaFileId = getCanvasClipMediaFileId(clip);
  return mediaFileId ? mediaFileStatusById.get(mediaFileId) : undefined;
}

function collectCanvasClipBadges(clip: CanvasClip, mediaStatus?: MediaFileCanvasStatus): CanvasClipBadge[] {
  const badges: CanvasClipBadge[] = [];

  if (clip.downloadError) {
    badges.push({ label: 'ERR', fill: 'rgba(239, 68, 68, 0.92)' });
  } else if (clip.isPendingDownload) {
    badges.push({ label: 'DL', fill: 'rgba(59, 130, 246, 0.88)' });
  }

  if (mediaStatus?.proxyStatus === 'generating') {
    badges.push({ label: 'P', fill: 'rgba(59, 130, 246, 0.9)' });
  } else if (mediaStatus?.proxyStatus === 'ready') {
    badges.push({ label: 'P', fill: 'rgba(34, 197, 94, 0.86)' });
  } else if (mediaStatus?.proxyStatus === 'error') {
    badges.push({ label: 'P!', fill: 'rgba(239, 68, 68, 0.9)' });
  }

  if (mediaStatus?.audioProxyStatus === 'generating') {
    badges.push({ label: 'A', fill: 'rgba(14, 165, 233, 0.9)' });
  } else if (mediaStatus?.audioProxyStatus === 'ready' || mediaStatus?.hasProxyAudio) {
    badges.push({ label: 'A', fill: 'rgba(34, 197, 94, 0.82)' });
  } else if (mediaStatus?.audioProxyStatus === 'error') {
    badges.push({ label: 'A!', fill: 'rgba(239, 68, 68, 0.9)' });
  }

  if (clip.transcriptStatus === 'transcribing') {
    badges.push({ label: 'T', fill: 'rgba(168, 85, 247, 0.9)' });
  } else if (clip.transcriptStatus === 'ready' && clip.transcript?.length) {
    badges.push({ label: 'T', fill: 'rgba(99, 102, 241, 0.78)' });
  }

  if (clip.analysisStatus === 'analyzing') {
    badges.push({ label: 'AN', fill: 'rgba(245, 158, 11, 0.9)' });
  } else if (clip.analysisStatus === 'ready') {
    badges.push({ label: 'AN', fill: 'rgba(20, 184, 166, 0.78)' });
  }

  if (clip.reversed) {
    badges.push({ label: 'R', fill: 'rgba(15, 23, 42, 0.86)', stroke: 'rgba(255,255,255,0.35)' });
  }
  if (clip.linkedGroupId) {
    badges.push({ label: 'L', fill: 'rgba(15, 23, 42, 0.86)', stroke: 'rgba(255,255,255,0.35)' });
  }

  return badges;
}

function getCanvasClipBadgeReserve(badges: readonly CanvasClipBadge[]): number {
  if (badges.length === 0) return 0;
  return badges.reduce((total, badge) => total + Math.max(14, badge.label.length * 6 + 8), 0) + 6;
}

function drawCanvasClipBadges(
  ctx: CanvasRenderingContext2D,
  badges: readonly CanvasClipBadge[],
  x: number,
  top: number,
  w: number,
): void {
  if (badges.length === 0 || w < 28) return;

  ctx.save();
  ctx.font = '9px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let right = x + w - 5;
  for (let index = badges.length - 1; index >= 0; index -= 1) {
    const badge = badges[index];
    const badgeW = Math.max(14, badge.label.length * 6 + 8);
    const left = right - badgeW;
    if (left < x + 4) break;

    ctx.beginPath();
    ctx.roundRect(left, top + 4, badgeW, 14, 3);
    ctx.fillStyle = badge.fill;
    ctx.fill();
    if (badge.stroke) {
      ctx.strokeStyle = badge.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.fillText(badge.label, left + badgeW / 2, top + 11);
    right = left - 3;
  }

  ctx.restore();
}

function hasCanvasCompositionDecorations(clip: CanvasClip): boolean {
  return Boolean(
    clip.isComposition ||
    clip.compositionId ||
    clip.mixdownGenerating ||
    (clip.mixdownWaveform && clip.mixdownWaveform.length > 0) ||
    (clip.hasMixdownAudio && clip.waveform && clip.waveform.length > 0) ||
    (clip.nestedClipBoundaries && clip.nestedClipBoundaries.length > 0) ||
    (clip.clipSegments && clip.clipSegments.length > 0)
  );
}

function drawCanvasCompositionOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (w < 2 || h < 2) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(251, 146, 60, 0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.roundRect(x + 1, top + 1, Math.max(0, w - 2), Math.max(0, h - 2), Math.min(4, h / 4));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawCanvasNestedBoundaries(
  ctx: CanvasRenderingContext2D,
  boundaries: readonly number[] | undefined,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (!boundaries || boundaries.length === 0 || w < 4) return;

  ctx.save();
  ctx.strokeStyle = 'rgba(248, 113, 113, 0.86)';
  ctx.lineWidth = 1;
  for (const boundary of boundaries) {
    if (!Number.isFinite(boundary) || boundary <= 0 || boundary >= 1) continue;
    const lineX = x + boundary * w;
    ctx.beginPath();
    ctx.moveTo(lineX + 0.5, top + 2);
    ctx.lineTo(lineX + 0.5, top + h - 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCanvasSegmentThumbnails(
  ctx: CanvasRenderingContext2D,
  clip: CanvasClip,
  x: number,
  top: number,
  w: number,
  h: number,
  requestRedraw: () => void,
): number {
  const segments = clip.clipSegments;
  if (!segments || segments.length === 0 || w < LOD_THUMB_PX) return 0;

  let drawn = 0;
  for (const segment of segments) {
    const startNorm = Math.max(0, Math.min(1, segment.startNorm));
    const endNorm = Math.max(startNorm, Math.min(1, segment.endNorm));
    const segmentX = x + startNorm * w;
    const segmentW = Math.max(1, (endNorm - startNorm) * w);
    if (segmentW <= 0) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(segmentX, top, segmentW, h);
    ctx.clip();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
    ctx.fillRect(segmentX, top, segmentW, h);

    if (segment.thumbnails.length > 0) {
      const count = Math.max(1, Math.min(MAX_THUMB_SLOTS, Math.ceil(segmentW / CANVAS_THUMB_SLOT_PX)));
      const slotW = segmentW / count;
      for (let index = 0; index < count; index += 1) {
        const thumbIndex = Math.min(
          segment.thumbnails.length - 1,
          Math.floor((index / count) * segment.thumbnails.length),
        );
        const url = segment.thumbnails[thumbIndex];
        const bmp = getThumbnailBitmap(url);
        if (bmp) {
          drawCover(ctx, bmp, segmentX + index * slotW, top, slotW, h);
          drawn += 1;
        } else {
          ensureThumbnailBitmap(url, requestRedraw);
        }
      }
    }

    ctx.fillStyle = 'rgba(251, 146, 60, 0.18)';
    ctx.fillRect(segmentX, top, segmentW, h);
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(segmentX + 0.5, top + 0.5, Math.max(0, segmentW - 1), Math.max(0, h - 1));
    ctx.restore();
  }

  return drawn;
}

function drawCanvasMixdownWaveform(
  ctx: CanvasRenderingContext2D,
  clip: CanvasClip,
  geometry: CanvasClipGeometry,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  const waveform = (clip.mixdownWaveform && clip.mixdownWaveform.length > 0)
    ? clip.mixdownWaveform
    : clip.hasMixdownAudio && clip.waveform && clip.waveform.length > 0
      ? clip.waveform
      : null;

  if (!waveform || w < 8 || h < 18) return;

  const waveformHeight = Math.min(42, Math.max(16, h / 3));
  const waveformTop = top + Math.max(3, Math.floor((h - waveformHeight) / 2));
  drawAudioWaveform(
    ctx,
    {
      ...clip,
      waveform,
      waveformChannels: undefined,
      inPoint: geometry.inPoint,
      outPoint: geometry.outPoint,
      source: {
        ...(clip.source ?? {}),
        naturalDuration: Math.max(0.001, geometry.duration),
        type: 'audio',
      },
    },
    null,
    x,
    waveformTop,
    w,
    waveformHeight,
    'compact',
    1,
  );
}

function drawCanvasCompositionDecorations(
  ctx: CanvasRenderingContext2D,
  clip: CanvasClip,
  geometry: CanvasClipGeometry,
  x: number,
  top: number,
  w: number,
  h: number,
  requestRedraw: () => void,
): number {
  if (!hasCanvasCompositionDecorations(clip)) return 0;

  let thumbnailDrawCount = 0;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, Math.min(4, h / 4));
  ctx.clip();
  thumbnailDrawCount += drawCanvasSegmentThumbnails(ctx, clip, x, top, w, h, requestRedraw);
  drawCanvasMixdownWaveform(ctx, clip, geometry, x, top, w, h);
  if (clip.mixdownGenerating && w >= 72) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fillRect(x + 6, top + Math.max(4, h - 20), Math.min(118, w - 12), 15);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.font = '10px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Generating audio', x + 11, top + Math.max(11, h - 12));
  }
  drawCanvasNestedBoundaries(ctx, clip.nestedClipBoundaries, x, top, w, h);
  ctx.restore();

  if (clip.isComposition || clip.compositionId) {
    drawCanvasCompositionOutline(ctx, x, top, w, h);
  }

  return thumbnailDrawCount;
}

function drawCanvasClipProgressBars(
  ctx: CanvasRenderingContext2D,
  clip: CanvasClip,
  mediaStatus: MediaFileCanvasStatus | undefined,
  x: number,
  top: number,
  w: number,
): void {
  const bars = collectCanvasClipProgressBars(clip, mediaStatus);
  if (bars.length === 0 || w < 10) return;

  ctx.save();
  bars.slice(0, 3).forEach((bar, index) => {
    const y = top + 3 + index * 3;
    const progress = Math.max(0.02, Math.min(1, bar.progress / 100));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    ctx.fillRect(x + 4, y, Math.max(0, w - 8), 2);
    ctx.fillStyle = bar.color;
    ctx.fillRect(x + 4, y, Math.max(1, (w - 8) * progress), 2);
  });
  ctx.restore();
}

function collectCanvasClipProgressBars(
  clip: CanvasClip,
  mediaStatus: MediaFileCanvasStatus | undefined,
): Array<{ progress: number; color: string }> {
  const bars: Array<{ progress: number; color: string }> = [];
  if (clip.isPendingDownload && !clip.downloadError) {
    bars.push({ progress: clip.downloadProgress ?? 0, color: 'rgba(96, 165, 250, 0.9)' });
  }
  if (clip.transcriptStatus === 'transcribing') {
    bars.push({ progress: clip.transcriptProgress ?? 0, color: 'rgba(168, 85, 247, 0.85)' });
  }
  if (clip.analysisStatus === 'analyzing') {
    bars.push({ progress: clip.analysisProgress ?? 0, color: 'rgba(245, 158, 11, 0.9)' });
  }
  if (mediaStatus?.proxyStatus === 'generating') {
    bars.push({ progress: mediaStatus.proxyProgress ?? 0, color: 'rgba(59, 130, 246, 0.82)' });
  }
  if (mediaStatus?.audioProxyStatus === 'generating') {
    bars.push({ progress: mediaStatus.audioProxyProgress ?? 0, color: 'rgba(14, 165, 233, 0.82)' });
  }
  return bars;
}

function drawCanvasTranscriptMarkers(
  ctx: CanvasRenderingContext2D,
  clip: CanvasClip,
  geometry: CanvasClipGeometry,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  const transcript = clip.transcript;
  if (!transcript || transcript.length === 0 || w < 18) return;

  const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
  const markerTop = top + Math.max(4, h - 7);
  const markerHeight = 2;

  ctx.save();
  ctx.fillStyle = 'rgba(129, 140, 248, 0.82)';
  for (const word of transcript) {
    const wordStart = Math.max(geometry.inPoint, Math.min(geometry.outPoint, word.start));
    const wordEnd = Math.max(geometry.inPoint, Math.min(geometry.outPoint, word.end));
    if (wordEnd <= geometry.inPoint || wordStart >= geometry.outPoint || wordEnd <= wordStart) continue;

    const startRatio = clip.reversed
      ? (geometry.outPoint - wordEnd) / sourceSpan
      : (wordStart - geometry.inPoint) / sourceSpan;
    const endRatio = clip.reversed
      ? (geometry.outPoint - wordStart) / sourceSpan
      : (wordEnd - geometry.inPoint) / sourceSpan;
    const left = x + Math.max(0, Math.min(1, startRatio)) * w;
    const right = x + Math.max(0, Math.min(1, endRatio)) * w;
    const markerW = Math.max(1, right - left);
    ctx.fillRect(left, markerTop, markerW, markerHeight);
  }
  ctx.restore();
}

function drawCanvasAnalysisOverlay(
  ctx: CanvasRenderingContext2D,
  clip: CanvasClip,
  geometry: CanvasClipGeometry,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  const frames = clip.analysis?.frames;
  if (!frames || frames.length < 2 || w < 24 || isCanvasAudioClip(clip)) return;
  if (clip.analysisStatus !== 'ready' && clip.analysisStatus !== 'analyzing') return;

  const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
  const visibleFrames = frames
    .filter((frame) => frame.timestamp >= geometry.inPoint && frame.timestamp <= geometry.outPoint)
    .toSorted((a, b) => a.timestamp - b.timestamp);
  if (visibleFrames.length < 2) return;

  const maxPoints = Math.max(24, Math.min(320, Math.floor(w / 2)));
  const step = Math.max(1, Math.ceil(visibleFrames.length / maxPoints));
  const sampled = visibleFrames.filter((_, index) => index % step === 0);
  const lastFrame = visibleFrames[visibleFrames.length - 1];
  if (sampled[sampled.length - 1] !== lastFrame) sampled.push(lastFrame);

  const xForTime = (timestamp: number) => {
    const ratio = clip.reversed
      ? (geometry.outPoint - timestamp) / sourceSpan
      : (timestamp - geometry.inPoint) / sourceSpan;
    return x + Math.max(0, Math.min(1, ratio)) * w;
  };
  const graphTop = top + Math.max(12, h * 0.28);
  const graphHeight = Math.max(8, h - (graphTop - top) - 8);
  const yForValue = (value: number, multiplier: number) => {
    const normalized = Math.max(0, Math.min(1, value * multiplier));
    return graphTop + graphHeight - normalized * graphHeight * 0.82;
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const drawSeries = (
    valueForFrame: (frame: (typeof sampled)[number]) => number,
    multiplier: number,
    stroke: string,
    fill: string,
  ) => {
    ctx.beginPath();
    ctx.moveTo(xForTime(sampled[0].timestamp), graphTop + graphHeight);
    for (const frame of sampled) {
      ctx.lineTo(xForTime(frame.timestamp), yForValue(valueForFrame(frame), multiplier));
    }
    ctx.lineTo(xForTime(sampled[sampled.length - 1].timestamp), graphTop + graphHeight);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    sampled.forEach((frame, index) => {
      const px = xForTime(frame.timestamp);
      const py = yForValue(valueForFrame(frame), multiplier);
      if (index === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  };

  drawSeries((frame) => frame.focus ?? 0, 1, 'rgba(34, 197, 94, 0.82)', 'rgba(34, 197, 94, 0.12)');
  drawSeries((frame) => frame.globalMotion ?? frame.motion ?? 0, 1.5, 'rgba(59, 130, 246, 0.72)', 'rgba(59, 130, 246, 0.10)');

  ctx.fillStyle = 'rgba(250, 204, 21, 0.82)';
  for (const frame of sampled) {
    if ((frame.faceCount ?? 0) <= 0) continue;
    ctx.beginPath();
    ctx.arc(xForTime(frame.timestamp), top + 7, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawCanvasPassiveDecorations(
  ctx: CanvasRenderingContext2D,
  clip: CanvasClip,
  geometry: CanvasClipGeometry,
  mediaStatus: MediaFileCanvasStatus | undefined,
  badges: readonly CanvasClipBadge[],
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, Math.min(4, h / 4));
  ctx.clip();
  drawCanvasAnalysisOverlay(ctx, clip, geometry, x, top, w, h);
  drawCanvasTranscriptMarkers(ctx, clip, geometry, x, top, w, h);
  drawCanvasClipProgressBars(ctx, clip, mediaStatus, x, top, w);
  drawCanvasClipBadges(ctx, badges, x, top, w);
  ctx.restore();
}

function hasCanvasPassiveDecorations(clip: CanvasClip, mediaStatus?: MediaFileCanvasStatus): boolean {
  return Boolean(
    clip.isPendingDownload ||
    clip.downloadError ||
    clip.linkedGroupId ||
    clip.reversed ||
    (clip.transcriptStatus && clip.transcriptStatus !== 'none') ||
    (clip.analysisStatus && clip.analysisStatus !== 'none') ||
    mediaStatus?.proxyStatus === 'generating' ||
    mediaStatus?.proxyStatus === 'ready' ||
    mediaStatus?.proxyStatus === 'error' ||
    mediaStatus?.audioProxyStatus === 'generating' ||
    mediaStatus?.audioProxyStatus === 'ready' ||
    mediaStatus?.audioProxyStatus === 'error' ||
    mediaStatus?.hasProxyAudio
  );
}

const MAX_WORKER_TRANSCRIPT_MARKERS = 512;
const MAX_WORKER_ANALYSIS_POINTS = 320;

function createWorkerTranscriptMarkers(clip: CanvasClip): Float32Array | undefined {
  const transcript = clip.transcript;
  if (!transcript || transcript.length === 0) return undefined;
  const inPoint = clip.inPoint ?? 0;
  const outPoint = clip.outPoint ?? inPoint + clip.duration;
  const sourceSpan = Math.max(0.001, outPoint - inPoint);
  const values: number[] = [];

  for (const word of transcript) {
    const wordStart = Math.max(inPoint, Math.min(outPoint, word.start));
    const wordEnd = Math.max(inPoint, Math.min(outPoint, word.end));
    if (wordEnd <= inPoint || wordStart >= outPoint || wordEnd <= wordStart) continue;
    values.push(
      clip.reversed
        ? Math.max(0, Math.min(1, (outPoint - wordEnd) / sourceSpan))
        : Math.max(0, Math.min(1, (wordStart - inPoint) / sourceSpan)),
      clip.reversed
        ? Math.max(0, Math.min(1, (outPoint - wordStart) / sourceSpan))
        : Math.max(0, Math.min(1, (wordEnd - inPoint) / sourceSpan)),
    );
    if (values.length >= MAX_WORKER_TRANSCRIPT_MARKERS * 2) break;
  }

  return values.length > 0 ? Float32Array.from(values) : undefined;
}

function createWorkerAnalysisOverlay(
  clip: CanvasClip,
  clipWidth: number,
): NonNullable<TimelineClipCanvasWorkerPreparedClipResources['passiveDecorations']>['analysisOverlay'] | undefined {
  const frames = clip.analysis?.frames;
  if (!frames || frames.length < 2 || clipWidth < 24 || isCanvasAudioClip(clip)) return undefined;
  if (clip.analysisStatus !== 'ready' && clip.analysisStatus !== 'analyzing') return undefined;

  const inPoint = clip.inPoint ?? 0;
  const outPoint = clip.outPoint ?? inPoint + clip.duration;
  const sourceSpan = Math.max(0.001, outPoint - inPoint);
  const visibleFrames = frames
    .filter((frame) => frame.timestamp >= inPoint && frame.timestamp <= outPoint)
    .toSorted((a, b) => a.timestamp - b.timestamp);
  if (visibleFrames.length < 2) return undefined;

  const maxPoints = Math.max(24, Math.min(MAX_WORKER_ANALYSIS_POINTS, Math.floor(clipWidth / 2)));
  const step = Math.max(1, Math.ceil(visibleFrames.length / maxPoints));
  const sampled = visibleFrames.filter((_, index) => index % step === 0);
  const lastFrame = visibleFrames[visibleFrames.length - 1];
  if (sampled[sampled.length - 1] !== lastFrame) sampled.push(lastFrame);

  const values: number[] = [];
  for (const frame of sampled) {
    const ratio = clip.reversed
      ? Math.max(0, Math.min(1, (outPoint - frame.timestamp) / sourceSpan))
      : Math.max(0, Math.min(1, (frame.timestamp - inPoint) / sourceSpan));
    values.push(
      ratio,
      Math.max(0, Math.min(1, frame.focus ?? 0)),
      Math.max(0, Math.min(1, (frame.globalMotion ?? frame.motion ?? 0) * 1.5)),
      (frame.faceCount ?? 0) > 0 ? 1 : 0,
    );
  }

  return values.length >= 8
    ? {
      kind: 'analysis-overlay',
      points: Float32Array.from(values),
      pointCount: sampled.length,
    }
    : undefined;
}

function createWorkerPreparedPassiveDecorationsResource(
  clip: CanvasClip,
  mediaStatus?: MediaFileCanvasStatus,
  clipWidth = 0,
): TimelineClipCanvasWorkerPreparedClipResources['passiveDecorations'] | undefined {
  const badges = collectCanvasClipBadges(clip, mediaStatus);
  const progressBars = collectCanvasClipProgressBars(clip, mediaStatus);
  const transcriptMarkers = createWorkerTranscriptMarkers(clip);
  const analysisOverlay = createWorkerAnalysisOverlay(clip, clipWidth);
  if (badges.length === 0 && progressBars.length === 0 && !transcriptMarkers && !analysisOverlay) return undefined;
  return {
    kind: 'passive-decorations',
    badges,
    progressBars,
    transcriptMarkers,
    analysisOverlay,
  };
}

/** Cover-fit draw of a bitmap into a destination rect, clipped by the caller. */
function drawCover(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bmp: ImageBitmap,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const scale = Math.max(dw / bmp.width, dh / bmp.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (bmp.width - sw) / 2;
  const sy = (bmp.height - sh) / 2;
  ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawThumbnails(
  ctx: CanvasRenderingContext2D,
  clip: CanvasClip,
  mediaFileId: string,
  x: number,
  top: number,
  w: number,
  h: number,
  requestRedraw: () => void,
): number {
  const count = Math.max(1, Math.min(MAX_THUMB_SLOTS, Math.floor(w / CANVAS_THUMB_SLOT_PX)));
  const urls = thumbnailCacheService.getThumbnailsForRange(
    mediaFileId,
    clip.inPoint ?? 0,
    clip.outPoint ?? (clip.inPoint ?? 0) + clip.duration,
    count,
    clip.reversed,
  );
  const slotW = w / count;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const url = urls[i];
    if (!url) continue;
    const bmp = getThumbnailBitmap(url);
    if (bmp) {
      drawCover(ctx, bmp, x + i * slotW, top, slotW, h);
      drawn += 1;
    } else {
      ensureThumbnailBitmap(url, requestRedraw, mediaFileId);
    }
  }
  return drawn;
}

interface WorkerThumbnailStripPlan {
  clipId: string;
  mediaFileId: string;
  x: number;
  width: number;
  height: number;
  bitmapWidth: number;
  bitmapHeight: number;
  urls: readonly (string | null)[];
}

interface WorkerThumbnailPreparation {
  handledClipIds: ReadonlySet<string>;
  plansByClipId: ReadonlyMap<string, WorkerThumbnailStripPlan>;
  missingBitmapRefs: readonly { url: string; mediaFileId?: string }[];
}

const WORKER_THUMBNAIL_STRIP_MAX_WIDTH = 2048;
const WORKER_THUMBNAIL_STRIP_MAX_HEIGHT = 128;
const WORKER_COMPOSITION_SEGMENT_MAX_COUNT = 128;
const WORKER_COMPOSITION_BOUNDARY_MAX_COUNT = 512;

function collectWorkerThumbnailPreparation(input: {
  clips: readonly CanvasClip[];
  trackId: string;
  height: number;
  cssWidth: number;
  canvasOffsetX: number;
  scrollX: number;
  viewportWidth: number;
  timeToPixel: (time: number) => number;
  clipDrag?: ClipDragState | null;
  clipDragPreview?: TimelineClipDragPreview | null;
  clipTrim?: ClipTrimState | null;
}): WorkerThumbnailPreparation {
  const handledClipIds = new Set<string>();
  const plansByClipId = new Map<string, WorkerThumbnailStripPlan>();
  const missingBitmapRefsByUrl = new Map<string, { url: string; mediaFileId?: string }>();
  const thumbVisibleLeft = input.scrollX - THUMBNAIL_VIEWPORT_OVERSCAN_PX;
  const thumbVisibleRight = input.scrollX + input.viewportWidth + THUMBNAIL_VIEWPORT_OVERSCAN_PX;
  const renderVisibleLeft = input.scrollX - CANVAS_RENDER_OVERSCAN_PX;
  const renderVisibleRight = input.scrollX + input.viewportWidth + CANVAS_RENDER_OVERSCAN_PX;
  const h = Math.max(1, input.height - 2);

  for (const clip of input.clips) {
    if (clip.clipSegments?.length) {
      const geometry = resolveClipGeometry(clip, input);
      if (geometry.visible) {
        const absoluteX = input.timeToPixel(geometry.startTime);
        const absoluteW = input.timeToPixel(geometry.duration);
        const absoluteRight = absoluteX + absoluteW;
        const visibleAbsLeft = Math.max(absoluteX, input.canvasOffsetX, renderVisibleLeft);
        const visibleAbsRight = Math.min(absoluteRight, input.canvasOffsetX + input.cssWidth, renderVisibleRight);
        const visibleW = visibleAbsRight - visibleAbsLeft;
        const inThumbWindow = absoluteRight > thumbVisibleLeft && absoluteX < thumbVisibleRight;
        if (absoluteW > 0 && visibleW >= LOD_THUMB_PX && inThumbWindow) {
          clip.clipSegments.slice(0, WORKER_COMPOSITION_SEGMENT_MAX_COUNT).forEach((segment) => {
            segment.thumbnails.forEach((url) => {
              if (!url || hasThumbnailBitmap(url)) return;
              missingBitmapRefsByUrl.set(url, { url, mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId });
            });
          });
        }
      }
    }

    const mediaFileId = clipShowsThumbnails(clip);
    if (!mediaFileId) continue;
    if (clip.isComposition && clip.clipSegments?.length) continue;

    const geometry = resolveClipGeometry(clip, input);
    if (!geometry.visible) {
      handledClipIds.add(clip.id);
      continue;
    }

    const absoluteX = input.timeToPixel(geometry.startTime);
    const absoluteW = input.timeToPixel(geometry.duration);
    const absoluteRight = absoluteX + absoluteW;
    if (absoluteW <= 0) {
      handledClipIds.add(clip.id);
      continue;
    }

    const visibleAbsLeft = Math.max(absoluteX, input.canvasOffsetX, renderVisibleLeft);
    const visibleAbsRight = Math.min(absoluteRight, input.canvasOffsetX + input.cssWidth, renderVisibleRight);
    const visibleW = visibleAbsRight - visibleAbsLeft;
    const inThumbWindow = absoluteRight > thumbVisibleLeft && absoluteX < thumbVisibleRight;
    if (visibleW < LOD_THUMB_PX || !inThumbWindow) {
      handledClipIds.add(clip.id);
      continue;
    }

    const visibleStartRatio = Math.max(0, Math.min(1, (visibleAbsLeft - absoluteX) / Math.max(1, absoluteW)));
    const visibleEndRatio = Math.max(visibleStartRatio, Math.min(1, (visibleAbsRight - absoluteX) / Math.max(1, absoluteW)));
    const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
    const visibleInPoint = geometry.inPoint + sourceSpan * visibleStartRatio;
    const visibleOutPoint = geometry.inPoint + sourceSpan * visibleEndRatio;
    const count = Math.max(1, Math.min(MAX_THUMB_SLOTS, Math.floor(visibleW / CANVAS_THUMB_SLOT_PX)));
    const urls = thumbnailCacheService.getThumbnailsForRange(
      mediaFileId,
      visibleInPoint,
      visibleOutPoint,
      count,
      clip.reversed,
    );
    if (!urls.some((url) => Boolean(url))) {
      handledClipIds.add(clip.id);
      continue;
    }
    let hasMissingBitmap = false;
    urls.forEach((url) => {
      if (!url || hasThumbnailBitmap(url)) return;
      hasMissingBitmap = true;
      missingBitmapRefsByUrl.set(url, { url, mediaFileId });
    });
    if (hasMissingBitmap) {
      handledClipIds.add(clip.id);
      continue;
    }

    handledClipIds.add(clip.id);
    plansByClipId.set(clip.id, {
      clipId: clip.id,
      mediaFileId,
      x: visibleAbsLeft - input.canvasOffsetX,
      width: visibleW,
      height: h,
      bitmapWidth: Math.max(1, Math.min(WORKER_THUMBNAIL_STRIP_MAX_WIDTH, Math.round(visibleW))),
      bitmapHeight: Math.max(1, Math.min(WORKER_THUMBNAIL_STRIP_MAX_HEIGHT, Math.round(h))),
      urls,
    });
  }

  return {
    handledClipIds,
    plansByClipId,
    missingBitmapRefs: [...missingBitmapRefsByUrl.values()],
  };
}

function createWorkerPreparedThumbnailStripResource(
  plan: WorkerThumbnailStripPlan,
): TimelineClipCanvasWorkerPreparedClipResources['thumbnailStrip'] | undefined {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const canvas = new OffscreenCanvas(plan.bitmapWidth, plan.bitmapHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  const slotWidth = plan.bitmapWidth / plan.urls.length;
  let drawCount = 0;
  for (let index = 0; index < plan.urls.length; index += 1) {
    const url = plan.urls[index];
    if (!url) continue;
    const bitmap = getThumbnailBitmap(url);
    if (!bitmap) continue;
    drawCover(ctx, bitmap, index * slotWidth, 0, slotWidth, plan.bitmapHeight);
    drawCount += 1;
  }
  if (drawCount === 0) return undefined;

  return {
    kind: 'thumbnail-strip',
    bitmap: canvas.transferToImageBitmap(),
    x: plan.x,
    width: plan.width,
    height: plan.height,
    drawCount,
  };
}

function createWorkerPreparedThumbnailResourcesByClipId(
  plansByClipId: ReadonlyMap<string, WorkerThumbnailStripPlan>,
): ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources> | undefined {
  if (plansByClipId.size === 0) return undefined;
  const resourcesByClipId = new Map<string, TimelineClipCanvasWorkerPreparedClipResources>();
  for (const [clipId, plan] of plansByClipId) {
    const thumbnailStrip = createWorkerPreparedThumbnailStripResource(plan);
    if (thumbnailStrip) {
      resourcesByClipId.set(clipId, { thumbnailStrip });
    }
  }
  return resourcesByClipId.size > 0 ? resourcesByClipId : undefined;
}

function mergeWorkerPreparedResourcesByClipId(
  base: ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources> | undefined,
  transient: ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources> | undefined,
): ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources> | undefined {
  if (!base) return transient;
  if (!transient) return base;
  const merged = new Map<string, TimelineClipCanvasWorkerPreparedClipResources>();
  base.forEach((resources, clipId) => {
    merged.set(clipId, resources);
  });
  transient.forEach((resources, clipId) => {
    merged.set(clipId, {
      ...(merged.get(clipId) ?? {}),
      ...resources,
    });
  });
  return merged;
}

function getWorkerDrawThumbnailCounts(
  message: NonNullable<ReturnType<typeof buildTimelineClipCanvasWorkerDrawMessage>['message']>,
): { thumbnailClipCount: number; thumbnailDrawCount: number } {
  let thumbnailClipCount = 0;
  let thumbnailDrawCount = 0;
  message.clips.forEach((clip) => {
    if (!clip.thumbnailStrip) return;
    thumbnailClipCount += 1;
    thumbnailDrawCount += clip.thumbnailStrip.drawCount;
  });
  return { thumbnailClipCount, thumbnailDrawCount };
}

function closeUnpostedWorkerDrawResources(pending: PendingTimelineClipCanvasWorkerDraw | null): void {
  if (!pending || pending.posted) return;
  pending.message.clips.forEach((clip) => {
    clip.thumbnailStrip?.bitmap.close();
    clip.compositionVisuals?.segmentThumbnailStrip?.bitmap.close();
  });
}

function drawClips(
  ctx: CanvasRenderingContext2D,
  props: TimelineClipCanvasProps,
  cssWidth: number,
  canvasOffsetX: number,
  mediaFileStatusById: MediaFileCanvasStatusMap,
  requestRedraw: () => void,
): TimelineCanvasDrawDiagnostics {
  const { clips, height, timeToPixel, selectedClipIds, hoveredClipId, trackColor, scrollX, viewportWidth, waveformsEnabled, audioDisplayMode = 'detailed', waveformPyramids, spectrogramTileSets } = props;
  ctx.clearRect(0, 0, cssWidth, height);
  const diagnostics: TimelineCanvasDrawDiagnostics = {
    inputClipCount: clips.length,
    visibleClipCount: 0,
    drawnClipCount: 0,
    thumbnailClipCount: 0,
    thumbnailDrawCount: 0,
    waveformClipCount: 0,
    workerMode: false,
  };

  const thumbVisibleLeft = scrollX - THUMBNAIL_VIEWPORT_OVERSCAN_PX;
  const thumbVisibleRight = scrollX + viewportWidth + THUMBNAIL_VIEWPORT_OVERSCAN_PX;
  const renderVisibleLeft = scrollX - CANVAS_RENDER_OVERSCAN_PX;
  const renderVisibleRight = scrollX + viewportWidth + CANVAS_RENDER_OVERSCAN_PX;

  const radius = Math.min(4, height / 4);
  const fill = withAlpha(trackColor, 0.55);
  const fillSelected = withAlpha(trackColor, 0.85);
  const border = withAlpha(trackColor, 0.9);
  const selectedBorder = '#ffffff';

  ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';

  for (const clip of clips) {
    const geometry = resolveClipGeometry(clip, props);
    if (!geometry.visible) continue;
    diagnostics.visibleClipCount += 1;
    const absoluteX = timeToPixel(geometry.startTime);
    const absoluteW = timeToPixel(geometry.duration);
    const absoluteRight = absoluteX + absoluteW;
    const visibleAbsLeft = Math.max(absoluteX, canvasOffsetX, renderVisibleLeft);
    const visibleAbsRight = Math.min(absoluteRight, canvasOffsetX + cssWidth, renderVisibleRight);
    const visibleW = visibleAbsRight - visibleAbsLeft;
    if (visibleW <= 0) continue;
    diagnostics.drawnClipCount += 1;

    const x = absoluteX - canvasOffsetX;
    const visibleX = visibleAbsLeft - canvasOffsetX;
    const w = absoluteW;
    if (w < LOD_BAR_PX) {
      ctx.fillStyle = selectedClipIds.has(clip.id) ? fillSelected : fill;
      ctx.fillRect(x, 1, Math.max(1, w), height - 2);
      continue;
    }

    const selected = selectedClipIds.has(clip.id);
    const hovered = hoveredClipId === clip.id;
    const mediaStatus = getMediaFileCanvasStatus(clip, mediaFileStatusById);
    const badges = collectCanvasClipBadges(clip, mediaStatus);
    const top = 1;
    const h = height - 2;

    // Rounded clip body fill.
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.fillStyle = selected ? fillSelected : fill;
    ctx.fill();

    if (waveformsEnabled && isCanvasAudioClip(clip)) {
      diagnostics.waveformClipCount += 1;
      const waveformPyramid = getWaveformPyramidForClip(clip, waveformPyramids);
      const visibleStartRatio = Math.max(0, Math.min(1, (visibleAbsLeft - absoluteX) / Math.max(1, absoluteW)));
      const visibleEndRatio = Math.max(visibleStartRatio, Math.min(1, (visibleAbsRight - absoluteX) / Math.max(1, absoluteW)));
      const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
      const visibleAudioClip = {
        ...clip,
        inPoint: geometry.inPoint + sourceSpan * visibleStartRatio,
        outPoint: geometry.inPoint + sourceSpan * visibleEndRatio,
      };
      let drewSpectrogram = false;
      if (audioDisplayMode === 'spectral') {
        const { refId, tileSet, variant } = getSpectrogramTileSetForClip(clip, spectrogramTileSets);
        const spectrogramDuration = Math.max(0.001, tileSet?.duration ?? clip.source?.naturalDuration ?? geometry.outPoint);
        const spectrogramRange = resolveTimelineSpectrogramSourceRange({
          variant,
          visibleSourceInPoint: visibleAudioClip.inPoint,
          visibleSourceOutPoint: visibleAudioClip.outPoint,
          tileDuration: spectrogramDuration,
          visibleStartRatio,
          visibleEndRatio,
        });
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, top, w, h, radius);
        ctx.clip();
        const result = drawTimelineSpectrogram(ctx, {
          tileSet,
          cacheKey: refId,
          x: visibleX,
          y: top,
          clipWidth: visibleW,
          height: h,
          inPoint: spectrogramRange.inPoint,
          outPoint: spectrogramRange.outPoint,
          naturalDuration: spectrogramRange.naturalDuration,
          renderStartPx: 0,
          renderWidth: visibleW,
        });
        drewSpectrogram = result.drawn;
        ctx.restore();
      }

      if (!drewSpectrogram) {
        drawAudioWaveform(
          ctx,
          visibleAudioClip,
          waveformPyramid,
          visibleX,
          top,
          visibleW,
          h,
          audioDisplayMode,
          timeToPixel(1),
        );
      }
    }

    // Filmstrip thumbnails clipped to the body — only for clips in the viewport,
    // so opening a large comp doesn't decode every clip's thumbnails at once.
    const hasCompositionSegments = Boolean(clip.isComposition && clip.clipSegments?.length);
    if (hasCompositionSegments) {
      diagnostics.thumbnailClipCount += 1;
    }

    const inThumbWindow = absoluteRight > thumbVisibleLeft && absoluteX < thumbVisibleRight;
    const mediaFileId = (visibleW >= LOD_THUMB_PX && inThumbWindow && !hasCompositionSegments) ? clipShowsThumbnails(clip) : null;
    if (mediaFileId) {
      diagnostics.thumbnailClipCount += 1;
      const visibleStartRatio = Math.max(0, Math.min(1, (visibleAbsLeft - absoluteX) / Math.max(1, absoluteW)));
      const visibleEndRatio = Math.max(visibleStartRatio, Math.min(1, (visibleAbsRight - absoluteX) / Math.max(1, absoluteW)));
      const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
      const visibleClip = {
        ...clip,
        inPoint: geometry.inPoint + sourceSpan * visibleStartRatio,
        outPoint: geometry.inPoint + sourceSpan * visibleEndRatio,
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(visibleX, top, visibleW, h);
      ctx.clip();
      diagnostics.thumbnailDrawCount += drawThumbnails(ctx, visibleClip, mediaFileId, visibleX, top, visibleW, h, requestRedraw);
      // Darken bottom strip so the label stays readable over thumbnails.
      const grad = ctx.createLinearGradient(0, top + h - 16, 0, top + h);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(visibleX, top + h - 16, visibleW, 16);
      ctx.restore();
    }

    const compositionThumbnailDrawCount = drawCanvasCompositionDecorations(ctx, clip, geometry, x, top, w, h, requestRedraw);
    if (compositionThumbnailDrawCount > 0) {
      diagnostics.thumbnailDrawCount += compositionThumbnailDrawCount;
    }

    drawSourceExtensionGhosts(ctx, props, geometry, top, h, renderVisibleLeft, renderVisibleRight, canvasOffsetX);
    drawCanvasFadeCurve(ctx, clip.fade, x, top, w, h);
    drawCanvasPassiveDecorations(ctx, clip, geometry, mediaStatus, badges, x, top, w, h);

    // Border.
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.lineWidth = selected ? 2 : hovered ? 1.5 : 1;
    ctx.strokeStyle = selected ? selectedBorder : hovered ? 'rgba(255,255,255,0.58)' : border;
    ctx.stroke();

    // Label, only when there is room.
    if (visibleW >= LOD_LABEL_PX && clip.name) {
      const labelLeft = Math.max(x + 5, visibleX + 5);
      const badgeReserve = Math.min(w * 0.45, getCanvasClipBadgeReserve(badges));
      const labelRight = Math.min(x + w - 5 - badgeReserve, visibleX + visibleW - 5);
      const labelW = labelRight - labelLeft;
      if (labelW <= 4) continue;

      ctx.save();
      ctx.beginPath();
      ctx.rect(labelLeft, top, labelW, h);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillText(clip.name, labelLeft + 1, mediaFileId ? top + h - 8 : top + h / 2);
      ctx.restore();
    }
  }

  return diagnostics;
}

function TimelineClipCanvasComponent(props: TimelineClipCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const thumbnailRedrawRafRef = useRef<number | null>(null);
  const visibleThumbnailSecondRangesRef = useRef<VisibleThumbnailSecondRangeMap>(new Map());
  const [redrawNonce, bumpRedraw] = useReducer((n: number) => n + 1, 0);
  const [spectrogramRetryNonce, bumpSpectrogramRetry] = useReducer((n: number) => n + 1, 0);
  const {
    clips,
    trackId,
    height,
    contentWidth,
    timeToPixel,
    selectedClipIds,
    hoveredClipId,
    trackColor,
    scrollX,
    viewportWidth,
    waveformsEnabled,
    audioDisplayMode,
    clipDrag,
    clipDragPreview,
    clipTrim,
  } = props;
  // Quantize scroll so we only redraw (to load newly-visible thumbnails) every
  // ~200px scrolled, not every pixel; the THUMBNAIL_VIEWPORT_OVERSCAN_PX covers
  // the gap. The draw still uses the exact scrollX for the window.
  const scrollBucket = Math.round(scrollX / 200);
  const canvasOffsetX = Math.max(0, scrollBucket * 200 - CANVAS_RENDER_OVERSCAN_PX);
  const cssWidth = Math.max(
    1,
    Math.min(
      MAX_CANVAS_WIDTH_PX,
      Math.ceil(viewportWidth + CANVAS_RENDER_OVERSCAN_PX * 2),
    ),
  );
  const visibleWaveformClips = useMemo(() => {
    if (!waveformsEnabled) return [] as readonly CanvasClip[];
    const visibleLeft = scrollX - CANVAS_RENDER_OVERSCAN_PX;
    const visibleRight = scrollX + viewportWidth + CANVAS_RENDER_OVERSCAN_PX;
    return clips.filter((clip) => {
      if (!isCanvasAudioClip(clip)) return false;
      const x = timeToPixel(clip.startTime);
      const w = timeToPixel(clip.duration);
      return x + w >= visibleLeft && x <= visibleRight;
    });
  }, [clips, scrollX, timeToPixel, viewportWidth, waveformsEnabled]);

  const visibleWaveformArtifactRefs = useMemo(
    () => audioDisplayMode === 'spectral' ? [] : collectTimelineWaveformArtifactRefs(visibleWaveformClips),
    [audioDisplayMode, visibleWaveformClips],
  );
  const visibleSpectrogramArtifactRefs = useMemo(
    () => audioDisplayMode === 'spectral' ? collectTimelineSpectrogramArtifactRefs(visibleWaveformClips) : [],
    [audioDisplayMode, visibleWaveformClips],
  );
  const visibleSourceWaveformGenerationRequests = useMemo(() => {
    if (!waveformsEnabled || clipDrag || clipDragPreview) return [];
    if (audioDisplayMode !== 'detailed') {
      const shouldUpgradeCompact =
        audioDisplayMode === 'compact' &&
        (timeToPixel(1) >= WAVEFORM_PYRAMID_AUTO_UPGRADE_ZOOM || cssWidth > WAVEFORM_PYRAMID_AUTO_UPGRADE_WIDTH);
      if (!shouldUpgradeCompact) return [];
    }

    return collectVisibleTimelineSourceWaveformGenerationRequests({
      clips: visibleWaveformClips,
      scrollX,
      viewportWidth,
      overscanPx: CANVAS_RENDER_OVERSCAN_PX,
      timeToPixel,
      mode: audioDisplayMode,
    });
  }, [
    audioDisplayMode,
    clipDrag,
    clipDragPreview,
    cssWidth,
    scrollX,
    timeToPixel,
    viewportWidth,
    visibleWaveformClips,
    waveformsEnabled,
  ]);
  const visibleSourceWaveformGenerationKey = useMemo(
    () => visibleSourceWaveformGenerationRequests.map((request) => request.requestKey).join('|'),
    [visibleSourceWaveformGenerationRequests],
  );
  const waveformRefKey = useMemo(
    () => visibleWaveformArtifactRefs.join('|'),
    [visibleWaveformArtifactRefs],
  );
  const spectrogramRefKey = useMemo(
    () => visibleSpectrogramArtifactRefs.join('|'),
    [visibleSpectrogramArtifactRefs],
  );
  const [waveformPyramids, setWaveformPyramids] = useState<Map<string, TimelineWaveformPyramid | null>>(() => new Map());
  const [spectrogramTileSets, setSpectrogramTileSets] = useState<Map<string, TimelineSpectrogramTileSet | null>>(() => new Map());
  const waveformPyramidsRef = useRef<WaveformPyramidMap>(waveformPyramids);
  const spectrogramTileSetsRef = useRef<SpectrogramTileSetMap>(spectrogramTileSets);
  const spectrogramMissedAtRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    return () => {
      unregisterTimelineCanvasDrawDiagnostics(trackId);
    };
  }, [trackId]);

  useEffect(() => {
    waveformPyramidsRef.current = waveformPyramids;
  }, [waveformPyramids]);
  useEffect(() => {
    spectrogramTileSetsRef.current = spectrogramTileSets;
  }, [spectrogramTileSets]);

  const mediaFilesState = useMediaStore((state) => state.files);
  const mediaFiles = useMemo(
    () => (Array.isArray(mediaFilesState) ? mediaFilesState : []),
    [mediaFilesState],
  );
  const mediaFileStatusById = useMemo(() => {
    const map = new Map<string, MediaFileCanvasStatus>();
    for (const file of mediaFiles) {
      map.set(file.id, {
        proxyStatus: file.proxyStatus,
        proxyProgress: file.proxyProgress,
        audioProxyStatus: file.audioProxyStatus,
        audioProxyProgress: file.audioProxyProgress,
        hasProxyAudio: file.hasProxyAudio,
      });
    }
    return map;
  }, [mediaFiles]);
  const workerThumbnailPreparation = useMemo(
    () => {
      void redrawNonce;
      return collectWorkerThumbnailPreparation({
        clips,
        trackId,
        height,
        cssWidth,
        canvasOffsetX,
        scrollX,
        viewportWidth,
        timeToPixel,
        clipDrag,
        clipDragPreview,
        clipTrim,
      });
    },
    [canvasOffsetX, clipDrag, clipDragPreview, clipTrim, clips, cssWidth, height, redrawNonce, scrollX, timeToPixel, trackId, viewportWidth],
  );
  useEffect(() => {
    if (workerThumbnailPreparation.missingBitmapRefs.length === 0) return;
    workerThumbnailPreparation.missingBitmapRefs.forEach(({ url, mediaFileId }) => {
      ensureThumbnailBitmap(url, bumpRedraw, mediaFileId);
    });
  }, [workerThumbnailPreparation.missingBitmapRefs]);
  const workerPreparedResourcesByClipId = useMemo(
    () => createWorkerPreparedResourcesByClipId(
      clips,
      waveformPyramids,
      spectrogramTileSets,
      mediaFileStatusById,
      waveformsEnabled,
      audioDisplayMode,
      height,
      trackId,
      cssWidth,
      canvasOffsetX,
      scrollX,
      viewportWidth,
      timeToPixel,
      clipDrag,
      clipDragPreview,
      clipTrim,
    ),
    [audioDisplayMode, canvasOffsetX, clipDrag, clipDragPreview, clipTrim, clips, cssWidth, height, mediaFileStatusById, scrollX, spectrogramTileSets, timeToPixel, trackId, viewportWidth, waveformPyramids, waveformsEnabled],
  );
  const workerDrawableClips = useMemo(
    () => createWorkerDrawableClips(clips, {
      trackId,
      clipDrag,
      clipDragPreview,
      clipTrim,
    }),
    [clips, trackId, clipDrag, clipDragPreview, clipTrim],
  );
  const passiveDecorationClipIds = useMemo(() => {
    const ids = new Set<string>();
    workerDrawableClips.forEach((clip) => {
      if (hasCanvasPassiveDecorations(clip, getMediaFileCanvasStatus(clip, mediaFileStatusById))) {
        ids.add(clip.id);
      }
    });
    return ids;
  }, [mediaFileStatusById, workerDrawableClips]);
  const hasPassiveDecorations = passiveDecorationClipIds.size > 0;
  const workerEligibility = useMemo(() => getTimelineClipCanvasWorkerEligibility({
    clips: workerDrawableClips,
    waveformsEnabled,
    audioDisplayMode,
    preparedResourcesByClipId: workerPreparedResourcesByClipId,
    preparedThumbnailClipIds: workerThumbnailPreparation.handledClipIds,
    passiveDecorationClipIds,
    hasPassiveDecorations,
    hasClipTrim: Boolean(clipTrim),
    activeTrimClipId: clipTrim?.clipId ?? null,
  }), [audioDisplayMode, clipTrim, hasPassiveDecorations, passiveDecorationClipIds, waveformsEnabled, workerDrawableClips, workerPreparedResourcesByClipId, workerThumbnailPreparation.handledClipIds]);
  const hasWorkerCanvasSupport = typeof Worker !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
  // Phase 4: optionally render in an OffscreenCanvas worker (off main thread).
  const rawWorkerMode = flags.timelineCanvasWorker && hasWorkerCanvasSupport && workerEligibility.eligible;
  const [workerRuntimeFallbackReason, setWorkerRuntimeFallbackReason] = useState<string | null>(null);
  const [workerCanvasGeneration, bumpWorkerCanvasGeneration] = useReducer((value: number) => value + 1, 0);
  const workerMode = rawWorkerMode && workerRuntimeFallbackReason === null;
  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef(false);
  const workerTransferredCanvasRef = useRef(false);
  const mainThreadCanvasContextInitializedRef = useRef(false);
  const workerDrawRequestIdRef = useRef(0);
  const pendingWorkerDrawRef = useRef<PendingTimelineClipCanvasWorkerDraw | null>(null);
  const publishWorkerDrawDiagnostics = useCallback((
    pending: PendingTimelineClipCanvasWorkerDraw,
    runtime: {
      pendingDraw: boolean;
      drawnClipCount?: number;
      thumbnailClipCount?: number;
      thumbnailDrawCount?: number;
      drawMs?: number;
      resourceBytes?: number;
      error?: string;
    },
  ) => {
    reportTimelineCanvasDrawDiagnostics(pending.trackId, {
      inputClipCount: pending.inputClipCount,
      visibleClipCount: pending.visibleClipCount,
      drawnClipCount: runtime.drawnClipCount ?? pending.visibleClipCount,
      thumbnailClipCount: runtime.thumbnailClipCount ?? pending.thumbnailClipCount,
      thumbnailDrawCount: runtime.thumbnailDrawCount ?? pending.thumbnailDrawCount,
      waveformClipCount: 0,
      workerMode: runtime.error ? false : true,
      workerEligible: true,
      workerPendingDraw: runtime.pendingDraw,
      workerDrawMs: runtime.drawMs,
      workerResourceBytes: runtime.resourceBytes,
      workerError: runtime.error,
      workerFallbackReasons: runtime.error ? [runtime.error] : undefined,
    });
  }, []);
  const enterWorkerRuntimeFallback = useCallback((reason: string) => {
    const worker = workerRef.current;
    if (worker) {
      worker.terminate();
    }
    workerRef.current = null;
    workerReadyRef.current = false;

    const pending = pendingWorkerDrawRef.current;
    if (pending) {
      publishWorkerDrawDiagnostics(pending, {
        pendingDraw: false,
        error: reason,
      });
      closeUnpostedWorkerDrawResources(pending);
    }

    if (workerTransferredCanvasRef.current) {
      workerTransferredCanvasRef.current = false;
      bumpWorkerCanvasGeneration();
    }
    setWorkerRuntimeFallbackReason((current) => current ?? reason);
  }, [publishWorkerDrawDiagnostics]);
  const mediaFileHashById = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const file of mediaFiles) {
      map.set(file.id, file.fileHash);
    }
    return map;
  }, [mediaFiles]);
  const visibleThumbnailRefs = useMemo<VisibleTimelineThumbnailRef[]>(() => {
    return collectVisibleTimelineThumbnailRefs({
      clips,
      scrollX,
      viewportWidth,
      overscanPx: THUMBNAIL_VIEWPORT_OVERSCAN_PX,
      timeToPixel,
      mediaFileHashById,
    });
  }, [clips, mediaFileHashById, scrollX, timeToPixel, viewportWidth]);
  const visibleThumbnailSecondRanges = useMemo(
    () => collectVisibleThumbnailSecondRanges({
      clips,
      trackId,
      scrollX,
      viewportWidth,
      timeToPixel,
      clipDrag,
      clipDragPreview,
      clipTrim,
    }),
    [clips, clipDrag, clipDragPreview, clipTrim, scrollX, timeToPixel, trackId, viewportWidth],
  );
  const visibleAudioArtifactClipIds = useMemo(
    () => collectVisibleAudioArtifactClipIds({
      clips,
      trackId,
      scrollX,
      viewportWidth,
      timeToPixel,
      clipDrag,
      clipDragPreview,
      clipTrim,
    }),
    [clips, clipDrag, clipDragPreview, clipTrim, scrollX, timeToPixel, trackId, viewportWidth],
  );
  const visibleAudioArtifactClipIdKey = visibleAudioArtifactClipIds.join('|');
  const visibleAudioAnalysisArtifactRefs = useMemo(() => {
    if (!waveformsEnabled || visibleAudioArtifactClipIds.length === 0) return [];
    const visibleClipIds = new Set(visibleAudioArtifactClipIds);
    return collectTimelineAudioAnalysisArtifactRefs(
      clips.filter((clip) => visibleClipIds.has(clip.id)),
    );
  }, [clips, visibleAudioArtifactClipIds, waveformsEnabled]);
  const audioAnalysisArtifactRefKey = useMemo(
    () => visibleAudioAnalysisArtifactRefs.map((ref) => `${ref.kind}:${ref.refId}`).join('|'),
    [visibleAudioAnalysisArtifactRefs],
  );
  const workerEligibilityReasonKey = workerEligibility.reasons.join('|');

  useEffect(() => {
    setWorkerRuntimeFallbackReason(null);
  }, [hasWorkerCanvasSupport, trackId, workerEligibility.eligible, workerEligibilityReasonKey]);

  useEffect(() => {
    visibleThumbnailSecondRangesRef.current = visibleThumbnailSecondRanges;
  }, [visibleThumbnailSecondRanges]);

  // Redraw when the thumbnail cache gains frames for any of our media files.
  // Worker mode consumes decoded, fresh per-draw thumbnail strips.
  useEffect(() => {
    const unsubscribe = thumbnailCacheService.subscribe((mediaFileId, _status, event) => {
      if (!thumbnailCacheEventIntersectsVisibleRanges(mediaFileId, event, visibleThumbnailSecondRangesRef.current)) return;
      if (thumbnailRedrawRafRef.current !== null) return;
      thumbnailRedrawRafRef.current = requestAnimationFrame(() => {
        thumbnailRedrawRafRef.current = null;
        bumpRedraw();
      });
    });
    return () => {
      unsubscribe();
      if (thumbnailRedrawRafRef.current !== null) {
        cancelAnimationFrame(thumbnailRedrawRafRef.current);
        thumbnailRedrawRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (visibleThumbnailRefs.length === 0) return;
    return scheduleVisibleTimelineThumbnailDbWarmup(visibleThumbnailRefs);
  }, [visibleThumbnailRefs]);

  useEffect(() => {
    if (visibleThumbnailRefs.length === 0) return;
    return scheduleVisibleTimelineThumbnailGeneration(visibleThumbnailRefs);
  }, [visibleThumbnailRefs]);

  useEffect(() => {
    if (!waveformsEnabled || !waveformRefKey) return;
    const controller = new AbortController();
    const refs = waveformRefKey
      .split('|')
      .filter((refId) => refId && !waveformPyramidsRef.current.has(refId));
    if (refs.length === 0) return;

    const publish = (refId: string, pyramid: TimelineWaveformPyramid | null) => {
      if (controller.signal.aborted) return;
      setWaveformPyramids((prev) => {
        if (prev.has(refId) && prev.get(refId) === pyramid) return prev;
        const next = new Map(prev);
        next.set(refId, pyramid);
        return next;
      });
      bumpRedraw();
    };

    void warmTimelineWaveformArtifacts(
      refs,
      {
        signal: controller.signal,
        onResult: ({ refId, pyramid }) => publish(refId, pyramid),
      },
    );

    return () => {
      controller.abort();
    };
  }, [waveformRefKey, waveformsEnabled]);

  useEffect(() => {
    if (!waveformsEnabled || audioDisplayMode !== 'spectral' || !spectrogramRefKey) return;
    const controller = new AbortController();
    const now = Date.now();
    const refs = spectrogramRefKey
      .split('|')
      .filter((refId) => {
        if (!refId || spectrogramTileSetsRef.current.get(refId)) return false;
        const missedAt = spectrogramMissedAtRef.current.get(refId);
        return missedAt === undefined || now - missedAt >= SPECTROGRAM_ARTIFACT_RETRY_MS;
      });
    if (refs.length === 0) return;
    let retryTimer: number | null = null;

    const publish = (refId: string, tileSet: TimelineSpectrogramTileSet | null) => {
      if (controller.signal.aborted) return;
      if (!tileSet) {
        spectrogramMissedAtRef.current.set(refId, Date.now());
        if (retryTimer === null && typeof window !== 'undefined') {
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            bumpSpectrogramRetry();
          }, SPECTROGRAM_ARTIFACT_RETRY_MS);
        }
        return;
      }
      spectrogramMissedAtRef.current.delete(refId);
      setSpectrogramTileSets((prev) => {
        if (prev.has(refId) && prev.get(refId) === tileSet) return prev;
        const next = new Map(prev);
        next.set(refId, tileSet);
        return next;
      });
      bumpRedraw();
    };

    void warmTimelineSpectrogramArtifacts(
      refs,
      {
        signal: controller.signal,
        onResult: ({ refId, tileSet }) => publish(refId, tileSet),
      },
    );

    return () => {
      controller.abort();
      if (retryTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(retryTimer);
      }
    };
  }, [audioDisplayMode, spectrogramRefKey, spectrogramRetryNonce, waveformsEnabled]);

  useEffect(() => {
    if (!waveformsEnabled || !audioAnalysisArtifactRefKey) return;
    const controller = new AbortController();

    void warmTimelineAudioAnalysisArtifacts(
      visibleAudioAnalysisArtifactRefs,
      { signal: controller.signal },
    );

    return () => {
      controller.abort();
    };
  }, [audioAnalysisArtifactRefKey, visibleAudioAnalysisArtifactRefs, waveformsEnabled]);

  useEffect(() => {
    if (!waveformsEnabled || !visibleSourceWaveformGenerationKey) return;
    return scheduleVisibleTimelineSourceWaveformGeneration(
      visibleSourceWaveformGenerationRequests,
      { delayMs: WAVEFORM_GENERATION_DELAY_MS },
    );
  }, [visibleSourceWaveformGenerationKey, visibleSourceWaveformGenerationRequests, waveformsEnabled]);

  useEffect(() => {
    if (!waveformsEnabled || !visibleAudioArtifactClipIdKey) return;
    const cleanups = visibleAudioArtifactClipIds.map((clipId) => (
      audioDisplayMode === 'spectral'
        ? scheduleTimelineSpectrogramTileGeneration({
          clipId,
          requestKey: `timeline-canvas:spectrogram:${clipId}`,
        })
        : scheduleTimelineProcessedWaveformDerivation({
          clipId,
          requestKey: `timeline-canvas:processed-waveform:${clipId}`,
        })
    ));
    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [audioDisplayMode, visibleAudioArtifactClipIdKey, visibleAudioArtifactClipIds, waveformsEnabled]);

  const postPendingWorkerDraw = useCallback(() => {
    const worker = workerRef.current;
    const pending = pendingWorkerDrawRef.current;
    if (!worker || !pending || !workerReadyRef.current) {
      return;
    }

    try {
      worker.postMessage(pending.message, pending.transferables);
      pending.posted = true;
      publishWorkerDrawDiagnostics(pending, {
        pendingDraw: true,
      });
    } catch (error) {
      enterWorkerRuntimeFallback(error instanceof Error
        ? `worker-post-failed:${error.message}`
        : `worker-post-failed:${String(error)}`);
    }
  }, [enterWorkerRuntimeFallback, publishWorkerDrawDiagnostics]);

  useEffect(() => {
    if (!workerMode && workerTransferredCanvasRef.current) {
      workerTransferredCanvasRef.current = false;
      bumpWorkerCanvasGeneration();
    }
  }, [workerMode]);

  // Worker lifecycle: transfer the canvas's drawing surface to the worker once.
  useEffect(() => {
    if (!workerMode) return;
    const canvas = canvasRef.current;
    if (!canvas || workerRef.current) return;
    if (mainThreadCanvasContextInitializedRef.current) {
      mainThreadCanvasContextInitializedRef.current = false;
      bumpWorkerCanvasGeneration();
      return;
    }

    let disposed = false;
    let readyTimeoutId: number | null = null;
    const worker = new Worker(new URL('./workers/timelineClipCanvas.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    const fail = (reason: string) => {
      if (disposed) return;
      enterWorkerRuntimeFallback(reason);
    };

    worker.onmessage = (event: MessageEvent<TimelineClipCanvasWorkerOutgoingMessage>) => {
      const message = event.data;
      if (message.type === 'ready') {
        workerReadyRef.current = true;
        if (readyTimeoutId !== null) {
          window.clearTimeout(readyTimeoutId);
          readyTimeoutId = null;
        }
        postPendingWorkerDraw();
        return;
      }
      if (message.type === 'drawn') {
        const pending = pendingWorkerDrawRef.current;
        if (!pending || pending.requestId !== message.requestId) {
          return;
        }
        publishWorkerDrawDiagnostics(pending, {
          pendingDraw: false,
          drawnClipCount: message.drawnClipCount,
          thumbnailClipCount: message.thumbnailClipCount,
          thumbnailDrawCount: message.thumbnailDrawCount,
          drawMs: message.drawMs,
          resourceBytes: message.resourceBytes,
        });
        return;
      }
      if (message.type === 'error') {
        fail(`worker-runtime-error:${message.message}`);
      }
    };
    worker.onerror = (event) => {
      fail(event.message ? `worker-error:${event.message}` : 'worker-error');
    };
    worker.onmessageerror = () => {
      fail('worker-messageerror');
    };

    try {
      const offscreen = canvas.transferControlToOffscreen();
      workerTransferredCanvasRef.current = true;
      const initMessage: TimelineClipCanvasWorkerInitMessage = { type: 'init', canvas: offscreen };
      worker.postMessage(initMessage, [offscreen]);
    } catch (error) {
      fail(error instanceof Error
        ? `worker-init-failed:${error.message}`
        : `worker-init-failed:${String(error)}`);
      return;
    }

    readyTimeoutId = window.setTimeout(() => {
      if (!workerReadyRef.current) {
        fail('worker-ready-timeout');
      }
    }, 2000);

    return () => {
      disposed = true;
      if (readyTimeoutId !== null) {
        window.clearTimeout(readyTimeoutId);
      }
      if (workerRef.current === worker) {
        worker.terminate();
        workerRef.current = null;
        workerReadyRef.current = false;
      }
      closeUnpostedWorkerDrawResources(pendingWorkerDrawRef.current);
      pendingWorkerDrawRef.current = null;
    };
  }, [enterWorkerRuntimeFallback, postPendingWorkerDraw, publishWorkerDrawDiagnostics, workerMode, workerCanvasGeneration]);

  // Worker draw: post plain geometry whenever it changes. CSS size stays on the
  // main-thread element; the worker owns the backing buffer.
  useEffect(() => {
    if (!workerMode) return;
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!canvas || !worker) return;
    canvas.style.left = `${canvasOffsetX}px`;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${height}px`;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const transientThumbnailResourcesByClipId = createWorkerPreparedThumbnailResourcesByClipId(
      workerThumbnailPreparation.plansByClipId,
    );
    const preparedResourcesByClipId = mergeWorkerPreparedResourcesByClipId(
      workerPreparedResourcesByClipId,
      transientThumbnailResourcesByClipId,
    );
    const workerDraw = buildTimelineClipCanvasWorkerDrawMessage({
      clips: workerDrawableClips,
      height,
      cssWidth,
      canvasOffsetX,
      dpr,
      timeToPixel,
      selectedClipIds,
      hoveredClipId,
      trackColor,
      waveformsEnabled,
      audioDisplayMode,
      preparedResourcesByClipId,
      preparedThumbnailClipIds: workerThumbnailPreparation.handledClipIds,
      passiveDecorationClipIds,
      hasPassiveDecorations,
      hasClipTrim: Boolean(clipTrim),
      activeTrimClipId: clipTrim?.clipId ?? null,
      requestId: workerDrawRequestIdRef.current + 1,
    });
    if (!workerDraw.message) {
      transientThumbnailResourcesByClipId?.forEach((resources) => {
        resources.thumbnailStrip?.bitmap.close();
      });
      return;
    }
    const thumbnailCounts = getWorkerDrawThumbnailCounts(workerDraw.message);
    workerDrawRequestIdRef.current = workerDraw.message.requestId;
    closeUnpostedWorkerDrawResources(pendingWorkerDrawRef.current);
    pendingWorkerDrawRef.current = {
      requestId: workerDraw.message.requestId,
      trackId,
      inputClipCount: workerDraw.inputClipCount,
      visibleClipCount: workerDraw.visibleClipCount,
      thumbnailClipCount: thumbnailCounts.thumbnailClipCount,
      thumbnailDrawCount: thumbnailCounts.thumbnailDrawCount,
      message: workerDraw.message,
      transferables: workerDraw.transferables,
      posted: false,
    };
    postPendingWorkerDraw();
  }, [workerMode, workerDrawableClips, trackId, height, cssWidth, canvasOffsetX, timeToPixel, selectedClipIds, hoveredClipId, trackColor, waveformsEnabled, audioDisplayMode, workerPreparedResourcesByClipId, workerThumbnailPreparation, passiveDecorationClipIds, hasPassiveDecorations, clipTrim, postPendingWorkerDraw]);

  useEffect(() => {
    if (workerMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return;
    }
    if (!ctx) return;
    mainThreadCanvasContextInitializedRef.current = true;

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const targetWidth = Math.round(cssWidth * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth) {
      canvas.width = targetWidth;
    }
    if (canvas.height !== targetHeight) {
      canvas.height = targetHeight;
    }
    const cssWidthStyle = `${cssWidth}px`;
    const cssHeightStyle = `${height}px`;
    const cssLeftStyle = `${canvasOffsetX}px`;
    if (canvas.style.left !== cssLeftStyle) {
      canvas.style.left = cssLeftStyle;
    }
    if (canvas.style.width !== cssWidthStyle) {
      canvas.style.width = cssWidthStyle;
    }
    if (canvas.style.height !== cssHeightStyle) {
      canvas.style.height = cssHeightStyle;
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const diagnostics = drawClips(
        ctx,
        {
          clips,
          trackId,
          height,
          contentWidth,
          timeToPixel,
          selectedClipIds,
          hoveredClipId,
          trackColor,
          scrollX,
          viewportWidth,
          waveformsEnabled,
          audioDisplayMode,
          clipDrag,
          clipDragPreview,
          clipTrim,
          waveformPyramids,
          spectrogramTileSets,
        },
        cssWidth,
        canvasOffsetX,
        mediaFileStatusById,
        bumpRedraw,
      );
      reportTimelineCanvasDrawDiagnostics(trackId, {
        ...diagnostics,
        workerMode,
        workerEligible: flags.timelineCanvasWorker && workerEligibility.eligible,
        workerError: workerRuntimeFallbackReason ?? undefined,
        workerFallbackReasons: flags.timelineCanvasWorker
          ? workerRuntimeFallbackReason
            ? [workerRuntimeFallbackReason]
            : workerEligibility.eligible
              ? undefined
              : workerEligibility.reasons
          : undefined,
      });
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // scrollX intentionally excluded; scrollBucket drives viewport-thumbnail redraws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerMode, clips, trackId, height, contentWidth, cssWidth, canvasOffsetX, timeToPixel, selectedClipIds, hoveredClipId, trackColor, scrollBucket, viewportWidth, waveformsEnabled, audioDisplayMode, clipDrag, clipDragPreview, clipTrim, waveformPyramids, spectrogramTileSets, mediaFileStatusById, redrawNonce, workerEligibility, workerRuntimeFallbackReason, workerCanvasGeneration]);

  return (
    <canvas
      key={`${trackId}:${workerCanvasGeneration}`}
      ref={canvasRef}
      className="timeline-clip-canvas"
      style={{ position: 'absolute', left: canvasOffsetX, top: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    />
  );
}

export const TimelineClipCanvas = memo(TimelineClipCanvasComponent);
