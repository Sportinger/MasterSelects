import { Logger } from './logger';
import { useTimelineStore } from '../stores/timeline';
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
import { analyzeFrameVisualMetrics, analyzeMotion } from './clipAnalysis/frameMetrics';
import { extractVideoFrame } from './clipAnalysis/frameExtractor';
import {
  cachedFaceCadenceIsCompatible,
  createAnalysisSampleSchedule,
  positiveSampleInterval,
  resolveSourceAnalysisRange,
  type SourceAnalysisRange,
} from './clipAnalysis/analysisSampling';
import {
  createStaleAnalysisRecoveryUpdate,
  propagateAnalysisToMediaFile,
  updateClipAnalysis,
} from './clipAnalysis/clipAnalysisState';
import {
  mergeTargetedAnalysisFrames,
  type ClipAnalysisTarget,
} from './clipAnalysis/targetedAnalysisMerge';
import { getFaceAnalysisRuntime } from './faceAnalysis/FaceAnalysisRuntime';
import {
  FaceIdentityTracker,
  createFaceIdentityPrefix,
  summarizeCachedFaces,
} from './faceAnalysis/faceIdentityTracker';
import {
  hasCompatibleFaceAnalysis,
  restoreCachedClipAnalysis,
} from './faceAnalysis/faceAnalysisPersistence';
import { hydrateAndProjectMediaSourceArtifacts } from './mediaArtifacts/mediaSourceArtifacts';
import { FACE_ANALYSIS_MODEL_VERSION } from './faceAnalysis/modelCatalog';
import type {
  ClipAnalysis,
  FaceAnalysisBackend,
  FrameAnalysisData,
} from '../types/clipMetadata';

export { clearClipAnalysis } from './clipAnalysis/clipAnalysisState';

const log = Logger.create('ClipAnalyzer');

const SAMPLE_INTERVAL_MS = 500;
let isAnalyzing = false;
let shouldCancel = false;
let currentClipId: string | null = null;
let analysisAbortController: AbortController | null = null;

// GPU optical flow analyzer instance
let flowAnalyzer: OpticalFlowAnalyzer | null = null;
let useGPUAnalysis = true; // Will be set to false if GPU init fails

export type { ClipAnalysisTarget } from './clipAnalysis/targetedAnalysisMerge';

export interface ClipAnalysisOptions {
  continueMode?: boolean;
  force?: boolean;
  target?: ClipAnalysisTarget;
  /** Source-time interval. Defaults to the current clip's trimmed range. */
  sourceRange?: SourceAnalysisRange;
  /** Focus/motion cadence. Defaults to the established Balanced 2 fps path. */
  sampleIntervalMs?: number;
  /** Optional independent YuNet/SFace cadence for a mixed visual pass. */
  faceSampleIntervalMs?: number;
}


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
 * A page reload discards the active AbortController, but the durable clip
 * state may still say "analyzing". Convert that orphaned state into a usable
 * empty or partial result so the UI can offer Analyze or Continue again.
 */
