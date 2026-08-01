// FrameContext - Single store read with lazy cached computations
// Eliminates duplicate store reads and repeated array filtering

import type { TimelineClip, TimelineTrack } from '../../types';
import type { FrameContext, ClipTimeInfo } from './types';
import { LAYER_BUILDER_CONSTANTS } from './types';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { applyClipDragPreview } from '../../stores/timeline/clipDragPreview';
import { getPlayheadPosition } from './PlayheadState';
import type { Composition, MediaFile } from '../../stores/mediaStore/types';
import { getTrackAudioMuted, getTrackAudioSolo, hasAnyAudibleSolo } from '../audio/audioGraphRouteSettings';
import { resolveTransitionSourceMapTime } from '../timeline/transitionSourceMap';
import {
  applyMotionParentTransformToClipTransform,
  createTimelineMotionParentEvaluation,
  getTimelineMotionLocalTransformAtTime,
} from '../motionDesign/contracts/timelineStructureAdapter';
import {
  createMotionParentGraphSnapshot,
  evaluateMotionParentGraphWorldTransforms,
} from '../motionDesign/structure/parentGraphPlanner';

function getClipsAtTime(clips: TimelineClip[], playheadPosition: number): TimelineClip[] {
  const EPSILON = 1e-6;

  // Bias the start boundary slightly so tiny floating-point gaps between
  // sequential clips don't produce an empty frame at the cut.
  const activeClips = clips.filter(
    clip =>
      playheadPosition + EPSILON >= clip.startTime &&
      playheadPosition < clip.startTime + clip.duration
  );

  if (activeClips.length <= 1) {
    return activeClips;
  }

  // If two sequential clips only "overlap" because the playhead is exactly on
  // the shared cut boundary, prefer the incoming clip and drop the outgoing one.
  const activeByTrack = new Map<string, TimelineClip[]>();
  for (const clip of activeClips) {
    const key = clip.trackId || clip.id;
    const trackClips = activeByTrack.get(key);
    if (trackClips) {
      trackClips.push(clip);
    } else {
      activeByTrack.set(key, [clip]);
    }
  }

  const resolvedIds = new Set<string>();

  for (const trackClips of activeByTrack.values()) {
    if (trackClips.length === 1) {
      resolvedIds.add(trackClips[0].id);
      continue;
    }

    const sortedClips = [...trackClips].sort((a, b) => a.startTime - b.startTime);
    const latestClip = sortedClips[sortedClips.length - 1];
    const isBoundaryOnlyOverlap =
      playheadPosition >= latestClip.startTime &&
      sortedClips.every(clip =>
        clip.id === latestClip.id ||
        clip.startTime + clip.duration <= latestClip.startTime + EPSILON
      );

    if (isBoundaryOnlyOverlap) {
      resolvedIds.add(latestClip.id);
      continue;
    }

    for (const clip of sortedClips) {
      resolvedIds.add(clip.id);
    }
  }

  return activeClips.filter(clip => resolvedIds.has(clip.id));
}

/**
 * Create a FrameContext with lazy-computed cached values
 * All store reads happen once here, then values are reused
 */
