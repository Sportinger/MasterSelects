import type { SerializableClip, TimelineClip, TimelineStore } from '../types';
import type { ClipAnalysis, FrameAnalysisData } from '../../../types';
import { clonePersistedClipAudioState } from '../../../services/audio/clipAudioStatePersistence';
import { Logger } from '../../../services/logger';
import { cloneClipNodeGraph } from '../../../services/nodeGraph';
import { normalizeTransitionInstanceParams } from '../../../transitions';
import { projectFileService } from '../../../services/projectFileService';
import { mediaNeedsRelink } from '../../../services/project/relinkMedia';
import {
  createLoadStateDeferredMediaRestorePatch,
  createLoadStateImageRestorePatch,
  createLoadStateNativeVideoPathRestorePatch,
  createLoadStateSpatialRestorePatch,
  resolveLoadStateMediaRuntimeReference,
  startLoadStateVectorRuntimeRestore,
} from '../../../services/timeline/timelineMediaSourceRuntimeRestore';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';
import type { useMediaStore } from '../../mediaStore';
import {
  createDataOnlyRestoredGaussianSplatSource,
  createDataOnlyRestoredModelSource,
} from '../restoredMediaSource';
import {
  applyManagedRestoredSpatialSource,
  createManagedRestoredImageUrl,
  isRestoredSpatialSourceType,
  restorePersistedClipVideoState,
} from '../nestedRestore';
import { startRestoredVectorRuntimeRestore } from '../vectorRuntimeRestore';

const log = Logger.create('Timeline');

type MediaStoreState = ReturnType<typeof useMediaStore.getState>;
type MediaFile = MediaStoreState['files'][number];
type TimelineSet = (partial: Partial<TimelineStore> | ((state: TimelineStore) => Partial<TimelineStore>)) => void;
type PatchRestoredClip = (
  clipId: string,
  updater: (clip: TimelineClip) => TimelineClip,
) => void;

export type RestoreLoadStateMediaClipResult = 'handled' | 'stale';

function createInitialRestoredMediaSource(
  serializedClip: SerializableClip,
  mediaFile: MediaFile,
): TimelineClip['source'] {
  if (serializedClip.sourceType === 'gaussian-splat') {
    const gaussianSplatSource = createDataOnlyRestoredGaussianSplatSource(
      serializedClip,
      serializedClip.duration,
      mediaFile,
    );
    if (gaussianSplatSource) {
      return gaussianSplatSource;
    }
  }

  const restoredModelSource = serializedClip.sourceType === 'model'
    ? createDataOnlyRestoredModelSource(serializedClip, serializedClip.duration, mediaFile)
    : null;

  return {
    type: serializedClip.sourceType,
    mediaFileId: serializedClip.mediaFileId,
    naturalDuration: serializedClip.naturalDuration,
    vectorAnimationSettings: serializedClip.vectorAnimationSettings,
    threeDEffectorsEnabled: serializedClip.threeDEffectorsEnabled ?? true,
    modelSequence: restoredModelSource?.modelSequence,
    modelPrimitiveIndex: restoredModelSource?.modelPrimitiveIndex,
    modelMaterialSettings: restoredModelSource?.modelMaterialSettings,
  };
}

function createRestoredMediaClip(params: {
  file: File;
  initialSource: TimelineClip['source'];
  mediaFile: MediaFile;
  needsReload: boolean;
  serializedClip: SerializableClip;
}): TimelineClip {
  const { file, initialSource, mediaFile, needsReload, serializedClip } = params;
  return {
    id: serializedClip.id,
    trackId: serializedClip.trackId,
    name: serializedClip.name || mediaFile.name || 'Untitled',
    file,
    signalAssetId: serializedClip.signalAssetId,
    signalRefId: serializedClip.signalRefId,
    signalRenderAdapterId: serializedClip.signalRenderAdapterId,
    startTime: serializedClip.startTime,
    duration: serializedClip.duration,
    inPoint: serializedClip.inPoint,
    outPoint: serializedClip.outPoint,
    source: initialSource,
    mediaFileId: serializedClip.mediaFileId,
    needsReload,
    thumbnails: serializedClip.thumbnails,
    linkedClipId: serializedClip.linkedClipId,
    linkedGroupId: serializedClip.linkedGroupId,
    videoState: restorePersistedClipVideoState(serializedClip),
    audioState: clonePersistedClipAudioState(serializedClip.audioState),
    waveform: serializedClip.waveform,
    waveformChannels: serializedClip.waveformChannels,
    transform: serializedClip.transform,
    sourceRect: serializedClip.sourceRect ? { ...serializedClip.sourceRect } : undefined,
    transitionRender: serializedClip.transitionRender ? structuredClone(serializedClip.transitionRender) : undefined,
    effects: serializedClip.effects || [],
    transitionIn: serializedClip.transitionIn ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionIn)) : undefined,
    transitionOut: serializedClip.transitionOut ? normalizeTransitionInstanceParams(structuredClone(serializedClip.transitionOut)) : undefined,
    colorCorrection: serializedClip.colorCorrection ? structuredClone(serializedClip.colorCorrection) : undefined,
    nodeGraph: cloneClipNodeGraph(serializedClip.nodeGraph),
    isLoading: !needsReload,
    masks: serializedClip.masks,
    transcript: serializedClip.transcript,
    transcriptStatus: serializedClip.transcriptStatus || 'none',
    analysis: serializedClip.analysis,
    analysisStatus: serializedClip.analysisStatus || 'none',
    reversed: serializedClip.reversed,
    speed: serializedClip.speed,
    preservesPitch: serializedClip.preservesPitch,
    is3D: serializedClip.is3D,
    meshType: serializedClip.meshType,
  };
}

