import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { ClipAudioState } from '../../../types/audio';
import type { ClipSegment } from '../../../types';
import type { MidiClipData } from '../../../types/midiClip';
import {
  createTimelineClipCanvasWorkerCompositionVisualsResource,
} from './timelineClipCanvasCompositionResource';
import type { TimelinePaintFadeVisuals } from '../../../timeline/paint';
import { createTimelineClipCanvasWorkerFadeVisualsResource } from './timelineClipCanvasFadeResource';
import { createTimelineClipCanvasWorkerMidiPreviewResource } from './timelineClipCanvasMidiResource';
import {
  createTimelineClipCanvasWorkerPassiveDecorationsResource,
  type TimelineClipCanvasMediaStatus,
} from './timelineClipCanvasPassiveDecorations';
import {
  createTimelineClipCanvasWorkerSpectrogramResource,
  type TimelineClipCanvasSpectrogramTileSetMap,
} from './timelineClipCanvasSpectrogramResource';
import {
  TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_HEIGHT,
  TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_WIDTH,
} from './timelineClipCanvasThumbnailResource';
import {
  createTimelineClipCanvasWorkerTrimVisualsResource,
  type TimelineClipCanvasTrimGeometry,
} from './timelineClipCanvasTrimResource';
import {
  createTimelineClipCanvasWorkerWaveformResource,
  type TimelineClipCanvasWaveformPyramidMap,
} from './timelineClipCanvasWaveformResource';
import type { TimelineClipCanvasWorkerPreparedClipResources } from './timelineClipCanvasWorkerModel';

export interface TimelineClipCanvasPreparedResourceClipInput {
  id: string;
  trackType?: 'video' | 'audio' | 'midi';
  startTime: number;
  duration: number;
  inPoint?: number;
  outPoint?: number;
  waveform?: readonly number[];
  waveformChannels?: readonly (readonly number[])[];
  audioState?: Pick<ClipAudioState, 'processedAnalysisRefs' | 'sourceAnalysisRefs'> | null;
  midiData?: MidiClipData;
  fade?: TimelinePaintFadeVisuals;
  isComposition?: boolean;
  compositionId?: string;
  nestedClipBoundaries?: readonly number[];
  clipSegments?: readonly ClipSegment[];
  mixdownWaveform?: readonly number[];
  mixdownGenerating?: boolean;
  hasMixdownAudio?: boolean;
  reversed?: boolean;
  linkedClipId?: string;
  linkedGroupId?: string;
  isPendingDownload?: boolean;
  downloadProgress?: number;
  downloadError?: string;
  transcript?: readonly { start: number; end: number }[];
  transcriptStatus?: string;
  transcriptProgress?: number;
  analysis?: { frames?: readonly { timestamp: number; focus?: number; globalMotion?: number; motion?: number; faceCount?: number }[] };
  analysisStatus?: string;
  analysisProgress?: number;
  source?: {
    type?: string | null;
    naturalDuration?: number;
    mediaFileId?: string;
  } | null;
}

interface CreateTimelineClipCanvasWorkerPreparedResourcesInput {
  clips: readonly TimelineClipCanvasPreparedResourceClipInput[];
  waveformPyramids: TimelineClipCanvasWaveformPyramidMap | undefined;
  spectrogramTileSets: TimelineClipCanvasSpectrogramTileSetMap | undefined;
  waveformsEnabled: boolean | undefined;
  audioDisplayMode: TimelineAudioDisplayMode | undefined;
  height: number;
  cssWidth: number;
  canvasOffsetX: number;
  scrollX: number;
  viewportWidth: number;
  timeToPixel: (time: number) => number;
  activeTrimClipId?: string | null;
  activeTrimIncludeLinked?: boolean;
  renderOverscanPx: number;
  minThumbnailWidth: number;
  thumbnailSlotPx: number;
  maxThumbnailSlots: number;
  resolveGeometry: (clip: TimelineClipCanvasPreparedResourceClipInput) => TimelineClipCanvasTrimGeometry;
  getMediaStatus: (clip: TimelineClipCanvasPreparedResourceClipInput) => TimelineClipCanvasMediaStatus | undefined;
}

