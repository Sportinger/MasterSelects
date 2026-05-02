// Project Load — load project file data into stores + background restoration

import { Logger } from '../logger';
import { engine } from '../../engine/WebGPUEngine';
import { useMediaStore, type MediaFile, type Composition, type MediaFolder, type ProjectLoadProgress } from '../../stores/mediaStore';
import { getMediaInfo } from '../../stores/mediaStore/helpers/mediaInfoHelpers';
import { createThumbnail } from '../../stores/mediaStore/helpers/thumbnailHelpers';
import {
  getExpectedProxyFrameCount,
  getExpectedProxyFps,
  getProxyProgressFromFrameIndices,
  isProxyFrameIndexSetComplete,
} from '../../stores/mediaStore/helpers/proxyCompleteness';
import { updateTimelineClips } from '../../stores/mediaStore/slices/fileManageSlice';
import { useTimelineStore } from '../../stores/timeline';
import { useYouTubeStore } from '../../stores/youtubeStore';
import { useDockStore } from '../../stores/dockStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFlashBoardStore } from '../../stores/flashboardStore';
import { useExportStore } from '../../stores/exportStore';
import { useMIDIStore } from '../../stores/midiStore';
import { flashBoardMediaBridge } from '../flashboard/FlashBoardMediaBridge';
import type {
  FlashBoard,
  FlashBoardJobState,
  FlashBoardNode,
  ProjectFlashBoardState,
} from '../../stores/flashboardStore/types';
import {
  projectFileService,
  type ProjectFile,
  type ProjectMediaFile,
  type ProjectComposition,
  type ProjectFolder,
} from '../projectFileService';
import { withProjectStoreSyncGuard } from './projectSave';
import { fileSystemService } from '../fileSystemService';
import { projectDB } from '../projectDB';
import {
  cacheProjectFileHandle,
  getProjectRawPathCandidates,
  getStoredProjectFileHandle,
} from './mediaSourceResolver';
import {
  applyRelinkMatch,
  createRelinkCandidateMapFromHandles,
  findRelinkMatch,
} from './relinkMedia';
import { fromProjectTransform } from './transformSerialization';
import { lottieRuntimeManager } from '../vectorAnimation/LottieRuntimeManager';
import type {
  GaussianSplatSequenceData,
  GaussianSplatSequenceFrame,
  ModelSequenceData,
  ModelSequenceFrame,
  ClipMask,
  CompositionTimelineData,
  Effect,
  Keyframe,
  AnalysisStatus,
  SceneDescriptionStatus,
  TimelineClip,
  TranscriptStatus,
} from '../../types';

const log = Logger.create('ProjectSync');
const MEDIA_PANEL_PROJECT_UI_LOADED_EVENT = 'media-panel-project-ui-loaded';

type ProjectLoadProgressUpdate = Partial<Omit<ProjectLoadProgress, 'active'>> & {
  message: string;
};

type MediaStoreSnapshot = ReturnType<typeof useMediaStore.getState>;
type MediaStoreUpdate =
  | Partial<MediaStoreSnapshot>
  | ((state: MediaStoreSnapshot) => Partial<MediaStoreSnapshot>);

type ConvertProjectMediaOptions = {
  hydrateFiles?: boolean;
  deferCacheChecks?: boolean;
  onProgress?: (done: number, total: number, name: string) => void;
};

const DEFAULT_PROJECT_LOAD_PROGRESS: ProjectLoadProgress = {
  active: false,
  phase: 'idle',
  percent: 0,
  message: '',
  blocking: false,
};

let projectLoadCompletionTimer: ReturnType<typeof setTimeout> | null = null;

function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function setProjectLoadProgress(update: ProjectLoadProgressUpdate | null): void {
  if (projectLoadCompletionTimer) {
    clearTimeout(projectLoadCompletionTimer);
    projectLoadCompletionTimer = null;
  }

  if (!update) {
    useMediaStore.setState({ projectLoadProgress: DEFAULT_PROJECT_LOAD_PROGRESS });
    return;
  }

  useMediaStore.setState((state) => ({
    projectLoadProgress: {
      ...state.projectLoadProgress,
      active: true,
      phase: update.phase ?? state.projectLoadProgress.phase,
      percent: clampPercent(update.percent ?? state.projectLoadProgress.percent),
      message: update.message,
      detail: update.detail,
      itemsDone: update.itemsDone,
      itemsTotal: update.itemsTotal,
      blocking: update.blocking ?? state.projectLoadProgress.blocking,
    },
  }));
}

function completeProjectLoadProgress(message = 'Project ready'): void {
  setProjectLoadProgress({
    phase: 'ready',
    percent: 100,
    message,
    blocking: false,
  });
  projectLoadCompletionTimer = setTimeout(() => {
    setProjectLoadProgress(null);
  }, 900);
}

function failProjectLoadProgress(error: unknown): void {
  setProjectLoadProgress({
    phase: 'error',
    percent: 100,
    message: 'Project load failed',
    detail: error instanceof Error ? error.message : String(error),
    blocking: false,
  });
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function removeLocalStorageKey(key: string): void {
  const storage = localStorage as Storage & { removeItem?: (name: string) => void };
  if (typeof storage.removeItem === 'function') {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, '');
}

function isAbsoluteFilePath(value: string | undefined): boolean {
  return Boolean(value && (value.startsWith('/') || /^[A-Za-z]:[/\\]/.test(value)));
}

type ProjectFileServiceRawResolver = typeof projectFileService & {
  resolveRawFilePath?: (relativePath: string | undefined) => string | null;
  resolveRawFileUrl?: (relativePath: string | undefined) => string | null;
};

function resolveProjectRawFilePath(relativePath: string | undefined): string | null {
  const resolver = (projectFileService as ProjectFileServiceRawResolver).resolveRawFilePath;
  return typeof resolver === 'function'
    ? resolver.call(projectFileService, relativePath)
    : null;
}

function resolveProjectRawFileUrl(relativePath: string | undefined): string | null {
  const resolver = (projectFileService as ProjectFileServiceRawResolver).resolveRawFileUrl;
  return typeof resolver === 'function'
    ? resolver.call(projectFileService, relativePath)
    : null;
}

/**
 * Calculate coverage ratio from time ranges vs total duration (0-1).
 */
function calcRangeCoverage(ranges: [number, number][], totalDuration: number): number {
  if (totalDuration <= 0 || ranges.length === 0) return 0;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push([...sorted[i]]);
    }
  }
  const covered = merged.reduce((sum, [s, e]) => sum + (e - s), 0);
  return Math.min(1, covered / totalDuration);
}

function getSequenceFrameHandleCacheKey(mediaFileId: string, frameIndex: number): string {
  return `${mediaFileId}_frame_${frameIndex}`;
}

async function restoreSequenceFrameFromHandle(
  mediaFileId: string,
  frameIndex: number,
): Promise<{ file: File; handle: FileSystemFileHandle } | null> {
  const cacheKey = getSequenceFrameHandleCacheKey(mediaFileId, frameIndex);
  let handle = fileSystemService.getFileHandle(cacheKey);

  if (!handle) {
    try {
      const storedHandle = await projectDB.getStoredHandle(`media_${cacheKey}`);
      if (storedHandle && storedHandle.kind === 'file' && 'getFile' in storedHandle) {
        handle = storedHandle as FileSystemFileHandle;
        fileSystemService.storeFileHandle(cacheKey, handle);
      }
    } catch (error) {
      log.warn('Could not restore sequence frame handle from IndexedDB', {
        mediaFileId,
        frameIndex,
        error,
      });
      return null;
    }
  }

  if (!handle) {
    return null;
  }

  try {
    const permission = 'queryPermission' in handle
      ? await handle.queryPermission({ mode: 'read' })
      : 'granted';
    if (permission !== 'granted') {
      return null;
    }

    return {
      file: await handle.getFile(),
      handle,
    };
  } catch (error) {
    log.warn('Could not read sequence frame handle', {
      mediaFileId,
      frameIndex,
      error,
    });
    return null;
  }
}