function loadCachedProjectAnalysis(params: {
  clip: TimelineClip;
  serializedClip: SerializableClip;
  set: TimelineSet;
}): void {
  const { clip, serializedClip, set } = params;
  if (serializedClip.analysis || !serializedClip.mediaFileId || !projectFileService.isProjectOpen()) {
    return;
  }

  const mediaFileId = serializedClip.mediaFileId;
  projectFileService.getAnalysis(
    mediaFileId,
    serializedClip.inPoint,
    serializedClip.outPoint,
  ).then(async cachedAnalysis => {
    const restoredAnalysis = cachedAnalysis ?? await projectFileService.getAllAnalysisMerged(mediaFileId);
    if (!restoredAnalysis) return;
    log.debug('Loaded analysis from project folder', { clip: serializedClip.name });
    const analysis: ClipAnalysis = {
      frames: restoredAnalysis.frames as FrameAnalysisData[],
      sampleInterval: restoredAnalysis.sampleInterval,
    };
    set(state => ({
      clips: state.clips.map(c =>
        c.id === clip.id
          ? { ...c, analysis, analysisStatus: 'ready' as const }
          : c
      ),
    }));
  }).catch(err => {
    log.warn('Failed to load analysis from project folder', err);
  });
}

function startLoadStateTopLevelRuntimeRestore(params: {
  clip: TimelineClip;
  serializedClip: SerializableClip;
  mediaFile: MediaFile;
  type: SerializableClip['sourceType'];
  loadFile?: File;
  fileUrl?: string;
  isCurrentTimelineSession: () => boolean;
  patchRestoredClip: PatchRestoredClip;
  wakePreviewAfterRestore: () => void;
}): boolean {
  const { clip, serializedClip, mediaFile, type, loadFile, fileUrl, isCurrentTimelineSession, patchRestoredClip, wakePreviewAfterRestore } = params;

  if (type === 'image') {
    const imagePatch = createLoadStateImageRestorePatch({
      adapters: { createManagedImageUrl: createManagedRestoredImageUrl },
      clipId: clip.id,
      fallbackFile: clip.file,
      mediaDuration: mediaFile.duration,
      mediaFileId: mediaFile.id,
      naturalDuration: serializedClip.naturalDuration,
      absolutePath: mediaFile.absolutePath,
      clipDuration: clip.duration,
      loadFile,
      fileUrl,
    });
    if (!imagePatch) {
      log.warn('Skipping image restore - no image URL available', { clip: clip.name, mediaFileId: mediaFile.id });
      patchRestoredClip(clip.id, (currentClip) => ({ ...currentClip, isLoading: false }));
      return true;
    }

    if (!isCurrentTimelineSession()) {
      return true;
    }

    patchRestoredClip(clip.id, (currentClip) => ({ ...currentClip, ...imagePatch }));
    wakePreviewAfterRestore();
    return true;
  }

  if (isVectorAnimationSourceType(type)) {
    return startLoadStateVectorRuntimeRestore({
      adapters: { startVectorRuntimeRestore: startRestoredVectorRuntimeRestore },
      clip,
      serializedClip,
      sourceType: type,
      loadFile,
      needsReloadWhenMissingFile: mediaNeedsRelink(mediaFile),
      isCurrentTimelineSession,
      applyPatch: (patch) => {
        patchRestoredClip(clip.id, (currentClip) => ({ ...currentClip, ...patch }));
      },
      onMissingFile: () => {
        log.warn('Skipping vector animation restore - file object not available', { clip: clip.name, type });
      },
      onReady: wakePreviewAfterRestore,
      onError: (error) => {
        log.warn('Failed to restore lottie clip', { clip: clip.name, error });
      },
      onStartError: (error) => {
        log.warn('Failed to start vector restore', { clip: clip.name, error });
      },
    });
  }

  if (isRestoredSpatialSourceType(type)) {
    const spatialResult = createLoadStateSpatialRestorePatch({
      adapters: { applyManagedSpatialSource: applyManagedRestoredSpatialSource },
      clip,
      serializedClip,
      duration: serializedClip.duration,
      mediaFile: { ...mediaFile, file: loadFile ?? mediaFile.file, url: fileUrl },
    });
    if (!spatialResult.restored) {
      log.warn('Skipping spatial restore - no source URL available', {
        clip: clip.name,
        mediaFileId: mediaFile.id,
        sourceType: type,
      });
      patchRestoredClip(clip.id, (currentClip) => ({ ...currentClip, isLoading: false }));
      return true;
    }
    patchRestoredClip(clip.id, (currentClip) => ({ ...currentClip, ...spatialResult.patch }));
    wakePreviewAfterRestore();
    return true;
  }

  return false;
}