function createTimelineClipCanvasWorkerCompositionMixdownWaveformResource(
  clip: TimelineClipCanvasPreparedResourceClipInput,
  height: number,
  timeToPixel: (time: number) => number,
): TimelineClipCanvasWorkerPreparedClipResources['waveform'] | undefined {
  if (clip.source?.type !== 'audio') return undefined;

  const waveform = clip.mixdownWaveform && clip.mixdownWaveform.length > 0
    ? clip.mixdownWaveform
    : clip.hasMixdownAudio && clip.waveform && clip.waveform.length > 0
      ? clip.waveform
      : null;
  if (!waveform) return undefined;

  return createTimelineClipCanvasWorkerWaveformResource(
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

export function createTimelineClipCanvasWorkerPreparedResourcesByClipId(
  input: CreateTimelineClipCanvasWorkerPreparedResourcesInput,
): ReadonlyMap<string, TimelineClipCanvasWorkerPreparedClipResources> | undefined {
  const resourcesByClipId = new Map<string, TimelineClipCanvasWorkerPreparedClipResources>();

  input.clips.forEach((clip) => {
    const geometry = input.resolveGeometry(clip);
    const resourceClip = {
      ...clip,
      startTime: geometry.startTime,
      duration: geometry.duration,
      inPoint: geometry.inPoint,
      outPoint: geometry.outPoint,
    };
    const clipWidth = Math.max(
      1,
      input.timeToPixel(resourceClip.startTime + resourceClip.duration) - input.timeToPixel(resourceClip.startTime),
    );
    const waveform = input.waveformsEnabled
      ? createTimelineClipCanvasWorkerWaveformResource(
        resourceClip,
        input.waveformPyramids,
        input.audioDisplayMode,
        input.height,
        input.timeToPixel,
      )
      : undefined;
    const spectrogram = input.waveformsEnabled
      ? createTimelineClipCanvasWorkerSpectrogramResource(
        resourceClip,
        input.spectrogramTileSets,
        input.audioDisplayMode,
        input.height,
        input.timeToPixel,
      )
      : undefined;
    const passiveDecorations = createTimelineClipCanvasWorkerPassiveDecorationsResource({
      clip: resourceClip,
      mediaStatus: input.getMediaStatus(resourceClip),
      clipWidth: Math.max(1, Math.round(clipWidth)),
    });
    const absoluteX = input.timeToPixel(resourceClip.startTime);
    const visibleAbsLeft = Math.max(absoluteX, input.canvasOffsetX, input.scrollX - input.renderOverscanPx);
    const visibleAbsRight = Math.min(
      absoluteX + clipWidth,
      input.canvasOffsetX + input.cssWidth,
      input.scrollX + input.viewportWidth + input.renderOverscanPx,
    );
    const visibleStartRatio = Math.max(0, Math.min(1, (visibleAbsLeft - absoluteX) / clipWidth));
    const visibleEndRatio = Math.max(visibleStartRatio, Math.min(1, (visibleAbsRight - absoluteX) / clipWidth));
    const midiPreview = createTimelineClipCanvasWorkerMidiPreviewResource(
      resourceClip,
      clipWidth,
      Math.max(1, input.height - 2),
      visibleStartRatio,
      visibleEndRatio,
    );
    const compositionVisuals = createTimelineClipCanvasWorkerCompositionVisualsResource({
      clip: resourceClip,
      clipWidth,
      height: input.height,
      mixdownWaveform: createTimelineClipCanvasWorkerCompositionMixdownWaveformResource(
        resourceClip,
        input.height,
        input.timeToPixel,
      ),
      minThumbnailWidth: input.minThumbnailWidth,
      thumbnailSlotPx: input.thumbnailSlotPx,
      maxThumbnailSlots: input.maxThumbnailSlots,
      maxBitmapWidth: TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_WIDTH,
      maxBitmapHeight: TIMELINE_CLIP_CANVAS_WORKER_THUMBNAIL_STRIP_MAX_HEIGHT,
    });
    const trimVisuals = input.activeTrimClipId === clip.id ||
      (input.activeTrimIncludeLinked === true && clip.linkedClipId === input.activeTrimClipId)
      ? createTimelineClipCanvasWorkerTrimVisualsResource({
        geometry,
        canvasOffsetX: input.canvasOffsetX,
        scrollX: input.scrollX,
        viewportWidth: input.viewportWidth,
        renderOverscanPx: input.renderOverscanPx,
        timeToPixel: input.timeToPixel,
      })
      : undefined;
    const fadeVisuals = createTimelineClipCanvasWorkerFadeVisualsResource({
      fade: clip.fade,
      clipWidth: Math.max(1,
        trimVisuals?.body.width ??
          (input.timeToPixel(clip.startTime + clip.duration) - input.timeToPixel(clip.startTime)),
      ),
      height: input.height,
    });

    if (waveform || spectrogram || midiPreview || passiveDecorations || compositionVisuals || trimVisuals || fadeVisuals) {
      resourcesByClipId.set(clip.id, { waveform, spectrogram, midiPreview, passiveDecorations, compositionVisuals, trimVisuals, fadeVisuals });
    }
  });

  return resourcesByClipId.size > 0 ? resourcesByClipId : undefined;
}