// ============================================
// REVERSE CONVERTERS (project format → store)
// ============================================

async function convertProjectMediaToStore(
  projectMedia: ProjectMediaFile[],
  options: ConvertProjectMediaOptions = {},
): Promise<MediaFile[]> {
  const hydrateFiles = options.hydrateFiles !== false;
  const deferCacheChecks = options.deferCacheChecks === true;
  const files: MediaFile[] = [];
  const total = projectMedia.length;

  for (const pm of projectMedia) {
    let resolvedProjectPath = pm.projectPath;
    let handle: FileSystemFileHandle | undefined;
    let file: File | undefined;
    let url = '';
    let thumbnailUrl: string | undefined;

    if (hydrateFiles) {
      // Prefer the project-local RAW copy. This is the canonical source for imported media.
      const storedProjectHandle = await getStoredProjectFileHandle(pm.id);
      if (storedProjectHandle) {
        try {
          file = await storedProjectHandle.getFile();
          handle = storedProjectHandle;
          url = URL.createObjectURL(file);
          resolvedProjectPath = resolvedProjectPath || `Raw/${storedProjectHandle.name}`;
          await cacheProjectFileHandle(pm.id, storedProjectHandle, true);
          log.info('Restored file from project RAW handle:', pm.name);
        } catch (e) {
          log.warn(`Could not access project RAW handle: ${pm.name}`, e);
        }
      }
    }

    let modelSequence: ModelSequenceData | undefined;
    if (pm.modelSequence) {
      const sequenceFrames: ModelSequenceFrame[] = [];
      for (let frameIndex = 0; frameIndex < pm.modelSequence.frames.length; frameIndex += 1) {
        const frame = pm.modelSequence.frames[frameIndex];
        let frameFile = frame.file;
        let modelUrl = frame.modelUrl;
        const frameFileUrl = resolveProjectRawFileUrl(frame.projectPath);
        if (!hydrateFiles && !modelUrl && frameFileUrl) {
          modelUrl = frameFileUrl;
        }

        if (hydrateFiles && !frameFile && frame.projectPath && projectFileService.isProjectOpen()) {
          try {
            const result = await projectFileService.getFileFromRaw(frame.projectPath);
            if (result?.file) {
              frameFile = result.file;
              modelUrl = URL.createObjectURL(result.file);
            }
          } catch (error) {
            log.warn(`Could not restore model sequence frame for ${pm.name}`, {
              frame: frame.name,
              error,
            });
          }
        }

        if (hydrateFiles && !frameFile) {
          const restoredFrame = await restoreSequenceFrameFromHandle(pm.id, frameIndex);
          if (restoredFrame) {
            frameFile = restoredFrame.file;
            modelUrl = URL.createObjectURL(restoredFrame.file);
          }
        }

        sequenceFrames.push({
          name: frame.name,
          projectPath: frame.projectPath,
          sourcePath: frame.sourcePath,
          absolutePath: frame.absolutePath ?? resolveProjectRawFilePath(frame.projectPath) ?? undefined,
          file: frameFile,
          modelUrl,
        });
      }

      modelSequence = {
        ...pm.modelSequence,
        frames: sequenceFrames,
      };
    }
    let gaussianSplatSequence: GaussianSplatSequenceData | undefined;
    if (pm.gaussianSplatSequence) {
      const sequenceFrames: GaussianSplatSequenceFrame[] = [];
      for (let frameIndex = 0; frameIndex < pm.gaussianSplatSequence.frames.length; frameIndex += 1) {
        const frame = pm.gaussianSplatSequence.frames[frameIndex];
        let frameFile = frame.file;
        let splatUrl = frame.splatUrl;
        const frameFileUrl = resolveProjectRawFileUrl(frame.projectPath);
        if (!hydrateFiles && !splatUrl && frameFileUrl) {
          splatUrl = frameFileUrl;
        }

        if (hydrateFiles && !frameFile && frame.projectPath && projectFileService.isProjectOpen()) {
          try {
            const result = await projectFileService.getFileFromRaw(frame.projectPath);
            if (result?.file) {
              frameFile = result.file;
              splatUrl = URL.createObjectURL(result.file);
            }
          } catch (error) {
            log.warn(`Could not restore gaussian splat sequence frame for ${pm.name}`, {
              frame: frame.name,
              error,
            });
          }
        }

        if (hydrateFiles && !frameFile) {
          const restoredFrame = await restoreSequenceFrameFromHandle(pm.id, frameIndex);
          if (restoredFrame) {
            frameFile = restoredFrame.file;
            splatUrl = URL.createObjectURL(restoredFrame.file);
          }
        }

        sequenceFrames.push({
          name: frame.name,
          projectPath: frame.projectPath,
          sourcePath: frame.sourcePath,
          absolutePath: frame.absolutePath ?? resolveProjectRawFilePath(frame.projectPath) ?? undefined,
          file: frameFile,
          splatUrl,
          splatCount: frame.splatCount,
          fileSize: frame.fileSize,
          container: frame.container,
          codec: frame.codec,
        });
      }

      gaussianSplatSequence = {
        ...pm.gaussianSplatSequence,
        frames: sequenceFrames,
      };
    }
    if (hydrateFiles && !file && projectFileService.isProjectOpen()) {
      for (const candidatePath of getProjectRawPathCandidates({
        mediaFileId: pm.id,
        projectPath: pm.projectPath,
        filePath: pm.sourcePath,
        name: pm.name,
      })) {
        try {
          const result = await projectFileService.getFileFromRaw(candidatePath);
          if (!result) {
            continue;
          }

          file = result.file;
          handle = result.handle;
          url = URL.createObjectURL(file);
          resolvedProjectPath = candidatePath;
          const projectHandle = result.handle;
          if (projectHandle) {
            await cacheProjectFileHandle(pm.id, projectHandle, true);
          }
          log.info('Restored file from project RAW path:', pm.name);
          break;
        } catch (e) {
          log.warn(`Could not access project RAW path for ${pm.name}: ${candidatePath}`, e);
        }
      }
    }

    const representativeFile = file ?? modelSequence?.frames[0]?.file ?? gaussianSplatSequence?.frames[0]?.file;
    const representativeProjectPath =
      resolvedProjectPath ??
      modelSequence?.frames[0]?.projectPath ??
      gaussianSplatSequence?.frames[0]?.projectPath;
    const nativeRepresentativeUrl =
      !hydrateFiles && representativeProjectPath
        ? resolveProjectRawFileUrl(representativeProjectPath) ?? ''
        : '';
    const representativeUrl =
      url ||
      modelSequence?.frames[0]?.modelUrl ||
      gaussianSplatSequence?.frames[0]?.splatUrl ||
      nativeRepresentativeUrl ||
      '';
    const representativeAbsolutePath =
      resolveProjectRawFilePath(representativeProjectPath) ??
      (isAbsoluteFilePath(pm.sourcePath) ? pm.sourcePath : undefined) ??
      modelSequence?.frames[0]?.absolutePath ??
      gaussianSplatSequence?.frames[0]?.absolutePath;

    // Fall back to the primary file handle for non-project media or legacy data.
    if (hydrateFiles && !file) {
      handle = fileSystemService.getFileHandle(pm.id);

      if (!handle) {
        try {
          const storedHandle = await projectDB.getStoredHandle(`media_${pm.id}`);
          if (storedHandle && storedHandle.kind === 'file') {
            handle = storedHandle as FileSystemFileHandle;
            fileSystemService.storeFileHandle(pm.id, handle);
            log.info(`Retrieved handle from IndexedDB for: ${pm.name}`);
          }
        } catch (e) {
          log.warn(`Failed to get handle from IndexedDB: ${pm.name}`, e);
        }
      }

      if (handle) {
        try {
          const permission = await handle.queryPermission({ mode: 'read' });
          if (permission === 'granted') {
            file = await handle.getFile();
            url = URL.createObjectURL(file);
            log.info('Restored file from handle:', pm.name);
          } else {
            log.info('File needs permission:', pm.name);
          }
        } catch (e) {
          log.warn(`Could not access file: ${pm.name}`, e);
        }
      }
    }

    // Check for existing transcript on disk + load words + calculate coverage
    let transcriptStatus: import('../../types').TranscriptStatus = 'none';
    let transcript: import('../../types').TranscriptWord[] | undefined;
    let transcriptCoverage = 0;
    let transcribedRanges: [number, number][] | undefined;
    if (!deferCacheChecks && projectFileService.isProjectOpen()) {
      try {
        const saved = await projectFileService.getTranscript(pm.id);
        if (saved) {
          // New format: { words, transcribedRanges }
          const words = saved.words as import('../../types').TranscriptWord[];
          if (words && words.length > 0) {
            transcriptStatus = 'ready';
            transcript = words;
            transcribedRanges = saved.transcribedRanges;
            if (pm.duration && pm.duration > 0) {
              // Prefer transcribed ranges for coverage (silence is still "transcribed")
              transcriptCoverage = transcribedRanges?.length
                ? calcRangeCoverage(transcribedRanges, pm.duration)
                : calcRangeCoverage(transcript.map(w => [w.start, w.end]), pm.duration);
            }
          }
        }
      } catch { /* no transcript file */ }
    }

    // Check for existing analysis on disk + calculate coverage
    let analysisStatus: import('../../types').AnalysisStatus = 'none';
    let analysisCoverage = 0;
    if (!deferCacheChecks && projectFileService.isProjectOpen()) {
      try {
        const ranges = await projectFileService.getAnalysisRanges(pm.id);
        if (ranges.length > 0) {
          analysisStatus = 'ready';
          if (pm.duration && pm.duration > 0) {
            const parsed: [number, number][] = ranges.map(key => {
              const [s, e] = key.split('-').map(Number);
              return [s, e];
            });
            analysisCoverage = calcRangeCoverage(parsed, pm.duration);
          }
        }
      } catch { /* no analysis file */ }
    }

    let proxyStatus: MediaFile['proxyStatus'] = 'none';
    let proxyFrameCount: number | undefined;
    let proxyProgress = 0;
    let proxyFps: number | undefined;
    if (pm.type === 'video' && pm.hasProxy && projectFileService.isProjectOpen()) {
      proxyFps = getExpectedProxyFps(pm.frameRate);
      if (deferCacheChecks) {
        proxyStatus = 'ready';
        proxyFrameCount = getExpectedProxyFrameCount(pm.duration, proxyFps) ?? undefined;
        proxyProgress = 100;
      } else {
        const proxyStorageKey = pm.fileHash || pm.id;
        const frameIndices = await projectFileService.getProxyFrameIndices(proxyStorageKey);
        if (frameIndices.size > 0) {
          proxyStatus = isProxyFrameIndexSetComplete(frameIndices, pm.duration, proxyFps) ? 'ready' : 'none';
          proxyFrameCount = frameIndices.size;
          proxyProgress = getProxyProgressFromFrameIndices(frameIndices, pm.duration, proxyFps);
        }
      }
    }

    files.push({
      id: pm.id,
      name: pm.name,
      type: pm.type,
      parentId: pm.folderId,
      createdAt: new Date(pm.importedAt).getTime(),
      file: representativeFile,
      url: representativeUrl,
      thumbnailUrl,
      duration: pm.duration,
      width: pm.width,
      height: pm.height,
      fps: pm.frameRate,
      codec: pm.codec ?? gaussianSplatSequence?.codec,
      audioCodec: pm.audioCodec,
      container: pm.container ?? (gaussianSplatSequence?.container ? `${gaussianSplatSequence.container} Seq` : undefined),
      bitrate: pm.bitrate,
      fileSize: pm.fileSize ?? gaussianSplatSequence?.totalFileSize,
      hasAudio: pm.hasAudio,
      splatCount: pm.splatCount ?? gaussianSplatSequence?.frames[0]?.splatCount,
      totalSplatCount: pm.totalSplatCount ?? gaussianSplatSequence?.totalSplatCount,
      splatFrameCount: pm.splatFrameCount ?? gaussianSplatSequence?.frameCount,
      modelSequence,
      gaussianSplatSequence,
      proxyStatus,
      proxyFrameCount,
      proxyFps: proxyStatus === 'ready' ? proxyFps : undefined,
      proxyProgress,
      hasFileHandle: !!handle || (!!representativeAbsolutePath && projectFileService.activeBackend === 'native'),
      filePath: pm.sourcePath,
      absolutePath: representativeAbsolutePath,
      projectPath: representativeProjectPath,
      fileHash: pm.fileHash,
      vectorAnimation: pm.vectorAnimation,
      labelColor: pm.labelColor as import('../../stores/mediaStore/types').LabelColor | undefined,
      transcriptStatus,
      transcript,
      transcriptCoverage,
      transcribedRanges,
      analysisStatus,
      analysisCoverage,
    });

    options.onProgress?.(files.length, total, pm.name);
    if (files.length % 3 === 0) {
      await yieldToBrowser();
    }
  }

  return files;
}

