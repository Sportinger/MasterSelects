import type { TimelineClip, TimelineTrack } from '../../../types';
import type { SplitAtTimesOperation, TimelineEditWarning } from './types';

const SPLIT_EPSILON = 0.001;

export interface SplitAtTimesApplyResult {
  clips: TimelineClip[];
  changedClipIds: string[];
  selectedClipIds: Set<string>;
  warnings: TimelineEditWarning[];
}

export function isCompositionAudioClip(clip: Pick<TimelineClip, 'isComposition' | 'source'>): boolean {
  return clip.isComposition === true && clip.source?.type === 'audio';
}

export function stripCompositionAudioRuntimeSource(source: TimelineClip['source']): TimelineClip['source'] {
  if (!source || source.type !== 'audio') return source;
  const { audioElement: _audioElement, ...dataOnlySource } = source;
  return dataOnlySource;
}

export function stripTimelineMediaRuntimeSource(source: TimelineClip['source']): TimelineClip['source'] {
  if (!source || (source.type !== 'video' && source.type !== 'audio')) {
    return source;
  }

  const {
    videoElement: _videoElement,
    audioElement: _audioElement,
    webCodecsPlayer: _webCodecsPlayer,
    nativeDecoder: _nativeDecoder,
    ...dataOnlySource
  } = source;
  return dataOnlySource;
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
    ...(clip.analysis ? { analysis: structuredClone(clip.analysis) } : {}),
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
  const finalClips = [
    ...clips.filter(candidate => !removedIds.has(candidate.id)),
    ...newParts,
    ...newLinkedParts,
  ].map(candidate => candidate.linkedClipId && removedIds.has(candidate.linkedClipId)
    ? { ...candidate, linkedClipId: undefined }
    : candidate);

  return {
    clips: finalClips,
    changedClipIds: [clip.id, ...(linkedClip ? [linkedClip.id] : []), ...newParts.map(part => part.id), ...newLinkedParts.map(part => part.id)],
    selectedClipIds: new Set([newParts[newParts.length - 1]?.id].filter(Boolean) as string[]),
    warnings,
  };
}
