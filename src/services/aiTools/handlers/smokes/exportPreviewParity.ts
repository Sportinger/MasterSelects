import { useTimelineStore } from '../../../../stores/timeline';
import { timelineRuntimeCoordinator } from '../../../timeline/timelineRuntimeCoordinator';
import {
  compareFrameFingerprints,
  fingerprintDataUrl,
  fingerprintImageBitmap,
} from '../../frameFingerprint';
import type { FrameFingerprint, FrameFingerprintComparison } from '../../frameFingerprint';
import type { ToolResult } from '../../types';
import { handleDebugExport } from '../export';
import { handleCaptureFrame } from '../preview';
import {
  beginTimelineCanvasSmokeMutation,
  captureTimelineCanvasSmokeRestoreState,
  clampNumber,
  getExportBlobSize,
  getNumberField,
  getResultDataObject,
  hasBrowserDom,
  readExportPreviewParityThresholds,
  resolveExportPreviewParitySampleTimes,
  restoreTimelineCanvasSmokeState,
  round,
  selectClosestExportPreviewSample,
  waitForFrames,
  type TimelineCanvasExportPreviewFingerprintSample,
  type TimelineCanvasExportPreviewParityRun,
  type TimelineCanvasExportPreviewReferenceAttempt,
  type TimelineCanvasSmokeRestoreResult,
  type TimelineCanvasSmokeSnapshot,
} from './smokeRuntime';
import { createSyntheticTimeline } from './smokeFixtures';
import { assertCanvasSmokeSnapshot, collectSmokeSnapshot } from './smokeSnapshots';