/**
 * Convert ProjectComposition to Composition format
 */
function convertProjectCompositionToStore(
  projectComps: ProjectComposition[],
  compositionViewState?: Record<string, {
    playheadPosition?: number;
    zoom?: number;
    scrollX?: number;
    inPoint?: number | null;
    outPoint?: number | null;
  }>
): Composition[] {
  return projectComps.map((pc) => {
    // Get saved view state for this composition
    const viewState = compositionViewState?.[pc.id];

    // Convert back to timelineData format
    const timelineData: CompositionTimelineData = {
      tracks: pc.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        height: t.height,
        locked: t.locked,
        visible: t.visible,
        muted: t.muted,
        solo: t.solo,
      })),
      clips: pc.clips.map((c) => ({
        id: c.id,
        trackId: c.trackId,
        name: c.name || '',
        mediaFileId: c.mediaId,  // Map mediaId -> mediaFileId for loadState
        sourceType: c.sourceType || 'video',
        naturalDuration: c.naturalDuration,
        thumbnails: c.thumbnails,
        linkedClipId: c.linkedClipId,
        linkedGroupId: c.linkedGroupId,
        waveform: c.waveform,
        modelSequence: c.modelSequence,
        gaussianSplatSequence: c.gaussianSplatSequence,
        threeDEffectorsEnabled: c.threeDEffectorsEnabled,
        meshType: c.meshType,
        cameraSettings: c.cameraSettings,
        splatEffectorSettings: c.splatEffectorSettings,
        gaussianBlendshapes: c.gaussianBlendshapes,
        gaussianSplatSettings: c.gaussianSplatSettings,
        startTime: c.startTime,
        duration: c.duration,
        inPoint: c.inPoint,
        outPoint: c.outPoint,
        transform: fromProjectTransform(c.transform),
        effects: c.effects.map((effect): Effect => ({
          id: effect.id,
          name: effect.name,
          type: effect.type as Effect['type'],
          enabled: effect.enabled,
          params: effect.params,
        })),
        colorCorrection: c.colorCorrection ? structuredClone(c.colorCorrection) : undefined,
        masks: c.masks.map((mask): ClipMask => ({
          id: mask.id,
          name: mask.name,
          mode: mask.mode,
          inverted: mask.inverted,
          opacity: mask.opacity,
          feather: mask.feather,
          featherQuality: mask.featherQuality ?? 50,
          enabled: mask.enabled !== false,
          visible: mask.visible !== false,
          closed: mask.closed,
          expanded: false,
          position: mask.position,
          vertices: mask.vertices.map((vertex, index) => ({
            id: `${mask.id}-v-${index}`,
            x: vertex.x,
            y: vertex.y,
            handleIn: vertex.inTangent,
            handleOut: vertex.outTangent,
            handleMode: vertex.handleMode,
          })),
        })),
        keyframes: (c.keyframes || []).map((keyframe): Keyframe => ({
          id: keyframe.id,
          clipId: c.id,
          property: keyframe.property as Keyframe['property'],
          time: keyframe.time,
          value: keyframe.value,
          easing: keyframe.easing as Keyframe['easing'],
          handleIn: keyframe.bezierHandles
            ? { x: keyframe.bezierHandles.x1, y: keyframe.bezierHandles.y1 }
            : undefined,
          handleOut: keyframe.bezierHandles
            ? { x: keyframe.bezierHandles.x2, y: keyframe.bezierHandles.y2 }
            : undefined,
        })),
        volume: c.volume,
        audioEnabled: c.audioEnabled,
        reversed: c.reversed,
        disabled: c.disabled,
        speed: c.speed,
        preservesPitch: c.preservesPitch,
        // Nested composition support
        isComposition: c.isComposition,
        compositionId: c.compositionId,
        // Text clip support
        textProperties: c.textProperties,
        text3DProperties: c.text3DProperties,
        // Solid clip support
        solidColor: c.solidColor,
        vectorAnimationSettings: c.vectorAnimationSettings,
        // 3D layer support
        is3D: c.is3D,
        // Transcript data
        transcript: c.transcript,
        transcriptStatus: c.transcriptStatus as TranscriptStatus | undefined,
        // Analysis data
        analysis: c.analysis,
        analysisStatus: c.analysisStatus as AnalysisStatus | undefined,
        // AI scene description data
        sceneDescriptions: c.sceneDescriptions,
        sceneDescriptionStatus: c.sceneDescriptionStatus as SceneDescriptionStatus | undefined,
      })),
      // Restore view state from saved uiState, or use defaults
      playheadPosition: viewState?.playheadPosition ?? 0,
      duration: pc.duration,
      zoom: viewState?.zoom ?? 1,
      scrollX: viewState?.scrollX ?? 0,
      inPoint: viewState?.inPoint ?? null,
      outPoint: viewState?.outPoint ?? null,
      loopPlayback: false,
      markers: (pc.markers || []).map((marker) => ({
        id: marker.id,
        time: marker.time,
        label: marker.name || '',
        color: marker.color,
        stopPlayback: marker.stopPlayback === true ? true : undefined,
        midiBindings: marker.midiBindings,
      })),
    };

    const comp: Composition = {
      id: pc.id,
      name: pc.name,
      type: 'composition',
      parentId: pc.folderId,
      labelColor: pc.labelColor as import('../../stores/mediaStore/types').LabelColor | undefined,
      createdAt: Date.now(),
      width: pc.width,
      height: pc.height,
      frameRate: pc.frameRate,
      duration: pc.duration,
      backgroundColor: pc.backgroundColor,
      timelineData,
    };
    return comp;
  });
}

