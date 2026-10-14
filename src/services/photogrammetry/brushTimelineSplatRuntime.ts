import { forgetSplatSceneReplacement, replaceGaussianSplatScene } from '../../engine/gaussian/core/splatSceneReplacement';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { gaussianSplatMediaRuntimeKey } from '../../stores/timeline/clip/addGaussianSplatClip';
import { resolveGaussianSplatClipRuntimeKey } from '../layerBuilder/layerBuilder3dSources';
import { Logger } from '../logger';
import { renderHostPort } from '../render/renderHostPort';
import { BrushTimelineSplat, type BrushTimelineSplatDeps } from './BrushTimelineSplat';
import { brushPreviewRuntime } from './brushPreviewRuntime';
import { brushTrainingManager } from './brushTrainingManager';
import { placeSplatOnTimeline } from './placeSplatOnTimeline';

const log = Logger.create('BrushTimelineSplat');

function liveClips(mediaFileId: string) {
  return useTimelineStore.getState().clips.filter(clip => (
    clip.source?.type === 'gaussian-splat'
    && !clip.source.gaussianSplatSequence
    && (clip.source.mediaFileId ?? clip.mediaFileId) === mediaFileId
  ));
}

/** Move splat clips onto another media file and its scene key. */
function repointClips(from: string, to: MediaFile, runtimeKey: string): number {
  const clips = liveClips(from);
  for (const clip of clips) {
    useTimelineStore.getState().updateClip(clip.id, {
      name: to.name,
      mediaFileId: to.id,
      ...(to.file ? { file: to.file } : {}),
      source: {
        ...clip.source!,
        mediaFileId: to.id,
        gaussianSplatUrl: to.url || clip.source?.gaussianSplatUrl,
        gaussianSplatFileName: to.name,
        gaussianSplatFileHash: to.fileHash,
        gaussianSplatRuntimeKey: runtimeKey,
      },
    });
  }
  return clips.length;
}

function removeMediaIfUnused(id: string): void {
  const media = useMediaStore.getState();
  const usage = media.getMediaFileUsages([id]).find(entry => entry.mediaFileId === id);
  if (usage && usage.clipCount > 0) {
    log.info('Kept the intermediate training splat; other clips still use it', { mediaFileId: id, clips: usage.clipCount });
    return;
  }
  media.removeFile(id);
}

export function createBrushTimelineSplatDeps(): BrushTimelineSplatDeps {
  return {
    preview: brushPreviewRuntime,
    training: brushTrainingManager,
    importSplat: file => useMediaStore.getState().importGaussianSplat(file),
    findMedia: id => useMediaStore.getState().files.find(file => file.id === id && !file.isImporting),
    findMediaByName: name => useMediaStore.getState().files.findLast(file => file.name === name && !file.isImporting),
    sceneKeysForMedia: mediaFileId => [...new Set(liveClips(mediaFileId).map(resolveGaussianSplatClipRuntimeKey))],
    sceneKeyForMedia: media => gaussianSplatMediaRuntimeKey(media) ?? `scan-splat:${media.id}`,
    placeOnTimeline: (file, media, camera) => placeSplatOnTimeline(file, media, camera),
    repointClips,
    removeMediaIfUnused,
    replaceScene: replaceGaussianSplatScene,
    forgetScene: forgetSplatSceneReplacement,
    requestRender: () => renderHostPort.requestRender(),
    log: (message, data) => log.info(message, data),
    setInterval: (callback, ms) => { const timer = setInterval(callback, ms); return () => clearInterval(timer); },
    isDocumentVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  };
}

const hot = import.meta.hot?.data as { timelineSplat?: BrushTimelineSplat } | undefined;
export const brushTimelineSplat = hot?.timelineSplat ?? new BrushTimelineSplat(createBrushTimelineSplatDeps());
if (hot?.timelineSplat) Object.setPrototypeOf(brushTimelineSplat, BrushTimelineSplat.prototype);
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(data => { data.timelineSplat = brushTimelineSplat; });
}
