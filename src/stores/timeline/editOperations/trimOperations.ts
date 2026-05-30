import type { TimelineClip, TimelineTrack } from '../../../types';
import { clearProcessedAudioAnalysisRefs } from '../helpers/audioAnalysisStateHelpers';
import type {
  RateStretchClipOperation,
  RippleTrimEdgeToTimeOperation,
  RollingEditOperation,
  SlideClipOperation,
  SlipClipOperation,
  TimelineEditWarning,
  TrimClipOperation,
  TrimEdgeToTimeOperation,
} from './types';

const MIN_CLIP_DURATION = 0.1;
const EPSILON = 0.0001;

type ClipTrimUpdate = {
  inPoint?: number;
  outPoint?: number;
  startTime?: number;
  duration?: number;
  speed?: number;
  preservesPitch?: boolean;
};

export interface TrimClipsApplyResult {
  clips: TimelineClip[];
  changedClipIds: string[];
  warnings: TimelineEditWarning[];
}

function isTrackLocked(tracks: TimelineTrack[], trackId: string): boolean {
  return tracks.find((track) => track.id === trackId)?.locked === true;
}

function getClipEnd(clip: TimelineClip): number {
  return clip.startTime + clip.duration;
}

function updateTrimmedClip(
  clip: TimelineClip,
  updates: ClipTrimUpdate,
): TimelineClip {
  const inPoint = updates.inPoint ?? clip.inPoint;
  const outPoint = updates.outPoint ?? clip.outPoint;
  const duration = updates.duration ?? (outPoint - inPoint);
  return clearProcessedAudioAnalysisRefs({
    ...clip,
    ...(updates.startTime !== undefined ? { startTime: Math.max(0, updates.startTime) } : {}),
    inPoint,
    outPoint,
    duration,
    ...(updates.speed !== undefined ? { speed: updates.speed } : {}),
    ...(updates.preservesPitch !== undefined ? { preservesPitch: updates.preservesPitch } : {}),
  });
}

function pushLinkedTrim(
  updatesByClipId: Map<string, ClipTrimUpdate>,
  clips: TimelineClip[],
  clip: TimelineClip,
  updates: ClipTrimUpdate,
  includeLinked: boolean | undefined,
): void {
  if (includeLinked === false || !clip.linkedClipId || updatesByClipId.has(clip.linkedClipId)) return;
  const linkedClip = clips.find((candidate) => candidate.id === clip.linkedClipId);
  if (!linkedClip) return;

  const inPointDelta = updates.inPoint !== undefined ? updates.inPoint - clip.inPoint : undefined;
  const outPointDelta = updates.outPoint !== undefined ? updates.outPoint - clip.outPoint : undefined;
  const startTimeDelta = updates.startTime !== undefined ? updates.startTime - clip.startTime : undefined;
  const durationDelta = updates.duration !== undefined ? updates.duration - clip.duration : undefined;

  updatesByClipId.set(linkedClip.id, {
    ...(inPointDelta !== undefined ? { inPoint: linkedClip.inPoint + inPointDelta } : {}),
    ...(outPointDelta !== undefined ? { outPoint: linkedClip.outPoint + outPointDelta } : {}),
    ...(startTimeDelta !== undefined ? { startTime: linkedClip.startTime + startTimeDelta } : {}),
    ...(durationDelta !== undefined ? { duration: linkedClip.duration + durationDelta } : {}),
    ...(updates.speed !== undefined ? { speed: updates.speed } : {}),
    ...(updates.preservesPitch !== undefined ? { preservesPitch: updates.preservesPitch } : {}),
  });
}

