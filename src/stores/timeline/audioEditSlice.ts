import type { ClipAudioEditOperation } from '../../types';
import { encodeAudioBufferToWavBlob } from '../../engine/audio/AudioFileEncoder';
import { AudioExtractor, audioExtractor } from '../../engine/audio/AudioExtractor';
import { Logger } from '../../services/logger';
import type { AudioEditActions, SliceCreator, TimelineAudioRegionEditType, TimelineClip } from './types';
import { generateClipId } from './helpers/idGenerator';
import { clearProcessedAudioAnalysisRefs } from './helpers/audioAnalysisStateHelpers';
import { ClipAudioRenderService } from '../../services/audio/ClipAudioRenderService';
import { generateTimelineWaveformAnalysisForFile } from '../../services/audio/timelineWaveformPyramidCache';
import { useMediaStore } from '../mediaStore';
import { createAudioElement } from './helpers/webCodecsHelpers';
import { captureSnapshot } from '../historyStore';

const log = Logger.create('TimelineAudioEdit');
const clipAudioRenderer = new ClipAudioRenderService();

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
    case 'silence': return 'Silence region';
    case 'cut': return 'Cut region';
    case 'paste': return 'Paste region';
    case 'insert-silence': return 'Insert silence';
    case 'delete-silence': return 'Delete silence';
    case 'reverse': return 'Reverse region';
    case 'invert-polarity': return 'Invert polarity';
    case 'swap-channels': return 'Swap channels';
    case 'mono-sum': return 'Mono sum';
  }
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

function getBaseFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
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
    const imported = await mediaStore.importFile(bakedFile, null, { forceCopyToProject: true });
    if (imported.type !== 'audio') {
      log.warn('Baked audio import did not produce an audio media file', { clipId, importedType: imported.type });
      return null;
    }

    const audioElement = createAudioElement(bakedFile);
    const analysis = await generateTimelineWaveformAnalysisForFile(bakedFile, {
      mediaFileId: imported.id,
    });
    const oldEditStack = clip.audioState.editStack ?? [];
    const oldSourceMediaFileId = getClipMediaFileId(clip);
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
          waveformGenerating: false,
          waveformProgress: 100,
          source: {
            ...(currentClip.source ?? { type: 'audio' as const }),
            type: 'audio' as const,
            audioElement,
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
});
