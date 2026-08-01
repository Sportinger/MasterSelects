import type { Keyframe, TimelineClip, TimelineTrack } from '../../../types';
import { stripTimelineSourceRuntimeHandles } from '../sourceRuntimeSanitizer';
import type { SplitAtTimesOperation, TimelineEditWarning } from './types';
import {
  cloneStoryboardClipProperties,
  cloneStoryboardPropertiesForSplit,
} from '../../../services/storyboard/core';
import {
  clearMotionParentsPreservingWorld,
  type MotionParentWorldPreservationContext,
} from './motionParentWorldPreservation';

const SPLIT_EPSILON = 0.001;

export interface SplitAtTimesApplyResult {
  clips: TimelineClip[];
  changedClipIds: string[];
  selectedClipIds: Set<string>;
  warnings: TimelineEditWarning[];
  clipKeyframes?: Map<string, Keyframe[]>;
}

export function isCompositionAudioClip(clip: Pick<TimelineClip, 'isComposition' | 'source'>): boolean {
  return clip.isComposition === true && clip.source?.type === 'audio';
}

export function stripCompositionAudioRuntimeSource(source: TimelineClip['source']): TimelineClip['source'] {
  return stripTimelineMediaRuntimeSource(source);
}

export function stripTimelineMediaRuntimeSource(source: TimelineClip['source']): TimelineClip['source'] {
  if (!source || (source.type !== 'video' && source.type !== 'audio')) {
    return source;
  }

  return stripTimelineSourceRuntimeHandles(source);
}

export function getSourceForFirstSplitPart(clip: TimelineClip): TimelineClip['source'] {
  return stripTimelineMediaRuntimeSource(clip.source);
}

export function deepCloneClipProps(clip: TimelineClip): Partial<TimelineClip> {
  return {
    transform: structuredClone(clip.transform),
    effects: clip.effects.map(e => structuredClone(e)),
    ...(clip.masks ? { masks: clip.masks.map(m => structuredClone(m)) } : {}),
    ...(clip.textProperties ? { textProperties: structuredClone(clip.textProperties) } : {}),
      ...(clip.captionProperties ? { captionProperties: structuredClone(clip.captionProperties) } : {}),
      ...(clip.captionLayerBinding ? { captionLayerBinding: structuredClone(clip.captionLayerBinding) } : {}),
    ...(clip.storyboardProperties
      ? { storyboardProperties: cloneStoryboardClipProperties(clip.storyboardProperties) }
      : {}),
    ...(clip.motion ? { motion: structuredClone(clip.motion) } : {}),
  };
}

export function cloneSourceForPart(clip: TimelineClip): TimelineClip['source'] {
  return stripTimelineMediaRuntimeSource(clip.source);
}

export function cloneLinkedSourceForPart(
  linkedClip: TimelineClip,
): TimelineClip['source'] {
  return stripTimelineMediaRuntimeSource(linkedClip.source);
}

export interface SplitTransitionLinkReplacement {
  originalClipId: string;
  incomingReplacementClipId: string;
  outgoingReplacementClipId: string;
}

export interface SplitMotionParentReplacement {
  originalClipId: string;
  replacementClipIds: readonly string[];
}

/**
 * A durable parent link can follow a split parent only when one replacement
 * covers the child's complete active range. Ambiguous spanning children are
 * detached instead of retaining a dangling or time-dependent relationship.
 */
export function remapMotionParentLinksForSplitReplacements(
  clips: readonly TimelineClip[],
  replacements: readonly SplitMotionParentReplacement[],
): TimelineClip[] {
  if (replacements.length === 0) return [...clips];
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const replacementsByOriginalId = new Map(replacements.map((replacement) => [
    replacement.originalClipId,
    replacement.replacementClipIds
      .map((clipId) => clipsById.get(clipId))
      .filter((clip): clip is TimelineClip => clip !== undefined),
  ]));

  return clips.map((clip) => {
    if (!clip.parentClipId) return clip;
    const candidates = replacementsByOriginalId.get(clip.parentClipId);
    if (!candidates) return clip;
    const covering = getCoveringSplitParentParts(clip, candidates);
    return {
      ...clip,
      parentClipId: covering.length === 1 ? covering[0].id : undefined,
    };
  });
}

function getCoveringSplitParentParts(
  child: TimelineClip,
  candidates: readonly TimelineClip[],
): TimelineClip[] {
  const childEnd = child.startTime + child.duration;
  return candidates.filter((candidate) => (
    candidate.startTime <= child.startTime + SPLIT_EPSILON
    && candidate.startTime + candidate.duration >= childEnd - SPLIT_EPSILON
  ));
}

export function collectMotionParentClipIdsDetachedBySplit(
  clips: readonly TimelineClip[],
  replacements: readonly SplitMotionParentReplacement[],
): string[] {
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const replacementsByOriginalId = new Map(replacements.map((replacement) => [
    replacement.originalClipId,
    replacement.replacementClipIds
      .map((clipId) => clipsById.get(clipId))
      .filter((clip): clip is TimelineClip => clip !== undefined),
  ]));
  return clips.flatMap((clip) => {
    if (!clip.parentClipId) return [];
    const candidates = replacementsByOriginalId.get(clip.parentClipId);
    return candidates && getCoveringSplitParentParts(clip, candidates).length !== 1
      ? [clip.id]
      : [];
  });
}