export async function restoreLoadStateMediaClip(params: {
  serializedClip: SerializableClip;
  mediaStore: MediaStoreState;
  set: TimelineSet;
  pushRestoredClip: (clip: TimelineClip) => void;
  patchRestoredClip: PatchRestoredClip;
  updateMediaFile: (mediaFileId: string, patch: { file: File; hasFileHandle: true; url?: string }) => void;
  restoreSourceThumbnails: (mediaFileId: string | undefined) => void;
  isCurrentTimelineSession: () => boolean;
  wakePreviewAfterRestore: () => void;
}): Promise<RestoreLoadStateMediaClipResult> {
  const { serializedClip, mediaStore, set, pushRestoredClip, patchRestoredClip, updateMediaFile, restoreSourceThumbnails, isCurrentTimelineSession, wakePreviewAfterRestore } = params;
  const mediaFile = mediaStore.files.find(f => f.id === serializedClip.mediaFileId);
  if (!mediaFile) {
    log.warn('Media file not found for clip', { clip: serializedClip.name, mediaFileId: serializedClip.mediaFileId });
    return 'handled';
  }

  const needsReload = mediaNeedsRelink(mediaFile);
  if (needsReload) {
    log.debug('Clip needs reload (file permission required)', { clip: serializedClip.name });
  }

  const file = mediaFile.file || new File([], mediaFile.name || 'pending', { type: 'video/mp4' });
  const initialSource = createInitialRestoredMediaSource(serializedClip, mediaFile);
  const clip = createRestoredMediaClip({ file, initialSource, mediaFile, needsReload, serializedClip });
  pushRestoredClip(clip);
  loadCachedProjectAnalysis({ clip, serializedClip, set });

  if (needsReload) {
    log.debug('Skipping media load for clip that needs reload', { clip: clip.name });
    return 'handled';
  }

  const type = serializedClip.sourceType;
  const {
    deferMediaElementRestore,
    fileUrl,
    loadFile,
    restoredMediaFilePatch,
  } = await resolveLoadStateMediaRuntimeReference({ mediaFile, sourceType: type });

  if (restoredMediaFilePatch) {
    updateMediaFile(mediaFile.id, restoredMediaFilePatch);
  }

  const nativeVideoAbsolutePath = mediaFile.absolutePath;
  if (type === 'video' && !loadFile && nativeVideoAbsolutePath && projectFileService.activeBackend === 'native') {
    patchRestoredClip(clip.id, (currentClip) => ({
      ...currentClip,
      ...createLoadStateNativeVideoPathRestorePatch({
        absolutePath: nativeVideoAbsolutePath,
        clipDuration: clip.duration,
        mediaDuration: mediaFile.duration,
        mediaFileId: mediaFile.id,
        naturalDuration: serializedClip.naturalDuration,
      }),
    }));
    restoreSourceThumbnails(serializedClip.mediaFileId);
    return 'handled';
  }

  const hasRestoredGaussianSplatSourceUrl =
    initialSource?.type === 'gaussian-splat' && !!initialSource.gaussianSplatUrl;
  if (
    !loadFile &&
    !fileUrl &&
    (type === 'video' || type === 'audio' || type === 'image' || type === 'model' || (type === 'gaussian-splat' && !hasRestoredGaussianSplatSourceUrl))
  ) {
    log.warn('Skipping media load - no file URL available', { clip: clip.name, mediaFileId: mediaFile.id });
    patchRestoredClip(clip.id, (currentClip) => ({ ...currentClip, isLoading: false }));
    return 'handled';
  }

  if (deferMediaElementRestore && (type === 'video' || type === 'audio')) {
    patchRestoredClip(clip.id, (currentClip) => ({
      ...currentClip,
      ...createLoadStateDeferredMediaRestorePatch({
        absolutePath: mediaFile.absolutePath,
        clipDuration: clip.duration,
        fallbackFile: currentClip.file,
        loadFile,
        mediaDuration: mediaFile.duration,
        mediaFileId: mediaFile.id,
        naturalDuration: serializedClip.naturalDuration,
        sourceType: type,
      }),
    }));
    if (type === 'video') {
      restoreSourceThumbnails(serializedClip.mediaFileId);
    }
    wakePreviewAfterRestore();
    return 'handled';
  }

  startLoadStateTopLevelRuntimeRestore({
    clip,
    serializedClip,
    mediaFile,
    type,
    loadFile,
    fileUrl,
    isCurrentTimelineSession,
    patchRestoredClip,
    wakePreviewAfterRestore,
  });
  return 'handled';
}