export function createFrameContext(playheadPositionOverride?: number): FrameContext {
  // === SINGLE STORE READS ===
  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();
  const now = performance.now();

  const {
    clips: storeClips,
    tracks,
    isPlaying,
    isDraggingPlayhead,
    playheadPosition: storePlayheadPosition,
    playbackSpeed,
    masterAudioState,
    clipDragPreview,
    layerTransformPreview,
    clipKeyframes,
    getInterpolatedTransform,
    getInterpolatedEffects,
    getInterpolatedNodeGraphParams,
    getInterpolatedColorCorrection,
    getInterpolatedVectorAnimationSettings,
    getInterpolatedTextBounds,
    getInterpolatedLightSettings,
    getInterpolatedSpeed,
    getSourceTimeForClip,
    hasKeyframes,
    getClipKeyframes,
  } = timelineState;

  if (playheadPositionOverride !== undefined && !Number.isFinite(playheadPositionOverride)) {
    throw new RangeError('playheadPositionOverride must be finite');
  }
  const playheadPosition = playheadPositionOverride
    ?? getPlayheadPosition(storePlayheadPosition);
  const clips = applyClipDragPreview(storeClips, clipDragPreview);
  const hasClipDragPreview = clipDragPreview != null;
  const activeCompId = mediaState.activeCompositionId || 'default';
  const previewWorldsByTimelineTime = new Map<number, ReturnType<
    typeof evaluateMotionParentGraphWorldTransforms
  >['worlds']>();
  const resolvePreviewWorlds = (timelineTime: number) => {
    if (!layerTransformPreview) return null;
    if (previewWorldsByTimelineTime.has(timelineTime)) {
      return previewWorldsByTimelineTime.get(timelineTime) ?? null;
    }
    const graph = createMotionParentGraphSnapshot(clips.map((clip) => ({
      clipId: clip.id,
      compositionId: activeCompId,
      space: clip.is3D ? '3d' as const : '2d' as const,
      ...(clip.parentClipId ? { parentClipId: clip.parentClipId } : {}),
    })));
    const baseEvaluation = createTimelineMotionParentEvaluation(clips, clipKeyframes, timelineTime);
    const preview = layerTransformPreview.transform;
    const evaluation = {
      ...baseEvaluation,
      localTransforms: baseEvaluation.localTransforms.map((entry) => (
        entry.clipId !== layerTransformPreview.clipId
          ? entry
          : {
              ...entry,
              transform: {
                ...entry.transform,
                position: preview.position
                  ? {
                      x: preview.position.x ?? entry.transform.position.x,
                      y: preview.position.y ?? entry.transform.position.y,
                    }
                  : entry.transform.position,
                scale: preview.scale
                  ? {
                      all: preview.scale.all ?? entry.transform.scale.all,
                      x: preview.scale.x ?? entry.transform.scale.x,
                      y: preview.scale.y ?? entry.transform.scale.y,
                    }
                  : entry.transform.scale,
              },
            }
      )),
    };
    const worlds = evaluateMotionParentGraphWorldTransforms(graph, evaluation).worlds;
    previewWorldsByTimelineTime.set(timelineTime, worlds);
    return worlds ?? null;
  };
  const getPreviewedInterpolatedTransform = (clipId: string, localTime: number) => {
    if (!layerTransformPreview) return getInterpolatedTransform(clipId, localTime);
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) return getInterpolatedTransform(clipId, localTime);
    const timelineTime = clip.startTime + localTime;
    let localTransform = getTimelineMotionLocalTransformAtTime(
      clip,
      clipKeyframes.get(clip.id) ?? [],
      timelineTime,
    );
    if (layerTransformPreview.clipId === clipId) {
      const preview = layerTransformPreview.transform;
      localTransform = {
        ...localTransform,
        position: preview.position
          ? { ...localTransform.position, ...preview.position }
          : localTransform.position,
        scale: preview.scale
          ? { ...localTransform.scale, ...preview.scale }
          : localTransform.scale,
      };
    }
    const world = resolvePreviewWorlds(timelineTime)?.get(clipId);
    return world
      ? applyMotionParentTransformToClipTransform(localTransform, world)
      : localTransform;
  };
  const activeComposition = mediaState.compositions.find((composition) => composition.id === activeCompId);
  const contextFrameRate =
    typeof activeComposition?.frameRate === 'number' &&
    Number.isFinite(activeComposition.frameRate) &&
    activeComposition.frameRate > 0
      ? activeComposition.frameRate
      : LAYER_BUILDER_CONSTANTS.FRAME_RATE;
  const proxyEnabled = mediaState.proxyEnabled;
  const frameNumber = Math.floor(playheadPosition * contextFrameRate + 1e-6);
  const visualPlayheadPosition = frameNumber / contextFrameRate;

  // === LAZY CACHED VALUES ===
  // These are computed on first access and cached

  let _videoTracks: TimelineTrack[] | null = null;
  let _audioTracks: TimelineTrack[] | null = null;
  let _visibleVideoTrackIds: Set<string> | null = null;
  let _unmutedAudioTrackIds: Set<string> | null = null;
  let _anyVideoSolo: boolean | null = null;
  let _anyAudioSolo: boolean | null = null;
  let _clipsAtTime: TimelineClip[] | null = null;
  let _clipsByTrackId: Map<string, TimelineClip> | null = null;
  let _mediaFileById: Map<string, MediaFile> | null = null;
  let _mediaFileByName: Map<string, MediaFile> | null = null;
  let _compositionById: Map<string, Composition> | null = null;

  const context: FrameContext = {
    // Raw data
    clips,
    tracks,
    isPlaying,
    isDraggingPlayhead,
    hasClipDragPreview,
    layerTransformPreview,
    playheadPosition,
    playbackSpeed,
    masterAudioState,
    activeCompId,
    proxyEnabled,

    // Store functions
    getInterpolatedTransform: getPreviewedInterpolatedTransform,
    getInterpolatedEffects,
    getInterpolatedNodeGraphParams,
    getInterpolatedColorCorrection,
    getInterpolatedVectorAnimationSettings,
    getInterpolatedTextBounds,
    getInterpolatedLightSettings,
    getInterpolatedSpeed,
    getSourceTimeForClip,
    hasKeyframes,
    getClipKeyframes,

    // Timing
    now,
    frameNumber,
    frameRate: contextFrameRate,
    visualPlayheadPosition,

    // Media files reference
    mediaFiles: mediaState.files,

    // === LAZY GETTERS ===

    get videoTracks(): TimelineTrack[] {
      if (_videoTracks === null) {
        _videoTracks = tracks.filter(t => t.type === 'video' && t.visible !== false);
      }
      return _videoTracks;
    },

    get audioTracks(): TimelineTrack[] {
      if (_audioTracks === null) {
        _audioTracks = tracks.filter(t => t.type === 'audio');
      }
      return _audioTracks;
    },

    get anyVideoSolo(): boolean {
      if (_anyVideoSolo === null) {
        _anyVideoSolo = this.videoTracks.some(t => t.solo);
      }
      return _anyVideoSolo;
    },

    get anyAudioSolo(): boolean {
      if (_anyAudioSolo === null) {
        // MIDI tracks share the audible solo group with audio tracks, so soloing
        // a MIDI track also silences non-soloed audio tracks (issue #260).
        _anyAudioSolo = hasAnyAudibleSolo(tracks);
      }
      return _anyAudioSolo;
    },

    get visibleVideoTrackIds(): Set<string> {
      if (_visibleVideoTrackIds === null) {
        _visibleVideoTrackIds = new Set();
        const anyVideoSolo = this.anyVideoSolo;
        for (const track of this.videoTracks) {
          if (track.visible && (!anyVideoSolo || track.solo)) {
            _visibleVideoTrackIds.add(track.id);
          }
        }
      }
      return _visibleVideoTrackIds;
    },

    get unmutedAudioTrackIds(): Set<string> {
      if (_unmutedAudioTrackIds === null) {
        _unmutedAudioTrackIds = new Set();
        const anyAudioSolo = this.anyAudioSolo;
        for (const track of this.audioTracks) {
          if (!getTrackAudioMuted(track) && (!anyAudioSolo || getTrackAudioSolo(track))) {
            _unmutedAudioTrackIds.add(track.id);
          }
        }
      }
      return _unmutedAudioTrackIds;
    },

    get clipsAtTime(): TimelineClip[] {
      if (_clipsAtTime === null) {
        _clipsAtTime = getClipsAtTime(clips, playheadPosition);
      }
      return _clipsAtTime;
    },

    get clipsByTrackId(): Map<string, TimelineClip> {
      if (_clipsByTrackId === null) {
        _clipsByTrackId = new Map();
        for (const clip of this.clipsAtTime) {
          _clipsByTrackId.set(clip.trackId, clip);
        }
      }
      return _clipsByTrackId;
    },

    get mediaFileById(): Map<string, MediaFile> {
      if (_mediaFileById === null) {
        _mediaFileById = new Map();
        for (const file of mediaState.files) {
          _mediaFileById.set(file.id, file);
        }
      }
      return _mediaFileById;
    },

    get mediaFileByName(): Map<string, MediaFile> {
      if (_mediaFileByName === null) {
        _mediaFileByName = new Map();
        for (const file of mediaState.files) {
          if (file.name) {
            _mediaFileByName.set(file.name, file);
          }
        }
      }
      return _mediaFileByName;
    },

    get compositionById(): Map<string, Composition> {
      if (_compositionById === null) {
        _compositionById = new Map();
        for (const comp of mediaState.compositions) {
          _compositionById.set(comp.id, comp);
        }
      }
      return _compositionById;
    },
  };

  return context;
}

