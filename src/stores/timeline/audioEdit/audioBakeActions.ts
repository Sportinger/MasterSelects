import type { AudioBakeRestoreState, TimelineClip } from '../../../types';
import type { AudioEditActions, SliceCreator } from '../types';
import { encodeAudioBufferToWavBlob } from '../../../engine/audio/AudioFileEncoder';
import { AudioExtractor, audioExtractor } from '../../../engine/audio/AudioExtractor';
import { ClipAudioRenderService } from '../../../services/audio/ClipAudioRenderService';
import { generateTimelineWaveformAnalysisForFile } from '../../../services/audio/timelineWaveformPyramidCache';
import { Logger } from '../../../services/logger';
import { PROJECT_FOLDERS } from '../../../services/project/core/constants';
import { captureSnapshot } from '../../historyStore';
import { useMediaStore } from '../../mediaStore';
import { generateClipId } from '../helpers/idGenerator';
import { getClipMediaFileId, isAudioClip } from './audioEditHelpers';

const log = Logger.create('TimelineAudioEdit');
let clipAudioRenderer: ClipAudioRenderService | undefined;
const getClipAudioRenderer = () => clipAudioRenderer ??= new ClipAudioRenderService();
const AUDIO_BAKE_MEDIA_FOLDER_NAME = 'Baked Audio';

type AudioBakeActions = Pick<AudioEditActions, 'bakeClipAudioEditStack' | 'unbakeClipAudioEditStack'>;

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
  return (await getClipAudioRenderer().render({ clip: renderClip, sourceBuffer })).buffer;
}

export const createAudioBakeActions: SliceCreator<AudioBakeActions> = (set, get) => ({
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
});