function applyTrimUpdates(
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  updatesByClipId: Map<string, ClipTrimUpdate>,
): TrimClipsApplyResult {
  const warnings: TimelineEditWarning[] = [];
  const validUpdates = new Map<string, ClipTrimUpdate>();
  const changedClipIds = new Set<string>();

  for (const [clipId, updates] of updatesByClipId) {
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) {
      warnings.push({ code: 'clip-not-found', message: 'Clip not found for trim operation.', clipId });
      continue;
    }
    if (isTrackLocked(tracks, clip.trackId)) {
      warnings.push({ code: 'track-locked', message: 'Cannot trim clips on locked tracks.', clipId, trackId: clip.trackId });
      continue;
    }

    const inPoint = updates.inPoint ?? clip.inPoint;
    const outPoint = updates.outPoint ?? clip.outPoint;
    const duration = updates.duration ?? (outPoint - inPoint);
    if (!Number.isFinite(inPoint) || !Number.isFinite(outPoint) || !Number.isFinite(duration) || duration < MIN_CLIP_DURATION) {
      warnings.push({ code: 'invalid-range', message: 'Trim range must keep a positive clip duration.', clipId });
      continue;
    }

    const startTime = updates.startTime ?? clip.startTime;
    const changed =
      Math.abs(inPoint - clip.inPoint) > EPSILON ||
      Math.abs(outPoint - clip.outPoint) > EPSILON ||
      Math.abs(startTime - clip.startTime) > EPSILON ||
      Math.abs(duration - clip.duration) > EPSILON ||
      (updates.speed !== undefined && Math.abs(updates.speed - (clip.speed ?? 1)) > EPSILON) ||
      (updates.preservesPitch !== undefined && updates.preservesPitch !== (clip.preservesPitch ?? true));
    if (!changed) continue;

    validUpdates.set(clipId, updates);
    changedClipIds.add(clipId);
  }

  if (validUpdates.size === 0) {
    return {
      clips,
      changedClipIds: [],
      warnings: warnings.length > 0 ? warnings : [{ code: 'no-op', message: 'No clips were trimmed.' }],
    };
  }

  return {
    clips: clips.map((clip) => {
      const updates = validUpdates.get(clip.id);
      return updates ? updateTrimmedClip(clip, updates) : clip;
    }),
    changedClipIds: [...changedClipIds],
    warnings,
  };
}

export function applyTrimClipOperation(
  operation: TrimClipOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): TrimClipsApplyResult {
  const clip = clips.find((candidate) => candidate.id === operation.clipId);
  if (!clip) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'clip-not-found', message: 'Clip not found for trim operation.', clipId: operation.clipId }],
    };
  }

  const updates = {
    inPoint: operation.inPoint,
    outPoint: operation.outPoint,
    ...(operation.startTime !== undefined ? { startTime: operation.startTime } : {}),
  };
  const updatesByClipId = new Map<string, ClipTrimUpdate>([
    [clip.id, updates],
  ]);
  pushLinkedTrim(updatesByClipId, clips, clip, updates, operation.includeLinked);

  // Multi-select trim: fold in the other selected clips, each already clamped to
  // its own bounds by the caller, so they all commit in one history batch.
  for (const extra of operation.extraClips ?? []) {
    if (updatesByClipId.has(extra.clipId)) continue;
    const extraClip = clips.find((candidate) => candidate.id === extra.clipId);
    if (!extraClip) continue;
    const extraUpdates: ClipTrimUpdate = {
      inPoint: extra.inPoint,
      outPoint: extra.outPoint,
      ...(extra.startTime !== undefined ? { startTime: extra.startTime } : {}),
    };
    updatesByClipId.set(extra.clipId, extraUpdates);
    pushLinkedTrim(updatesByClipId, clips, extraClip, extraUpdates, operation.includeLinked);
  }

  return applyTrimUpdates(clips, tracks, updatesByClipId);
}

function getTrimTargets(
  operation: TrimEdgeToTimeOperation,
  selectedClipIds: Set<string>,
): string[] {
  if (operation.clipIds && operation.clipIds.length > 0) return operation.clipIds;
  return [...selectedClipIds];
}