/**
 * Get media file for a clip - O(1) lookup
 */
export function getMediaFileForClip(ctx: FrameContext, clip: TimelineClip): MediaFile | undefined {
  // Try by ID first
  if (clip.mediaFileId) {
    const byId = ctx.mediaFileById.get(clip.mediaFileId);
    if (byId) return byId;
  }

  // Try source.mediaFileId (survives project reload even when top-level mediaFileId doesn't)
  if (clip.source?.mediaFileId && clip.source.mediaFileId !== clip.mediaFileId) {
    const bySourceId = ctx.mediaFileById.get(clip.source.mediaFileId);
    if (bySourceId) return bySourceId;
  }

  // Fall back to name
  if (clip.name) {
    return ctx.mediaFileByName.get(clip.name);
  }

  return undefined;
}

/**
 * Check if a video track is visible (considering solo)
 */
export function isVideoTrackVisible(ctx: FrameContext, trackId: string): boolean {
  return ctx.visibleVideoTrackIds.has(trackId);
}

/**
 * Check if an audio track is muted (considering solo)
 */
export function isAudioTrackMuted(ctx: FrameContext, trackId: string): boolean {
  return !ctx.unmutedAudioTrackIds.has(trackId);
}

/**
 * Get clip at playhead for a track - O(1) lookup
 */
