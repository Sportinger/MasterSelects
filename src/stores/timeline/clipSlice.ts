// Clip-related actions slice - Coordinator
// Delegates to specialized modules in ./clip/ and ./helpers/
// Reduced from ~2031 LOC to ~650 LOC (68% reduction)

import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { CoreClipActions, SliceCreator } from './types';
import { Logger } from '../../services/logger';
import { copyParameterKeyframesToParts, parameterSourceSplitPatch } from '../../services/parameterSources/parameterSourceLifecycle';
import { getPlayheadPosition } from '../../services/layerBuilder/PlayheadState';
import { getTimelineDurationForSourceWindow } from '../../utils/clipPlaybackTiming';
import { quantizeClipStartTime, quantizeFrameLockedClipTiming } from '../../utils/timelineFrameQuantization';
import { getActiveCompositionFrameRate } from './editOperations/activeCompositionFrameRate';
import { normalizeTimelinePropertyValue } from './keyframes/keyframePropertyValue';

const log = Logger.create('ClipSlice');

function isVisualClipSourceType(sourceType: string | undefined): boolean {
  return sourceType === 'video' ||
    sourceType === 'image' ||
    sourceType === 'text' ||
    sourceType === 'solid' ||
    sourceType === 'model' ||
    sourceType === 'camera' ||
    sourceType === 'light' ||
    sourceType === 'gaussian-avatar' ||
    sourceType === 'gaussian-splat' ||
    sourceType === 'splat-effector' ||
    sourceType === 'math-scene' ||
    sourceType === 'transition-overlay' ||
    sourceType === 'motion-shape' ||
    sourceType === 'motion-null' ||
    sourceType === 'motion-adjustment' ||
    sourceType === 'storyboard' ||
    sourceType === 'flock' ||
    isVectorAnimationSourceType(sourceType);
}

function isTrackLocked(tracks: TimelineTrack[], trackId: string | undefined): boolean {
  return !!trackId && tracks.find(t => t.id === trackId)?.locked === true;
}

function isClipOnLockedTrack(clips: TimelineClip[], tracks: TimelineTrack[], clipId: string): boolean {
  const clip = clips.find(c => c.id === clipId);
  return isTrackLocked(tracks, clip?.trackId);
}

// Import extracted modules
import { applyAddClipAction } from './clip/addClipAction';
import { replaceClipSourceAction } from './clip/replaceClipSourceAction';
import { replaceClipSourceWithCompositionAction } from './clip/replaceClipSourceWithCompositionAction';
import {
  applyAddCompClipAction,
  refreshCompClipNestedDataAction,
} from './clip/compositionClipActions';
import {
  cancelAudioAnalysisForClipAction,
  generateWaveformForClipAction,
} from './clip/clipWaveformAnalysisActions';
import { generateProcessedWaveformForClipAction } from './clip/clipProcessedWaveformAnalysisActions';
import {
  generateLoudnessForClipAction,
  generateSpectrogramForClipAction,
} from './clip/clipPreparedAudioAnalysisActions';
import {
  generateBeatOnsetForClipAction,
  generateFrequencyPhaseForClipAction,
} from './clip/clipRhythmFrequencyAnalysisActions';
import { generateAudioIntelligenceForClipAction } from './clip/clipAudioIntelligenceActions';
import { setClipParentAction, toggleClip3DAction } from './clip/clipMotionParentActions';
import {
  setClipPreservesPitchAction,
  setClipSpeedAction,
  setLinkedClipSpeedEnabledAction,
  toggleClipReverseAction,
} from './clip/clipSpeedActions';
import { generateMidiNoteId } from './helpers/idGenerator';
import { partitionMidiNotesAtCut } from '../../services/midi/midiClipTiming';
import { cleanupDeletedClipResources } from './deletedClipResources';
import {
  applyClipUpdatesWithAudioAnalysisInvalidation,
  clearProcessedAudioAnalysisRefs,
} from './helpers/audioAnalysisStateHelpers';
import {
  cloneLinkedSourceForPart,
  deepCloneClipProps,
  cloneSourceForPart,
  collectMotionParentClipIdsDetachedBySplit,
  getSourceForFirstSplitPart,
  remapMotionParentLinksForSplitReplacements,
  remapTransitionLinksForSplitReplacements,
} from './editOperations/splitBatchOperations';
import { applyDeleteClipsOperation } from './editOperations/deleteOperations';
import { copyFlockKeyframesToClipParts } from './editOperations/flockClipKeyframes';
import { clearMotionParentsPreservingWorld } from './editOperations/motionParentWorldPreservation';
import { cloneStoryboardPropertiesForSplit } from '../../services/storyboard/core';
import {
  clearTransitionsLinkedToRemovedClips,
  ensureTransitionCompositionsForChangedClips,
  setClipsAndCleanupTransitionComps,
} from './editOperations/transitionCompositionMaintenance';
import { isVectorAnimationSourceType } from '../../types/vectorAnimation';
import { useMediaStore } from '../mediaStore';

