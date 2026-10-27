import type {
  ClipAudioEditOperation,
  ClipAudioRegionGainPreview,
} from '../../types';
import { Logger } from '../../services/logger';
import type {
  AudioEditActions,
  ApplyAudioRegionGainEditOptions,
  SliceCreator,
} from './types';
import { clearProcessedAudioAnalysisRefs } from './helpers/audioAnalysisStateHelpers';
import { createAudioRepairSuggestionOperation } from '../../services/audio/audioRepairSuggestionOperations';
import {
  clampRegionFadeSeconds,
  clampRegionGainDb,
  createAudioEditOperationId,
  findMatchingRegionGainOperationIndex,
  getClipMediaFileId,
  isAudioClip,
  operationLabel,
} from './audioEdit/audioEditHelpers';
import { createAudioBakeActions } from './audioEdit/audioBakeActions';
import { createAudioDetectionActions } from './audioEdit/audioDetectionActions';
import { createSpectralAudioActions } from './audioEdit/spectralAudioActions';
import { createAudioTransientActions } from './audioEdit/audioTransientActions';
import { captureSnapshot } from '../historyStore';

const log = Logger.create('TimelineAudioEdit');

export const createAudioEditSlice: SliceCreator<AudioEditActions> = (set, get) => ({
  applyAudioRegionEdit: (type, options = {}) => {
    const { audioRegionSelection, clips, tracks } = get();
    if (!audioRegionSelection) {
      log.warn('Cannot apply audio edit without an active region selection');
      return null;
    }

    const clip = clips.find(c => c.id === audioRegionSelection.clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot apply audio edit to missing or non-audio clip', {
        clipId: audioRegionSelection.clipId,
      });
      return null;
    }

    const track = tracks.find(t => t.id === audioRegionSelection.trackId);
    if (track?.locked) {
      log.warn('Cannot apply audio edit on locked track', {
        clipId: clip.id,
        trackId: audioRegionSelection.trackId,
      });
      return null;
    }

    const start = Math.max(0, Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint));
    const end = Math.max(start, Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint));
    if (end - start <= 0.0005) {
      log.warn('Cannot apply audio edit to an empty region', { clipId: clip.id, start, end });
      return null;
    }

    const operation: ClipAudioEditOperation = {
      id: createAudioEditOperationId(),
      type,
      enabled: true,
      params: {
        label: operationLabel(type),
        timelineStart: audioRegionSelection.startTime,
        timelineEnd: audioRegionSelection.endTime,
        preserveClipDuration: true,
        ...(options.params ?? {}),
      },
      timeRange: { start, end },
      ...(options.channelMask ? { channelMask: [...options.channelMask] } : {}),
      createdAt: Date.now(),
    };

    captureSnapshot(operationLabel(type));
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clip.id) return currentClip;
        const audioState = currentClip.audioState ?? {};
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            editStack: [
              ...(audioState.editStack ?? []),
              operation,
            ],
          },
        });
      }),
      ...(options.keepSelection ? {} : { audioRegionSelection: null }),
    });
    get().invalidateCache();
    return operation.id;
  },

  setAudioRegionGainPreview: (preview: ClipAudioRegionGainPreview | null) => {
    set({ audioRegionGainPreview: preview });
  },

  clearAudioRegionGainPreview: () => {
    set({ audioRegionGainPreview: null });
  },

  setAudioRegionGainEdit: (options: ApplyAudioRegionGainEditOptions) => {
    const { audioRegionSelection, clips, tracks } = get();
    if (!audioRegionSelection) {
      log.warn('Cannot set region gain without an active audio region selection');
      return null;
    }

    const clip = clips.find(c => c.id === audioRegionSelection.clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot set region gain on missing or non-audio clip', {
        clipId: audioRegionSelection.clipId,
      });
      return null;
    }

    const track = tracks.find(t => t.id === audioRegionSelection.trackId);
    if (track?.locked) {
      log.warn('Cannot set region gain on locked track', {
        clipId: clip.id,
        trackId: audioRegionSelection.trackId,
      });
      return null;
    }

    const start = Math.max(0, Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint));
    const end = Math.max(start, Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint));
    const duration = end - start;
    if (duration <= 0.0005) {
      log.warn('Cannot set region gain on an empty region', { clipId: clip.id, start, end });
      return null;
    }

    const gainDb = Number(clampRegionGainDb(options.gainDb).toFixed(2));
    const fadeInSeconds = Number(clampRegionFadeSeconds(options.fadeInSeconds, duration / 2).toFixed(4));
    const fadeOutSeconds = Number(clampRegionFadeSeconds(options.fadeOutSeconds, duration / 2).toFixed(4));
    const isNoop = Math.abs(gainDb) <= 0.01;
    const existingGainIndex = findMatchingRegionGainOperationIndex(clip.audioState?.editStack ?? [], start, end);
    if (isNoop && existingGainIndex < 0) {
      set({ audioRegionGainPreview: null });
      return null;
    }
    let operationId: string | null = null;

    captureSnapshot(isNoop ? 'Reset region gain' : 'Set region gain');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clip.id) return currentClip;
        const audioState = currentClip.audioState ?? {};
        const editStack = audioState.editStack ?? [];
        const existingIndex = findMatchingRegionGainOperationIndex(editStack, start, end);

        if (isNoop) {
          if (existingIndex < 0) return currentClip;
          return clearProcessedAudioAnalysisRefs({
            ...currentClip,
            audioState: {
              ...audioState,
              editStack: editStack.filter((_, index) => index !== existingIndex),
            },
          });
        }

        const nextOperation: ClipAudioEditOperation = {
          id: existingIndex >= 0 ? editStack[existingIndex].id : createAudioEditOperationId(),
          type: 'gain',
          enabled: true,
          params: {
            label: 'Region gain',
            timelineStart: audioRegionSelection.startTime,
            timelineEnd: audioRegionSelection.endTime,
            preserveClipDuration: true,
            gainDb,
            fadeInSeconds,
            fadeOutSeconds,
          },
          timeRange: { start, end },
          createdAt: existingIndex >= 0 ? editStack[existingIndex].createdAt : Date.now(),
        };
        operationId = nextOperation.id;

        const nextEditStack = existingIndex >= 0
          ? editStack.map((operation, index) => index === existingIndex ? nextOperation : operation)
          : [...editStack, nextOperation];

        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            editStack: nextEditStack,
          },
        });
      }),
      ...(options.keepSelection ? {} : { audioRegionSelection: null }),
      audioRegionGainPreview: null,
    });
    get().invalidateCache();
    return operationId;
  },

  setClipAudioEditOperationRange: (clipId, operationIds, selection, options = {}) => {
    if (operationIds.length === 0) return;

    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot move audio edit on locked track', { clipId, operationIds });
      return;
    }

    const operationIdSet = new Set(operationIds);
    const start = Math.max(0, Math.min(selection.sourceInPoint, selection.sourceOutPoint));
    const end = Math.max(start, Math.max(selection.sourceInPoint, selection.sourceOutPoint));
    if (end - start <= 0.0005) return;

    let changed = false;
    const nextClips = clips.map(currentClip => {
      if (currentClip.id !== clipId || !currentClip.audioState?.editStack?.length) return currentClip;

      const nextEditStack = currentClip.audioState.editStack.map(operation => {
        if (!operationIdSet.has(operation.id) || !operation.timeRange) return operation;

        const previousStart = Math.min(operation.timeRange.start, operation.timeRange.end);
        const previousEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
        const previousTimelineStart = typeof operation.params.timelineStart === 'number'
          ? operation.params.timelineStart
          : null;
        const previousTimelineEnd = typeof operation.params.timelineEnd === 'number'
          ? operation.params.timelineEnd
          : null;
        const nextTimelineStart = Math.min(selection.startTime, selection.endTime);
        const nextTimelineEnd = Math.max(selection.startTime, selection.endTime);

        if (
          Math.abs(previousStart - start) <= 0.0005 &&
          Math.abs(previousEnd - end) <= 0.0005 &&
          previousTimelineStart !== null &&
          previousTimelineEnd !== null &&
          Math.abs(previousTimelineStart - nextTimelineStart) <= 0.0005 &&
          Math.abs(previousTimelineEnd - nextTimelineEnd) <= 0.0005
        ) {
          return operation;
        }

        changed = true;
        return {
          ...operation,
          params: {
            ...operation.params,
            timelineStart: nextTimelineStart,
            timelineEnd: nextTimelineEnd,
          },
          timeRange: { start, end },
        };
      });

      return clearProcessedAudioAnalysisRefs({
        ...currentClip,
        audioState: {
          ...currentClip.audioState,
          editStack: nextEditStack,
        },
      });
    });

    if (!changed) return;
    if (options.captureHistory) {
      captureSnapshot(options.historyLabel ?? 'Move audio region edit');
    }
    set({ clips: nextClips });
    get().invalidateCache();
  },

  applyAudioRepairSuggestion: (clipId, suggestion) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot apply repair suggestion to missing or non-audio clip', { clipId });
      return null;
    }

    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot apply repair suggestion on locked track', { clipId, trackId: clip.trackId });
      return null;
    }

    const operation = createAudioRepairSuggestionOperation(clip, suggestion, {
      id: createAudioEditOperationId(),
      createdAt: Date.now(),
    });
    if (!operation) {
      log.warn('Cannot apply repair suggestion to an empty clip range', { clipId });
      return null;
    }

    captureSnapshot(`Apply ${suggestion.label}`);
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        const audioState = currentClip.audioState ?? {};
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            editStack: [
              ...(audioState.editStack ?? []),
              operation,
            ],
          },
        });
      }),
    });
    get().invalidateCache();
    return operation.id;
  },

  ...createAudioDetectionActions(set, get),
  ...createAudioTransientActions(set, get),

  copySelectedAudioRegion: () => {
    const { audioRegionSelection, clips } = get();
    if (!audioRegionSelection) {
      log.warn('Cannot copy audio without an active region selection');
      return false;
    }

    const clip = clips.find(c => c.id === audioRegionSelection.clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot copy audio from missing or non-audio clip', {
        clipId: audioRegionSelection.clipId,
      });
      return false;
    }

    const sourceInPoint = Math.min(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    const sourceOutPoint = Math.max(audioRegionSelection.sourceInPoint, audioRegionSelection.sourceOutPoint);
    if (sourceOutPoint - sourceInPoint <= 0.0005) {
      log.warn('Cannot copy an empty audio region', { clipId: clip.id });
      return false;
    }

    set({
      audioRegionClipboard: {
        sourceClipId: clip.id,
        sourceTrackId: audioRegionSelection.trackId,
        sourceMediaFileId: getClipMediaFileId(clip),
        sourceAudioRevisionId: clip.audioState?.sourceAudioRevisionId,
        startTime: audioRegionSelection.startTime,
        endTime: audioRegionSelection.endTime,
        sourceInPoint,
        sourceOutPoint,
        duration: sourceOutPoint - sourceInPoint,
        copiedAt: Date.now(),
      },
    });
    return true;
  },

  pasteAudioRegionToSelection: () => {
    const { audioRegionClipboard, audioRegionSelection } = get();
    if (!audioRegionClipboard) {
      log.warn('Cannot paste audio without copied audio region data');
      return null;
    }
    if (!audioRegionSelection) {
      log.warn('Cannot paste audio without an active target region selection');
      return null;
    }

    return get().applyAudioRegionEdit('paste', {
      keepSelection: true,
      params: {
        label: 'Paste region',
        sourceClipId: audioRegionClipboard.sourceClipId,
        sourceTrackId: audioRegionClipboard.sourceTrackId,
        sourceMediaFileId: audioRegionClipboard.sourceMediaFileId ?? null,
        sourceAudioRevisionId: audioRegionClipboard.sourceAudioRevisionId ?? null,
        sourceInPoint: audioRegionClipboard.sourceInPoint,
        sourceOutPoint: audioRegionClipboard.sourceOutPoint,
        sourceDuration: audioRegionClipboard.duration,
        replaceSelection: true,
      },
    });
  },

  setClipAudioEditOperationEnabled: (clipId, operationId, enabled) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot toggle audio edit on locked track', { clipId, operationId });
      return;
    }

    captureSnapshot(enabled ? 'Enable audio edit' : 'Bypass audio edit');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.editStack?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            editStack: currentClip.audioState.editStack.map(operation =>
              operation.id === operationId ? { ...operation, enabled } : operation
            ),
          },
        });
      }),
    });
    get().invalidateCache();
  },

  setClipAudioMuted: (clipId, muted) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) {
      log.warn('Cannot mute a missing clip', { clipId });
      return;
    }
    if (tracks.find(t => t.id === clip.trackId)?.locked) {
      log.warn('Cannot mute a clip on a locked track', { clipId });
      return;
    }
    if ((clip.audioState?.muted === true) === muted) return;

    captureSnapshot(muted ? 'Mute clip' : 'Unmute clip');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        const { muted: _previous, ...audioState } = currentClip.audioState ?? {};
        // Mute is part of the processed-analysis identity (audioAnalysisIdentity.ts).
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: muted ? { ...audioState, muted: true } : audioState,
        });
      }),
    });
    get().invalidateCache();
  },

  removeClipAudioEditOperation: (clipId, operationId) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot remove audio edit on locked track', { clipId, operationId });
      return;
    }

    captureSnapshot('Remove audio edit');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.editStack?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            editStack: currentClip.audioState.editStack.filter(operation => operation.id !== operationId),
          },
        });
      }),
    });
    get().invalidateCache();
  },

  clearClipAudioEditStack: (clipId) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot clear audio edits on locked track', { clipId });
      return;
    }

    captureSnapshot('Clear audio edit stack');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.editStack?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            editStack: [],
          },
        });
      }),
    });
    get().invalidateCache();
  },

  ...createAudioBakeActions(set, get),

  ...createSpectralAudioActions(set, get),
});