export function remapTransitionLinksForSplitReplacements(
  clips: readonly TimelineClip[],
  replacements: readonly SplitTransitionLinkReplacement[],
): TimelineClip[] {
  if (replacements.length === 0) return [...clips];
  const incomingTargets = new Map(replacements.map((replacement) => [
    replacement.originalClipId,
    replacement.incomingReplacementClipId,
  ]));
  const outgoingTargets = new Map(replacements.map((replacement) => [
    replacement.originalClipId,
    replacement.outgoingReplacementClipId,
  ]));

  return clips.map((clip) => {
    const nextTransitionOut = clip.transitionOut?.linkedClipId
      ? incomingTargets.get(clip.transitionOut.linkedClipId)
      : undefined;
    const nextTransitionIn = clip.transitionIn?.linkedClipId
      ? outgoingTargets.get(clip.transitionIn.linkedClipId)
      : undefined;
    if (!nextTransitionOut && !nextTransitionIn) return clip;
    return {
      ...clip,
      ...(nextTransitionOut && clip.transitionOut
        ? { transitionOut: { ...clip.transitionOut, linkedClipId: nextTransitionOut } }
        : {}),
      ...(nextTransitionIn && clip.transitionIn
        ? { transitionIn: { ...clip.transitionIn, linkedClipId: nextTransitionIn } }
        : {}),
    };
  });
}

function getTrackForClip(clip: TimelineClip, tracks: TimelineTrack[]): TimelineTrack | undefined {
  return tracks.find(track => track.id === clip.trackId);
}

function getValidSplitTimes(clip: TimelineClip, times: number[]): number[] {
  const clipStart = clip.startTime;
  const clipEnd = clip.startTime + clip.duration;
  const uniqueTimes = new Set<number>();

  for (const time of times) {
    if (!Number.isFinite(time)) continue;
    if (time <= clipStart + SPLIT_EPSILON || time >= clipEnd - SPLIT_EPSILON) continue;
    uniqueTimes.add(time);
  }

  return [...uniqueTimes].toSorted((a, b) => a - b);
}

