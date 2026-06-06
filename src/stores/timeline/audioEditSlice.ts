import type {
  AudioBakeRestoreState,
  ClipAudioEditOperation,
  ClipAudioRegionGainPreview,
  SpectralImageLayer,
} from '../../types';
import { encodeAudioBufferToWavBlob } from '../../engine/audio/AudioFileEncoder';
import { AudioExtractor, audioExtractor } from '../../engine/audio/AudioExtractor';
import { Logger } from '../../services/logger';
import type {
  AudioEditActions,
  ApplyAudioRegionGainEditOptions,
  ApplyDetectedSilenceRemovalOptions,
  ApplyDetectedTransientSofteningOptions,
  SliceCreator,
  TimelineAudioRegionSelection,
  TimelineAudioRegionEditType,
  TimelineClip,
} from './types';
import { generateClipId } from './helpers/idGenerator';
import { clearProcessedAudioAnalysisRefs } from './helpers/audioAnalysisStateHelpers';
import { ClipAudioRenderService } from '../../services/audio/ClipAudioRenderService';
import {
  createAudioRepairSuggestionOperation,
  getClipAudioSourceRange,
} from '../../services/audio/audioRepairSuggestionOperations';
import {
  detectClipSilenceRanges as detectClipSilenceRangesForAudio,
  type AudioSilenceRange,
} from '../../services/audio/audioSilenceDetection';
import {
  detectClipTransientRanges as detectClipTransientRangesForAudio,
  type AudioTransientRange,
} from '../../services/audio/audioTransientDetection';
import { generateTimelineWaveformAnalysisForFile } from '../../services/audio/timelineWaveformPyramidCache';
import { PROJECT_FOLDERS } from '../../services/project/core/constants';
import { useMediaStore } from '../mediaStore';
import { captureSnapshot } from '../historyStore';

const log = Logger.create('TimelineAudioEdit');
const clipAudioRenderer = new ClipAudioRenderService();
const AUDIO_BAKE_MEDIA_FOLDER_NAME = 'Baked Audio';

function isAudioClip(clip: TimelineClip): boolean {
  const fileName = clip.file?.name || clip.name || '';
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return clip.source?.type === 'audio'
    || clip.file?.type?.startsWith('audio/') === true
    || ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus'].includes(extension);
}

function createAudioEditOperationId(): string {
  return generateClipId('audio-edit');
}

function operationLabel(type: TimelineAudioRegionEditType): string {
  switch (type) {
    case 'gain': return 'Region gain';
    case 'silence': return 'Silence region';
    case 'cut': return 'Cut region';
    case 'paste': return 'Paste region';
    case 'insert-silence': return 'Insert silence';
    case 'delete-silence': return 'Delete silence';
    case 'reverse': return 'Reverse region';
    case 'invert-polarity': return 'Invert polarity';
    case 'swap-channels': return 'Swap channels';
    case 'mono-sum': return 'Mono sum';
    case 'split-stereo': return 'Split stereo';
    case 'repair': return 'Repair region';
    case 'effect': return 'Region FX';
    case 'room-tone-fill': return 'Room tone fill';
  }
}

function clampRegionGainDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-120, Math.min(24, value));
}

function clampRegionFadeSeconds(value: number | undefined, maxSeconds: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.max(0, maxSeconds), value ?? 0));
}

function rangesMatch(
  operation: ClipAudioEditOperation,
  start: number,
  end: number,
): boolean {
  if (!operation.timeRange) return false;
  return Math.abs(Math.min(operation.timeRange.start, operation.timeRange.end) - start) <= 0.001 &&
    Math.abs(Math.max(operation.timeRange.start, operation.timeRange.end) - end) <= 0.001;
}

function findMatchingRegionGainOperationIndex(
  editStack: readonly ClipAudioEditOperation[],
  start: number,
  end: number,
): number {
  for (let index = editStack.length - 1; index >= 0; index -= 1) {
    const operation = editStack[index];
    if (operation?.type === 'gain' && rangesMatch(operation, start, end)) {
      return index;
    }
  }
  return -1;
}