/**
 * Convert ProjectFolder to MediaFolder format
 */
function convertProjectFolderToStore(projectFolders: ProjectFolder[]): MediaFolder[] {
  return projectFolders.map((pf) => ({
    id: pf.id,
    name: pf.name,
    parentId: pf.parentId,
    labelColor: pf.labelColor as import('../../stores/mediaStore/types').LabelColor | undefined,
    isExpanded: true,
    createdAt: Date.now(),
  }));
}

function hydrateFlashBoardFromProject(data: ProjectFlashBoardState): void {
  const boards: FlashBoard[] = data.boards.map((board) => {
    const nodes: FlashBoardNode[] = board.nodes.map((node) => {
      let job: FlashBoardJobState | undefined;
      if (node.job) {
        const interrupted = node.job.status === 'queued' || node.job.status === 'processing';
        job = {
          ...node.job,
          status: interrupted ? 'failed' : node.job.status,
          error: interrupted && !node.job.error ? 'Job interrupted by reload' : node.job.error,
        };
      }

      return {
        id: node.id,
        kind: node.kind,
        createdAt: new Date(node.createdAt).getTime(),
        updatedAt: new Date(node.updatedAt).getTime(),
        position: node.position,
        size: node.size,
        request: node.request,
        job,
        result: node.result,
      };
    });

    return {
      id: board.id,
      name: board.name,
      createdAt: new Date(board.createdAt).getTime(),
      updatedAt: new Date(board.updatedAt).getTime(),
      viewport: board.viewport,
      nodes,
    };
  });

  useFlashBoardStore.setState({
    activeBoardId: data.activeBoardId,
    boards,
    selectedNodeIds: [],
    composer: {
      draftNodeId: null,
      isOpen: false,
      generateAudio: false,
      multiShots: false,
      multiPrompt: [],
      referenceMediaFileIds: [],
    },
  });
}

// ============================================
// LOAD PROJECT TO STORES
// ============================================

/**
 * Load project data from projectFileService into stores
 */