export function applyTrimEdgeToTimeOperation(
  operation: TrimEdgeToTimeOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  selectedClipIds: Set<string>,
): TrimClipsApplyResult {
  const warnings: TimelineEditWarning[] = [];
  const updatesByClipId = new Map<string, { inPoint?: number; outPoint?: number; startTime?: number }>();
  const targetIds = getTrimTargets(operation, selectedClipIds);

  if (targetIds.length === 0) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'no-op', message: 'No clips selected for trim-to-time operation.' }],
    };
  }

  for (const clipId of targetIds) {
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) {
      warnings.push({ code: 'clip-not-found', message: 'Clip not found for trim-to-time operation.', clipId });
      continue;
    }

    if (operation.time <= clip.startTime + EPSILON || operation.time >= getClipEnd(clip) - EPSILON) {
      warnings.push({ code: 'invalid-time', message: 'Trim-to-time must target a time inside the clip.', clipId });
      continue;
    }

    const offset = operation.time - clip.startTime;
    const updates = operation.edge === 'start'
      ? { startTime: operation.time, inPoint: clip.inPoint + offset }
      : { outPoint: clip.inPoint + offset };
    updatesByClipId.set(clip.id, updates);
    pushLinkedTrim(updatesByClipId, clips, clip, updates, operation.includeLinked);
  }

  if (updatesByClipId.size === 0) {
    return {
      clips,
      changedClipIds: [],
      warnings: warnings.length > 0 ? warnings : [{ code: 'no-op', message: 'No clips were trimmed.' }],
    };
  }

  const result = applyTrimUpdates(clips, tracks, updatesByClipId);
  return {
    ...result,
    warnings: [...warnings, ...result.warnings],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getSourceDuration(clip: TimelineClip): number {
  const naturalDuration = clip.source?.naturalDuration;
  if (Number.isFinite(naturalDuration) && naturalDuration && naturalDuration > 0) {
    return naturalDuration;
  }
  return Math.max(clip.outPoint, clip.inPoint + clip.duration, clip.duration, MIN_CLIP_DURATION);
}

function getSortedTrackClips(clips: TimelineClip[], trackId: string, excludeClipIds = new Set<string>()): TimelineClip[] {
  return clips
    .filter((clip) => clip.trackId === trackId && !excludeClipIds.has(clip.id))
    .toSorted((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
}

function findPreviousClip(clips: TimelineClip[], clip: TimelineClip): TimelineClip | null {
  const candidates = getSortedTrackClips(clips, clip.trackId, new Set([clip.id]))
    .filter((candidate) => getClipEnd(candidate) <= clip.startTime + EPSILON);
  return candidates[candidates.length - 1] ?? null;
}

function findNextClip(clips: TimelineClip[], clip: TimelineClip): TimelineClip | null {
  return getSortedTrackClips(clips, clip.trackId, new Set([clip.id]))
    .find((candidate) => candidate.startTime >= getClipEnd(clip) - EPSILON) ?? null;
}

function getTrimEdgeTargets(
  operation: RippleTrimEdgeToTimeOperation,
  selectedClipIds: Set<string>,
): string[] {
  if (operation.clipIds && operation.clipIds.length > 0) return operation.clipIds;
  return [...selectedClipIds];
}

function addRippleShiftUpdates(
  updatesByClipId: Map<string, ClipTrimUpdate>,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  trackId: string,
  afterTime: number,
  delta: number,
  protectedClipIds: Set<string>,
  warnings: TimelineEditWarning[],
): void {
  if (Math.abs(delta) <= EPSILON) return;

  for (const candidate of clips) {
    if (candidate.trackId !== trackId || protectedClipIds.has(candidate.id)) continue;
    if (candidate.startTime < afterTime - EPSILON) continue;
    if (isTrackLocked(tracks, candidate.trackId)) {
      warnings.push({
        code: 'track-locked',
        message: 'Cannot ripple clips on locked tracks.',
        clipId: candidate.id,
        trackId: candidate.trackId,
      });
      continue;
    }
    const existing = updatesByClipId.get(candidate.id) ?? {};
    updatesByClipId.set(candidate.id, {
      ...existing,
      startTime: Math.max(0, (existing.startTime ?? candidate.startTime) + delta),
    });
  }
}

export function applyRippleTrimEdgeToTimeOperation(
  operation: RippleTrimEdgeToTimeOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  selectedClipIds: Set<string>,
): TrimClipsApplyResult {
  const warnings: TimelineEditWarning[] = [];
  const updatesByClipId = new Map<string, ClipTrimUpdate>();
  const targetIds = getTrimEdgeTargets(operation, selectedClipIds);
  const processedClipIds = new Set<string>();

  if (targetIds.length === 0) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'no-op', message: 'No clips selected for ripple trim operation.' }],
    };
  }

  for (const clipId of targetIds) {
    if (processedClipIds.has(clipId)) continue;
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip) {
      warnings.push({ code: 'clip-not-found', message: 'Clip not found for ripple trim operation.', clipId });
      continue;
    }
    processedClipIds.add(clip.id);
    if (operation.includeLinked !== false && clip.linkedClipId) processedClipIds.add(clip.linkedClipId);

    const originalStart = clip.startTime;
    const originalEnd = getClipEnd(clip);
    const linkedClip = operation.includeLinked === false || !clip.linkedClipId
      ? null
      : clips.find((candidate) => candidate.id === clip.linkedClipId) ?? null;
    const protectedClipIds = new Set([clip.id, ...(linkedClip ? [linkedClip.id] : [])]);
    const rippleTrackIds = [...new Set([clip.trackId, ...(linkedClip ? [linkedClip.trackId] : [])])];

    if (operation.edge === 'start') {
      if (operation.time <= originalStart + EPSILON || operation.time >= originalEnd - MIN_CLIP_DURATION) {
        warnings.push({ code: 'invalid-time', message: 'Ripple trim start must target a time inside the clip.', clipId });
        continue;
      }
      const removedDuration = operation.time - originalStart;
      const updates = {
        inPoint: clip.inPoint + removedDuration,
        outPoint: clip.outPoint,
        startTime: originalStart,
      };
      updatesByClipId.set(clip.id, updates);
      pushLinkedTrim(updatesByClipId, clips, clip, updates, operation.includeLinked);
      for (const trackId of rippleTrackIds) {
        addRippleShiftUpdates(updatesByClipId, clips, tracks, trackId, originalEnd, -removedDuration, protectedClipIds, warnings);
      }
    } else {
      if (operation.time <= originalStart + MIN_CLIP_DURATION || operation.time >= originalEnd - EPSILON) {
        warnings.push({ code: 'invalid-time', message: 'Ripple trim end must target a time inside the clip.', clipId });
        continue;
      }
      const removedDuration = originalEnd - operation.time;
      const updates = {
        outPoint: clip.outPoint - removedDuration,
      };
      updatesByClipId.set(clip.id, updates);
      pushLinkedTrim(updatesByClipId, clips, clip, updates, operation.includeLinked);
      for (const trackId of rippleTrackIds) {
        addRippleShiftUpdates(updatesByClipId, clips, tracks, trackId, originalEnd, -removedDuration, protectedClipIds, warnings);
      }
    }
  }

  if (updatesByClipId.size === 0) {
    return {
      clips,
      changedClipIds: [],
      warnings: warnings.length > 0 ? warnings : [{ code: 'no-op', message: 'No clips were ripple trimmed.' }],
    };
  }

  const result = applyTrimUpdates(clips, tracks, updatesByClipId);
  return {
    ...result,
    warnings: [...warnings, ...result.warnings],
  };
}