function spectralOperationLabel(type: 'spectral-mask' | 'spectral-resynthesis'): string {
  switch (type) {
    case 'spectral-mask': return 'Spectral mask';
    case 'spectral-resynthesis': return 'Spectral resynthesis';
  }
}

function createSpectralLayerId(): string {
  return generateClipId('spectral-layer');
}

function normalizeSpectralLayer(layer: SpectralImageLayer): SpectralImageLayer {
  const frequencyMin = Math.max(0, Math.min(layer.frequencyMin, layer.frequencyMax));
  const frequencyMax = Math.max(frequencyMin, Math.max(layer.frequencyMin, layer.frequencyMax));
  const { keyframes: rawKeyframes, ...layerWithoutKeyframes } = layer;
  const keyframes = (rawKeyframes ?? [])
    .map(keyframe => {
      const normalized = {
        ...keyframe,
        time: Math.max(0, Math.min(Math.max(0.001, layer.duration), keyframe.time)),
      };
      if (typeof normalized.opacity === 'number') {
        normalized.opacity = Math.max(0, Math.min(1, normalized.opacity));
      }
      if (typeof normalized.gainDb === 'number') {
        normalized.gainDb = Math.max(-60, Math.min(24, normalized.gainDb));
      }
      if (typeof normalized.frequencyMin === 'number') {
        normalized.frequencyMin = Math.max(0, normalized.frequencyMin);
      }
      if (typeof normalized.frequencyMax === 'number') {
        normalized.frequencyMax = Math.max(0, normalized.frequencyMax);
      }
      if (
        typeof normalized.frequencyMin === 'number' &&
        typeof normalized.frequencyMax === 'number' &&
        normalized.frequencyMin > normalized.frequencyMax
      ) {
        const min = normalized.frequencyMax;
        normalized.frequencyMax = normalized.frequencyMin;
        normalized.frequencyMin = min;
      }
      return normalized;
    })
    .filter(keyframe => keyframe.id)
    .toSorted((a, b) => a.time - b.time);
  return {
    ...layerWithoutKeyframes,
    timeStart: Math.max(0, layer.timeStart),
    duration: Math.max(0.001, layer.duration),
    frequencyMin,
    frequencyMax,
    opacity: Math.max(0, Math.min(1, layer.opacity)),
    gainDb: Math.max(-60, Math.min(24, layer.gainDb)),
    featherTime: Math.max(0, layer.featherTime),
    featherFrequency: Math.max(0, layer.featherFrequency),
    ...(keyframes.length > 0 ? { keyframes } : {}),
  };
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

function sourceTimeToTimelineTime(clip: TimelineClip, sourceTime: number): number {
  const sourceRange = getClipAudioSourceRange(clip);
  const sourceSpan = Math.max(0.001, sourceRange.end - sourceRange.start);
  const ratio = Math.max(0, Math.min(1, (sourceTime - sourceRange.start) / sourceSpan));
  return clip.startTime + ratio * clip.duration;
}

function normalizeDetectedSilenceRanges(
  clip: TimelineClip,
  ranges: readonly AudioSilenceRange[],
): AudioSilenceRange[] {
  const sourceRange = getClipAudioSourceRange(clip);
  const normalized = ranges
    .map(range => {
      const start = Math.max(sourceRange.start, Math.min(sourceRange.end, Math.min(range.start, range.end)));
      const end = Math.max(sourceRange.start, Math.min(sourceRange.end, Math.max(range.start, range.end)));
      return {
        start,
        end,
        duration: Math.max(0, end - start),
        rmsDb: typeof range.rmsDb === 'number' && Number.isFinite(range.rmsDb) ? range.rmsDb : -120,
      };
    })
    .filter(range => range.duration > 0.01)
    .toSorted((a, b) => a.start - b.start);

  const merged: AudioSilenceRange[] = [];
  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 0.001) {
      previous.end = Math.max(previous.end, range.end);
      previous.duration = previous.end - previous.start;
      previous.rmsDb = Math.min(previous.rmsDb, range.rmsDb);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function normalizeDetectedTransientRanges(
  clip: TimelineClip,
  ranges: readonly AudioTransientRange[],
): AudioTransientRange[] {
  const sourceRange = getClipAudioSourceRange(clip);
  return ranges
    .map(range => {
      const start = Math.max(sourceRange.start, Math.min(sourceRange.end, Math.min(range.start, range.end)));
      const end = Math.max(sourceRange.start, Math.min(sourceRange.end, Math.max(range.start, range.end)));
      return {
        start,
        end,
        duration: Math.max(0, end - start),
        peakDb: typeof range.peakDb === 'number' && Number.isFinite(range.peakDb) ? range.peakDb : -120,
        rmsDb: typeof range.rmsDb === 'number' && Number.isFinite(range.rmsDb) ? range.rmsDb : -120,
        crestDb: typeof range.crestDb === 'number' && Number.isFinite(range.crestDb) ? range.crestDb : 0,
        strength: typeof range.strength === 'number' && Number.isFinite(range.strength) ? range.strength : 0,
      };
    })
    .filter(range => range.duration > 0.001)
    .toSorted((a, b) => a.start - b.start);
}

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.0005;
}

async function resolveDetectedSilenceRanges(
  clip: TimelineClip,
  options: ApplyDetectedSilenceRemovalOptions,
): Promise<AudioSilenceRange[]> {
  if (options.ranges?.length) {
    return options.ranges;
  }
  return detectClipSilenceRangesForAudio(clip, options.detection ?? {});
}

async function resolveDetectedTransientRanges(
  clip: TimelineClip,
  options: ApplyDetectedTransientSofteningOptions,
): Promise<AudioTransientRange[]> {
  if (options.ranges?.length) {
    return options.ranges;
  }
  return detectClipTransientRangesForAudio(clip, options.detection ?? {});
}

function getSelectedRoomToneTargetRange(
  clip: TimelineClip,
  selection: TimelineAudioRegionSelection | null,
): { start: number; end: number } | null {
  if (!selection || selection.clipId !== clip.id) return null;
  const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
  const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);
  return end - start > 0.0005 ? { start, end } : null;
}