export async function handleRunTimelineCanvasExportPreviewParitySmoke(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const restoreState = args.restoreTimelineAfterRun === false
    ? null
    : captureTimelineCanvasSmokeRestoreState();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  const failures: string[] = [];
  const captureFailures: string[] = [];
  const previewSamples: TimelineCanvasExportPreviewFingerprintSample[] = [];
  const fingerprintOptions = {
    sampleWidth: Math.round(clampNumber(args.sampleWidth, 16, 4, 64)),
    sampleHeight: Math.round(clampNumber(args.sampleHeight, 16, 4, 64)),
  };
  const comparisonThresholds = readExportPreviewParityThresholds(args);
  const includePrecise = args.includePrecise === true;
  const exportWidth = Math.round(clampNumber(args.width, 320, 64, 3840));
  const exportHeight = Math.round(clampNumber(args.height, 180, 64, 2160));
  const exportFps = clampNumber(args.fps, 8, 1, 60);
  const maxSampleTimeDeltaSeconds = clampNumber(args.maxSampleTimeDeltaSeconds, 0.35, 0, 10);
  let synthetic: Awaited<ReturnType<typeof createSyntheticTimeline>> | null = null;
  let before: TimelineCanvasSmokeSnapshot | null = null;
  let after: TimelineCanvasSmokeSnapshot | null = null;
  let reference: {
    capturedAt: number;
    width: number | null;
    height: number | null;
    mode: string | null;
    canvasSource: string | null;
    fingerprint: FrameFingerprint;
  } | null = null;
  let runtimeBeforeExport: ReturnType<typeof timelineRuntimeCoordinator.getBridgeStats> | null = null;
  let runtimeAfterExport: ReturnType<typeof timelineRuntimeCoordinator.getBridgeStats> | null = null;
  let activeExportMode: 'fast' | 'precise' = 'fast';
  const referenceAttempts: TimelineCanvasExportPreviewReferenceAttempt[] = [];

  const unsubscribe = useTimelineStore.subscribe((state, previousState) => {
    if (!state.exportPreviewFrame || state.exportPreviewFrame === previousState.exportPreviewFrame) {
      return;
    }
    try {
      previewSamples.push({
        exportMode: activeExportMode,
        exportProgress: state.exportProgress,
        exportCurrentTime: state.exportCurrentTime,
        previewFrameTime: state.exportPreviewFrameTime,
        fingerprint: fingerprintImageBitmap(state.exportPreviewFrame, fingerprintOptions),
      });
    } catch (error) {
      captureFailures.push(error instanceof Error
        ? `preview frame fingerprint failed: ${error.message}`
        : `preview frame fingerprint failed: ${String(error)}`);
    }
  });

  const runExport = async (
    exportMode: 'fast' | 'precise',
    startTime: number,
    durationSeconds: number,
  ): Promise<TimelineCanvasExportPreviewParityRun> => {
    activeExportMode = exportMode;
    const beforeSampleCount = previewSamples.length;
    const maxRuntimeMs = Math.round(clampNumber(
      exportMode === 'precise'
        ? args.preciseMaxRuntimeMs ?? args.maxRuntimeMs
        : args.fastMaxRuntimeMs ?? args.maxRuntimeMs,
      exportMode === 'precise' ? 60000 : 30000,
      1000,
      600000,
    ));
    const result = await handleDebugExport({
      startTime,
      durationSeconds,
      width: exportWidth,
      height: exportHeight,
      fps: exportFps,
      includeAudio: false,
      exportMode,
      download: false,
      maxRuntimeMs,
      ...(args.codec !== undefined ? { codec: args.codec } : {}),
      ...(args.container !== undefined ? { container: args.container } : {}),
    });
    await waitForFrames(2, 180);

    const data = getResultDataObject(result);
    const elapsedMs = typeof data.elapsedMs === 'number' && Number.isFinite(data.elapsedMs)
      ? Math.round(data.elapsedMs)
      : null;
    const modeSamples = previewSamples
      .slice(beforeSampleCount)
      .filter((sample) => sample.exportMode === exportMode);
    const bestSample = selectClosestExportPreviewSample(modeSamples, startTime);
    const runFailures: string[] = [];
    let comparison: FrameFingerprintComparison | null = null;
    const blobSize = getExportBlobSize(result);

    if (!result.success) {
      runFailures.push(result.error ?? `${exportMode} debugExport failed`);
    }
    if (blobSize <= 0) {
      runFailures.push(`${exportMode} debugExport returned empty blob`);
    }
    if (modeSamples.length === 0) {
      runFailures.push(`${exportMode} export published no preview fingerprint samples`);
    }
    if (bestSample && reference) {
      const sampleTime = bestSample.previewFrameTime ?? bestSample.exportCurrentTime;
      if (typeof sampleTime === 'number' && Number.isFinite(sampleTime)) {
        const sampleDelta = Math.abs(sampleTime - startTime);
        if (sampleDelta > maxSampleTimeDeltaSeconds) {
          runFailures.push(`${exportMode} preview sample time delta ${round(sampleDelta)}s/${maxSampleTimeDeltaSeconds}s`);
        }
      }
      comparison = compareFrameFingerprints(reference.fingerprint, bestSample.fingerprint, comparisonThresholds);
      runFailures.push(...comparison.failures.map((failure) => `${exportMode} ${failure}`));
    }

    return {
      exportMode,
      success: runFailures.length === 0,
      error: runFailures.length > 0 ? runFailures.join('; ') : null,
      blobSize,
      elapsedMs,
      sampleCount: modeSamples.length,
      bestSample,
      comparison,
      failures: runFailures,
    };
  };

  let fastRun: TimelineCanvasExportPreviewParityRun | null = null;
  let preciseRun: TimelineCanvasExportPreviewParityRun | null = null;
  let sampleTime = 0;
  let exportDurationSeconds = 0.75;
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  try {
    synthetic = args.createSynthetic === false
      ? null
      : await createSyntheticTimeline({
        ...args,
        clipCount: clampNumber(args.clipCount, 12, 1, 240),
        videoTrackCount: clampNumber(args.videoTrackCount, 3, 1, 16),
        audioTrackCount: 0,
        durationSeconds: clampNumber(args.durationSeconds, 6, 1, 120),
        clipDurationSeconds: clampNumber(args.clipDurationSeconds, 2.4, 0.2, 20),
        initialZoom: clampNumber(args.initialZoom, 72, 8, 1000),
      });
    before = collectSmokeSnapshot('before');
    const timelineStore = useTimelineStore.getState();
    const timelineDuration = Math.max(0, timelineStore.duration);
    const maxStartTime = Math.max(0, timelineDuration - 0.1);
    const sampleTimeCandidates = resolveExportPreviewParitySampleTimes(args, maxStartTime);
    sampleTime = sampleTimeCandidates[0] ?? 0;
    exportDurationSeconds = clampNumber(
      args.exportDurationSeconds,
      0.75,
      0.1,
      Math.max(0.1, timelineDuration - sampleTime),
    );

    if (!hasBrowserDom()) {
      failures.push('browser DOM is unavailable');
    }
    if (timelineStore.clips.length === 0) {
      failures.push('timeline has no clips for export preview parity smoke');
    }

    if (failures.length === 0) {
      const captureMode = args.captureMode === 'dom' ? 'dom' : 'gpu';
      for (const candidateTime of sampleTimeCandidates) {
        let attemptError: string | null = null;
        let attemptFingerprint: FrameFingerprint | null = null;
        let referenceCapture = await handleCaptureFrame({ time: candidateTime, mode: captureMode }, useTimelineStore.getState());
        if (!referenceCapture.success && captureMode === 'gpu') {
          referenceCapture = await handleCaptureFrame({ time: candidateTime, mode: 'dom' }, useTimelineStore.getState());
        }

        if (!referenceCapture.success) {
          attemptError = referenceCapture.error ?? 'reference frame capture failed';
        } else {
          const captureData = getResultDataObject(referenceCapture);
          const dataUrl = typeof captureData.dataUrl === 'string' ? captureData.dataUrl : null;
          if (!dataUrl) {
            attemptError = 'reference frame capture did not return a dataUrl';
          } else {
            attemptFingerprint = await fingerprintDataUrl(dataUrl, fingerprintOptions);
            reference = {
              capturedAt: getNumberField(captureData, 'capturedAt', candidateTime),
              width: typeof captureData.width === 'number' ? captureData.width : null,
              height: typeof captureData.height === 'number' ? captureData.height : null,
              mode: typeof captureData.mode === 'string' ? captureData.mode : null,
              canvasSource: typeof captureData.canvasSource === 'string' ? captureData.canvasSource : null,
              fingerprint: attemptFingerprint,
            };
            sampleTime = candidateTime;
          }
        }

        referenceAttempts.push({
          requestedTime: candidateTime,
          success: Boolean(attemptFingerprint),
          error: attemptError,
          fingerprint: attemptFingerprint,
        });

        if (
          attemptFingerprint &&
          attemptFingerprint.nonBlankRatio >= (comparisonThresholds.minReferenceNonBlankRatio ?? 0.05)
        ) {
          break;
        }
      }

      if (!reference) {
        failures.push(`reference frame capture failed for ${sampleTimeCandidates.length} sample candidates`);
      }
    }

    if (reference) {
      runtimeBeforeExport = timelineRuntimeCoordinator.getBridgeStats();
      const exportResourcesBefore = runtimeBeforeExport.policies.export.resources.length;
      if (exportResourcesBefore !== 0) {
        failures.push(`export runtime resources existed before parity smoke: ${exportResourcesBefore}`);
      }
      fastRun = await runExport('fast', sampleTime, exportDurationSeconds);
      failures.push(...fastRun.failures);
      if (includePrecise) {
        preciseRun = await runExport('precise', sampleTime, Math.min(exportDurationSeconds, 0.5));
        failures.push(...preciseRun.failures);
      }
      runtimeAfterExport = timelineRuntimeCoordinator.getBridgeStats();
      const exportResourcesAfter = runtimeAfterExport.policies.export.resources.length;
      if (exportResourcesAfter !== 0) {
        failures.push(`export runtime resources retained after parity smoke: ${exportResourcesAfter}`);
      }
    }

    failures.push(...captureFailures);
    after = collectSmokeSnapshot('after');
    failures.push(...assertCanvasSmokeSnapshot(after, {
      requireTimelineDom: args.requireTimelineDom !== false,
    }));
  } finally {
    try {
      unsubscribe();
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
      }
    } finally {
      endSmokeMutation();
    }
  }

  return {
    success: failures.length === 0,
    ...(failures.length > 0 ? { error: failures.join('; ') } : {}),
    data: {
      synthetic,
      sampleTime,
      exportDurationSeconds,
      fingerprintOptions,
      comparisonThresholds,
      reference,
      referenceAttempts,
      fastRun,
      preciseRun,
      before,
      after,
      runtimeBeforeExport,
      runtimeAfterExport,
      previewSampleCount: previewSamples.length,
      restore: {
        enabled: Boolean(restoreState),
        result: restoreResult,
      },
      failures,
    },
  };
}