function resolveRollingPair(
  operation: RollingEditOperation,
  clips: TimelineClip[],
): { leftClip: TimelineClip; rightClip: TimelineClip } | null {
  const clip = clips.find((candidate) => candidate.id === operation.clipId);
  if (!clip) return null;

  if (operation.edge === 'start') {
    const leftClip = findPreviousClip(clips, clip);
    return leftClip ? { leftClip, rightClip: clip } : null;
  }

  const rightClip = findNextClip(clips, clip);
  return rightClip ? { leftClip: clip, rightClip } : null;
}

function addRollingPairUpdates(
  updatesByClipId: Map<string, ClipTrimUpdate>,
  leftClip: TimelineClip,
  rightClip: TimelineClip,
  editTime: number,
): boolean {
  const leftDuration = editTime - leftClip.startTime;
  const rightDuration = getClipEnd(rightClip) - editTime;
  if (leftDuration < MIN_CLIP_DURATION || rightDuration < MIN_CLIP_DURATION) return false;

  const rightSourceDelta = editTime - rightClip.startTime;
  updatesByClipId.set(leftClip.id, {
    outPoint: leftClip.inPoint + leftDuration,
  });
  updatesByClipId.set(rightClip.id, {
    startTime: editTime,
    inPoint: rightClip.inPoint + rightSourceDelta,
  });
  return true;
}