function encodeRoomToneSourceRanges(ranges: readonly AudioSilenceRange[]): string | null {
  if (!ranges.length) return null;
  return JSON.stringify(ranges.slice(0, 12).map(range => ({
    start: Number(range.start.toFixed(6)),
    end: Number(range.end.toFixed(6)),
    duration: Number(range.duration.toFixed(6)),
    rmsDb: Number(range.rmsDb.toFixed(3)),
  })));
}

function getBaseFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

function getAudioBakeProjectFileName(fileName: string): string {
  return `${PROJECT_FOLDERS.RAW_BAKED_AUDIO}/${fileName}`;
}

function getOrCreateAudioBakeMediaFolderId(mediaStore: ReturnType<typeof useMediaStore.getState>): string {
  const existingFolder = mediaStore.folders.find(folder =>
    folder.name === AUDIO_BAKE_MEDIA_FOLDER_NAME &&
    folder.parentId === null
  );
  return existingFolder?.id ?? mediaStore.createFolder(AUDIO_BAKE_MEDIA_FOLDER_NAME, null).id;
}

function cloneAudioBakeRestoreState(state: AudioBakeRestoreState): AudioBakeRestoreState {
  return {
    ...state,
    waveform: state.waveform ? [...state.waveform] : undefined,
    waveformChannels: state.waveformChannels?.map(channel => [...channel]),
    audioState: state.audioState ? structuredClone(state.audioState) : undefined,
  };
}

function createAudioBakeRestoreState(clip: TimelineClip): AudioBakeRestoreState {
  return {
    name: clip.name,
    mediaFileId: getClipMediaFileId(clip),
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    sourceNaturalDuration: clip.source?.naturalDuration,
    waveform: clip.waveform ? [...clip.waveform] : undefined,
    waveformChannels: clip.waveformChannels?.map(channel => [...channel]),
    audioState: clip.audioState ? structuredClone(clip.audioState) : undefined,
  };
}