export async function loadProjectToStores(): Promise<void> {
  let backgroundProjectData: ProjectFile | null = null;
  let backgroundHydrateFiles = true;

  setProjectLoadProgress({
    phase: 'opening',
    percent: 5,
    message: 'Opening project',
    blocking: true,
  });

  try {
    await withProjectStoreSyncGuard(async () => {
    const projectData = projectFileService.getProjectData();
    if (!projectData) {
      log.error(' No project data to load');
      return;
    }
    backgroundProjectData = projectData;

    // Firefox/native helper must not synchronously download every RAW file or
    // 3D sequence frame before the project appears in the UI.
    const hydrateFiles = projectFileService.activeBackend !== 'native';
    backgroundHydrateFiles = hydrateFiles;
    if (!hydrateFiles) {
      log.info('Native backend detected; deferring media file hydration until after project metadata is loaded');
    }

    // Convert and load data
    setProjectLoadProgress({
      phase: 'media',
      percent: 12,
      message: 'Loading media references',
      itemsDone: 0,
      itemsTotal: projectData.media.length,
      blocking: true,
    });
    const files = await convertProjectMediaToStore(projectData.media, {
      hydrateFiles,
      deferCacheChecks: true,
      onProgress: (done, total, name) => {
        const mediaPercent = total > 0 ? done / total : 1;
        setProjectLoadProgress({
          phase: 'media',
          percent: 12 + mediaPercent * 24,
          message: 'Loading media references',
          detail: name,
          itemsDone: done,
          itemsTotal: total,
          blocking: true,
        });
      },
    });
    setProjectLoadProgress({
      phase: 'timeline',
      percent: 40,
      message: 'Restoring timeline',
      blocking: true,
    });
    const compositions = convertProjectCompositionToStore(
      projectData.compositions,
      projectData.uiState?.compositionViewState
    );
    const folders = convertProjectFolderToStore(projectData.folders);

  // Clear timeline first
  const timelineStore = useTimelineStore.getState();
  timelineStore.clearTimeline();

  // Restore generated media items
  const textItems = projectData.textItems || [];
  const solidItems = projectData.solidItems || [];
  const meshItems = projectData.meshItems || [];
  const cameraItems = projectData.cameraItems || [];
  const splatEffectorItems = projectData.splatEffectorItems || [];

  // Update media store
  useMediaStore.setState({
    files,
    compositions: compositions.length > 0 ? compositions : [{
      id: `comp-${Date.now()}`,
      name: 'Comp 1',
      type: 'composition',
      parentId: null,
      createdAt: Date.now(),
      width: projectData.settings.width,
      height: projectData.settings.height,
      frameRate: projectData.settings.frameRate,
      duration: 60,
      backgroundColor: '#000000',
    }],
    folders,
    textItems,
    solidItems,
    meshItems,
    cameraItems,
    splatEffectorItems,
    activeCompositionId: projectData.activeCompositionId,
    openCompositionIds: projectData.openCompositionIds || [],
    expandedFolderIds: projectData.expandedFolderIds || [],
    slotAssignments: projectData.slotAssignments || {},
    slotClipSettings: projectData.slotClipSettings || {},
    selectedSlotCompositionId: null,
  });

  // Load active composition's timeline
  if (projectData.activeCompositionId) {
    const activeComp = compositions.find((c) => c.id === projectData.activeCompositionId);
    if (activeComp?.timelineData) {
      await timelineStore.loadState(activeComp.timelineData);

      // Sync transcript/analysis status from clips to MediaFiles (for badge display)
      syncStatusFromClipsToMedia();
    }
  }

  setProjectLoadProgress({
    phase: 'ui',
    percent: 58,
    message: 'Restoring workspace',
    blocking: true,
  });

  // Load YouTube panel state
  if (projectData.youtube) {
    useYouTubeStore.getState().loadState(projectData.youtube);
  } else {
    useYouTubeStore.getState().reset();
  }

  // Restore dock layout from project
  if (projectData.uiState?.dockLayout) {
    useDockStore.getState().setLayoutFromProject(projectData.uiState.dockLayout);
    log.info(' Restored dock layout from project');
  }

  if (projectData.flashboard) {
    hydrateFlashBoardFromProject(projectData.flashboard);
    flashBoardMediaBridge.hydrateMetadata(projectData.flashboard.generationMetadataByMediaId ?? {});
    log.info(' Restored FlashBoard state from project');
  } else {
    useFlashBoardStore.setState({
      activeBoardId: null,
      boards: [],
      selectedNodeIds: [],
      composer: {
        draftNodeId: null,
        isOpen: false,
        generateAudio: false,
        multiShots: false,
        multiPrompt: [],
        referenceMediaFileIds: [],
      },
    });
    flashBoardMediaBridge.hydrateMetadata({});
  }

  // Restore per-project UI settings to localStorage
  if (projectData.uiState?.mediaPanelColumns) {
    localStorage.setItem('media-panel-column-order', JSON.stringify(projectData.uiState.mediaPanelColumns));
  }
  if (projectData.uiState?.mediaPanelNameWidth !== undefined) {
    localStorage.setItem('media-panel-name-width', String(projectData.uiState.mediaPanelNameWidth));
  }
  if (projectData.uiState?.mediaPanelViewMode) {
    localStorage.setItem('media-panel-view-mode', projectData.uiState.mediaPanelViewMode);
  }
  if (projectData.uiState?.mediaPanelBoardViewport) {
    localStorage.setItem('media-panel-board-viewport', JSON.stringify(projectData.uiState.mediaPanelBoardViewport));
  } else {
    removeLocalStorageKey('media-panel-board-viewport');
  }
  if (projectData.uiState?.mediaPanelBoardOrder) {
    localStorage.setItem('media-panel-board-order', JSON.stringify(projectData.uiState.mediaPanelBoardOrder));
  } else {
    removeLocalStorageKey('media-panel-board-order');
  }
  if (projectData.uiState?.mediaPanelBoardGroupOffsets) {
    localStorage.setItem('media-panel-board-group-offsets', JSON.stringify(projectData.uiState.mediaPanelBoardGroupOffsets));
  } else {
    removeLocalStorageKey('media-panel-board-group-offsets');
  }
  removeLocalStorageKey('media-panel-board-layout');
  window.dispatchEvent(new CustomEvent(MEDIA_PANEL_PROJECT_UI_LOADED_EVENT));
  if (projectData.uiState?.transcriptLanguage) {
    localStorage.setItem('transcriptLanguage', projectData.uiState.transcriptLanguage);
  }

  // Restore view toggle states
  if (projectData.uiState) {
    const ui = projectData.uiState;
    const ts = useTimelineStore.getState();
    if (ui.thumbnailsEnabled !== undefined) ts.setThumbnailsEnabled(ui.thumbnailsEnabled);
    if (ui.waveformsEnabled !== undefined) ts.setWaveformsEnabled(ui.waveformsEnabled);
    if (ui.showTranscriptMarkers !== undefined) ts.setShowTranscriptMarkers(ui.showTranscriptMarkers);
    if (ui.proxyEnabled !== undefined) useMediaStore.getState().setProxyEnabled(ui.proxyEnabled);

    const changelogSettings: Partial<{
      showChangelogOnStartup: boolean;
      lastSeenChangelogVersion: string | null;
    }> = {};
    if (ui.showChangelogOnStartup !== undefined) {
      changelogSettings.showChangelogOnStartup = ui.showChangelogOnStartup;
    }
    if ('lastSeenChangelogVersion' in ui) {
      changelogSettings.lastSeenChangelogVersion = ui.lastSeenChangelogVersion ?? null;
    }
    if (Object.keys(changelogSettings).length > 0) {
      useSettingsStore.setState(changelogSettings);
    }

  }

  const projectMIDIState = projectData.uiState?.midi;
  useMIDIStore.setState({
    isEnabled: projectMIDIState?.isEnabled ?? false,
    transportBindings: {
      playPause: projectMIDIState?.transportBindings?.playPause ?? null,
      stop: projectMIDIState?.transportBindings?.stop ?? null,
    },
    slotBindings: projectMIDIState?.slotBindings ?? {},
    parameterBindings: projectMIDIState?.parameterBindings ?? {},
    learnTarget: null,
  });

  useExportStore.getState().hydrateFromProject(projectData.uiState?.exportState);

  // Reload API keys (may have been restored from .keys.enc during loadProject)
  await useSettingsStore.getState().loadApiKeys();

  setProjectLoadProgress({
    phase: 'ready',
    percent: 70,
    message: 'Project visible',
    detail: projectData.name,
    blocking: false,
  });

  log.info(' Loaded project to stores:', projectData.name);
    });

    if (backgroundProjectData) {
      void runPostLoadRestoration(backgroundProjectData, backgroundHydrateFiles);
    } else {
      completeProjectLoadProgress();
    }
  } catch (error) {
    failProjectLoadProgress(error);
    throw error;
  }
}

// ============================================
// BACKGROUND RESTORATION HELPERS
// ============================================

async function applyProjectRestoreMediaUpdate(
  update: MediaStoreUpdate,
): Promise<void> {
  await withProjectStoreSyncGuard(async () => {
    useMediaStore.setState(update);
  });
}