export function applySplitAtTimesOperation(
  operation: SplitAtTimesOperation,
  clips: TimelineClip[],
  tracks: TimelineTrack[],
  parentPreservation?: MotionParentWorldPreservationContext,
): SplitAtTimesApplyResult {
  const warnings: TimelineEditWarning[] = [];
  const clip = clips.find(candidate => candidate.id === operation.clipId);
  if (!clip) {
    return {
      clips,
      changedClipIds: [],
      selectedClipIds: new Set(),
      warnings: [{
        code: 'clip-not-found',
        clipId: operation.clipId,
        message: `Clip not found: ${operation.clipId}`,
      }],
    };
  }

  const track = getTrackForClip(clip, tracks);
  if (track?.locked === true) {
    return {
      clips,
      changedClipIds: [],
      selectedClipIds: new Set(),
      warnings: [{
        code: 'track-locked',
        clipId: clip.id,
        trackId: track.id,
        message: `Cannot split ${clip.name ?? clip.id} because its track is locked.`,
      }],
    };
  }

  const linkedClip = operation.includeLinked !== false && clip.linkedClipId
    ? clips.find(candidate => candidate.id === clip.linkedClipId)
    : undefined;
  const linkedTrack = linkedClip ? getTrackForClip(linkedClip, tracks) : undefined;
  if (linkedTrack?.locked === true) {
    return {
      clips,
      changedClipIds: [],
      selectedClipIds: new Set(),
      warnings: [{
        code: 'track-locked',
        clipId: linkedClip?.id,
        trackId: linkedTrack.id,
        message: `Cannot split linked clip ${linkedClip?.name ?? linkedClip?.id} because its track is locked.`,
      }],
    };
  }

  const splitTimes = getValidSplitTimes(clip, operation.times);
  if (splitTimes.length === 0) {
    return {
      clips,
      changedClipIds: [],
      selectedClipIds: new Set(),
      warnings: [{
        code: 'no-op',
        clipId: clip.id,
        message: 'No valid split times are inside the clip range.',
      }],
    };
  }

  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 7);
  const boundaries = [clip.startTime, ...splitTimes, clip.startTime + clip.duration];
  const newParts: TimelineClip[] = [];
  const newLinkedParts: TimelineClip[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const partStart = boundaries[index];
    const partEnd = boundaries[index + 1];
    const partDuration = partEnd - partStart;
    const partInPoint = clip.inPoint + (partStart - clip.startTime);
    const partOutPoint = partInPoint + partDuration;
    const partId = `clip-${timestamp}-${randomSuffix}-p${index}`;
    const linkedPartId = linkedClip ? `clip-${timestamp}-${randomSuffix}-lp${index}` : undefined;

    newParts.push({
      ...clip,
      ...deepCloneClipProps(clip),
      id: partId,
      startTime: partStart,
      duration: partDuration,
      inPoint: partInPoint,
      outPoint: partOutPoint,
      storyboardProperties: cloneStoryboardPropertiesForSplit(clip.storyboardProperties, index),
      linkedClipId: linkedPartId,
      source: index === 0 ? getSourceForFirstSplitPart(clip) : cloneSourceForPart(clip),
      transitionIn: index === 0 ? clip.transitionIn : undefined,
      transitionOut: index === boundaries.length - 2 ? clip.transitionOut : undefined,
    });

    if (linkedClip && linkedPartId) {
      const linkedInPoint = linkedClip.inPoint + (partStart - clip.startTime);
      newLinkedParts.push({
        ...linkedClip,
        ...deepCloneClipProps(linkedClip),
        id: linkedPartId,
        startTime: partStart,
        duration: partDuration,
        inPoint: linkedInPoint,
        outPoint: linkedInPoint + partDuration,
        storyboardProperties: cloneStoryboardPropertiesForSplit(linkedClip.storyboardProperties, index),
        linkedClipId: partId,
        source: index === 0
          ? getSourceForFirstSplitPart(linkedClip)
          : cloneLinkedSourceForPart(linkedClip),
        transitionIn: index === 0 ? linkedClip.transitionIn : undefined,
        transitionOut: index === boundaries.length - 2 ? linkedClip.transitionOut : undefined,
      });
    }
  }

  const removedIds = new Set([clip.id, ...(linkedClip ? [linkedClip.id] : [])]);
  const linkedFirstPart = newLinkedParts[0];
  const linkedLastPart = newLinkedParts[newLinkedParts.length - 1];
  const parentReplacements: SplitMotionParentReplacement[] = [{
    originalClipId: clip.id,
    replacementClipIds: newParts.map((part) => part.id),
  }, ...(linkedClip
    ? [{
        originalClipId: linkedClip.id,
        replacementClipIds: newLinkedParts.map((part) => part.id),
      }]
    : [])];
  const provisionalClips = [
    ...clips,
    ...newParts,
    ...newLinkedParts,
  ];
  const detachedChildIds = collectMotionParentClipIdsDetachedBySplit(
    provisionalClips.filter((candidate) => !removedIds.has(candidate.id)),
    parentReplacements,
  );
  const lockedDetachedChild = clips.find((candidate) => (
    detachedChildIds.includes(candidate.id)
    && tracks.find((track) => track.id === candidate.trackId)?.locked === true
  ));
  if (parentPreservation && lockedDetachedChild) {
    return {
      clips,
      changedClipIds: [],
      selectedClipIds: new Set(),
      warnings: [{
        code: 'track-locked',
        clipId: lockedDetachedChild.id,
        trackId: lockedDetachedChild.trackId,
        message: 'Cannot preserve a parented child on a locked track.',
      }],
    };
  }
  let sourceClips = clips;
  let nextClipKeyframes: Map<string, Keyframe[]> | undefined;
  if (parentPreservation && detachedChildIds.length > 0) {
    const preserved = clearMotionParentsPreservingWorld(
      clips,
      detachedChildIds,
      { ...parentPreservation, timelineTime: splitTimes[0] },
    );
    if (!preserved.ok) {
      return {
        clips,
        changedClipIds: [],
        selectedClipIds: new Set(),
        warnings: [{ code: 'unsupported', message: preserved.message }],
      };
    }
    sourceClips = preserved.clips;
    nextClipKeyframes = preserved.clipKeyframes;
  }
  const transitionRemappedClips = remapTransitionLinksForSplitReplacements([
    ...sourceClips.filter(candidate => !removedIds.has(candidate.id)),
    ...newParts,
    ...newLinkedParts,
  ].map(candidate => candidate.linkedClipId && removedIds.has(candidate.linkedClipId)
    ? { ...candidate, linkedClipId: undefined }
    : candidate), [
    {
      originalClipId: clip.id,
      incomingReplacementClipId: newParts[0].id,
      outgoingReplacementClipId: newParts[newParts.length - 1].id,
    },
    ...(linkedClip && linkedFirstPart && linkedLastPart
      ? [{
          originalClipId: linkedClip.id,
          incomingReplacementClipId: linkedFirstPart.id,
          outgoingReplacementClipId: linkedLastPart.id,
        }]
      : []),
  ]);
  const finalClips = remapMotionParentLinksForSplitReplacements(
    transitionRemappedClips,
    parentReplacements,
  );

  return {
    clips: finalClips,
    changedClipIds: [clip.id, ...(linkedClip ? [linkedClip.id] : []), ...newParts.map(part => part.id), ...newLinkedParts.map(part => part.id)],
    selectedClipIds: new Set([newParts[newParts.length - 1]?.id].filter(Boolean) as string[]),
    warnings,
    ...(nextClipKeyframes ? { clipKeyframes: nextClipKeyframes } : {}),
  };
}