export function recoverStaleAnalysis(clipId: string): boolean {
  if (isAnalyzing) return false;

  const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
  if (!clip) return false;
  const recovery = createStaleAnalysisRecoveryUpdate(clip);
  if (!recovery) return false;
  updateClipAnalysis(clipId, recovery);
  triggerTimelineSave();
  log.warn('Recovered stale analysis state after page reload', { clipId });
  return true;
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
export async function analyzeClip(clipId: string, options: ClipAnalysisOptions = {}): Promise<void> {
  // Prevent concurrent analysis
  if (isAnalyzing) {
    log.warn('Already analyzing');
    throw new Error(`Another clip analysis is already running (${currentClipId ?? 'unknown clip'}).`);
  }

  const initialClip = useTimelineStore.getState().clips.find(c => c.id === clipId);
  const mediaFileId = initialClip?.source?.mediaFileId || initialClip?.mediaFileId;
  if (mediaFileId) {
    await hydrateAndProjectMediaSourceArtifacts(mediaFileId);
  }
  const clip = useTimelineStore.getState().clips.find(c => c.id === clipId);

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

  const target = options.target ?? 'all';
  const hadReadyMetrics = clip.analysisStatus === 'ready' && Boolean(clip.analysis?.frames.length);
  const hadReadyFaces = clip.faceAnalysisStatus === 'ready'
    && hasCompatibleFaceAnalysis(clip.analysis);
  const analyzeFaces = target !== 'metrics';
  const analyzeMetrics = target !== 'faces' || !hadReadyMetrics;
  const mergeTarget: ClipAnalysisTarget = analyzeFaces && analyzeMetrics ? 'all' : target;

  // Set analyzing state
  isAnalyzing = true;
  shouldCancel = false;
  currentClipId = clipId;
  const abortController = new AbortController();
  analysisAbortController = abortController;

  // Update status to analyzing
  updateClipAnalysis(clipId, {
    status: analyzeMetrics ? 'analyzing' : undefined,
    progress: analyzeMetrics ? 0 : undefined,
    faceStatus: analyzeFaces ? 'analyzing' : undefined,
    faceProgress: analyzeFaces ? 0 : undefined,
    faceMessage: analyzeFaces ? 'Preparing YuNet + SFace.' : undefined,
  });

  // Check for cached analysis first (from project folder, not browser cache)
  const [inPoint, outPoint] = resolveSourceAnalysisRange(
    options.sourceRange,
    clip.inPoint ?? 0,
    clip.outPoint ?? clip.duration,
  );
  const metricSampleIntervalMs = positiveSampleInterval(options.sampleIntervalMs, SAMPLE_INTERVAL_MS);
  const faceSampleIntervalMs = positiveSampleInterval(options.faceSampleIntervalMs, metricSampleIntervalMs);
  // Face embeddings are intentionally not persisted. A full pass keeps anonymous
  // person IDs coherent instead of creating colliding identities across cache gaps.
  const continueMode = false;
  if (options.continueMode) {
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

  if (!continueMode && !options.force && mediaFileId && projectFileService.isProjectOpen()) {
    try {
      const cachedAnalysis = await projectFileService.getAnalysis(mediaFileId, inPoint, outPoint);
      const restored = cachedAnalysis ? restoreCachedClipAnalysis(cachedAnalysis) : null;
      const metricsCacheIsCompatible = !analyzeMetrics
        || restored?.analysis.sampleInterval === undefined
        || restored.analysis.sampleInterval <= metricSampleIntervalMs;
      const facesCacheIsCompatible = !analyzeFaces
        || Boolean(restored?.hasFaces
          && cachedFaceCadenceIsCompatible(restored.analysis.frames, faceSampleIntervalMs));
      const cacheSatisfiesTarget = Boolean(
        restored?.analysis.frames.length
        && metricsCacheIsCompatible
        && facesCacheIsCompatible,
      );
      if (restored && cacheSatisfiesTarget) {
        log.info('Found cached analysis in project folder, loading...');
        const mergedFrames = mergeTargetedAnalysisFrames(
          clip.analysis?.frames ?? [],
          restored.analysis.frames,
          mergeTarget,
          [[inPoint, outPoint]],
        );
        const hasMergedFaces = mergedFrames.some(
          frame => frame.faceModelVersion === FACE_ANALYSIS_MODEL_VERSION,
        );
        const mergedFaceAnalysis = hasMergedFaces
          ? {
              ...summarizeCachedFaces(mergedFrames),
              backend: restored.analysis.faceAnalysis?.backend
                ?? clip.analysis?.faceAnalysis?.backend
                ?? 'cached' as const,
            }
          : undefined;
        const mergedAnalysis: ClipAnalysis = {
          frames: mergedFrames,
          sampleInterval: restored.analysis.sampleInterval,
          faceAnalysis: mergedFaceAnalysis,
        };
        const mergedFacesReady = hasCompatibleFaceAnalysis(mergedAnalysis);

        updateClipAnalysis(clipId, {
          status: 'ready',
          progress: 100,
          faceStatus: mergedFacesReady ? 'ready' : undefined,
          faceProgress: mergedFacesReady ? 100 : undefined,
          faceMessage: mergedFacesReady ? null : undefined,
          analysis: mergedAnalysis,
        });

        triggerTimelineSave();
        isAnalyzing = false;
        currentClipId = null;
        analysisAbortController = null;
        return;
      }
      if (cachedAnalysis && target !== 'metrics') {
        log.info('Ignoring clip analysis cache without compatible YuNet + SFace data');
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

    let faceRuntime: ReturnType<typeof getFaceAnalysisRuntime> | null = null;
    let backend: FaceAnalysisBackend | null = null;
    let identityTracker: FaceIdentityTracker | null = null;
    if (analyzeFaces) {
      faceRuntime = getFaceAnalysisRuntime();
      backend = await faceRuntime.prepare({
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
      identityTracker = new FaceIdentityTracker(createFaceIdentityPrefix(identityScope));
    }
    const getLatestAnalysis = () => (
      useTimelineStore.getState().clips.find(candidate => candidate.id === clipId)?.analysis
    );
    const summarizeMergedFaces = (frames: readonly FrameAnalysisData[]) => {
      if (!analyzeFaces) {
        return getLatestAnalysis()?.faceAnalysis ?? clip.analysis?.faceAnalysis;
      }
      const summary = summarizeCachedFaces(frames);
      return backend ? { ...summary, backend } : summary;
    };

    // Try to initialize GPU optical flow analyzer
    // Force recreate analyzer to ensure fresh state (avoids stale GPU errors)
    const gpuAvailable = analyzeMetrics && useGPUAnalysis && await initGPUAnalyzer(true);
    if (gpuAvailable) {
      log.debug('Using GPU optical flow analysis');
      resetOpticalFlowAnalyzer(); // Reset state for new clip
    } else if (analyzeMetrics) {
      log.debug('Using CPU motion analysis (fallback)');
    } else {
      log.debug('Reusing existing focus and motion data for face-only analysis');
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
    let faceCanvas: HTMLCanvasElement | null = null;
    let faceContext: CanvasRenderingContext2D | null = null;
    if (analyzeFaces) {
      const sourceWidth = video.videoWidth || 640;
      const sourceHeight = video.videoHeight || 360;
      const faceScale = Math.min(1, 640 / Math.max(sourceWidth, sourceHeight));
      faceCanvas = document.createElement('canvas');
      faceCanvas.width = Math.max(32, Math.round(sourceWidth * faceScale));
      faceCanvas.height = Math.max(32, Math.round(sourceHeight * faceScale));
      faceContext = faceCanvas.getContext('2d', { willReadFrequently: true });
      if (!faceContext) {
        throw new Error('Could not create the YuNet frame canvas.');
      }
    }

    // Determine ranges to analyze
    const ranges: [number, number][] = analysisGaps
      ? analysisGaps.map(([s, e]) => [s, Math.min(e, video.duration)])
      : [[Math.max(0, inPoint), Math.min(outPoint, video.duration)]];
    if (ranges.some(([start, end]) => end <= start)) {
      throw new RangeError('Analysis source range does not overlap the video source.');
    }

    // Calculate total samples across all ranges for progress reporting
    const totalSamples = ranges.reduce((sum, [s, e]) => {
      return sum + createAnalysisSampleSchedule(
        s,
        e,
        analyzeMetrics ? metricSampleIntervalMs : undefined,
        analyzeFaces ? faceSampleIntervalMs : undefined,
      ).length;
    }, 0);

    let processedSamples = 0;
    const newFrames: FrameAnalysisData[] = [];
    let previousFrame: ImageData | null = null;
    const completedRanges: [number, number][] = [];
    const existingFramesByTimestamp = new Map(
      (clip.analysis?.frames ?? []).map(frame => [Math.round(frame.timestamp * 1000), frame]),
    );

    log.info(`Analyzing ${target}: ${totalSamples} samples across ${ranges.length} range(s)`, {
      metricSampleIntervalMs: analyzeMetrics ? metricSampleIntervalMs : undefined,
      faceSampleIntervalMs: analyzeFaces ? faceSampleIntervalMs : undefined,
      continueMode,
    });

    for (const [rangeStart, rangeEnd] of ranges) {
      const rangeSamples = createAnalysisSampleSchedule(
        rangeStart,
        rangeEnd,
        analyzeMetrics ? metricSampleIntervalMs : undefined,
        analyzeFaces ? faceSampleIntervalMs : undefined,
      );

      // Reset flow analyzer between ranges (different video regions)
      if (gpuAvailable) {
        resetOpticalFlowAnalyzer();
      }
      previousFrame = null;

      const rangeFrames: FrameAnalysisData[] = [];

      for (const scheduledSample of rangeSamples) {
        if (shouldCancel) {
          log.info('Analysis cancelled');
          updateClipAnalysis(clipId, {
            status: analyzeMetrics ? (hadReadyMetrics ? 'ready' : 'none') : undefined,
            progress: analyzeMetrics ? (hadReadyMetrics ? 100 : 0) : undefined,
            faceStatus: analyzeFaces ? (hadReadyFaces ? 'ready' : 'none') : undefined,
            faceProgress: analyzeFaces ? (hadReadyFaces ? 100 : 0) : undefined,
            faceMessage: analyzeFaces ? 'Face analysis cancelled.' : undefined,
            analysis: clip.analysis ?? null,
          });
          return;
        }

        const absoluteTime = scheduledSample.time;

        const frame = await extractVideoFrame(video, absoluteTime, canvas, ctx);
        const existingFrame = existingFramesByTimestamp.get(Math.round(absoluteTime * 1000));
        const calculateMetrics = scheduledSample.metrics && (analyzeMetrics || !existingFrame);
        let motionResult: MotionResult | null = null;
        let focus = existingFrame?.focus ?? 0;
        let brightness = existingFrame?.brightness ?? 0.5;
        if (calculateMetrics) {
          const analysisStart = performance.now();
          if (gpuAvailable) {
            const bitmap = await createImageBitmap(canvas);
            motionResult = await analyzeMotionGPU(bitmap);
            bitmap.close();
          } else {
            motionResult = analyzeMotion(frame, previousFrame);
          }
          const visualMetrics = analyzeFrameVisualMetrics(frame);
          focus = visualMetrics.sharpness;
          brightness = visualMetrics.brightness;
          if (processedSamples === 0) {
            const analysisTime = performance.now() - analysisStart;
            log.debug(`First frame analysis took ${analysisTime.toFixed(1)}ms (${gpuAvailable ? 'GPU' : 'CPU'})`);
          }
          previousFrame = frame;
        }

        let faces = existingFrame?.faces;
        if (scheduledSample.faces && analyzeFaces && faceRuntime && identityTracker && faceCanvas && faceContext) {
          faceContext.drawImage(video, 0, 0, faceCanvas.width, faceCanvas.height);
          const faceFrame = faceContext.getImageData(0, 0, faceCanvas.width, faceCanvas.height);
          const runtimeDetections = await faceRuntime.analyzeFrame(faceFrame, abortController.signal);
          faces = identityTracker.track(absoluteTime, runtimeDetections);
        }

        const analyzedFrame: FrameAnalysisData = {
          timestamp: absoluteTime,
          motion: motionResult?.total ?? existingFrame?.motion ?? 0,
          globalMotion: motionResult?.global ?? existingFrame?.globalMotion ?? 0,
          localMotion: motionResult?.local ?? existingFrame?.localMotion ?? 0,
          focus,
          brightness,
          faceCount: faces?.length ?? existingFrame?.faceCount ?? 0,
          isSceneCut: motionResult?.isSceneCut ?? existingFrame?.isSceneCut,
        };
        const directionalMotion = {
          meanMagnitude: motionResult?.meanMagnitude ?? existingFrame?.motionMeanMagnitude,
          meanX: motionResult?.meanX ?? existingFrame?.motionMeanX,
          meanY: motionResult?.meanY ?? existingFrame?.motionMeanY,
          directionCoherence: motionResult?.directionCoherence
            ?? existingFrame?.motionDirectionCoherence,
          coverageRatio: motionResult?.coverageRatio ?? existingFrame?.motionCoverageRatio,
          vectorConvention: motionResult?.vectorConvention
            ?? existingFrame?.motionVectorConvention,
        };
        if (directionalMotion.meanMagnitude !== undefined) {
          analyzedFrame.motionMeanMagnitude = directionalMotion.meanMagnitude;
        }
        if (directionalMotion.meanX !== undefined) analyzedFrame.motionMeanX = directionalMotion.meanX;
        if (directionalMotion.meanY !== undefined) analyzedFrame.motionMeanY = directionalMotion.meanY;
        if (directionalMotion.directionCoherence !== undefined) {
          analyzedFrame.motionDirectionCoherence = directionalMotion.directionCoherence;
        }
        if (directionalMotion.coverageRatio !== undefined) {
          analyzedFrame.motionCoverageRatio = directionalMotion.coverageRatio;
        }
        if (directionalMotion.vectorConvention) {
          analyzedFrame.motionVectorConvention = directionalMotion.vectorConvention;
        }
        if (faces) analyzedFrame.faces = faces;
        if (analyzeFaces) {
          analyzedFrame.faceModelVersion = FACE_ANALYSIS_MODEL_VERSION;
        } else if (existingFrame?.faceModelVersion) {
          analyzedFrame.faceModelVersion = existingFrame.faceModelVersion;
        }
        rangeFrames.push(analyzedFrame);

        processedSamples++;

        const progress = Math.round((processedSamples / totalSamples) * 100);

        if (processedSamples % 4 === 0 || processedSamples === totalSamples) {
          const latestAnalysis = getLatestAnalysis();
          const allSoFar = mergeTargetedAnalysisFrames(
            latestAnalysis?.frames ?? clip.analysis?.frames ?? [],
            [...newFrames, ...rangeFrames],
            mergeTarget,
            [
              ...completedRanges,
              [rangeStart, Math.min(
                rangeEnd,
                absoluteTime + metricSampleIntervalMs / 1000,
              )],
            ],
          );
          const partialAnalysis: ClipAnalysis = {
            frames: allSoFar,
            sampleInterval: analyzeMetrics
              ? metricSampleIntervalMs
              : latestAnalysis?.sampleInterval ?? clip.analysis?.sampleInterval ?? SAMPLE_INTERVAL_MS,
            faceAnalysis: summarizeMergedFaces(allSoFar),
          };
          updateClipAnalysis(clipId, {
            progress: analyzeMetrics ? progress : undefined,
            faceProgress: analyzeFaces ? 10 + Math.round(progress * 0.9) : undefined,
            faceMessage: analyzeFaces
              ? `Analyzing faces: ${processedSamples} / ${totalSamples} frames.`
              : undefined,
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
          const latestAnalysis = getLatestAnalysis();
          const currentRangeFrames = (latestAnalysis?.frames ?? clip.analysis?.frames ?? [])
            .filter(frame => frame.timestamp >= rangeStart && frame.timestamp < rangeEnd);
          const persistedRangeFrames = mergeTargetedAnalysisFrames(
            currentRangeFrames,
            rangeFrames,
            mergeTarget,
            [[rangeStart, rangeEnd]],
          );
          await projectFileService.saveAnalysis(
            mediaFileId,
            rangeStart,
            rangeEnd,
            persistedRangeFrames,
            analyzeMetrics ? metricSampleIntervalMs : clip.analysis?.sampleInterval ?? SAMPLE_INTERVAL_MS,
            summarizeMergedFaces(persistedRangeFrames),
          );
          log.debug('Saved analysis range', { range: `${rangeStart.toFixed(1)}-${rangeEnd.toFixed(1)}` });
        } catch (err) {
          log.warn('Failed to save analysis range', err);
        }
      }
      completedRanges.push([rangeStart, rangeEnd]);
    }

    if (shouldCancel) {
      log.info('Analysis cancelled');
      updateClipAnalysis(clipId, {
        status: analyzeMetrics ? (hadReadyMetrics ? 'ready' : 'none') : undefined,
        progress: analyzeMetrics ? (hadReadyMetrics ? 100 : 0) : undefined,
        faceStatus: analyzeFaces ? (hadReadyFaces ? 'ready' : 'none') : undefined,
        faceProgress: analyzeFaces ? (hadReadyFaces ? 100 : 0) : undefined,
        faceMessage: analyzeFaces ? 'Face analysis cancelled.' : undefined,
        analysis: clip.analysis ?? null,
      });
      return;
    }

    const latestAnalysis = getLatestAnalysis();
    const finalFrames = mergeTargetedAnalysisFrames(
      latestAnalysis?.frames ?? clip.analysis?.frames ?? [],
      newFrames,
      mergeTarget,
      ranges,
    );

    const analysis: ClipAnalysis = {
      frames: finalFrames,
      sampleInterval: analyzeMetrics
        ? metricSampleIntervalMs
        : latestAnalysis?.sampleInterval ?? clip.analysis?.sampleInterval ?? SAMPLE_INTERVAL_MS,
      faceAnalysis: summarizeMergedFaces(finalFrames),
    };

    updateClipAnalysis(clipId, {
      status: analyzeMetrics ? 'ready' : undefined,
      progress: analyzeMetrics ? 100 : undefined,
      faceStatus: analyzeFaces ? 'ready' : undefined,
      faceProgress: analyzeFaces ? 100 : undefined,
      faceMessage: analyzeFaces ? null : undefined,
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
        status: analyzeMetrics ? (hadReadyMetrics ? 'ready' : 'none') : undefined,
        progress: analyzeMetrics ? (hadReadyMetrics ? 100 : 0) : undefined,
        faceStatus: analyzeFaces ? (hadReadyFaces ? 'ready' : 'none') : undefined,
        faceProgress: analyzeFaces ? (hadReadyFaces ? 100 : 0) : undefined,
        faceMessage: analyzeFaces ? 'Face analysis cancelled.' : undefined,
        analysis: clip.analysis ?? null,
      });
      triggerTimelineSave();
    } else {
      const message = error instanceof Error ? error.message : String(error);
      updateClipAnalysis(clipId, {
        status: analyzeMetrics ? 'error' : undefined,
        progress: analyzeMetrics ? 0 : undefined,
        faceStatus: analyzeFaces ? 'error' : undefined,
        faceProgress: analyzeFaces ? 0 : undefined,
        faceMessage: analyzeFaces ? message : undefined,
        analysis: clip.analysis ?? null,
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
