// Clip Analyzer Service
// Analyzes individual clips for focus, motion, and face detection

import { Logger } from './logger';
import { useTimelineStore } from '../stores/timeline';
import { useMediaStore } from '../stores/mediaStore';
import { triggerTimelineSave } from '../stores/mediaStore';
import { projectFileService } from './projectFileService';
import { renderHostPort } from './render/renderHostPort';
import {
  OpticalFlowAnalyzer,
  getOpticalFlowAnalyzer,
  resetOpticalFlowAnalyzer,
  destroyOpticalFlowAnalyzer,
  type MotionResult,
} from '../engine/analysis/OpticalFlowAnalyzer';
import { analyzeMotion, analyzeSharpness } from './clipAnalysis/frameMetrics';
import { getFaceAnalysisRuntime } from './faceAnalysis/FaceAnalysisRuntime';
import {
  FaceIdentityTracker,
  createFaceIdentityPrefix,
  summarizeCachedFaces,
} from './faceAnalysis/faceIdentityTracker';
import { FACE_ANALYSIS_MODEL_VERSION } from './faceAnalysis/modelCatalog';
import type { ClipAnalysis, FrameAnalysisData, AnalysisStatus } from '../types/clipMetadata';
import type { TimelineClip } from '../types/timeline';

const log = Logger.create('ClipAnalyzer');

// Analysis sample interval in milliseconds
const SAMPLE_INTERVAL_MS = 500;

// Cancellation state
let isAnalyzing = false;
let shouldCancel = false;
let currentClipId: string | null = null;
let analysisAbortController: AbortController | null = null;

// GPU optical flow analyzer instance
let flowAnalyzer: OpticalFlowAnalyzer | null = null;
let useGPUAnalysis = true; // Will be set to false if GPU init fails

/**
 * Initialize GPU optical flow analyzer
 * @param forceRecreate - If true, destroys and recreates the analyzer
 */
async function initGPUAnalyzer(forceRecreate = false): Promise<boolean> {
  // If force recreate or no analyzer exists, destroy and create new
  if (forceRecreate && flowAnalyzer) {
    log.debug('Destroying existing GPU analyzer for fresh start');
    destroyOpticalFlowAnalyzer();
    flowAnalyzer = null;
  }

  if (flowAnalyzer) return true;

  try {
    const device = renderHostPort.getDevice();
    if (!device) {
      log.warn('WebGPU device not available, falling back to CPU');
      useGPUAnalysis = false;
      return false;
    }

    flowAnalyzer = await getOpticalFlowAnalyzer(device);
    log.info('GPU optical flow analyzer initialized');
    return true;
  } catch (error) {
    log.warn('Failed to init GPU analyzer, falling back to CPU', error);
    useGPUAnalysis = false;
    flowAnalyzer = null;
    return false;
  }
}

/**
 * Analyze motion using GPU optical flow
 */
async function analyzeMotionGPU(bitmap: ImageBitmap): Promise<MotionResult> {
  if (!flowAnalyzer) {
    return { total: 0, global: 0, local: 0, isSceneCut: false };
  }

  try {
    return await flowAnalyzer.analyzeFrame(bitmap);
  } catch (error) {
    log.warn('GPU motion analysis failed', error);
    return { total: 0, global: 0, local: 0, isSceneCut: false };
  }
}

/**
 * Extract a frame from video at specific timestamp
 */