export function applyRollingEditOperation(
  operation: RollingEditOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): TrimClipsApplyResult {
  const pair = resolveRollingPair(operation, clips);
  if (!pair) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'clip-not-found', message: 'Could not find adjacent clips for rolling edit.', clipId: operation.clipId }],
    };
  }

  const updatesByClipId = new Map<string, ClipTrimUpdate>();
  if (!addRollingPairUpdates(updatesByClipId, pair.leftClip, pair.rightClip, operation.time)) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'invalid-time', message: 'Rolling edit would violate minimum clip duration.', clipId: operation.clipId }],
    };
  }

  if (operation.includeLinked !== false && pair.leftClip.linkedClipId && pair.rightClip.linkedClipId) {
    const linkedLeft = clips.find((candidate) => candidate.id === pair.leftClip.linkedClipId);
    const linkedRight = clips.find((candidate) => candidate.id === pair.rightClip.linkedClipId);
    if (linkedLeft && linkedRight) {
      addRollingPairUpdates(updatesByClipId, linkedLeft, linkedRight, operation.time);
    }
  }

  return applyTrimUpdates(clips, tracks, updatesByClipId);
}

function addSlipUpdate(
  updatesByClipId: Map<string, ClipTrimUpdate>,
  clip: TimelineClip,
  sourceDelta: number,
): boolean {
  const visibleSourceDuration = clip.outPoint - clip.inPoint;
  const sourceDuration = getSourceDuration(clip);
  const maxInPoint = Math.max(0, sourceDuration - visibleSourceDuration);
  const nextInPoint = clamp(clip.inPoint + sourceDelta, 0, maxInPoint);
  const nextOutPoint = nextInPoint + visibleSourceDuration;

  if (Math.abs(nextInPoint - clip.inPoint) <= EPSILON && Math.abs(nextOutPoint - clip.outPoint) <= EPSILON) {
    return false;
  }
  updatesByClipId.set(clip.id, {
    inPoint: nextInPoint,
    outPoint: nextOutPoint,
    duration: clip.duration,
  });
  return true;
}

export function applySlipClipOperation(
  operation: SlipClipOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): TrimClipsApplyResult {
  const clip = clips.find((candidate) => candidate.id === operation.clipId);
  if (!clip) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'clip-not-found', message: 'Clip not found for slip operation.', clipId: operation.clipId }],
    };
  }

  const updatesByClipId = new Map<string, ClipTrimUpdate>();
  addSlipUpdate(updatesByClipId, clip, operation.sourceDelta);
  if (operation.includeLinked !== false && clip.linkedClipId) {
    const linkedClip = clips.find((candidate) => candidate.id === clip.linkedClipId);
    if (linkedClip) addSlipUpdate(updatesByClipId, linkedClip, operation.sourceDelta);
  }

  return applyTrimUpdates(clips, tracks, updatesByClipId);
}