async function runPostLoadRestoration(projectData: ProjectFile, hydrateFiles: boolean): Promise<void> {
  try {
    if (hydrateFiles) {
      setProjectLoadProgress({
        phase: 'relink',
        percent: 72,
        message: 'Checking missing media',
        blocking: false,
      });
      await autoRelinkFromRawFolder();
    } else {
      log.info('Skipping eager auto-relink for native backend during initial project load');
    }

    await yieldToBrowser();

    setProjectLoadProgress({
      phase: 'thumbnails',
      percent: 78,
      message: 'Restoring thumbnails',
      blocking: false,
    });
    await restoreMediaThumbnails((done, total, name) => {
      const ratio = total > 0 ? done / total : 1;
      setProjectLoadProgress({
        phase: 'thumbnails',
        percent: 78 + ratio * 8,
        message: 'Restoring thumbnails',
        detail: name,
        itemsDone: done,
        itemsTotal: total,
        blocking: false,
      });
    });

    setProjectLoadProgress({
      phase: 'metadata',
      percent: 86,
      message: 'Refreshing media metadata',
      blocking: false,
    });
    await refreshMediaMetadata((done, total, name) => {
      const ratio = total > 0 ? done / total : 1;
      setProjectLoadProgress({
        phase: 'metadata',
        percent: 86 + ratio * 6,
        message: 'Refreshing media metadata',
        detail: name,
        itemsDone: done,
        itemsTotal: total,
        blocking: false,
      });
    });

    setProjectLoadProgress({
      phase: 'caches',
      percent: 92,
      message: 'Checking project caches',
      itemsDone: 0,
      itemsTotal: projectData.media.length,
      blocking: false,
    });
    await restoreDeferredMediaCacheState(projectData.media, (done, total, name, itemProgress) => {
      const ratio = total > 0 ? (done + (itemProgress ?? 0)) / total : 1;
      setProjectLoadProgress({
        phase: 'caches',
        percent: 92 + ratio * 7,
        message: 'Checking project caches',
        detail: name,
        itemsDone: done,
        itemsTotal: total,
        blocking: false,
      });
    });

    completeProjectLoadProgress('Project ready');
  } catch (error) {
    log.warn('Post-load project restoration finished with warnings', error);
    completeProjectLoadProgress('Project ready with warnings');
  }
}

/**
 * Refresh media metadata (codec, bitrate, hasAudio) for all loaded files.
 * This runs in the background after project load to populate metadata fields.
 */
