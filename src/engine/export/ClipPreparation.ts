// Clip preparation and initialization for export

import { Logger } from '../../services/logger';
import type { TimelineClip } from '../../stores/timeline/types';
import type { ExportSettings, ExportClipState, ExportMode } from './types';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { fileSystemService } from '../../services/fileSystemService';
import { projectFileService } from '../../services/projectFileService';
import {
  getProjectRawPathCandidates,
  getStoredProjectFileHandle,
} from '../../services/project/mediaSourceResolver';
import { bindSourceRuntimeForOwner } from '../../services/mediaRuntime/clipBindings';
import { mediaRuntimeRegistry } from '../../services/mediaRuntime/registry';
import { ParallelDecodeManager } from '../ParallelDecodeManager';
import type { WebCodecsPlayer } from '../WebCodecsPlayer';
import { lottieRuntimeManager } from '../../services/vectorAnimation/LottieRuntimeManager';
import type { MediaFile } from '../../stores/mediaStore/types';

const log = Logger.create('ClipPreparation');
const FAST_EXPORT_SINGLE_FILE_LIMIT_BYTES = 1536 * 1024 * 1024; // 1.5 GB
const FAST_EXPORT_TOTAL_FILE_LIMIT_BYTES = 2048 * 1024 * 1024; // 2 GB

export interface ClipPreparationResult {
  clipStates: Map<string, ExportClipState>;
  parallelDecoder: ParallelDecodeManager | null;
  useParallelDecode: boolean;
  exportMode: ExportMode;
}

type ParallelClipInfo = Parameters<ParallelDecodeManager['initialize']>[0][number];
type ClipFileDataCache = Map<string, Promise<ArrayBuffer | null>>;

function getExportRuntimeOwnerId(clipId: string): string {
  return `export:${clipId}`;
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.mediaFileId || clip.source?.mediaFileId;
}

function getClipSourceCacheKey(clip: TimelineClip, mediaFile?: MediaFile | null): string {
  const mediaFileId = getClipMediaFileId(clip);
  if (mediaFileId) {
    return `media:${mediaFileId}`;
  }

  const filePath = mediaFile?.filePath || mediaFile?.projectPath || clip.source?.filePath;
  if (filePath) {
    return `path:${filePath}`;
  }

  const url = mediaFile?.url || clip.source?.videoElement?.currentSrc || clip.source?.videoElement?.src;
  if (url) {
    return `url:${url}`;
  }

  if (clip.file) {
    return `file:${clip.file.name}:${clip.file.size}:${clip.file.lastModified}`;
  }

  return `clip:${clip.id}`;
}

function getFastModeFileSizeStats(
  videoClips: TimelineClip[],
  mediaFiles: MediaFile[]
): { totalBytes: number; largestBytes: number; largestClipName: string | null; uniqueSourceCount: number } {
  let totalBytes = 0;
  let largestBytes = 0;
  let largestClipName: string | null = null;
  const countedSources = new Set<string>();

  for (const clip of videoClips) {
    if (clip.source?.type !== 'video') {
      continue;
    }

    const mediaFileId = getClipMediaFileId(clip);
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const sourceKey = getClipSourceCacheKey(clip, mediaFile);
    const fileSize = mediaFile?.fileSize ?? clip.file?.size ?? 0;

    if (!countedSources.has(sourceKey)) {
      countedSources.add(sourceKey);
      totalBytes += fileSize;
    }

    if (fileSize > largestBytes) {
      largestBytes = fileSize;
      largestClipName = clip.name;
    }
  }

  return { totalBytes, largestBytes, largestClipName, uniqueSourceCount: countedSources.size };
}

function shouldAutoFallbackToPrecise(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);

  return (
    message.includes('FAST export failed') ||
    message.includes('NotReadableError') ||
    message.includes('The requested file could not be read') ||
    message.includes('Array buffer allocation failed') ||
    message.includes('out of memory')
  );
}

function createDetachedExportVideoElement(src: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = src;
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.load();
  return video;
}