export function getClipForTrack(ctx: FrameContext, trackId: string): TimelineClip | undefined {
  return ctx.clipsByTrackId.get(trackId);
}

// === CLIP TIME CALCULATION MEMOIZATION ===

const clipTimeCacheByContext = new WeakMap<FrameContext, Map<string, ClipTimeInfo>>();

function getClipTimeCacheKey(clip: TimelineClip): string {
  if (clip.transitionSourceMap) {
    return `${clip.id}:transition-map:${clip.startTime.toFixed(6)}`;
  }
  const sourceOverride = clip.transitionSourceTimeOverride;
  return Number.isFinite(sourceOverride)
    ? `${clip.id}:transition:${sourceOverride!.toFixed(6)}:${clip.startTime.toFixed(6)}`
    : clip.id;
}

/**
 * Get clip time info with memoization
 * Eliminates repeated calculations of the same clip time
 */
export function getClipTimeInfo(ctx: FrameContext, clip: TimelineClip): ClipTimeInfo {
  let clipTimeCache = clipTimeCacheByContext.get(ctx);

  if (!clipTimeCache) {
    clipTimeCache = new Map<string, ClipTimeInfo>();
    clipTimeCacheByContext.set(ctx, clipTimeCache);
  }

  const cacheKey = getClipTimeCacheKey(clip);
  const cached = clipTimeCache.get(cacheKey);
  if (cached) return cached;

  // Calculate
  const clipLocalTime = ctx.playheadPosition - clip.startTime;
  const visualPlayheadPosition =
    typeof ctx.visualPlayheadPosition === 'number' && Number.isFinite(ctx.visualPlayheadPosition)
      ? ctx.visualPlayheadPosition
      : ctx.playheadPosition;
  const visualClipLocalTime = visualPlayheadPosition - clip.startTime;
  const mappedTime = resolveTransitionSourceMapTime(clip.transitionSourceMap, clipLocalTime);
  const visualMappedTime = resolveTransitionSourceMapTime(
    clip.transitionSourceMap,
    visualClipLocalTime,
  );
  const isHold = mappedTime
    ? mappedTime.isHold || mappedTime.sourceRate === 0
    : clip.transitionSourceHold === true;
  const speed = mappedTime
    ? mappedTime.sourceRate
    : isHold
      ? 0
      : ctx.getInterpolatedSpeed(clip.id, clipLocalTime);
  const absSpeed = Math.abs(speed);
  const initialSpeed = mappedTime
    ? mappedTime.sourceRate
    : !mappedTime && clip.transitionSourceHold
      ? 1
      : ctx.getInterpolatedSpeed(clip.id, 0);
  const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
  const sourceOverride = clip.transitionSourceTimeOverride;
  const baseSourceTime = mappedTime
    ? mappedTime.sourceTime - startPoint
    : Number.isFinite(sourceOverride)
      ? sourceOverride! - startPoint
      : ctx.getSourceTimeForClip(clip.id, clipLocalTime);
  const clipTime = mappedTime
    ? mappedTime.sourceTime
    : Number.isFinite(sourceOverride)
      ? sourceOverride!
      : Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + baseSourceTime));
  const visualBaseSourceTime = visualMappedTime
    ? visualMappedTime.sourceTime - startPoint
    : Number.isFinite(sourceOverride)
      ? sourceOverride! - startPoint
      : ctx.getSourceTimeForClip(clip.id, visualClipLocalTime);
  const visualClipTime = visualMappedTime
    ? visualMappedTime.sourceTime
    : Number.isFinite(sourceOverride)
      ? sourceOverride!
      : Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + visualBaseSourceTime));

  const info: ClipTimeInfo = {
    clipLocalTime,
    sourceTime: baseSourceTime,
    clipTime,
    visualClipLocalTime,
    visualSourceTime: visualBaseSourceTime,
    visualClipTime,
    isHold,
    sourceRate: mappedTime?.sourceRate ?? speed,
    speed,
    absSpeed,
  };

  // Cache and return
  clipTimeCache.set(cacheKey, info);

  // Limit cache size
  if (clipTimeCache.size > LAYER_BUILDER_CONSTANTS.MAX_CLIP_TIME_CACHE) {
    const firstKey = clipTimeCache.keys().next().value;
    if (firstKey) clipTimeCache.delete(firstKey);
  }

  return info;
}