function createPlaceholderAudioFile(name: string): File {
  return new File([], name, { type: 'audio/wav' });
}

async function renderClipEditStackOnly(
  clip: TimelineClip,
  extractor: AudioExtractor = audioExtractor,
): Promise<AudioBuffer> {
  const sourceBuffer = await extractor.extractAudio(
    clip.file,
    getClipMediaFileId(clip) ?? clip.id,
  );
  const renderClip: TimelineClip = {
    ...clip,
    speed: 1,
    reversed: false,
    preservesPitch: true,
    effects: [],
    audioState: {
      ...(clip.audioState ?? {}),
      muted: false,
      effectStack: [],
    },
  };
  return (await clipAudioRenderer.render({ clip: renderClip, sourceBuffer })).buffer;
}

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

  detectClipSilenceRanges: async (clipId, options = {}) => {
    const clip = get().clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot detect silence for missing or non-audio clip', { clipId });
      return [];
    }

    return detectClipSilenceRangesForAudio(clip, options);
  },

  applyDetectedSilenceRemoval: async (clipId, options = {}) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot remove detected silence from missing or non-audio clip', { clipId });
      return [];
    }

    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot remove detected silence on locked track', { clipId, trackId: clip.trackId });
      return [];
    }

    const ranges = normalizeDetectedSilenceRanges(
      clip,
      await resolveDetectedSilenceRanges(clip, options),
    );
    if (ranges.length === 0) {
      log.info('No detected silence ranges to remove', { clipId });
      return [];
    }

    const now = Date.now();
    const totalRemovedSeconds = ranges.reduce((sum, range) => sum + range.duration, 0);
    const operations: ClipAudioEditOperation[] = ranges.map((range, index) => ({
      id: createAudioEditOperationId(),
      type: 'delete-silence',
      enabled: true,
      params: {
        label: 'Remove detected silence',
        detectedSilence: true,
        compactTimeline: true,
        preserveClipDuration: false,
        silenceThresholdDb: options.detection?.thresholdDb ?? -50,
        silenceRmsDb: Number(range.rmsDb.toFixed(3)),
        silenceDuration: Number(range.duration.toFixed(6)),
        sequenceIndex: index + 1,
        sequenceCount: ranges.length,
        timelineStart: sourceTimeToTimelineTime(clip, range.start),
        timelineEnd: sourceTimeToTimelineTime(clip, range.end),
      },
      timeRange: { start: range.start, end: range.end },
      createdAt: now + index,
    }));
    const operationIds = operations.map(operation => operation.id);
    const compactedDuration = Math.max(0.001, clip.duration - totalRemovedSeconds);
    const rippleShift = options.rippleTimeline ? clip.duration - compactedDuration : 0;
    const oldClipEnd = clip.startTime + clip.duration;

    captureSnapshot('Remove detected silence');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id === clipId) {
          const audioState = currentClip.audioState ?? {};
          return clearProcessedAudioAnalysisRefs({
            ...currentClip,
            duration: compactedDuration,
            audioState: {
              ...audioState,
              editStack: [
                ...(audioState.editStack ?? []),
                ...operations,
              ],
            },
          });
        }

        if (
          rippleShift > 0 &&
          currentClip.trackId === clip.trackId &&
          currentClip.startTime >= oldClipEnd - 0.0005
        ) {
          return {
            ...currentClip,
            startTime: Math.max(0, currentClip.startTime - rippleShift),
          };
        }

        return currentClip;
      }),
    });
    get().updateDuration();
    get().invalidateCache();
    return operationIds;
  },

  applyRoomToneFill: async (clipId, options = {}) => {
    const { clips, tracks, audioRegionSelection } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot apply room tone fill to missing or non-audio clip', { clipId });
      return null;
    }

    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot apply room tone fill on locked track', { clipId, trackId: clip.trackId });
      return null;
    }

    const targetRange = options.targetRange ?? getSelectedRoomToneTargetRange(clip, audioRegionSelection);
    if (!targetRange || targetRange.end - targetRange.start <= 0.0005) {
      log.warn('Cannot apply room tone fill without a target audio region', { clipId });
      return null;
    }

    const sourceRange = getClipAudioSourceRange(clip);
    const clampedTarget = {
      start: Math.max(sourceRange.start, Math.min(sourceRange.end, Math.min(targetRange.start, targetRange.end))),
      end: Math.max(sourceRange.start, Math.min(sourceRange.end, Math.max(targetRange.start, targetRange.end))),
    };
    if (clampedTarget.end - clampedTarget.start <= 0.0005) {
      log.warn('Cannot apply room tone fill outside the clip source range', { clipId });
      return null;
    }

    const detectedSourceRanges = options.sourceRanges?.length
      ? options.sourceRanges
      : await detectClipSilenceRangesForAudio(clip, {
          thresholdDb: options.detection?.thresholdDb ?? -48,
          minSilenceSeconds: options.detection?.minSilenceSeconds ?? 0.2,
          windowSeconds: options.detection?.windowSeconds,
          hopSeconds: options.detection?.hopSeconds,
          paddingSeconds: options.detection?.paddingSeconds ?? 0,
          mergeGapSeconds: options.detection?.mergeGapSeconds,
          maxRanges: options.detection?.maxRanges ?? 16,
        });
    const sourceRanges = normalizeDetectedSilenceRanges(clip, detectedSourceRanges)
      .filter(range => !rangesOverlap(range, clampedTarget))
      .slice(0, 12);
    const encodedSourceRanges = encodeRoomToneSourceRanges(sourceRanges);
    const firstSourceRange = sourceRanges[0];
    const operation: ClipAudioEditOperation = {
      id: createAudioEditOperationId(),
      type: 'room-tone-fill',
      enabled: true,
      params: {
        label: 'Room tone fill',
        timelineStart: sourceTimeToTimelineTime(clip, clampedTarget.start),
        timelineEnd: sourceTimeToTimelineTime(clip, clampedTarget.end),
        preserveClipDuration: true,
        roomToneGainDb: options.gainDb ?? 0,
        crossfadeSeconds: options.crossfadeSeconds ?? 0.025,
        generatedNoiseDb: -66,
        roomToneSourceCount: sourceRanges.length,
        ...(encodedSourceRanges ? { roomToneSourceRanges: encodedSourceRanges } : {}),
        ...(firstSourceRange ? {
          sourceInPoint: firstSourceRange.start,
          sourceOutPoint: firstSourceRange.end,
        } : {}),
      },
      timeRange: clampedTarget,
      createdAt: Date.now(),
    };

    captureSnapshot('Room tone fill');
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

  detectClipTransientRanges: async (clipId, options = {}) => {
    const clip = get().clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot detect transients for missing or non-audio clip', { clipId });
      return [];
    }

    return detectClipTransientRangesForAudio(clip, options);
  },

  applyDetectedTransientSoftening: async (clipId, options = {}) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot soften detected transients for missing or non-audio clip', { clipId });
      return [];
    }

    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot soften detected transients on locked track', { clipId, trackId: clip.trackId });
      return [];
    }

    const ranges = normalizeDetectedTransientRanges(
      clip,
      await resolveDetectedTransientRanges(clip, options),
    );
    if (ranges.length === 0) {
      log.info('No detected transients to soften', { clipId });
      return [];
    }

    const now = Date.now();
    const operations: ClipAudioEditOperation[] = ranges.map((range, index) => ({
      id: createAudioEditOperationId(),
      type: 'repair',
      enabled: true,
      params: {
        label: 'Soften detected transient',
        repairType: 'transient-soften',
        detectedTransient: true,
        preserveClipDuration: true,
        gainDb: options.gainDb ?? -6,
        attackSeconds: options.attackSeconds ?? 0.002,
        releaseSeconds: options.releaseSeconds ?? 0.018,
        transientPeakDb: Number(range.peakDb.toFixed(3)),
        transientRmsDb: Number(range.rmsDb.toFixed(3)),
        transientCrestDb: Number(range.crestDb.toFixed(3)),
        transientStrength: Number(range.strength.toFixed(3)),
        sequenceIndex: index + 1,
        sequenceCount: ranges.length,
        timelineStart: sourceTimeToTimelineTime(clip, range.start),
        timelineEnd: sourceTimeToTimelineTime(clip, range.end),
      },
      timeRange: { start: range.start, end: range.end },
      createdAt: now + index,
    }));
    const operationIds = operations.map(operation => operation.id);

    captureSnapshot('Soften detected transients');
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
              ...operations,
            ],
          },
        });
      }),
    });
    get().invalidateCache();
    return operationIds;
  },

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

  bakeClipAudioEditStack: async (clipId) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot bake missing or non-audio clip', { clipId });
      return null;
    }
    if (!clip.audioState?.editStack?.some(operation => operation.enabled !== false)) {
      log.warn('Cannot bake clip without active audio edit operations', { clipId });
      return null;
    }
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot bake audio edits on locked track', { clipId, trackId: clip.trackId });
      return null;
    }

    const rendered = await renderClipEditStackOnly(clip);
    const wavBlob = encodeAudioBufferToWavBlob(rendered);
    const bakedFileName = `${getBaseFileName(clip.name)} - baked audio.wav`;
    const bakedFile = new File([wavBlob], bakedFileName, {
      type: 'audio/wav',
      lastModified: Date.now(),
    });

    const mediaStore = useMediaStore.getState();
    const audioBakeFolderId = getOrCreateAudioBakeMediaFolderId(mediaStore);
    const imported = await mediaStore.importFile(bakedFile, audioBakeFolderId, {
      forceCopyToProject: true,
      projectFileName: getAudioBakeProjectFileName(bakedFileName),
    });
    if (imported.type !== 'audio') {
      log.warn('Baked audio import did not produce an audio media file', { clipId, importedType: imported.type });
      return null;
    }

    const analysis = await generateTimelineWaveformAnalysisForFile(bakedFile, {
      mediaFileId: imported.id,
    });
    const oldEditStack = clip.audioState.editStack ?? [];
    const oldSourceMediaFileId = getClipMediaFileId(clip);
    const restore = createAudioBakeRestoreState(clip);
    const nextOutPoint = rendered.duration;
    const nextDuration = Math.max(0.001, Math.min(clip.duration, nextOutPoint));

    captureSnapshot('Bake audio edit stack');
    set({
      clips: get().clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        return {
          ...currentClip,
          name: bakedFileName,
          file: bakedFile,
          mediaFileId: imported.id,
          duration: nextDuration,
          inPoint: 0,
          outPoint: nextOutPoint,
          waveform: analysis.waveform,
          waveformChannels: analysis.waveformChannels,
          waveformGenerating: false,
          waveformProgress: 100,
          source: {
            ...(currentClip.source ?? { type: 'audio' as const }),
            type: 'audio' as const,
            naturalDuration: nextOutPoint,
            mediaFileId: imported.id,
            file: bakedFile,
          },
          audioState: {
            ...(currentClip.audioState ?? {}),
            sourceAudioRevisionId: imported.id,
            editStack: [],
            sourceAnalysisRefs: analysis.audioAnalysisRefs,
            processedAnalysisRefs: undefined,
            bakeHistory: [
              ...(currentClip.audioState?.bakeHistory ?? []),
              {
                id: generateClipId('audio-bake'),
                mediaFileId: imported.id,
                sourceMediaFileId: oldSourceMediaFileId,
                sourceClipId: currentClip.id,
                operationIds: oldEditStack.map(operation => operation.id),
                createdAt: Date.now(),
                provenance: {
                  operationCount: oldEditStack.length,
                  duration: nextOutPoint,
                },
                restore,
              },
            ],
          },
        };
      }),
    });
    get().updateDuration();
    get().invalidateCache();
    return imported.id;
  },

  unbakeClipAudioEditStack: (clipId) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot unbake missing or non-audio clip', { clipId });
      return false;
    }

    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot unbake audio edits on locked track', { clipId, trackId: clip.trackId });
      return false;
    }

    const bakeHistory = clip.audioState?.bakeHistory ?? [];
    const latestBake = bakeHistory[bakeHistory.length - 1];
    const restore = latestBake?.restore;
    if (!latestBake || !restore) {
      log.warn('Cannot unbake clip without a reversible bake entry', { clipId });
      return false;
    }

    const sourceMediaFileId = restore.mediaFileId ?? latestBake.sourceMediaFileId;
    if (!sourceMediaFileId) {
      log.warn('Cannot unbake clip without a source media reference', { clipId, bakeId: latestBake.id });
      return false;
    }

    const mediaStore = useMediaStore.getState();
    const sourceMediaFile = mediaStore.files.find(file => file.id === sourceMediaFileId);
    if (!sourceMediaFile) {
      log.warn('Cannot unbake clip because the source media is missing', {
        clipId,
        sourceMediaFileId,
      });
      return false;
    }

    const restoredFile = sourceMediaFile.file;
    const restoredUrl = sourceMediaFile.url;
    if (!restoredFile && !restoredUrl) {
      log.warn('Cannot unbake clip because the source media has no file or URL', {
        clipId,
        sourceMediaFileId,
      });
      return false;
    }

    const restoredState = cloneAudioBakeRestoreState(restore);
    const sourcePath = sourceMediaFile.absolutePath ?? sourceMediaFile.filePath ?? sourceMediaFile.projectPath;
    const naturalDuration = restoredState.sourceNaturalDuration ?? sourceMediaFile.duration ?? restoredState.outPoint;

    captureSnapshot('Unbake audio edit stack');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        return {
          ...currentClip,
          name: restoredState.name,
          file: restoredFile ?? createPlaceholderAudioFile(restoredState.name),
          mediaFileId: sourceMediaFileId,
          duration: restoredState.duration,
          inPoint: restoredState.inPoint,
          outPoint: restoredState.outPoint,
          waveform: restoredState.waveform ?? sourceMediaFile.waveform ?? [],
          waveformChannels: restoredState.waveformChannels ?? sourceMediaFile.waveformChannels,
          waveformGenerating: false,
          waveformProgress: 100,
          needsReload: false,
          source: {
            ...(currentClip.source ?? { type: 'audio' as const }),
            type: 'audio' as const,
            naturalDuration,
            mediaFileId: sourceMediaFileId,
            ...(restoredFile ? { file: restoredFile } : {}),
            ...(sourcePath ? { filePath: sourcePath } : {}),
          },
          audioState: restoredState.audioState,
        };
      }),
    });
    get().updateDuration();
    get().invalidateCache();
    return true;
  },

  applySpectralRegionEdit: (type, options = {}) => {
    const { audioSpectralRegionSelection, clips, tracks } = get();
    if (!audioSpectralRegionSelection) {
      log.warn('Cannot apply spectral edit without an active spectral selection');
      return null;
    }

    const clip = clips.find(c => c.id === audioSpectralRegionSelection.clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot apply spectral edit to missing or non-audio clip', {
        clipId: audioSpectralRegionSelection.clipId,
      });
      return null;
    }

    const track = tracks.find(t => t.id === audioSpectralRegionSelection.trackId);
    if (track?.locked) {
      log.warn('Cannot apply spectral edit on locked track', {
        clipId: clip.id,
        trackId: audioSpectralRegionSelection.trackId,
      });
      return null;
    }

    const start = Math.max(0, Math.min(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint));
    const end = Math.max(start, Math.max(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint));
    const frequencyMinHz = Math.max(0, Math.min(audioSpectralRegionSelection.frequencyMinHz, audioSpectralRegionSelection.frequencyMaxHz));
    const frequencyMaxHz = Math.max(frequencyMinHz, Math.max(audioSpectralRegionSelection.frequencyMinHz, audioSpectralRegionSelection.frequencyMaxHz));

    if (end - start <= 0.0005 || frequencyMaxHz - frequencyMinHz <= 1) {
      log.warn('Cannot apply spectral edit to an empty time/frequency region', {
        clipId: clip.id,
        start,
        end,
        frequencyMinHz,
        frequencyMaxHz,
      });
      return null;
    }

    const operation: ClipAudioEditOperation = {
      id: createAudioEditOperationId(),
      type,
      enabled: true,
      params: {
        label: spectralOperationLabel(type),
        timelineStart: audioSpectralRegionSelection.startTime,
        timelineEnd: audioSpectralRegionSelection.endTime,
        frequencyMinHz,
        frequencyMaxHz,
        selectionMode: audioSpectralRegionSelection.selectionMode ?? 'rectangle',
        ...(audioSpectralRegionSelection.selectionMode === 'brush'
          ? {
              brushShape: 'soft-ellipse',
              brushTimeRadiusSeconds: audioSpectralRegionSelection.brushTimeRadiusSeconds ?? Math.max(0.001, (end - start) / 2),
              brushFrequencyRadiusHz: audioSpectralRegionSelection.brushFrequencyRadiusHz ?? Math.max(1, (frequencyMaxHz - frequencyMinHz) / 2),
            }
          : {}),
        blendMode: type === 'spectral-mask' ? 'attenuate' : 'replace',
        gainDb: type === 'spectral-mask' ? -18 : 6,
        featherTime: audioSpectralRegionSelection.selectionMode === 'brush' ? Math.max(0.015, (end - start) * 0.35) : 0.015,
        featherFrequencyHz: Math.max(12, (frequencyMaxHz - frequencyMinHz) * (audioSpectralRegionSelection.selectionMode === 'brush' ? 0.22 : 0.05)),
        ...(options.params ?? {}),
      },
      timeRange: { start, end },
      ...(options.channelMask ? { channelMask: [...options.channelMask] } : {}),
      createdAt: Date.now(),
    };

    captureSnapshot(spectralOperationLabel(type));
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
      ...(options.keepSelection ? {} : { audioSpectralRegionSelection: null }),
    });
    get().invalidateCache();
    return operation.id;
  },

  addClipSpectralImageLayer: (clipId, layerInput) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot add spectral image layer to missing or non-audio clip', { clipId });
      return null;
    }
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot add spectral image layer on locked track', { clipId, trackId: clip.trackId });
      return null;
    }

    const layer = normalizeSpectralLayer({
      ...layerInput,
      id: layerInput.id ?? createSpectralLayerId(),
    });

    captureSnapshot('Add spectral image layer');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        const audioState = currentClip.audioState ?? {};
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            spectralLayers: [
              ...(audioState.spectralLayers ?? []),
              layer,
            ],
          },
        });
      }),
    });
    get().invalidateCache();
    return layer.id;
  },

  updateClipSpectralImageLayer: (clipId, layerId, patch) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot update spectral image layer on locked track', { clipId, layerId });
      return;
    }

    captureSnapshot('Update spectral image layer');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.spectralLayers?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            spectralLayers: currentClip.audioState.spectralLayers.map(layer =>
              layer.id === layerId
                ? normalizeSpectralLayer({ ...layer, ...patch })
                : layer
            ),
          },
        });
      }),
    });
    get().invalidateCache();
  },

  removeClipSpectralImageLayer: (clipId, layerId) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot remove spectral image layer on locked track', { clipId, layerId });
      return;
    }

    captureSnapshot('Remove spectral image layer');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.spectralLayers?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            spectralLayers: currentClip.audioState.spectralLayers.filter(layer => layer.id !== layerId),
          },
        });
      }),
    });
    get().invalidateCache();
  },
});