function waitForVideoCondition(
  video: HTMLVideoElement,
  events: Array<'loadedmetadata' | 'loadeddata' | 'canplay' | 'canplaythrough' | 'seeked' | 'error'>,
  timeoutMs: number,
  ready: () => boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    if (ready()) {
      resolve(true);
      return;
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(ready());
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      for (const eventName of events) {
        video.removeEventListener(eventName, onEvent);
      }
    };

    const onEvent = () => {
      if (!ready()) {
        return;
      }
      cleanup();
      resolve(true);
    };

    for (const eventName of events) {
      video.addEventListener(eventName, onEvent);
    }
  });
}

async function primePreciseExportVideoElement(
  video: HTMLVideoElement,
  warmupTime: number
): Promise<void> {
  const metadataReady = await waitForVideoCondition(
    video,
    ['loadedmetadata', 'error'],
    10000,
    () => video.readyState >= 1
  );

  if (!metadataReady) {
    return;
  }

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const maxSeekTime = duration > 0 ? Math.max(0, duration - 0.001) : 0;
  const warmupTarget = duration > 0
    ? Math.max(0, Math.min(warmupTime, maxSeekTime))
    : Math.max(0, warmupTime);

  if (Math.abs(video.currentTime - warmupTarget) > 0.01 || video.readyState < 2) {
    try {
      video.currentTime = warmupTarget;
    } catch {
      // Ignore warmup seek failures - export seeking has its own recovery path.
    }
  }

  await waitForVideoCondition(
    video,
    ['loadeddata', 'canplay', 'canplaythrough', 'seeked', 'error'],
    2500,
    () => !video.seeking && video.readyState >= 2
  );
}

async function resolveClipExportFile(clip: TimelineClip, mediaFile?: MediaFile | null): Promise<File | null> {
  const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId || '';
  const projectHandle = await getStoredProjectFileHandle(mediaFileId);
  if (projectHandle) {
    try {
      return await projectHandle.getFile();
    } catch (e) {
      log.warn(`Project RAW handle failed for ${clip.name}:`, e);
    }
  }

  if (projectFileService.isProjectOpen()) {
    for (const candidatePath of getProjectRawPathCandidates({
      mediaFileId,
      projectPath: mediaFile?.projectPath,
      filePath: mediaFile?.filePath,
      name: clip.name,
    })) {
      try {
        const result = await projectFileService.getFileFromRaw(candidatePath);
        if (result) {
          return result.file;
        }
      } catch (e) {
        log.warn(`Project RAW file load failed for ${clip.name} at ${candidatePath}:`, e);
      }
    }
  }

  const storedHandle = mediaFile?.hasFileHandle && mediaFileId
    ? fileSystemService.getFileHandle(mediaFileId)
    : null;
  if (storedHandle) {
    try {
      return await storedHandle.getFile();
    } catch (e) {
      log.warn(`Media file handle failed for ${clip.name}:`, e);
    }
  }

  if (mediaFile?.file) {
    return mediaFile.file;
  }

  if (clip.file) {
    return clip.file;
  }

  return null;
}