async function extractFrame(
  video: HTMLVideoElement,
  timestampSec: number,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      if (timeoutId) clearTimeout(timeoutId);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    const onSeeked = () => finish();

    video.addEventListener('seeked', onSeeked);
    video.currentTime = timestampSec;

    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Video seek timed out at ${timestampSec.toFixed(3)}s.`));
    }, 3000);
  });
}

export function isAnalysisRunning(): boolean {
  return isAnalyzing;
}

export function getCurrentAnalyzingClipId(): string | null {
  return currentClipId;
}

export function cancelAnalysis(): void {
  if (isAnalyzing) {
    shouldCancel = true;
    analysisAbortController?.abort();
    log.info('Cancel requested');
  }
}

/**
 * Find uncovered time gaps within a range given a set of covered ranges.
 */
function findGaps(
  coveredRanges: [number, number][],
  rangeStart: number,
  rangeEnd: number
): [number, number][] {
  // Sort and merge covered ranges, clipped to [rangeStart, rangeEnd]
  const clipped: [number, number][] = [];
  for (const [s, e] of coveredRanges) {
    const cs = Math.max(s, rangeStart);
    const ce = Math.min(e, rangeEnd);
    if (cs < ce) clipped.push([cs, ce]);
  }
  clipped.sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const range of clipped) {
    if (merged.length > 0 && range[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], range[1]);
    } else {
      merged.push([...range]);
    }
  }

  // Find gaps
  const gaps: [number, number][] = [];
  let cursor = rangeStart;
  for (const [s, e] of merged) {
    if (cursor < s) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < rangeEnd) gaps.push([cursor, rangeEnd]);
  return gaps;
}

/**
 * Analyze a clip for focus, motion, and faces
 * Only analyzes the trimmed portion (inPoint to outPoint)
 * When continueMode is true, only analyzes uncovered gaps.
 */
export async function analyzeClip(clipId: string, options?: { continueMode?: boolean }): Promise<void> {
  // Prevent concurrent analysis
  if (isAnalyzing) {
    log.warn('Already analyzing');
    throw new Error(`Another clip analysis is already running (${currentClipId ?? 'unknown clip'}).`);
  }

  const store = useTimelineStore.getState();
  const clip = store.clips.find(c => c.id === clipId);

  if (!clip || !clip.file) {
    log.warn('Clip not found or has no file', { clipId });
    throw new Error(`Clip not found or source file is unavailable: ${clipId}.`);
  }

  // Only analyze video files - check MIME type or file extension as fallback
  const isVideo = clip.file.type.startsWith('video/') ||
    /\.(mp4|webm|mov|avi|mkv|m4v|mxf)$/i.test(clip.file.name);
  if (!isVideo) {
    log.warn('Not a video file', { type: clip.file.type, name: clip.file.name });
    throw new Error(`YuNet + SFace only support video clips (${clip.file.name}).`);
  }

  // Set analyzing state
  isAnalyzing = true;
  shouldCancel = false;
  currentClipId = clipId;
  const abortController = new AbortController();
  analysisAbortController = abortController;

  // Update status to analyzing
  updateClipAnalysis(clipId, {
    status: 'analyzing',
    progress: 0,
    faceStatus: 'analyzing',
    faceProgress: 0,
    faceMessage: 'Preparing YuNet + SFace.',
  });

  // Check for cached analysis first (from project folder, not browser cache)
  const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
  const inPoint = clip.inPoint ?? 0;
  const outPoint = clip.outPoint ?? clip.duration;
  // Face embeddings are intentionally not persisted. A full pass keeps anonymous
  // person IDs coherent instead of creating colliding identities across cache gaps.
  const continueMode = false;
  if (options?.continueMode) {
    log.info('Continue requested; running a full pass to keep SFace identities coherent');
  }

  // In continue mode, find gaps in existing coverage
  let analysisGaps: [number, number][] | null = null;
  if (continueMode && mediaFileId && projectFileService.isProjectOpen()) {
    try {
      const rangeKeys = await projectFileService.getAnalysisRanges(mediaFileId);
      const coveredRanges: [number, number][] = rangeKeys.map(key => {
        const [s, e] = key.split('-').map(Number);
        return [s, e];
      });
      analysisGaps = findGaps(coveredRanges, inPoint, outPoint);
      if (analysisGaps.length === 0) {
        log.info('No gaps to analyze, clip is fully covered');
        isAnalyzing = false;
        currentClipId = null;
        return;
      }
      log.info(`Continue mode: ${analysisGaps.length} gaps to analyze`, { gaps: analysisGaps });
    } catch (err) {
      log.warn('Failed to get analysis ranges for continue mode', err);
      analysisGaps = null; // Fall back to full analysis
    }
  }

  if (!continueMode && mediaFileId && projectFileService.isProjectOpen()) {
    try {
      const cachedAnalysis = await projectFileService.getAnalysis(mediaFileId, inPoint, outPoint);
      const cachedFrames = cachedAnalysis?.frames as FrameAnalysisData[] | undefined;
      const hasCompatibleFaces = cachedFrames?.length
        && cachedFrames.every(frame => frame.faceModelVersion === FACE_ANALYSIS_MODEL_VERSION);
      if (cachedAnalysis && hasCompatibleFaces) {
        log.info('Found cached analysis in project folder, loading...');

        const analysis: ClipAnalysis = {
          frames: cachedFrames,
          sampleInterval: cachedAnalysis.sampleInterval,
          faceAnalysis: summarizeCachedFaces(cachedFrames),
        };

        updateClipAnalysis(clipId, {
          status: 'ready',
          progress: 100,
          faceStatus: 'ready',
          faceProgress: 100,
          faceMessage: null,
          analysis,
        });

        triggerTimelineSave();
        isAnalyzing = false;
        currentClipId = null;
        analysisAbortController = null;
        return;
      }
      if (cachedAnalysis) {
        log.info('Ignoring legacy clip analysis cache without compatible YuNet + SFace data');
      }
    } catch (err) {
      log.warn('Failed to check analysis cache', err);
    }
  }

  let videoUrl: string | null = null;

  try {
    // Create video element
    const video = document.createElement('video');
    videoUrl = URL.createObjectURL(clip.file);
    video.src = videoUrl;
    video.muted = true;
    video.preload = 'auto';

    // Wait for video to load
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video'));
      setTimeout(() => reject(new Error('Video load timeout')), 30000);
    });

    const faceRuntime = getFaceAnalysisRuntime();
    const backend = await faceRuntime.prepare({
      signal: abortController.signal,
      onProgress: ({ progress, message }) => {
        updateClipAnalysis(clipId, {
          faceStatus: 'analyzing',
          faceProgress: Math.round(progress * 10),
          faceMessage: message,
        });
      },
    });
    const identityScope = `${mediaFileId ?? clip.id}:${inPoint.toFixed(3)}:${outPoint.toFixed(3)}`;
    const identityTracker = new FaceIdentityTracker(createFaceIdentityPrefix(identityScope));

    // Try to initialize GPU optical flow analyzer
    // Force recreate analyzer to ensure fresh state (avoids stale GPU errors)
    const gpuAvailable = useGPUAnalysis && await initGPUAnalyzer(true);
    if (gpuAvailable) {
      log.debug('Using GPU optical flow analysis');
      resetOpticalFlowAnalyzer(); // Reset state for new clip
    } else {
      log.debug('Using CPU motion analysis (fallback)');
    }

    // Create canvas for frame extraction
    const canvas = document.createElement('canvas');
    // GPU uses 160x90, CPU uses 320x180
    canvas.width = gpuAvailable ? 160 : 320;
    canvas.height = gpuAvailable ? 90 : 180;
    const ctx = canvas.getContext('2d', { willReadFrequently: !gpuAvailable });

    if (!ctx) {
      throw new Error('Could not get canvas context');
    }

    // Face inference uses its own aspect-preserving resolution. The motion
    // canvas can be as small as 160x90, which misses small faces.
    const sourceWidth = video.videoWidth || 640;
    const sourceHeight = video.videoHeight || 360;
    const faceScale = Math.min(1, 640 / Math.max(sourceWidth, sourceHeight));
    const faceCanvas = document.createElement('canvas');
    faceCanvas.width = Math.max(32, Math.round(sourceWidth * faceScale));
    faceCanvas.height = Math.max(32, Math.round(sourceHeight * faceScale));
    const faceContext = faceCanvas.getContext('2d', { willReadFrequently: true });
    if (!faceContext) {
      throw new Error('Could not create the YuNet frame canvas.');
    }

    // Determine ranges to analyze
    const ranges: [number, number][] = analysisGaps
      ? analysisGaps.map(([s, e]) => [s, Math.min(e, video.duration)])
      : [[inPoint, Math.min(outPoint, video.duration)]];

    // Calculate total samples across all ranges for progress reporting
    const totalSamples = ranges.reduce((sum, [s, e]) => {
      return sum + Math.ceil(((e - s) * 1000) / SAMPLE_INTERVAL_MS);
    }, 0);

    let processedSamples = 0;
    const newFrames: FrameAnalysisData[] = [];
    let previousFrame: ImageData | null = null;

    log.info(`Analyzing ${totalSamples} frames across ${ranges.length} range(s)${continueMode ? ' (continue mode)' : ''}`);

    for (const [rangeStart, rangeEnd] of ranges) {
      const rangeDuration = rangeEnd - rangeStart;
      const rangeSamples = Math.ceil((rangeDuration * 1000) / SAMPLE_INTERVAL_MS);

      // Reset flow analyzer between ranges (different video regions)
      if (gpuAvailable) {
        resetOpticalFlowAnalyzer();
      }
      previousFrame = null;

      const rangeFrames: FrameAnalysisData[] = [];

      for (let i = 0; i < rangeSamples; i++) {
        if (shouldCancel) {
          log.info('Analysis cancelled');
          updateClipAnalysis(clipId, {
            status: continueMode ? 'ready' : 'none',
            progress: 0,
            faceStatus: continueMode ? 'ready' : 'none',
            faceProgress: 0,
            faceMessage: 'Face analysis cancelled.',
          });
          return;
        }

        const relativeTime = (i * SAMPLE_INTERVAL_MS) / 1000;
        const absoluteTime = rangeStart + relativeTime;

        const frame = await extractFrame(video, absoluteTime, canvas, ctx);
        faceContext.drawImage(video, 0, 0, faceCanvas.width, faceCanvas.height);
        const faceFrame = faceContext.getImageData(0, 0, faceCanvas.width, faceCanvas.height);

        let motionResult: MotionResult;
        const analysisStart = performance.now();

        if (gpuAvailable) {
          const bitmap = await createImageBitmap(canvas);
          motionResult = await analyzeMotionGPU(bitmap);
          bitmap.close();
        } else {
          motionResult = analyzeMotion(frame, previousFrame);
        }

        const analysisTime = performance.now() - analysisStart;
        if (processedSamples === 0) {
          log.debug(`First frame analysis took ${analysisTime.toFixed(1)}ms (${gpuAvailable ? 'GPU' : 'CPU'})`);
        }

        const focus = analyzeSharpness(frame);
        const runtimeDetections = await faceRuntime.analyzeFrame(
          faceFrame,
          abortController.signal,
        );
        const faces = identityTracker.track(absoluteTime, runtimeDetections);

        rangeFrames.push({
          timestamp: absoluteTime,
          motion: motionResult.total,
          globalMotion: motionResult.global,
          localMotion: motionResult.local,
          focus,
          brightness: 0.5,
          faceCount: faces.length,
          faces,
          faceModelVersion: FACE_ANALYSIS_MODEL_VERSION,
          isSceneCut: motionResult.isSceneCut,
        });

        previousFrame = frame;
        processedSamples++;

        const progress = Math.round((processedSamples / totalSamples) * 100);

        if (processedSamples % 4 === 0 || processedSamples === totalSamples) {
          const existingFrames = continueMode ? (clip.analysis?.frames || []) : [];
          const allSoFar = [...existingFrames, ...newFrames, ...rangeFrames]
            .toSorted((a, b) => a.timestamp - b.timestamp);
          const partialAnalysis: ClipAnalysis = {
            frames: allSoFar,
            sampleInterval: SAMPLE_INTERVAL_MS,
            faceAnalysis: identityTracker.summarize(backend),
          };
          updateClipAnalysis(clipId, {
            progress,
            faceProgress: 10 + Math.round(progress * 0.9),
            faceMessage: `Analyzing faces: ${processedSamples} / ${totalSamples} frames.`,
            analysis: partialAnalysis,
          });
        }

        if (processedSamples % 5 === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }

      newFrames.push(...rangeFrames);

      // Save each range to project folder immediately
      if (mediaFileId && projectFileService.isProjectOpen()) {
        try {
          await projectFileService.saveAnalysis(mediaFileId, rangeStart, rangeEnd, rangeFrames, SAMPLE_INTERVAL_MS);
          log.debug('Saved analysis range', { range: `${rangeStart.toFixed(1)}-${rangeEnd.toFixed(1)}` });
        } catch (err) {
          log.warn('Failed to save analysis range', err);
        }
      }
    }

    if (shouldCancel) {
      log.info('Analysis cancelled');
      updateClipAnalysis(clipId, {
        status: continueMode ? 'ready' : 'none',
        progress: 0,
        faceStatus: continueMode ? 'ready' : 'none',
        faceProgress: 0,
        faceMessage: 'Face analysis cancelled.',
      });
      return;
    }

    // Merge with existing frames if continue mode
    let finalFrames = newFrames;
    if (continueMode && clip.analysis?.frames.length) {
      finalFrames = [...clip.analysis.frames, ...newFrames];
      finalFrames.sort((a, b) => a.timestamp - b.timestamp);
      // Deduplicate by timestamp
      const seen = new Set<number>();
      finalFrames = finalFrames.filter(f => {
        const ts = Math.round(f.timestamp * 1000);
        if (seen.has(ts)) return false;
        seen.add(ts);
        return true;
      });
    }

    const analysis: ClipAnalysis = {
      frames: finalFrames,
      sampleInterval: SAMPLE_INTERVAL_MS,
      faceAnalysis: identityTracker.summarize(backend),
    };

    updateClipAnalysis(clipId, {
      status: 'ready',
      progress: 100,
      faceStatus: 'ready',
      faceProgress: 100,
      faceMessage: null,
      analysis,
    });

    // Propagate analysis status to MediaFile for badge display
    if (mediaFileId) {
      propagateAnalysisToMediaFile(mediaFileId);
    }

    triggerTimelineSave();
    log.info(`Done: ${finalFrames.length} frames analyzed`);

  } catch (error) {
    log.error('Analysis failed', error);
    if (shouldCancel) {
      updateClipAnalysis(clipId, {
        status: 'none',
        progress: 0,
        faceStatus: 'none',
        faceProgress: 0,
        faceMessage: 'Face analysis cancelled.',
      });
      triggerTimelineSave();
    } else {
      const message = error instanceof Error ? error.message : String(error);
      updateClipAnalysis(clipId, {
        status: 'error',
        progress: 0,
        faceStatus: 'error',
        faceProgress: 0,
        faceMessage: message,
      });
      triggerTimelineSave();
    }
  } finally {
    // Clean up
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    isAnalyzing = false;
    shouldCancel = false;
    currentClipId = null;
    analysisAbortController = null;
  }
}

/**
 * Propagate analysis status and coverage to MediaFile for badge display.
 */
async function propagateAnalysisToMediaFile(mediaFileId: string): Promise<void> {
  try {
    const mediaState = useMediaStore.getState();
    const file = mediaState.files.find(f => f.id === mediaFileId);
    if (!file || !file.duration || file.duration <= 0) return;

    const allRanges: [number, number][] = [];

    // 1. Try to get ranges from project folder on disk
    if (projectFileService.isProjectOpen()) {
      try {
        const rangeKeys = await projectFileService.getAnalysisRanges(mediaFileId);
        for (const key of rangeKeys) {
          const [s, e] = key.split('-').map(Number);
          if (!isNaN(s) && !isNaN(e)) allRanges.push([s, e]);
        }
      } catch { /* ignore */ }
    }

    // 2. Also derive ranges from all clips with analysis/description for this media file
    const clips = useTimelineStore.getState().clips;
    for (const clip of clips) {
      const mfId = clip.source?.mediaFileId || clip.mediaFileId;
      if (mfId !== mediaFileId) continue;
      if (clip.analysisStatus === 'ready' || clip.sceneDescriptionStatus === 'ready') {
        const inPt = clip.inPoint ?? 0;
        const outPt = clip.outPoint ?? (clip.source?.naturalDuration ?? file.duration);
        if (outPt > inPt) allRanges.push([inPt, outPt]);
      }
    }

    const analysisCoverage = calcCoverage(allRanges, file.duration);

    useMediaStore.setState({
      files: mediaState.files.map(f =>
        f.id === mediaFileId
          ? { ...f, analysisStatus: 'ready' as const, analysisCoverage }
          : f
      ),
    });
    log.debug('Propagated analysis status to MediaFile', { mediaFileId, analysisCoverage: analysisCoverage.toFixed(2) });
  } catch (e) {
    log.warn('Failed to propagate analysis status to MediaFile', e);
  }
}

/**
 * Calculate coverage ratio from a set of time ranges vs total duration.
 */
function calcCoverage(ranges: [number, number][], totalDuration: number): number {
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

function updateClipAnalysis(
  clipId: string,
  data: {
    status?: AnalysisStatus;
    progress?: number;
    analysis?: ClipAnalysis | null;
    faceStatus?: AnalysisStatus;
    faceProgress?: number;
    faceMessage?: string | null;
  }
): TimelineClip | undefined {
  const store = useTimelineStore.getState();
  let originalClip: TimelineClip | undefined;
  const clips = store.clips.map(clip => {
    if (clip.id !== clipId) return clip;
    originalClip = clip;

    const next = {
      ...clip,
      analysisStatus: data.status ?? clip.analysisStatus,
      analysisProgress: data.progress ?? clip.analysisProgress,
      faceAnalysisStatus: data.faceStatus ?? clip.faceAnalysisStatus,
      faceAnalysisProgress: data.faceProgress ?? clip.faceAnalysisProgress,
      faceAnalysisMessage: data.faceMessage === null
        ? undefined
        : data.faceMessage ?? clip.faceAnalysisMessage,
    };
    if ('analysis' in data) next.analysis = data.analysis ?? undefined;
    return next;
  });

  useTimelineStore.setState({ clips });
  return originalClip;
}

export async function clearClipAnalysis(clipId: string): Promise<void> {
  const clip = updateClipAnalysis(clipId, {
    status: 'none',
    progress: 0,
    faceStatus: 'none',
    faceProgress: 0,
    faceMessage: null,
    analysis: null,
  });
  const mediaFileId = clip?.source?.mediaFileId || clip?.mediaFileId;
  if (clip && mediaFileId && projectFileService.isProjectOpen()) {
    try {
      const deleted = await projectFileService.deleteAnalysisRange(
        mediaFileId,
        clip.inPoint ?? 0,
        clip.outPoint ?? clip.duration,
      );
      if (!deleted) log.warn('Could not delete persisted clip analysis range', { clipId, mediaFileId });
    } catch (error) {
      log.warn('Failed to delete persisted clip analysis range', error);
    }
  }
  triggerTimelineSave();
}