function addSlideTripletUpdates(
  updatesByClipId: Map<string, ClipTrimUpdate>,
  previousClip: TimelineClip,
  clip: TimelineClip,
  nextClip: TimelineClip,
  delta: number,
): void {
  updatesByClipId.set(previousClip.id, {
    outPoint: previousClip.outPoint + delta,
  });
  updatesByClipId.set(clip.id, {
    startTime: clip.startTime + delta,
  });
  updatesByClipId.set(nextClip.id, {
    startTime: nextClip.startTime + delta,
    inPoint: nextClip.inPoint + delta,
  });
}

export function applySlideClipOperation(
  operation: SlideClipOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): TrimClipsApplyResult {
  const clip = clips.find((candidate) => candidate.id === operation.clipId);
  if (!clip) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'clip-not-found', message: 'Clip not found for slide operation.', clipId: operation.clipId }],
    };
  }

  const previousClip = findPreviousClip(clips, clip);
  const nextClip = findNextClip(clips, clip);
  if (!previousClip || !nextClip) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'clip-not-found', message: 'Slide operation requires adjacent clips on both sides.', clipId: operation.clipId }],
    };
  }

  const minDelta = -(previousClip.duration - MIN_CLIP_DURATION);
  const maxDelta = nextClip.duration - MIN_CLIP_DURATION;
  const delta = clamp(operation.timelineDelta, minDelta, maxDelta);
  if (Math.abs(delta) <= EPSILON) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'no-op', message: 'Slide operation did not move the clip.' }],
    };
  }

  const updatesByClipId = new Map<string, ClipTrimUpdate>();
  addSlideTripletUpdates(updatesByClipId, previousClip, clip, nextClip, delta);

  if (
    operation.includeLinked !== false &&
    clip.linkedClipId &&
    previousClip.linkedClipId &&
    nextClip.linkedClipId
  ) {
    const linkedClip = clips.find((candidate) => candidate.id === clip.linkedClipId);
    const linkedPreviousClip = clips.find((candidate) => candidate.id === previousClip.linkedClipId);
    const linkedNextClip = clips.find((candidate) => candidate.id === nextClip.linkedClipId);
    if (linkedPreviousClip && linkedClip && linkedNextClip) {
      addSlideTripletUpdates(updatesByClipId, linkedPreviousClip, linkedClip, linkedNextClip, delta);
    }
  }

  return applyTrimUpdates(clips, tracks, updatesByClipId);
}

export function applyRateStretchClipOperation(
  operation: RateStretchClipOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
): TrimClipsApplyResult {
  const clip = clips.find((candidate) => candidate.id === operation.clipId);
  if (!clip) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'clip-not-found', message: 'Clip not found for rate stretch operation.', clipId: operation.clipId }],
    };
  }

  const clipEnd = getClipEnd(clip);
  const targetDuration = operation.edge === 'start'
    ? clipEnd - operation.time
    : operation.time - clip.startTime;
  if (!Number.isFinite(targetDuration) || targetDuration < MIN_CLIP_DURATION) {
    return {
      clips,
      changedClipIds: [],
      warnings: [{ code: 'invalid-range', message: 'Rate stretch must keep a positive clip duration.', clipId: operation.clipId }],
    };
  }

  const sourceWindowDuration = Math.max(MIN_CLIP_DURATION, clip.outPoint - clip.inPoint);
  const speedSign = (clip.speed ?? 1) < 0 ? -1 : 1;
  const speed = speedSign * (sourceWindowDuration / targetDuration);
  const updates: ClipTrimUpdate = {
    ...(operation.edge === 'start' ? { startTime: operation.time } : {}),
    duration: targetDuration,
    speed,
    preservesPitch: operation.preservesPitch ?? clip.preservesPitch ?? true,
  };

  const updatesByClipId = new Map<string, ClipTrimUpdate>([[clip.id, updates]]);
  pushLinkedTrim(updatesByClipId, clips, clip, updates, operation.includeLinked);
  return applyTrimUpdates(clips, tracks, updatesByClipId);
}