export const createClipSlice: SliceCreator<CoreClipActions> = (set, get) => ({
  addClip: (...args) => applyAddClipAction({ set, get }, ...args),

  addCompClip: (...args) => applyAddCompClipAction({ set, get }, ...args),

  replaceClipSource: (...args) => replaceClipSourceAction({ set, get }, ...args),

  replaceClipSourceWithComposition: (...args) => replaceClipSourceWithCompositionAction({ set, get }, ...args),

  removeClip: (id) => {
    const {
      clips,
      tracks,
      selectedClipIds,
      clipKeyframes,
      playheadPosition,
      updateDuration,
      invalidateCache,
    } = get();
    const clipToRemove = clips.find(c => c.id === id);
    if (!clipToRemove) return;

    // Determine whether to also remove the linked clip:
    // Only remove linked clip if it is also currently selected
    const linkedId = clipToRemove.linkedClipId;
    const removeLinked = !!(linkedId && selectedClipIds.has(linkedId));
    const idsToRemove = new Set([id]);
    if (removeLinked && linkedId) idsToRemove.add(linkedId);
    if ([...idsToRemove].some(removeId => isClipOnLockedTrack(clips, tracks, removeId))) {
      log.warn('Cannot remove clip from locked track', { id });
      return;
    }

    const result = applyDeleteClipsOperation({
      id: `remove-clip:${id}`,
      type: 'delete-clips',
      clipIds: [...idsToRemove],
      includeLinked: false,
    }, clips, tracks, selectedClipIds, {
      clipKeyframes,
      timelineTime: getPlayheadPosition(playheadPosition),
    });
    if (result.changedClipIds.length === 0) {
      log.warn('Cannot remove clip while preserving Motion parent world transforms', {
        id,
        warnings: result.warnings.map((warning) => warning.message),
      });
      return;
    }

    cleanupDeletedClipResources(result.deletedClips);
    const updatedClips = clearTransitionsLinkedToRemovedClips(result.clips, idsToRemove);

    setClipsAndCleanupTransitionComps(set, clips, {
      clips: updatedClips,
      ...(result.clipKeyframes ? { clipKeyframes: result.clipKeyframes } : {}),
      selectedClipIds: result.selectedClipIds,
    });
    const referencedCompositionIds = new Set(
      updatedClips.map(clip => clip.compositionId).filter(Boolean),
    );
    const mediaState = useMediaStore.getState();
    for (const removedClip of clips.filter(clip => idsToRemove.has(clip.id))) {
      const compositionId = removedClip.compositionId;
      if (!compositionId || referencedCompositionIds.has(compositionId)) continue;
      const composition = mediaState.compositions.find(candidate => candidate.id === compositionId);
      if (
        composition?.captionComp?.kind === 'caption-comp'
        && composition.captionComp.parentCaptionClipId === removedClip.id
      ) {
        mediaState.removeComposition(compositionId);
      }
    }
    updateDuration();
    invalidateCache();
  },

  moveClip: (id, newStartTime, newTrackId, skipLinked = false, skipGroup = false, skipTrim = false, excludeClipIds?: string[]) => {
    const { clips, tracks, updateDuration, getSnappedPosition, getPositionWithResistance, trimOverlappingClips, invalidateCache } = get();
    const movingClip = clips.find(c => c.id === id);
    if (!movingClip) return;
    const frameRate = getActiveCompositionFrameRate();

    const targetTrackId = newTrackId ?? movingClip.trackId;
    if (isTrackLocked(tracks, movingClip.trackId) || isTrackLocked(tracks, targetTrackId)) {
      log.warn('Cannot move clip on or into locked track', { id, targetTrackId });
      return;
    }
    const linkedClip = clips.find(c => c.id === movingClip.linkedClipId || c.linkedClipId === id);
    if (linkedClip && !skipLinked && isTrackLocked(tracks, linkedClip.trackId)) {
      log.warn('Cannot move linked clip on locked track', { id, linkedClipId: linkedClip.id });
      return;
    }
    const groupClips = !skipGroup && movingClip.linkedGroupId
      ? clips.filter(c => c.linkedGroupId === movingClip.linkedGroupId && c.id !== id)
      : [];
    if (groupClips.some(groupClip => isTrackLocked(tracks, groupClip.trackId))) {
      log.warn('Cannot move linked group with clips on locked tracks', { id });
      return;
    }

    // Validate track type if changing tracks
    if (newTrackId && newTrackId !== movingClip.trackId) {
      const targetTrack = tracks.find(t => t.id === newTrackId);
      const sourceType = movingClip.source?.type;
      if (targetTrack && sourceType) {
        if (isVisualClipSourceType(sourceType) && targetTrack.type !== 'video') return;
        if (sourceType === 'audio' && targetTrack.type !== 'audio') return;
      }
    }

    const requestedStartTime = quantizeClipStartTime(movingClip, newStartTime, frameRate);
    const { startTime: snappedPosition } = getSnappedPosition(id, requestedStartTime, targetTrackId);
    const snappedTime = quantizeClipStartTime(movingClip, snappedPosition, frameRate);
    const resistanceResult = getPositionWithResistance(id, snappedTime, targetTrackId, movingClip.duration, undefined, excludeClipIds);
    let finalStartTime = quantizeClipStartTime(movingClip, resistanceResult.startTime, frameRate);
    let forcingOverlap = resistanceResult.forcingOverlap;
    const { noFreeSpace } = resistanceResult;

    // If a target lane cannot accept the clip, find an alternative or create a
    // new one. This also applies to same-track audio moves: audio never eats an
    // existing clip on drop.
    let actualTrackId = targetTrackId;
    const targetTrack = tracks.find(t => t.id === targetTrackId);
    if (noFreeSpace && (targetTrackId !== movingClip.trackId || targetTrack?.type === 'audio')) {
      if (targetTrack) {
        const altTracks = tracks.filter(t =>
          t.type === targetTrack.type && t.id !== targetTrackId && t.id !== movingClip.trackId && !t.locked
        );
        let found = false;
        for (const alt of altTracks) {
          const altResult = getPositionWithResistance(id, snappedTime, alt.id, movingClip.duration, undefined, excludeClipIds);
          if (!altResult.noFreeSpace) {
            actualTrackId = alt.id;
            finalStartTime = quantizeClipStartTime(movingClip, altResult.startTime, frameRate);
            forcingOverlap = altResult.forcingOverlap;
            found = true;
            break;
          }
        }
        if (!found) {
          // No existing track has space — create a new one
          actualTrackId = get().addTrack(targetTrack.type);
          finalStartTime = Math.max(0, snappedTime);
          forcingOverlap = false;
        }
      }
    }

    const timeDelta = finalStartTime - movingClip.startTime;

    let linkedFinalTime = linkedClip ? linkedClip.startTime + timeDelta : 0;
    let linkedFinalTrackId = linkedClip?.trackId;
    let linkedForcingOverlap = false;
    if (linkedClip && !skipLinked) {
      const linkedResult = getPositionWithResistance(linkedClip.id, linkedClip.startTime + timeDelta, linkedClip.trackId, linkedClip.duration, undefined, excludeClipIds);
      linkedFinalTime = quantizeClipStartTime(linkedClip, linkedResult.startTime, frameRate);
      linkedForcingOverlap = linkedResult.forcingOverlap;
      const linkedTrack = get().tracks.find(track => track.id === linkedClip.trackId);
      if (linkedResult.noFreeSpace && linkedTrack?.type === 'audio') {
        const alternativeTracks = get().tracks.filter(track =>
          track.type === 'audio' && track.id !== linkedClip.trackId && !track.locked
        );
        let foundAlternative = false;
        for (const alternativeTrack of alternativeTracks) {
          const alternativeResult = getPositionWithResistance(
            linkedClip.id,
            linkedClip.startTime + timeDelta,
            alternativeTrack.id,
            linkedClip.duration,
            undefined,
            excludeClipIds,
          );
          if (alternativeResult.noFreeSpace) continue;
          linkedFinalTrackId = alternativeTrack.id;
          linkedFinalTime = quantizeClipStartTime(linkedClip, alternativeResult.startTime, frameRate);
          linkedForcingOverlap = alternativeResult.forcingOverlap;
          foundAlternative = true;
          break;
        }
        if (!foundAlternative) {
          linkedFinalTrackId = get().addTrack('audio');
          linkedFinalTime = Math.max(0, linkedClip.startTime + timeDelta);
          linkedForcingOverlap = false;
        }
      }
    }

    const previousClips = clips;
    set({
      clips: clips.map(c => {
        if (c.id === id) return { ...c, startTime: Math.max(0, finalStartTime), trackId: actualTrackId };
        if (!skipLinked && (c.id === movingClip.linkedClipId || c.linkedClipId === id)) {
          return { ...c, startTime: Math.max(0, linkedFinalTime), trackId: linkedFinalTrackId ?? c.trackId };
        }
        if (!skipGroup && groupClips.some(gc => gc.id === c.id)) {
          const groupResult = getPositionWithResistance(c.id, c.startTime + timeDelta, c.trackId, c.duration);
          return { ...c, startTime: quantizeClipStartTime(c, groupResult.startTime, frameRate) };
        }
        return c;
      }),
    });

    if (forcingOverlap && !skipTrim) trimOverlappingClips(id, finalStartTime, actualTrackId, movingClip.duration, excludeClipIds);
    if (linkedForcingOverlap && linkedClip && !skipLinked && !skipTrim) {
      trimOverlappingClips(linkedClip.id, linkedFinalTime, linkedFinalTrackId ?? linkedClip.trackId, linkedClip.duration, excludeClipIds);
    }
    ensureTransitionCompositionsForChangedClips(set, get, [
      id,
      ...(linkedClip && !skipLinked ? [linkedClip.id] : []),
      ...groupClips.map((groupClip) => groupClip.id),
    ], previousClips);

    updateDuration();
    invalidateCache();
  },

  trimClip: (id, inPoint, outPoint) => {
    const { clips, tracks, updateDuration, invalidateCache } = get();
    if (isClipOnLockedTrack(clips, tracks, id)) {
      log.warn('Cannot trim clip on locked track', { id });
      return;
    }
    setClipsAndCleanupTransitionComps(set, clips, {
      clips: clips.map(c => {
        if (c.id !== id) return c;
        return quantizeFrameLockedClipTiming(clearProcessedAudioAnalysisRefs({
          ...c,
          inPoint,
          outPoint,
          duration: getTimelineDurationForSourceWindow(c, inPoint, outPoint),
        }), getActiveCompositionFrameRate());
      }),
    });
    ensureTransitionCompositionsForChangedClips(set, get, [id], clips);
    updateDuration();
    invalidateCache();
  },

  splitClip: (clipId, splitTime) => {
    const { clips, tracks, clipKeyframes, updateDuration, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    if (isClipOnLockedTrack(clips, tracks, clipId) || (clip.linkedClipId && isClipOnLockedTrack(clips, tracks, clip.linkedClipId))) {
      log.warn('Cannot split clip on locked track', { clipId });
      return;
    }

    const clipEnd = clip.startTime + clip.duration;
    if (splitTime <= clip.startTime || splitTime >= clipEnd) {
      log.warn('Cannot split at edge or outside clip');
      return;
    }

    const firstPartDuration = splitTime - clip.startTime;
    const secondPartDuration = clip.duration - firstPartDuration;
    const splitInSource = clip.inPoint + firstPartDuration;

    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substr(2, 5);

    // MIDI clips have no external source file — the note data IS the content, so
    // a cut yields two INDEPENDENT clips (each owning its own rebased notes),
    // not two windows onto a shared array as with media. See partitionMidiNotesAtCut.
    if (clip.source?.type === 'midi') {
      const { left, right } = partitionMidiNotesAtCut(
        clip.midiData?.notes ?? [],
        { inPoint: clip.inPoint, outPoint: clip.outPoint },
        splitInSource,
        (source, rebased) => ({
          id: generateMidiNoteId(),
          pitch: source.pitch,
          velocity: source.velocity,
          start: rebased.start,
          duration: rebased.duration,
        }),
      );

      const midiFirstClip: TimelineClip = {
        ...clip,
        ...deepCloneClipProps(clip),
        id: `clip-${timestamp}-${randomSuffix}-a`,
        duration: firstPartDuration,
        inPoint: 0,
        outPoint: firstPartDuration,
        source: { type: 'midi', naturalDuration: firstPartDuration },
        midiData: { ...(clip.midiData ?? { notes: [] }), notes: left },
        linkedClipId: undefined,
        transitionOut: undefined,
        transitionIn: undefined,
      };
      const midiSecondClip: TimelineClip = {
        ...clip,
        ...deepCloneClipProps(clip),
        id: `clip-${timestamp}-${randomSuffix}-b`,
        startTime: splitTime,
        duration: secondPartDuration,
        inPoint: 0,
        outPoint: secondPartDuration,
        source: { type: 'midi', naturalDuration: secondPartDuration },
        midiData: { ...(clip.midiData ?? { notes: [] }), notes: right },
        linkedClipId: undefined,
        transitionIn: undefined,
        transitionOut: undefined,
      };

      const remaining = clips.filter(c => c.id !== clipId);
      remaining.push(midiFirstClip, midiSecondClip);
      setClipsAndCleanupTransitionComps(set, clips, {
        clips: remaining,
        selectedClipIds: new Set([midiSecondClip.id]),
      });
      updateDuration();
      invalidateCache();
      log.debug('Split MIDI clip', {
        clip: clip.name,
        splitTime: splitTime.toFixed(2),
        leftNotes: left.length,
        rightNotes: right.length,
      });
      return;
    }

    // Split parts carry serializable source metadata; runtime media elements are rebuilt on demand.
    const secondClipSource = cloneSourceForPart(clip);

    const firstClip: TimelineClip = {
      ...clip,
      ...deepCloneClipProps(clip),
      id: `clip-${timestamp}-${randomSuffix}-a`,
      duration: firstPartDuration,
      outPoint: splitInSource,
      linkedClipId: undefined,
      source: getSourceForFirstSplitPart(clip),
      transitionOut: undefined,
      storyboardProperties: cloneStoryboardPropertiesForSplit(clip.storyboardProperties, 0),
    };

    const secondClip: TimelineClip = {
      ...clip,
      ...deepCloneClipProps(clip),
      ...parameterSourceSplitPatch(clip, firstPartDuration),
      id: `clip-${timestamp}-${randomSuffix}-b`,
      startTime: splitTime,
      duration: secondPartDuration,
      inPoint: splitInSource,
      linkedClipId: undefined,
      source: secondClipSource,
      transitionIn: undefined,
      storyboardProperties: cloneStoryboardPropertiesForSplit(clip.storyboardProperties, 1),
    };

    let linkedFirstClip: TimelineClip | undefined;
    let linkedSecondClip: TimelineClip | undefined;
    if (clip.linkedClipId) {
      const linkedClip = clips.find(c => c.id === clip.linkedClipId);
      if (linkedClip) {
        const linkedSecondClipId = `clip-${timestamp}-${randomSuffix}-linked-b`;
        const linkedSecondSource = cloneLinkedSourceForPart(linkedClip);

        linkedFirstClip = {
          ...linkedClip,
          ...deepCloneClipProps(linkedClip),
          id: `clip-${timestamp}-${randomSuffix}-linked-a`,
          duration: firstPartDuration,
          outPoint: linkedClip.inPoint + firstPartDuration,
          linkedClipId: firstClip.id,
          source: getSourceForFirstSplitPart(linkedClip),
          storyboardProperties: cloneStoryboardPropertiesForSplit(linkedClip.storyboardProperties, 0),
        };
        linkedSecondClip = {
          ...linkedClip,
          ...deepCloneClipProps(linkedClip),
          ...parameterSourceSplitPatch(linkedClip, firstPartDuration),
          id: linkedSecondClipId,
          startTime: splitTime,
          duration: secondPartDuration,
          inPoint: linkedClip.inPoint + firstPartDuration,
          linkedClipId: secondClip.id,
          source: linkedSecondSource,
          storyboardProperties: cloneStoryboardPropertiesForSplit(linkedClip.storyboardProperties, 1),
        };
        firstClip.linkedClipId = linkedFirstClip.id;
        secondClip.linkedClipId = linkedSecondClip.id;
      }
    }

    const removedIds = new Set([clipId, ...(clip.linkedClipId ? [clip.linkedClipId] : [])]);
    const parentReplacements = [{
      originalClipId: clip.id,
      replacementClipIds: [firstClip.id, secondClip.id],
    }, ...(linkedFirstClip && linkedSecondClip && clip.linkedClipId
      ? [{
          originalClipId: clip.linkedClipId,
          replacementClipIds: [linkedFirstClip.id, linkedSecondClip.id],
        }]
      : [])];
    const detachedChildIds = collectMotionParentClipIdsDetachedBySplit([
      ...clips.filter((candidate) => !removedIds.has(candidate.id)),
      firstClip,
      secondClip,
      ...(linkedFirstClip && linkedSecondClip ? [linkedFirstClip, linkedSecondClip] : []),
    ], parentReplacements);
    const lockedDetachedChildId = detachedChildIds.find((childId) => (
      isClipOnLockedTrack(clips, tracks, childId)
    ));
    if (lockedDetachedChildId) {
      log.warn('Cannot split while a detached Motion child is on a locked track', {
        clipId,
        childClipId: lockedDetachedChildId,
      });
      return;
    }
    let sourceClips = clips;
    let preservedClipKeyframes: Map<string, Keyframe[]> | undefined;
    if (detachedChildIds.length > 0) {
      const preserved = clearMotionParentsPreservingWorld(
        clips,
        detachedChildIds,
        { clipKeyframes, timelineTime: splitTime },
      );
      if (!preserved.ok) {
        log.warn('Cannot split clip while preserving Motion child world transforms', {
          clipId,
          message: preserved.message,
        });
        return;
      }
      sourceClips = preserved.clips;
      preservedClipKeyframes = preserved.clipKeyframes;
    }

    const newClips: TimelineClip[] = sourceClips.filter((candidate) => !removedIds.has(candidate.id));
    if (linkedFirstClip && linkedSecondClip) {
      newClips.push(linkedFirstClip, linkedSecondClip);
    }
    newClips.push(firstClip, secondClip);
    const transitionRemappedClips = remapTransitionLinksForSplitReplacements(newClips, [
      {
        originalClipId: clip.id,
        incomingReplacementClipId: firstClip.id,
        outgoingReplacementClipId: secondClip.id,
      },
      ...(linkedFirstClip && linkedSecondClip && clip.linkedClipId
        ? [{
            originalClipId: clip.linkedClipId,
            incomingReplacementClipId: linkedFirstClip.id,
            outgoingReplacementClipId: linkedSecondClip.id,
          }]
      : []),
    ]);
    const remappedClips = remapMotionParentLinksForSplitReplacements(
      transitionRemappedClips,
      parentReplacements,
    );
    const changedClipIds = [
      clip.id,
      firstClip.id,
      secondClip.id,
      ...(linkedFirstClip && linkedSecondClip && clip.linkedClipId
        ? [clip.linkedClipId, linkedFirstClip.id, linkedSecondClip.id]
        : []),
    ];
    const flockPartKeyframes = clip.source?.type === 'flock'
      ? copyFlockKeyframesToClipParts(preservedClipKeyframes ?? clipKeyframes, clip.id, [firstClip.id, secondClip.id])
      : null;
    let nextClipKeyframes = copyParameterKeyframesToParts(flockPartKeyframes ?? preservedClipKeyframes ?? clipKeyframes, clip, [firstClip, secondClip]);
    const originalLinked = clips.find(candidate => candidate.id === clip.linkedClipId);
    if (originalLinked && linkedFirstClip && linkedSecondClip) nextClipKeyframes = copyParameterKeyframesToParts(nextClipKeyframes, originalLinked, [linkedFirstClip, linkedSecondClip]);
    setClipsAndCleanupTransitionComps(set, clips, {
      clips: remappedClips,
      ...(nextClipKeyframes ? { clipKeyframes: nextClipKeyframes } : {}),
      selectedClipIds: new Set([secondClip.id]),
    });
    ensureTransitionCompositionsForChangedClips(set, get, changedClipIds, clips);
    updateDuration();
    invalidateCache();
    log.debug('Split clip', { clip: clip.name, splitTime: splitTime.toFixed(2) });
  },

  splitClipAtPlayhead: () => {
    const { clips, playheadPosition, selectedClipIds, applyTimelineEditOperation } = get();
    const clipsAtPlayhead = clips.filter(c =>
      playheadPosition > c.startTime && playheadPosition < c.startTime + c.duration
    );

    if (clipsAtPlayhead.length === 0) {
      log.warn('No clip at playhead position');
      return;
    }

    let clipsToSplit = selectedClipIds.size > 0
      ? clipsAtPlayhead.filter(c => selectedClipIds.has(c.id))
      : clipsAtPlayhead;

    if (clipsToSplit.length === 0) clipsToSplit = clipsAtPlayhead;

    applyTimelineEditOperation({
      id: `split-at-playhead:${playheadPosition}`,
      type: 'split-at-time',
      clipIds: clipsToSplit.map((clip) => clip.id),
      time: playheadPosition,
      includeLinked: true,
    }, {
      source: 'shortcut',
      historyLabel: 'Split at playhead',
    });
  },

  updateClip: (id, updates) => {
    const { clips, tracks, updateDuration } = get();
    if (isClipOnLockedTrack(clips, tracks, id)) {
      log.warn('Cannot update clip on locked track', { id });
      return;
    }
    setClipsAndCleanupTransitionComps(set, clips, {
      clips: clips.map(c => c.id === id ? applyClipUpdatesWithAudioAnalysisInvalidation(c, updates) : c),
    });
    ensureTransitionCompositionsForChangedClips(set, get, [id], clips);
    updateDuration();
  },

  updateClipTransform: (id, transform) => {
    const { clips, tracks, invalidateCache } = get();
    if (isClipOnLockedTrack(clips, tracks, id)) {
      log.warn('Cannot update clip transform on locked track', { id });
      return;
    }
    const normalizedTransform = transform.opacity === undefined
      ? transform
      : {
          ...transform,
          opacity: normalizeTimelinePropertyValue('opacity', transform.opacity),
        };
    set({
      clips: clips.map(c => {
        if (c.id !== id) return c;
        return {
          ...c,
          transform: {
            ...c.transform,
            ...normalizedTransform,
            position: normalizedTransform.position ? { ...c.transform.position, ...normalizedTransform.position } : c.transform.position,
            anchor: normalizedTransform.anchor ? { ...(c.transform.anchor ?? { x: 0, y: 0, z: 0 }), ...normalizedTransform.anchor } : c.transform.anchor,
            scale: normalizedTransform.scale ? { ...c.transform.scale, ...normalizedTransform.scale } : c.transform.scale,
            rotation: normalizedTransform.rotation ? { ...c.transform.rotation, ...normalizedTransform.rotation } : c.transform.rotation,
          },
        };
      }),
    });
    invalidateCache();
  },

  toggleClipReverse: (id) => toggleClipReverseAction({ set, get }, id),

  // ========== WAVEFORM GENERATION ==========

  cancelAudioAnalysisForClip: (clipId) => cancelAudioAnalysisForClipAction({ set, get }, clipId),
  generateWaveformForClip: (clipId, options = {}) => generateWaveformForClipAction({ set, get }, clipId, options),
  generateProcessedWaveformForClip: (clipId, options = {}) => generateProcessedWaveformForClipAction({ set, get }, clipId, options),

  generateSpectrogramForClip: (clipId, options = {}) => generateSpectrogramForClipAction({ set, get }, clipId, options),
  generateLoudnessForClip: (clipId, options = {}) => generateLoudnessForClipAction({ set, get }, clipId, options),
  generateBeatOnsetForClip: (clipId, options = {}) => generateBeatOnsetForClipAction({ set, get }, clipId, options),
  generateFrequencyPhaseForClip: (clipId, options = {}) => generateFrequencyPhaseForClipAction({ set, get }, clipId, options),
  generateAudioIntelligenceForClip: (clipId, options = {}) => generateAudioIntelligenceForClipAction({ set, get }, clipId, options),

  // ========== PARENTING (PICK WHIP) ==========

  setClipParent: (...args) => setClipParentAction({ set, get }, ...args),

  getClipChildren: (clipId: string) => {
    return get().clips.filter(c => c.parentClipId === clipId);
  },

  setClipSpeed: (...args) => setClipSpeedAction({ set, get }, ...args),

  setLinkedClipSpeedEnabled: (...args) => setLinkedClipSpeedEnabledAction({ set, get }, ...args),

  setClipPreservesPitch: (...args) => setClipPreservesPitchAction({ set, get }, ...args),

  refreshCompClipNestedData: (sourceCompositionId) => refreshCompClipNestedDataAction({ set, get }, sourceCompositionId),

  toggle3D: (clipId) => toggleClip3DAction({ set, get }, clipId),
});
