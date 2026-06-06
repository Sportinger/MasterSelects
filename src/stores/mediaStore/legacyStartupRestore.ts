import type {
  CameraItem,
  MathSceneItem,
  MediaFile,
  MediaState,
  MeshItem,
  MotionShapeItem,
  ProxyStatus,
  SolidItem,
  SplatEffectorItem,
  TextItem,
} from './types';
import type { TranscriptStatus, TranscriptWord } from '../../types';
import { getExpectedProxyFps, isProxyFrameIndexSetComplete } from './helpers/proxyCompleteness';
import { fileSystemService } from '../../services/fileSystemService';
import { projectDB } from '../../services/projectDB';
import { projectFileService } from '../../services/projectFileService';
import { Logger } from '../../services/logger';
import {
  createPrimaryMediaObjectUrl,
  createThumbnailMediaObjectUrl,
  revokeMediaFileObjectUrls,
} from '../../services/project/mediaObjectUrlManager';

type MediaStoreSet = (
  partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>),
) => void;

const log = Logger.create('LegacyStartupRestore');

const isBlobUrl = (value?: string): value is string => typeof value === 'string' && value.startsWith('blob:');

export async function restoreLegacyStartupMediaState(
  set: MediaStoreSet,
  get: () => MediaState,
): Promise<void> {
  set({ isLoading: true });
  try {
    const storedFiles = await projectDB.getAllMediaFiles();
    const { files } = get();

    const updatedFiles = await Promise.all(
      files.map(async (mediaFile) => {
        const stored = storedFiles.find((sf) => sf.id === mediaFile.id);
        if (!stored) return mediaFile;

        let file: File | undefined;
        let url = mediaFile.url;
        let thumbnailUrl = mediaFile.thumbnailUrl;

        if (mediaFile.projectPath && projectFileService.isProjectOpen()) {
          try {
            const result = await projectFileService.getFileFromRaw(mediaFile.projectPath);
            if (result) {
              file = result.file;
              url = createPrimaryMediaObjectUrl(mediaFile.id, file, { revokeExisting: false });
              const projectHandle = result.handle;
              if (projectHandle) {
                fileSystemService.storeFileHandle(mediaFile.id, projectHandle);
                await projectDB.storeHandle(`media_${mediaFile.id}`, projectHandle);
              }
              log.debug('Restored file from project RAW copy:', stored.name);
            }
          } catch (e) {
            log.warn(`Failed to restore file from project RAW copy: ${stored.name}`, e);
          }
        }

        if (!file) {
          const handle = await projectDB.getStoredHandle(`media_${mediaFile.id}`);
          if (handle && 'getFile' in handle) {
            try {
              const permission = await (handle as FileSystemFileHandle).queryPermission({ mode: 'read' });
              if (permission === 'granted') {
                file = await (handle as FileSystemFileHandle).getFile();
                url = createPrimaryMediaObjectUrl(mediaFile.id, file, { revokeExisting: false });
                fileSystemService.storeFileHandle(mediaFile.id, handle as FileSystemFileHandle);
                log.debug('Restored file from handle:', stored.name);
              } else {
                const newPermission = await (handle as FileSystemFileHandle).requestPermission({ mode: 'read' });
                if (newPermission === 'granted') {
                  file = await (handle as FileSystemFileHandle).getFile();
                  url = createPrimaryMediaObjectUrl(mediaFile.id, file, { revokeExisting: false });
                  fileSystemService.storeFileHandle(mediaFile.id, handle as FileSystemFileHandle);
                  log.debug(`Restored file from handle (after permission): ${stored.name}`);
                }
              }
            } catch (e) {
              log.warn(`Failed to restore file from handle: ${stored.name}`, e);
            }
          }
        }

        if (stored.fileHash) {
          let thumbBlob: Blob | null = null;
          if (projectFileService.isProjectOpen()) {
            thumbBlob = await projectFileService.getThumbnail(stored.fileHash);
          }
          if (!thumbBlob || thumbBlob.size <= 0) {
            const storedThumbnail = await projectDB.getThumbnail(stored.fileHash);
            thumbBlob = storedThumbnail?.blob ?? null;
          }
          if (thumbBlob && thumbBlob.size > 0) {
            thumbnailUrl = createThumbnailMediaObjectUrl(mediaFile.id, thumbBlob);
          }
        }

        if (file || thumbnailUrl !== mediaFile.thumbnailUrl) {
          revokeMediaFileObjectUrls(mediaFile, {
            keepUrls: [url, thumbnailUrl].filter(isBlobUrl),
          });
        }

        let proxyStatus: ProxyStatus = 'none';
        let proxyFrameCount: number | undefined;
        let proxyProgress = 0;
        let proxyFps: number | undefined;
        let proxyFormat: MediaFile['proxyFormat'];
        if (stored.type === 'video' && projectFileService.isProjectOpen()) {
          const storageKey = stored.fileHash || mediaFile.id;
          const frameIndices = await projectFileService.getProxyFrameIndices(storageKey);
          if (isProxyFrameIndexSetComplete(frameIndices, stored.duration ?? mediaFile.duration, stored.fps ?? mediaFile.fps)) {
            proxyFps = getExpectedProxyFps(stored.fps ?? mediaFile.fps);
            proxyStatus = 'ready';
            proxyFrameCount = frameIndices.size;
            proxyProgress = 100;
            proxyFormat = 'jpeg-sequence';
          }
        }

        let transcriptStatus: TranscriptStatus = 'none';
        let transcript: TranscriptWord[] | undefined;
        if (projectFileService.isProjectOpen()) {
          try {
            const saved = await projectFileService.getTranscript(mediaFile.id);
            if (saved && Array.isArray(saved) && saved.length > 0) {
              transcriptStatus = 'ready';
              transcript = saved as TranscriptWord[];
            }
          } catch { /* no transcript file */ }
        }

        return {
          ...mediaFile,
          file,
          url,
          thumbnailUrl,
          fileHash: stored.fileHash,
          hasFileHandle: !!file,
          proxyStatus,
          proxyFrameCount,
          proxyFps: proxyStatus === 'ready' ? proxyFps : undefined,
          proxyProgress,
          proxyFormat,
          transcriptStatus,
          transcript,
          duration: stored.duration ?? mediaFile.duration,
          width: stored.width ?? mediaFile.width,
          height: stored.height ?? mediaFile.height,
          fps: stored.fps ?? mediaFile.fps,
          codec: stored.codec ?? mediaFile.codec,
          container: stored.container ?? mediaFile.container,
          fileSize: stored.fileSize ?? mediaFile.fileSize,
        };
      }),
    );

    let restoredTextItems: TextItem[] = [];
    let restoredSolidItems: SolidItem[] = [];
    let restoredMeshItems: MeshItem[] = [];
    let restoredCameraItems: CameraItem[] = [];
    let restoredSplatEffectorItems: SplatEffectorItem[] = [];
    let restoredMathSceneItems: MathSceneItem[] = [];
    let restoredMotionShapeItems: MotionShapeItem[] = [];
    try {
      const storedText = localStorage.getItem('ms-textItems');
      if (storedText) restoredTextItems = JSON.parse(storedText);
    } catch { /* ignore parse errors */ }
    try {
      const storedSolid = localStorage.getItem('ms-solidItems');
      if (storedSolid) restoredSolidItems = JSON.parse(storedSolid);
    } catch { /* ignore parse errors */ }
    try {
      const storedMesh = localStorage.getItem('ms-meshItems');
      if (storedMesh) restoredMeshItems = JSON.parse(storedMesh);
    } catch { /* ignore parse errors */ }
    try {
      const storedCamera = localStorage.getItem('ms-cameraItems');
      if (storedCamera) restoredCameraItems = JSON.parse(storedCamera);
    } catch { /* ignore parse errors */ }
    try {
      const storedSplatEffectors = localStorage.getItem('ms-splatEffectorItems');
      if (storedSplatEffectors) restoredSplatEffectorItems = JSON.parse(storedSplatEffectors);
    } catch { /* ignore parse errors */ }
    try {
      const storedMathScenes = localStorage.getItem('ms-mathSceneItems');
      if (storedMathScenes) restoredMathSceneItems = JSON.parse(storedMathScenes);
    } catch { /* ignore parse errors */ }
    try {
      const storedMotionShapes = localStorage.getItem('ms-motionShapeItems');
      if (storedMotionShapes) restoredMotionShapeItems = JSON.parse(storedMotionShapes);
    } catch { /* ignore parse errors */ }

    set({
      files: updatedFiles,
      isLoading: false,
      ...(restoredTextItems.length > 0 && { textItems: restoredTextItems }),
      ...(restoredSolidItems.length > 0 && { solidItems: restoredSolidItems }),
      ...(restoredMeshItems.length > 0 && { meshItems: restoredMeshItems }),
      ...(restoredCameraItems.length > 0 && { cameraItems: restoredCameraItems }),
      ...(restoredSplatEffectorItems.length > 0 && { splatEffectorItems: restoredSplatEffectorItems }),
      ...(restoredMathSceneItems.length > 0 && { mathSceneItems: restoredMathSceneItems }),
      ...(restoredMotionShapeItems.length > 0 && { motionShapeItems: restoredMotionShapeItems }),
    });
    log.info(`Restored ${storedFiles.length} files from IndexedDB`);
  } catch (e) {
    log.error('Failed to init from IndexedDB:', e);
    set({ isLoading: false });
  }
}