async function createPreciseExportVideoElement(
  clip: TimelineClip,
  mediaFile?: MediaFile | null,
  warmupTime = 0
): Promise<{ videoElement: HTMLVideoElement; objectUrl?: string } | null> {
  const resolvedFile = await resolveClipExportFile(clip, mediaFile);
  const fallbackSrc =
    clip.source?.videoElement?.currentSrc ||
    clip.source?.videoElement?.src ||
    mediaFile?.url ||
    '';

  const objectUrl = resolvedFile ? URL.createObjectURL(resolvedFile) : undefined;
  const src = objectUrl ?? fallbackSrc;
  if (!src) {
    return null;
  }

  const videoElement = createDetachedExportVideoElement(src);

  try {
    await primePreciseExportVideoElement(videoElement, warmupTime);
    if (videoElement.readyState < 1) {
      throw new Error('Export video metadata did not become available');
    }
    return { videoElement, objectUrl };
  } catch (e) {
    videoElement.pause();
    videoElement.removeAttribute('src');
    try {
      videoElement.load();
    } catch {
      // Ignore teardown failures for detached export video elements.
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    log.warn(`Failed to create dedicated PRECISE export video for ${clip.name}:`, e);
    return null;
  }
}

function getClipWarmupSourceTime(clip: TimelineClip, exportStartTime: number): number {
  const firstTimelineTime = Math.max(exportStartTime, clip.startTime);
  const clipLocalTime = Math.max(0, Math.min(clip.duration, firstTimelineTime - clip.startTime));
  const clipSpeed = clip.speed ?? 1;
  const speedAdjusted = clipLocalTime * Math.abs(clipSpeed);
  const sourceTime = (clip.reversed !== (clipSpeed < 0))
    ? clip.outPoint - speedAdjusted
    : clip.inPoint + speedAdjusted;
  const minSourceTime = Math.min(clip.inPoint, clip.outPoint);
  const maxSourceTime = Math.max(clip.inPoint, clip.outPoint);
  const safeMaxSourceTime = Math.max(minSourceTime, maxSourceTime - 0.001);

  return Math.max(minSourceTime, Math.min(sourceTime, safeMaxSourceTime));
}

function createExportRuntimeSource(
  clip: TimelineClip,
  runtimeOwnerId: string,
  overridePlayer?: WebCodecsPlayer | null
): TimelineClip['source'] {
  const runtimeSource = bindSourceRuntimeForOwner({
    ownerId: runtimeOwnerId,
    source: clip.source,
    file: clip.file,
    mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
    filePath: clip.source?.filePath,
    sessionPolicy: 'export',
    sessionOwnerId: runtimeOwnerId,
  });

  if (!runtimeSource) {
    return clip.source;
  }

  return {
    ...runtimeSource,
    webCodecsPlayer: overridePlayer ?? undefined,
  };
}

async function loadClipFileDataCached(
  clip: TimelineClip,
  mediaFile: MediaFile | null | undefined,
  cache: ClipFileDataCache
): Promise<ArrayBuffer | null> {
  const sourceKey = getClipSourceCacheKey(clip, mediaFile);
  let promise = cache.get(sourceKey);
  if (!promise) {
    promise = loadClipFileData(clip, mediaFile);
    cache.set(sourceKey, promise);
  }
  return promise;
}

/**
 * Prepare all video clips for export based on export mode.
 * FAST mode: WebCodecs with MP4Box parsing - sequential decoding, very fast
 * PRECISE mode: HTMLVideoElement seeking - frame-accurate but slower
 */
export async function prepareClipsForExport(
  settings: ExportSettings,
  exportMode: ExportMode
): Promise<ClipPreparationResult> {
  const endPrepare = log.time('prepareClipsForExport TOTAL');
  const { clips, tracks } = useTimelineStore.getState();
  const mediaFiles = useMediaStore.getState().files;
  const startTime = settings.startTime;
  const endTime = settings.endTime;

  const clipStates = new Map<string, ExportClipState>();

  // Find all video clips that will be in the export range
  const videoClips = clips.filter(clip => {
    const track = tracks.find(t => t.id === clip.trackId);
    if (!track?.visible || track.type !== 'video') return false;
    const clipEnd = clip.startTime + clip.duration;
    return clip.startTime < endTime && clipEnd > startTime;
  });

  const lottieClips: TimelineClip[] = [];
  for (const clip of videoClips) {
    if (clip.source?.type === 'lottie') {
      lottieClips.push(clip);
    }
    if (clip.isComposition && clip.nestedClips?.length) {
      for (const nestedClip of clip.nestedClips) {
        if (nestedClip.source?.type === 'lottie') {
          lottieClips.push(nestedClip);
        }
      }
    }
  }

  if (lottieClips.length > 0) {
    await Promise.all(lottieClips.map(async (clip) => {
      if (!clip.file) {
        return;
      }
      await lottieRuntimeManager.prepareClipSource(clip, clip.file);
    }));
  }

  log.info(`Preparing ${videoClips.length} video clips for ${exportMode.toUpperCase()} export...`);

  if (exportMode === 'precise') {
    const result = await initializePreciseMode(videoClips, clipStates, mediaFiles, startTime);
    endPrepare();
    return result;
  }

  const { totalBytes, largestBytes, largestClipName, uniqueSourceCount } = getFastModeFileSizeStats(videoClips, mediaFiles);
  if (largestBytes >= FAST_EXPORT_SINGLE_FILE_LIMIT_BYTES || totalBytes >= FAST_EXPORT_TOTAL_FILE_LIMIT_BYTES) {
    log.warn(
      `FAST export bypassed for large source media (largest=${(largestBytes / 1024 / 1024).toFixed(0)}MB, uniqueTotal=${(totalBytes / 1024 / 1024).toFixed(0)}MB, uniqueSources=${uniqueSourceCount}/${videoClips.length}). Using PRECISE mode instead.`,
      { largestClipName }
    );
    const result = await initializePreciseMode(videoClips, clipStates, mediaFiles, startTime);
    endPrepare();
    return result;
  }

  // FAST MODE: WebCodecs with MP4Box parsing
  try {
    return await initializeFastMode(videoClips, mediaFiles, startTime, endTime, clipStates, settings.fps, endPrepare);
  } catch (e) {
    if (shouldAutoFallbackToPrecise(e)) {
      log.warn('FAST export failed, auto-falling back to PRECISE mode', e);
      clipStates.clear();
      const result = await initializePreciseMode(videoClips, clipStates, mediaFiles, startTime);
      endPrepare();
      return result;
    }
    throw e;
  }
}

async function initializePreciseMode(
  videoClips: TimelineClip[],
  clipStates: Map<string, ExportClipState>,
  mediaFiles: MediaFile[],
  exportStartTime: number
): Promise<ClipPreparationResult> {
  const registerPreciseClip = async (clip: TimelineClip, warmupTime: number) => {
    const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
    const mediaFileId = clip.mediaFileId || clip.source?.mediaFileId;
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const preparedVideo = clip.source?.type === 'video'
      ? await createPreciseExportVideoElement(clip, mediaFile, warmupTime)
      : null;

    clipStates.set(clip.id, {
      clipId: clip.id,
      webCodecsPlayer: null,
      lastSampleIndex: 0,
      isSequential: false,
      runtimeOwnerId,
      runtimeSource: createExportRuntimeSource(clip, runtimeOwnerId),
      preciseVideoElement: preparedVideo?.videoElement ?? clip.source?.videoElement ?? null,
      preciseVideoObjectUrl: preparedVideo?.objectUrl ?? null,
      hasDedicatedPreciseVideoElement: !!preparedVideo,
    });

    return !!preparedVideo;
  };

  let preciseClipCount = 0;
  let preciseNestedClipCount = 0;
  let dedicatedPreciseVideoCount = 0;

  for (const clip of videoClips) {
    if (clip.isComposition && clip.nestedClips) {
      for (const nestedClip of clip.nestedClips) {
        if (nestedClip.source?.type !== 'video') continue;
        if (await registerPreciseClip(nestedClip, getClipWarmupSourceTime(nestedClip, nestedClip.startTime))) {
          dedicatedPreciseVideoCount += 1;
        }
        preciseNestedClipCount += 1;
      }
    }

    if (clip.source?.type !== 'video') continue;
    if (await registerPreciseClip(clip, getClipWarmupSourceTime(clip, exportStartTime))) {
      dedicatedPreciseVideoCount += 1;
    }
    preciseClipCount += 1;
    log.debug(`Clip ${clip.name}: PRECISE mode (HTMLVideoElement seeking)`);
  }
  log.info(`All ${preciseClipCount} clips using PRECISE HTMLVideoElement seeking`);
  if (preciseNestedClipCount > 0) {
    log.info(`Registered ${preciseNestedClipCount} nested PRECISE export clips`);
  }
  if (dedicatedPreciseVideoCount > 0) {
    log.info(`Prepared ${dedicatedPreciseVideoCount} dedicated PRECISE export video elements`);
  }

  return {
    clipStates,
    parallelDecoder: null,
    useParallelDecode: false,
    exportMode: 'precise',
  };
}

async function initializeFastMode(
  videoClips: TimelineClip[],
  mediaFiles: MediaFile[],
  startTime: number,
  endTime: number,
  clipStates: Map<string, ExportClipState>,
  fps: number,
  endPrepare: () => void
): Promise<ClipPreparationResult> {
  const { WebCodecsPlayer } = await import('../WebCodecsPlayer');
  const fileDataCache: ClipFileDataCache = new Map();

  // Separate composition clips from regular video clips
  const regularVideoClips: TimelineClip[] = [];
  const nestedVideoClips: Array<{ clip: TimelineClip; parentClip: TimelineClip }> = [];

  for (const clip of videoClips) {
    if (clip.source?.type !== 'video') continue;

    if (clip.isComposition) {
      clipStates.set(clip.id, {
        clipId: clip.id,
        webCodecsPlayer: null,
        lastSampleIndex: 0,
        isSequential: false,
      });
      log.debug(`Clip ${clip.name}: Composition with nested clips`);

      // Collect nested video clips
      if (clip.nestedClips) {
        for (const nestedClip of clip.nestedClips) {
          if (nestedClip.source?.type === 'video' && nestedClip.source.videoElement) {
            nestedVideoClips.push({ clip: nestedClip, parentClip: clip });
          }
        }
      }
    } else {
      regularVideoClips.push(clip);
    }
  }

  // Use parallel decoding if we have 2+ total video clips
  const totalVideoClips = regularVideoClips.length + nestedVideoClips.length;
  if (totalVideoClips >= 2) {
    log.info(`Using PARALLEL decoding for ${regularVideoClips.length} regular + ${nestedVideoClips.length} nested = ${totalVideoClips} video clips`);
    return initializeParallelDecoding(regularVideoClips, mediaFiles, startTime, endTime, nestedVideoClips, clipStates, fps, endPrepare, fileDataCache);
  }

  // Single clip: use sequential approach
  for (const clip of regularVideoClips) {
    const mediaFileId = getClipMediaFileId(clip);
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;

    const endLoad = log.time(`loadClipFileData "${clip.name}"`);
    const fileData = await loadClipFileDataCached(clip, mediaFile, fileDataCache);
    endLoad();

    if (!fileData) {
      throw new Error(`FAST export failed: Could not load file data for clip "${clip.name}". Try PRECISE mode instead.`);
    }

    // Detect file format from magic bytes
    const header = new Uint8Array(fileData.slice(0, 12));
    const isMOV = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70 &&
                  (header[8] === 0x71 && header[9] === 0x74);
    const fileType = isMOV ? 'MOV' : 'MP4';

    log.debug(`Loaded ${clip.name} (${(fileData.byteLength / 1024 / 1024).toFixed(1)}MB, ${fileType})`);

    // Create dedicated WebCodecs player for export
    const exportPlayer = new WebCodecsPlayer({ useSimpleMode: false, loop: false });

    const endParse = log.time(`loadArrayBuffer "${clip.name}"`);
    try {
      await exportPlayer.loadArrayBuffer(fileData);
      endParse();
    } catch (e) {
      endParse();
      const hint = isMOV ? ' MOV containers may have unsupported audio codecs.' : '';
      throw new Error(`FAST export failed: WebCodecs/MP4Box parsing failed for clip "${clip.name}": ${e}.${hint} Try PRECISE mode instead.`);
    }

    // Calculate clip start time (accounting for speed)
    const clipStartInExport = Math.max(0, startTime - clip.startTime);
    const clipSpeed = clip.speed ?? 1;
    const speedAdjusted = clipStartInExport * Math.abs(clipSpeed);
    const clipTime = (clip.reversed !== (clipSpeed < 0))
      ? clip.outPoint - speedAdjusted
      : clip.inPoint + speedAdjusted;

    const endSeqPrep = log.time(`prepareForSequentialExport "${clip.name}"`);
    await exportPlayer.prepareForSequentialExport(clipTime);
    endSeqPrep();
    const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);

    clipStates.set(clip.id, {
      clipId: clip.id,
      webCodecsPlayer: exportPlayer,
      lastSampleIndex: exportPlayer.getCurrentSampleIndex(),
      isSequential: true,
      runtimeOwnerId,
      runtimeSource: createExportRuntimeSource(clip, runtimeOwnerId, exportPlayer),
    });

    log.debug(`Clip ${clip.name}: FAST mode enabled (${exportPlayer.width}x${exportPlayer.height})`);
  }

  log.info(`All ${videoClips.length} clips using FAST WebCodecs sequential decoding`);
  endPrepare();

  return {
    clipStates,
    parallelDecoder: null,
    useParallelDecode: false,
    exportMode: 'fast',
  };
}