async function refreshMediaMetadata(
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<void> {
  const mediaState = useMediaStore.getState();
  // Refresh files that have a file object but are missing important metadata
  const filesToRefresh = mediaState.files.filter(f =>
    (f.type === 'video' || f.type === 'audio' || f.type === 'image') &&
    f.file && (
      f.codec === undefined ||
      f.container === undefined ||
      f.fileSize === undefined ||
      (f.type === 'video' && f.hasAudio === undefined)
    )
  );

  if (filesToRefresh.length === 0) {
    log.debug('No files need metadata refresh');
    return;
  }

  log.info(`Refreshing metadata for ${filesToRefresh.length} files...`);

  // Process files in parallel but with a limit to avoid overwhelming the browser
  const batchSize = 3;
  let completed = 0;
  for (let i = 0; i < filesToRefresh.length; i += batchSize) {
    const batch = filesToRefresh.slice(i, i + batchSize);

    await Promise.all(batch.map(async (mediaFile) => {
      if (!mediaFile.file) {
        completed++;
        onProgress?.(completed, filesToRefresh.length, mediaFile.name);
        return;
      }

      try {
        const info = await getMediaInfo(mediaFile.file, mediaFile.type as 'video' | 'audio' | 'image');

        // Update the file in the store
        await applyProjectRestoreMediaUpdate((state) => ({
          files: state.files.map((f) =>
            f.id === mediaFile.id
              ? {
                  ...f,
                  codec: info.codec || f.codec,
                  audioCodec: info.audioCodec,
                  container: info.container || f.container,
                  bitrate: info.bitrate || f.bitrate,
                  fileSize: info.fileSize || f.fileSize,
                  hasAudio: info.hasAudio ?? f.hasAudio,
                  fps: info.fps || f.fps,
                }
              : f
          ),
        }));

        log.debug(`Refreshed metadata for: ${mediaFile.name}`, {
          codec: info.codec,
          hasAudio: info.hasAudio,
          bitrate: info.bitrate,
        });
      } catch (e) {
        log.warn(`Failed to refresh metadata for: ${mediaFile.name}`, e);
      } finally {
        completed++;
        onProgress?.(completed, filesToRefresh.length, mediaFile.name);
      }
    }));
    await yieldToBrowser();
  }

  log.info('Media metadata refresh complete');
}

/**
 * Restore thumbnails for media files after project load.
 * Checks project folder first, then regenerates from file if needed.
 */
async function restoreMediaThumbnails(
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<void> {
  const mediaState = useMediaStore.getState();
  // Find files that need thumbnails (video/image files without thumbnailUrl)
  const filesToRestore = mediaState.files.filter(f =>
    f.file && !f.thumbnailUrl && (f.type === 'video' || f.type === 'image')
  );

  if (filesToRestore.length === 0) {
    log.debug('No thumbnails need restoration');
    return;
  }

  log.info(`Restoring thumbnails for ${filesToRestore.length} files...`);

  // Process in batches to avoid overwhelming browser
  const batchSize = 5;
  let completed = 0;
  for (let i = 0; i < filesToRestore.length; i += batchSize) {
    const batch = filesToRestore.slice(i, i + batchSize);

    await Promise.all(batch.map(async (mediaFile) => {
      if (!mediaFile.file) {
        completed++;
        onProgress?.(completed, filesToRestore.length, mediaFile.name);
        return;
      }

      try {
        let thumbnailUrl: string | undefined;

        // First try to get from project folder if we have a hash
        if (mediaFile.fileHash && projectFileService.isProjectOpen()) {
          const existingBlob = await projectFileService.getThumbnail(mediaFile.fileHash);
          if (existingBlob && existingBlob.size > 0) {
            thumbnailUrl = URL.createObjectURL(existingBlob);
            log.debug(`Restored thumbnail from project: ${mediaFile.name}`);
          }
        }

        // If not found in project, regenerate from file
        if (!thumbnailUrl) {
          thumbnailUrl = await createThumbnail(mediaFile.file, mediaFile.type as 'video' | 'image');
          log.debug(`Regenerated thumbnail: ${mediaFile.name}`);
        }

        if (thumbnailUrl) {
          await applyProjectRestoreMediaUpdate((state) => ({
            files: state.files.map((f) =>
              f.id === mediaFile.id ? { ...f, thumbnailUrl } : f
            ),
          }));
        }
      } catch (e) {
        log.warn(`Failed to restore thumbnail for: ${mediaFile.name}`, e);
      } finally {
        completed++;
        onProgress?.(completed, filesToRestore.length, mediaFile.name);
      }
    }));
    await yieldToBrowser();
  }

  log.info('Thumbnail restoration complete');
}

async function restoreDeferredMediaCacheState(
  projectMedia: ProjectMediaFile[],
  onProgress?: (done: number, total: number, name: string, itemProgress?: number) => void,
): Promise<void> {
  if (!projectFileService.isProjectOpen() || projectMedia.length === 0) {
    return;
  }

  let completed = 0;
  for (const pm of projectMedia) {
    onProgress?.(completed, projectMedia.length, pm.name, 0);
    const updates: Partial<MediaFile> = {};

    try {
      const saved = await projectFileService.getTranscript(pm.id);
      if (saved) {
        const words = Array.isArray(saved)
          ? saved as import('../../types').TranscriptWord[]
          : saved.words as import('../../types').TranscriptWord[];
        if (words && words.length > 0) {
          updates.transcriptStatus = 'ready';
          updates.transcript = words;
          const transcribedRanges = Array.isArray(saved)
            ? undefined
            : saved.transcribedRanges;
          updates.transcribedRanges = transcribedRanges;
          updates.transcriptCoverage = pm.duration && pm.duration > 0
            ? (
                transcribedRanges?.length
                  ? calcRangeCoverage(transcribedRanges, pm.duration)
                  : calcRangeCoverage(words.map(w => [w.start, w.end]), pm.duration)
              )
            : 0;
        }
      }
    } catch { /* no transcript file */ }

    try {
      const ranges = await projectFileService.getAnalysisRanges(pm.id);
      if (ranges.length > 0) {
        updates.analysisStatus = 'ready';
        if (pm.duration && pm.duration > 0) {
          const parsed: [number, number][] = ranges.map(key => {
            const [s, e] = key.split('-').map(Number);
            return [s, e];
          });
          updates.analysisCoverage = calcRangeCoverage(parsed, pm.duration);
        }
      }
    } catch { /* no analysis file */ }

    if (pm.type === 'video' && pm.hasProxy) {
      try {
        const proxyFps = getExpectedProxyFps(pm.frameRate);
        const expectedFrames = getExpectedProxyFrameCount(pm.duration, proxyFps);
        const frameIndices = await projectFileService.getProxyFrameIndices(
          pm.fileHash || pm.id,
          (scan) => {
            const scanRatio = expectedFrames
              ? Math.min(0.98, scan.matched / expectedFrames)
              : 0;
            const label = expectedFrames
              ? `${pm.name} - proxy ${scan.matched}/${expectedFrames}`
              : `${pm.name} - proxy ${scan.matched} frames`;
            onProgress?.(completed, projectMedia.length, label, scan.done ? 0.98 : scanRatio);
          },
        );
        if (frameIndices.size > 0) {
          updates.proxyStatus = isProxyFrameIndexSetComplete(frameIndices, pm.duration, proxyFps) ? 'ready' : 'none';
          updates.proxyFrameCount = frameIndices.size;
          updates.proxyFps = updates.proxyStatus === 'ready' ? proxyFps : undefined;
          updates.proxyProgress = getProxyProgressFromFrameIndices(frameIndices, pm.duration, proxyFps);
        } else {
          updates.proxyStatus = 'none';
          updates.proxyFrameCount = undefined;
          updates.proxyFps = undefined;
          updates.proxyProgress = 0;
        }
      } catch {
        updates.proxyStatus = 'none';
        updates.proxyFrameCount = undefined;
        updates.proxyFps = undefined;
        updates.proxyProgress = 0;
      }
    }

    if (Object.keys(updates).length > 0) {
      await applyProjectRestoreMediaUpdate((state) => ({
        files: state.files.map((file) => (
          file.id === pm.id ? { ...file, ...updates } : file
        )),
      }));
    }

    completed++;
    onProgress?.(completed, projectMedia.length, pm.name);
    await yieldToBrowser();
  }
}

/**
 * Automatically relink missing media files from the project's Raw folder
 * This runs silently after project load - no user interaction needed if all files are found
 */
async function autoRelinkFromRawFolder(): Promise<void> {
  if (!projectFileService.isProjectOpen()) return;

  const mediaState = useMediaStore.getState();
  const missingFiles = mediaState.files.filter(f => !f.file && !f.url);

  if (missingFiles.length === 0) {
    log.info(' No missing files to relink');
    return;
  }

  log.info(`Attempting auto-relink for ${missingFiles.length} missing files...`);

  // Scan Raw first, then the whole project folder. Raw keeps priority if duplicate names exist.
  let rawFiles = await projectFileService.scanRawFolder();
  if (rawFiles.size === 0) {
    // Wait briefly and retry - the directory handle may need time on first load
    log.debug('Raw folder scan returned empty, retrying after delay...');
    await new Promise(resolve => setTimeout(resolve, 200));
    rawFiles = await projectFileService.scanRawFolder();
  }
  const projectFiles = await projectFileService.scanProjectFolder();
  const relinkCandidates = new Map(rawFiles);
  for (const [name, handle] of projectFiles) {
    if (!relinkCandidates.has(name)) {
      relinkCandidates.set(name, handle);
    }
  }

  if (relinkCandidates.size === 0) {
    log.info(' Project media folders are empty or not accessible');
    return;
  }

  log.debug(`Found ${relinkCandidates.size} candidate files in project folder`, {
    rawFiles: rawFiles.size,
    projectFiles: projectFiles.size,
  });

  // Match and relink files. This handles normal media and numbered 3D sequences.
  let relinkedCount = 0;
  const relinkedByProjectScan = new Set<string>();
  const candidateMap = await createRelinkCandidateMapFromHandles(relinkCandidates.values());

  for (const file of missingFiles) {
    const match = findRelinkMatch(file, candidateMap);
    if (!match) {
      continue;
    }

    const applied = await applyRelinkMatch(file.id, match);
    if (applied) {
      relinkedByProjectScan.add(file.id);
      relinkedCount++;
      log.debug('Auto-relinked from project folder', { name: file.name, kind: match.kind });
    }
  }

  let fallbackRelinkedCount = 0;
  const updatedFiles = [...useMediaStore.getState().files];
  for (let i = 0; i < updatedFiles.length; i++) {
    const file = updatedFiles[i];
    if (file.file || file.url) continue; // Already has file
    if (relinkedByProjectScan.has(file.id)) continue;

    // Try to get from stored file handle in IndexedDB
    try {
      const storedHandle = await projectDB.getStoredHandle(`media_${file.id}`);
      if (storedHandle && storedHandle.kind === 'file') {
        const fileHandle = storedHandle as FileSystemFileHandle;
        const permission = await fileHandle.queryPermission({ mode: 'read' });

        if (permission === 'granted') {
          const fileObj = await fileHandle.getFile();
          const url = URL.createObjectURL(fileObj);

          fileSystemService.storeFileHandle(file.id, fileHandle);

          updatedFiles[i] = {
            ...file,
            file: fileObj,
            url,
            hasFileHandle: true,
          };

          relinkedCount++;
          fallbackRelinkedCount++;
          log.debug(`Auto-relinked from IndexedDB handle: ${file.name}`);
        }
      }
    } catch (e) {
      // Silently ignore - will need manual reload
    }
  }

  if (relinkedCount > 0) {
    if (fallbackRelinkedCount > 0) {
      // Update media store with handle-restored files. Project-folder relinks already update stores directly.
      useMediaStore.setState({ files: updatedFiles });

      // Small delay to allow state to settle before updating timeline clips
      await new Promise(resolve => setTimeout(resolve, 50));

      // Update timeline clips with proper source elements (video/audio/image)
      for (const file of updatedFiles) {
        if (file.file && !relinkedByProjectScan.has(file.id)) {
          await updateTimelineClips(file.id, file.file);
        }
      }
    }

    log.info(`Auto-relinked ${relinkedCount}/${missingFiles.length} files from project folder or stored handles`);

    // Reload nested composition clips that may need their content updated
    await reloadNestedCompositionClips();
  } else {
    log.info(' No files could be auto-relinked from project folder');
  }
}

/**
 * Reload nested clips for composition clips that are missing their content.
 * This is called after auto-relinking when media files become available.
 */
async function reloadNestedCompositionClips(): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const mediaStore = useMediaStore.getState();

  // Find composition clips that have no nested clips (need reload)
  const compClips = timelineStore.clips.filter(
    c => c.isComposition && c.compositionId && (!c.nestedClips || c.nestedClips.length === 0)
  );

  if (compClips.length === 0) return;

  log.info(`Reloading ${compClips.length} nested composition clips...`);

  for (const compClip of compClips) {
    const composition = mediaStore.compositions.find(c => c.id === compClip.compositionId);
    if (!composition?.timelineData) continue;

    const nestedClips: TimelineClip[] = [];
    const nestedTracks = composition.timelineData.tracks;

    for (const nestedSerializedClip of composition.timelineData.clips) {
      const nestedMediaFile = mediaStore.files.find(f => f.id === nestedSerializedClip.mediaFileId);
      if (!nestedMediaFile?.file) continue;

      const nestedClip: TimelineClip = {
        id: `nested-${compClip.id}-${nestedSerializedClip.id}`,
        trackId: nestedSerializedClip.trackId,
        name: nestedSerializedClip.name,
        file: nestedMediaFile.file,
        startTime: nestedSerializedClip.startTime,
        duration: nestedSerializedClip.duration,
        inPoint: nestedSerializedClip.inPoint,
        outPoint: nestedSerializedClip.outPoint,
        source: null,
        mediaFileId: nestedSerializedClip.mediaFileId,
        thumbnails: nestedSerializedClip.thumbnails,
        transform: nestedSerializedClip.transform,
        effects: nestedSerializedClip.effects || [],
        masks: nestedSerializedClip.masks || [],
        reversed: nestedSerializedClip.reversed,
        speed: nestedSerializedClip.speed,
        preservesPitch: nestedSerializedClip.preservesPitch,
        isLoading: true,
      };

      nestedClips.push(nestedClip);

      const sourceType = nestedSerializedClip.sourceType;
      const notifyNestedReload = () => {
        useTimelineStore.setState((state) => ({
          clips: [...state.clips],
        }));
      };

      if (sourceType === 'lottie') {
        try {
          nestedClip.source = {
            type: 'lottie',
            mediaFileId: nestedSerializedClip.mediaFileId,
            naturalDuration: nestedSerializedClip.naturalDuration,
            vectorAnimationSettings: nestedSerializedClip.vectorAnimationSettings,
          };
          const runtime = await lottieRuntimeManager.prepareClipSource(nestedClip, nestedMediaFile.file);
          const naturalDuration =
            runtime.metadata.duration ??
            nestedSerializedClip.naturalDuration ??
            nestedSerializedClip.duration;

          nestedClip.source = {
            type: 'lottie',
            textCanvas: runtime.canvas,
            mediaFileId: nestedSerializedClip.mediaFileId,
            naturalDuration,
            vectorAnimationSettings: nestedSerializedClip.vectorAnimationSettings,
          };
          nestedClip.isLoading = false;
          lottieRuntimeManager.renderClipAtTime(nestedClip, nestedClip.startTime);
          notifyNestedReload();
        } catch (error) {
          nestedClip.isLoading = false;
          log.warn('Failed to reload nested lottie clip', {
            compClipId: compClip.id,
            nestedClipId: nestedClip.id,
            error,
          });
        }
        continue;
      }

      const fileUrl = URL.createObjectURL(nestedMediaFile.file);

      if (sourceType === 'video') {
        const video = document.createElement('video');
        video.src = fileUrl;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous';

        video.addEventListener('canplaythrough', () => {
          nestedClip.source = {
            type: 'video',
            videoElement: video,
            naturalDuration: video.duration,
          };
          nestedClip.isLoading = false;

          // Trigger state update
          notifyNestedReload();

          // Pre-cache frame via createImageBitmap for immediate scrubbing without play()
          engine.preCacheVideoFrame(video);
        }, { once: true });

        video.load();
      } else if (sourceType === 'audio') {
        const audio = document.createElement('audio');
        audio.src = fileUrl;
        audio.preload = 'auto';

        audio.addEventListener('canplaythrough', () => {
          nestedClip.source = {
            type: 'audio',
            audioElement: audio,
            naturalDuration: audio.duration,
          };
          nestedClip.isLoading = false;

          notifyNestedReload();
        }, { once: true });

        audio.load();
      } else if (sourceType === 'image') {
        const img = new Image();
        img.src = fileUrl;
        img.crossOrigin = 'anonymous';

        img.addEventListener('load', () => {
          nestedClip.source = {
            type: 'image',
            imageElement: img,
          };
          nestedClip.isLoading = false;

          notifyNestedReload();
        }, { once: true });
      }
    }

    // Update the composition clip with nested data
    if (nestedClips.length > 0) {
      timelineStore.updateClip(compClip.id, {
        nestedClips,
        nestedTracks,
        isLoading: false,
      });

      // Generate thumbnails if missing
      if (!compClip.thumbnails || compClip.thumbnails.length === 0) {
        const { generateCompThumbnails } = await import('../../stores/timeline/clip/addCompClip');
        const compDuration = composition.timelineData?.duration ?? composition.duration;
        generateCompThumbnails({
          clipId: compClip.id,
          nestedClips,
          compDuration,
          thumbnailsEnabled: timelineStore.thumbnailsEnabled,
          get: useTimelineStore.getState,
          set: useTimelineStore.setState,
        });
      }
    }
  }

  log.info('Nested composition clips reloaded');
}

/**
 * Sync transcript/analysis status + coverage from timeline clips to MediaFiles.
 * Ensures badges show correctly after project load.
 */
function syncStatusFromClipsToMedia(): void {
  const clips = useTimelineStore.getState().clips;
  const transcriptWords = new Map<string, { start: number; end: number }[]>();
  // Track transcribed time ranges (clip in/out = entire range was processed, silence counts)
  const transcribedRangesMap = new Map<string, [number, number][]>();
  const analysisRanges = new Map<string, [number, number][]>();

  for (const clip of clips) {
    const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
    if (!mediaFileId) continue;

    if (clip.transcriptStatus === 'ready' && clip.transcript?.length) {
      const existing = transcriptWords.get(mediaFileId) || [];
      for (const w of clip.transcript) existing.push({ start: w.start, end: w.end });
      transcriptWords.set(mediaFileId, existing);
      // Track clip's full range as transcribed
      const inPt = clip.inPoint ?? 0;
      const outPt = clip.outPoint ?? (clip.source?.naturalDuration ?? 0);
      if (outPt > inPt) {
        const existingRanges = transcribedRangesMap.get(mediaFileId) || [];
        existingRanges.push([inPt, outPt]);
        transcribedRangesMap.set(mediaFileId, existingRanges);
      }
    }

    if (clip.analysisStatus === 'ready' || clip.sceneDescriptionStatus === 'ready') {
      const inPt = clip.inPoint ?? 0;
      const outPt = clip.outPoint ?? (clip.source?.naturalDuration ?? 0);
      if (outPt > inPt) {
        const existing = analysisRanges.get(mediaFileId) || [];
        existing.push([inPt, outPt]);
        analysisRanges.set(mediaFileId, existing);
      }
    }
  }

  if (transcriptWords.size === 0 && analysisRanges.size === 0) return;

  useMediaStore.setState((state) => ({
    files: state.files.map((f) => {
      const tWords = transcriptWords.get(f.id);
      const tRanges = transcribedRangesMap.get(f.id);
      const aRanges = analysisRanges.get(f.id);
      if (!tWords && !aRanges) return f;
      const dur = f.duration || 0;
      return {
        ...f,
        ...(tWords && f.transcriptStatus !== 'ready' && {
          transcriptStatus: 'ready' as const,
          // Use transcribed time ranges (not word ranges) - silence counts as transcribed
          transcriptCoverage: dur > 0 && tRanges ? calcRangeCoverage(tRanges, dur) : 0,
          transcribedRanges: tRanges,
        }),
        ...(aRanges && f.analysisStatus !== 'ready' && {
          analysisStatus: 'ready' as const,
          analysisCoverage: dur > 0 ? calcRangeCoverage(aRanges, dur) : 0,
        }),
      };
    }),
  }));

  log.info(`Synced badges from clips (T:${transcriptWords.size}, A:${analysisRanges.size})`);
}