async function initializeParallelDecoding(
  clips: TimelineClip[],
  mediaFiles: MediaFile[],
  _startTime: number,
  endTime: number,
  nestedClips: Array<{ clip: TimelineClip; parentClip: TimelineClip }>,
  clipStates: Map<string, ExportClipState>,
  fps: number,
  endPrepare: () => void,
  fileDataCache: ClipFileDataCache
): Promise<ClipPreparationResult> {
  const parallelDecoder = new ParallelDecodeManager();

  // Load all clip file data in parallel
  const endLoadAll = log.time('loadAllClipFileData');
  const loadPromises: Promise<ParallelClipInfo>[] = clips.map(async (clip) => {
    const mediaFileId = getClipMediaFileId(clip);
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const fileData = await loadClipFileDataCached(clip, mediaFile, fileDataCache);

    if (!fileData) {
      throw new Error(`FAST export failed: Could not load file data for clip "${clip.name}". Try PRECISE mode instead.`);
    }

    return {
      clipId: clip.id,
      clipName: clip.name,
      fileData,
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      reversed: clip.reversed || false,
      speed: clip.speed ?? 1,
    };
  });

  // Load nested clips
  const nestedLoadPromises: Promise<ParallelClipInfo | null>[] = nestedClips.map(async ({ clip, parentClip }) => {
    const mediaFileId = getClipMediaFileId(clip);
    const mediaFile = mediaFileId ? mediaFiles.find(f => f.id === mediaFileId) : null;
    const fileData = await loadClipFileDataCached(clip, mediaFile, fileDataCache);

    if (!fileData) {
      log.warn(`Could not load nested clip "${clip.name}", will use HTMLVideoElement`);
      return null;
    }

    return {
      clipId: clip.id,
      clipName: `${parentClip.name}/${clip.name}`,
      fileData,
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      reversed: clip.reversed || false,
      speed: clip.speed ?? 1,
      isNested: true,
      parentClipId: parentClip.id,
      parentStartTime: parentClip.startTime,
      parentInPoint: parentClip.inPoint || 0,
    };
  });

  const loadedClips = await Promise.all(loadPromises);
  const loadedNestedClips = (await Promise.all(nestedLoadPromises)).filter(
    (clipInfo): clipInfo is ParallelClipInfo => clipInfo !== null
  );
  endLoadAll();

  const clipInfos: ParallelClipInfo[] = [...loadedClips, ...loadedNestedClips];

  log.info(`Loaded ${loadedClips.length} regular + ${loadedNestedClips.length} nested clips for parallel decoding`);

  const endParallelInit = log.time('parallelDecoder.initialize');
  await parallelDecoder.initialize(clipInfos, fps);
  endParallelInit();

  // Pre-decode first frame to ensure it's ready when export starts
  // This is critical because the parallel decoder initializes lazily
  const endPrefetch = log.time('parallelDecoder.prefetchFirstFrame');
  await parallelDecoder.prefetchFramesForTime(_startTime);

  // Verify first frame is decoded for clips that are active at start time
  // NOTE: We initialize ALL clips in parallel decoder, but only verify frames for clips active at start
  const MAX_RETRIES = 5;
  for (const clipInfo of clipInfos) {
    // Check if clip is active at start time
    let clipActiveAtStart: boolean;
    let clipTimeAtExportStart: number;

    if (clipInfo.isNested && clipInfo.parentStartTime !== undefined) {
      // Nested clip: check if parent comp is active and clip is active within it
      const compTime = _startTime - clipInfo.parentStartTime - (clipInfo.parentInPoint || 0);
      clipActiveAtStart = compTime >= clipInfo.startTime && compTime < clipInfo.startTime + clipInfo.duration;
      clipTimeAtExportStart = _startTime; // Use main timeline time for getFrameForClip
    } else {
      // Regular clip
      clipActiveAtStart = _startTime >= clipInfo.startTime && _startTime < clipInfo.startTime + clipInfo.duration;
      clipTimeAtExportStart = _startTime;
    }

    log.debug(`Clip "${clipInfo.clipName}": startTime=${clipInfo.startTime}, exportStart=${_startTime}, active=${clipActiveAtStart}`);

    // Skip verification for clips not active at start, but they ARE initialized in parallel decoder
    if (!clipActiveAtStart) {
      log.debug(`"${clipInfo.clipName}" not active at export start, skipping first frame verification`);
      continue;
    }

    log.info(`Verifying first frame for "${clipInfo.clipName}"`);

    let frame = parallelDecoder.getFrameForClip(clipInfo.clipId, clipTimeAtExportStart);

    if (!frame) {
      // Retry with delays
      for (let retry = 0; retry < MAX_RETRIES && !frame; retry++) {
        log.warn(`First frame not ready for "${clipInfo.clipName}" (attempt ${retry + 1}/${MAX_RETRIES}), retrying...`);
        await new Promise(r => setTimeout(r, 200)); // Give decoder time
        await parallelDecoder.prefetchFramesForTime(clipTimeAtExportStart);
        frame = parallelDecoder.getFrameForClip(clipInfo.clipId, clipTimeAtExportStart);
      }
    }

    if (!frame) {
      throw new Error(`Failed to decode first frame for clip "${clipInfo.clipName}" after ${MAX_RETRIES} attempts. The video file may be corrupted or use an unsupported codec.`);
    }
  }

  const prewarmedClipStarts = await parallelDecoder.prewarmClipStarts(_startTime, endTime);
  if (prewarmedClipStarts > 0) {
    log.info(`Prewarmed ${prewarmedClipStarts} clip start frames for smoother cuts`);
  }
  endPrefetch();

  // Also seek all HTMLVideoElements to their correct start positions as fallback
  // This ensures correct frame if parallel decoder fails and falls back to video element
  const seekPromises: Promise<void>[] = [];
  for (const clip of clips) {
    if (clip.source?.videoElement) {
      const video = clip.source.videoElement;
      const clipLocalTime = Math.max(0, _startTime - clip.startTime);
      const clipSpeed = clip.speed ?? 1;
      const speedAdjusted = clipLocalTime * Math.abs(clipSpeed);
      const sourceTime = (clip.reversed !== (clipSpeed < 0))
        ? clip.outPoint - speedAdjusted
        : clip.inPoint + speedAdjusted;

      seekPromises.push(new Promise<void>((resolve) => {
        const targetTime = Math.max(0, Math.min(sourceTime, video.duration || 0));
        if (Math.abs(video.currentTime - targetTime) < 0.01) {
          resolve();
          return;
        }
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = targetTime;
        // Timeout fallback
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        }, 500);
      }));
    }
  }
  if (seekPromises.length > 0) {
    await Promise.all(seekPromises);
    // Wait for frames to be ready after seek
    await new Promise(r => setTimeout(r, 50));
    log.info(`Seeked ${seekPromises.length} video elements to start positions as fallback`);
  }

  // Mark clips as using parallel decoding
  for (const clip of clips) {
    const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
    clipStates.set(clip.id, {
      clipId: clip.id,
      webCodecsPlayer: null,
      lastSampleIndex: 0,
      isSequential: false,
      runtimeOwnerId,
      runtimeSource: createExportRuntimeSource(clip, runtimeOwnerId),
    });
  }

  for (const { clip } of nestedClips) {
    const runtimeOwnerId = getExportRuntimeOwnerId(clip.id);
    clipStates.set(clip.id, {
      clipId: clip.id,
      webCodecsPlayer: null,
      lastSampleIndex: 0,
      isSequential: false,
      runtimeOwnerId,
      runtimeSource: createExportRuntimeSource(clip, runtimeOwnerId),
    });
  }

  log.info(`Parallel decoding initialized for ${clipInfos.length} total clips`);
  endPrepare();

  return {
    clipStates,
    parallelDecoder,
    useParallelDecode: true,
    exportMode: 'fast',
  };
}

/**
 * Load file data for a clip from various sources.
 */
export async function loadClipFileData(clip: TimelineClip, mediaFile?: MediaFile | null): Promise<ArrayBuffer | null> {
  let fileData: ArrayBuffer | null = null;

  const resolvedFile = await resolveClipExportFile(clip, mediaFile);
  if (!fileData && resolvedFile) {
    try {
      fileData = await resolvedFile.arrayBuffer();
    } catch (e) {
      log.warn(`Resolved export file access failed for ${clip.name}:`, e);
    }
  }

  // 2. Try media file's blob URL
  if (!fileData && mediaFile?.url) {
    try {
      const response = await fetch(mediaFile.url);
      fileData = await response.arrayBuffer();
    } catch (e) {
      log.warn(`Media blob URL fetch failed for ${clip.name}:`, e);
    }
  }

  // 3. Try video element's src (blob URL)
  if (!fileData && clip.source?.videoElement?.src) {
    try {
      const response = await fetch(clip.source.videoElement.src);
      fileData = await response.arrayBuffer();
    } catch (e) {
      log.warn(`Video src fetch failed for ${clip.name}:`, e);
    }
  }

  return fileData;
}

/**
 * Cleanup export mode - destroy dedicated export players.
 */
export function cleanupExportMode(
  clipStates: Map<string, ExportClipState>,
  parallelDecoder: ParallelDecodeManager | null
): void {
  // Cleanup parallel decoder
  if (parallelDecoder) {
    parallelDecoder.cleanup();
  }

  // Destroy all dedicated export WebCodecs players
  for (const state of clipStates.values()) {
    if (state.runtimeSource?.runtimeSourceId && state.runtimeSource.runtimeSessionKey) {
      mediaRuntimeRegistry.releaseSession(
        state.runtimeSource.runtimeSourceId,
        state.runtimeSource.runtimeSessionKey
      );
    }
    if (state.runtimeSource?.runtimeSourceId && state.runtimeOwnerId) {
      mediaRuntimeRegistry.releaseRuntime(
        state.runtimeSource.runtimeSourceId,
        state.runtimeOwnerId
      );
    }
    if (state.webCodecsPlayer && state.isSequential) {
      try {
        state.webCodecsPlayer.endSequentialExport();
        state.webCodecsPlayer.destroy();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    if (state.hasDedicatedPreciseVideoElement && state.preciseVideoElement) {
      try {
        state.preciseVideoElement.pause();
        state.preciseVideoElement.removeAttribute('src');
        state.preciseVideoElement.load();
      } catch {
        // Ignore cleanup failures for detached export video elements.
      }
    }
    if (state.preciseVideoObjectUrl) {
      try {
        URL.revokeObjectURL(state.preciseVideoObjectUrl);
      } catch {
        // Ignore URL cleanup failures.
      }
    }
  }

  clipStates.clear();
  log.info('Export cleanup complete');
}
