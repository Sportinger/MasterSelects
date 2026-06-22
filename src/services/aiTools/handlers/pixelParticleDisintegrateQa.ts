import { useTimelineStore } from '../../../stores/timeline';
import { renderHostPort } from '../../render/renderHostPort';
import {
  compareFrameFingerprints,
  fingerprintDataUrl,
  fingerprintImageBitmap,
  type FrameFingerprint,
  type FrameFingerprintComparison,
} from '../frameFingerprint';
import type { ToolResult } from '../types';
import { handleDebugExport } from './export';
import { handleCaptureFrame } from './preview';
import {
  beginTimelineCanvasSmokeMutation,
  captureTimelineCanvasSmokeRestoreState,
  clampNumber,
  getExportBlobSize,
  getResultDataObject,
  restoreTimelineCanvasSmokeState,
  selectClosestExportPreviewSample,
  type TimelineCanvasExportPreviewFingerprintSample,
  type TimelineCanvasSmokeRestoreResult,
} from './smokes/smokeRuntime';
import { createSyntheticTimeline } from './smokes/smokeFixtures';

interface CaptureProof {
  readonly label: string;
  readonly time: number;
  readonly success: boolean;
  readonly error: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly mode: string | null;
  readonly canvasSource: string | null;
  readonly fingerprint: FrameFingerprint | null;
}

const CAPTURE_PARITY_THRESHOLDS = {
  maxAvgRgbDelta: 1,
  maxMeanLumaDelta: 1,
  maxNonBlankRatioDelta: 0.02,
  minReferenceNonBlankRatio: 0,
  minCandidateNonBlankRatio: 0,
  maxColorRangeDelta: 4,
};

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function compactFingerprint(fingerprint: FrameFingerprint | null): Record<string, unknown> | null {
  if (!fingerprint) return null;
  return {
    hash: fingerprint.hash,
    nonBlankRatio: fingerprint.nonBlankRatio,
    alphaCoverage: fingerprint.alphaCoverage,
    meanLuma: fingerprint.meanLuma,
    avgRgb: fingerprint.avgRgb,
    colorRange: fingerprint.colorRange,
  };
}

async function captureProof(
  label: string,
  time: number | null,
  sampleSize: number,
  mode: 'auto' | 'gpu' | 'dom',
): Promise<CaptureProof> {
  const timeline = useTimelineStore.getState();
  const result = await handleCaptureFrame(time === null ? { mode } : { time, mode }, timeline);
  const data = getResultDataObject(result);
  const dataUrl = typeof data.dataUrl === 'string' ? data.dataUrl : null;
  const capturedAt = typeof data.capturedAt === 'number'
    ? data.capturedAt
    : time ?? timeline.playheadPosition;
  let fingerprint: FrameFingerprint | null = null;
  let fingerprintError: string | null = null;

  if (result.success && dataUrl) {
    try {
      fingerprint = await fingerprintDataUrl(dataUrl, {
        sampleWidth: sampleSize,
        sampleHeight: sampleSize,
      });
    } catch (error) {
      fingerprintError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    label,
    time: capturedAt,
    success: result.success && !!fingerprint,
    error: result.success
      ? fingerprintError
      : result.error ?? 'capture failed',
    width: typeof data.width === 'number' ? data.width : null,
    height: typeof data.height === 'number' ? data.height : null,
    mode: typeof data.mode === 'string' ? data.mode : null,
    canvasSource: typeof data.canvasSource === 'string' ? data.canvasSource : null,
    fingerprint,
  };
}

function compareCaptureParity(
  label: string,
  reference: CaptureProof | null,
  candidate: CaptureProof | null,
): { comparison: FrameFingerprintComparison | null; failures: string[] } {
  if (!reference?.fingerprint || !candidate?.fingerprint) {
    return {
      comparison: null,
      failures: [`${label} parity missing reference or candidate fingerprint`],
    };
  }
  const comparison = compareFrameFingerprints(
    reference.fingerprint,
    candidate.fingerprint,
    CAPTURE_PARITY_THRESHOLDS,
  );
  return {
    comparison,
    failures: comparison.failures.map((failure) => `${label} parity ${failure}`),
  };
}

function captureFailures(captures: readonly CaptureProof[]): string[] {
  const failures: string[] = [];
  for (const capture of captures) {
    if (!capture.success) {
      failures.push(`${capture.label} capture failed: ${capture.error ?? 'unknown error'}`);
    }
  }
  const fingerprints = captures
    .map((capture) => capture.fingerprint)
    .filter((fingerprint): fingerprint is FrameFingerprint => !!fingerprint);
  if (fingerprints.length >= 2) {
    const uniqueHashes = new Set(fingerprints.map((fingerprint) => fingerprint.hash));
    if (uniqueHashes.size < 2) {
      failures.push('particle progress captures did not produce distinct frame fingerprints');
    }
  }
  const first = captures[0]?.fingerprint;
  const middle = captures[1]?.fingerprint;
  if (first && first.nonBlankRatio < 0.05) {
    failures.push(`start capture nonBlankRatio ${first.nonBlankRatio}/0.05`);
  }
  if (middle && middle.nonBlankRatio < 0.02) {
    failures.push(`middle capture nonBlankRatio ${middle.nonBlankRatio}/0.02`);
  }
  return failures;
}

async function waitForPlaybackPosition(targetTime: number, timeoutMs: number): Promise<{
  readonly reached: boolean;
  readonly position: number;
  readonly elapsedMs: number;
}> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const position = useTimelineStore.getState().playheadPosition;
    if (position >= targetTime) {
      return {
        reached: true,
        position,
        elapsedMs: round(performance.now() - startedAt),
      };
    }
    await new Promise(resolve => setTimeout(resolve, 16));
  }
  return {
    reached: false,
    position: useTimelineStore.getState().playheadPosition,
    elapsedMs: round(performance.now() - startedAt),
  };
}

function appendError(existing: string | undefined, addition: string): string {
  return existing ? `${existing}; ${addition}` : addition;
}

export async function handleRunPixelParticleDisintegrateQa(args: Record<string, unknown>): Promise<ToolResult> {
  const restoreState = args.restoreTimelineAfterRun === false
    ? null
    : captureTimelineCanvasSmokeRestoreState();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  let restoreError: string | null = null;
  let toolResult: ToolResult = {
    success: false,
    error: 'pixel particle QA did not complete',
  };
  const failures: string[] = [];
  const warnings: string[] = [];
  const exportPreviewSamples: TimelineCanvasExportPreviewFingerprintSample[] = [];
  const sampleSize = Math.round(clampNumber(args.sampleSize, 20, 4, 64));
  const includePlaybackParity = args.includePlaybackParity !== false;
  const durationSeconds = clampNumber(args.durationSeconds, 1.25, 1.05, 10);
  const midpointTime = clampNumber(args.midpointTime, 0.5, 0.1, durationSeconds - 0.1);
  const endTime = clampNumber(args.endTime, 1, midpointTime + 0.05, durationSeconds);
  const captureMode = args.captureMode === 'dom' || args.captureMode === 'gpu' || args.captureMode === 'auto'
    ? args.captureMode
    : 'dom';
  const exportMode = args.exportMode === 'precise' ? 'precise' : 'fast';
  const endSmokeMutation = beginTimelineCanvasSmokeMutation();

  const unsubscribe = useTimelineStore.subscribe((state, previousState) => {
    if (!state.exportPreviewFrame || state.exportPreviewFrame === previousState.exportPreviewFrame) {
      return;
    }
    try {
      exportPreviewSamples.push({
        exportMode,
        exportProgress: state.exportProgress,
        exportCurrentTime: state.exportCurrentTime,
        previewFrameTime: state.exportPreviewFrameTime,
        fingerprint: fingerprintImageBitmap(state.exportPreviewFrame, {
          sampleWidth: sampleSize,
          sampleHeight: sampleSize,
        }),
      });
    } catch (error) {
      warnings.push(error instanceof Error
        ? `export preview fingerprint failed: ${error.message}`
        : `export preview fingerprint failed: ${String(error)}`);
    }
  });

  try {
    await createSyntheticTimeline({
      clipCount: 1,
      videoTrackCount: 1,
      audioTrackCount: 0,
      durationSeconds,
      clipDurationSeconds: durationSeconds,
      syntheticSourceType: 'image',
      initialZoom: 72,
    });

    const timeline = useTimelineStore.getState();
    const clip = timeline.clips[0];
    if (!clip) {
      failures.push('synthetic particle QA timeline did not create a clip');
    }

    let effectId: string | null | undefined = null;
    if (clip) {
      effectId = timeline.addClipEffect(clip.id, 'pixel-particle-disintegrate');
      if (!effectId) {
        failures.push('could not add pixel-particle-disintegrate to QA clip');
      } else {
        const progressProperty = `effect.${effectId}.progress` as const;
        timeline.addKeyframe(clip.id, progressProperty, 0, 0, 'linear');
        timeline.addKeyframe(clip.id, progressProperty, 0.5, midpointTime, 'linear');
        timeline.addKeyframe(clip.id, progressProperty, 1, endTime, 'ease-in-out');
      }
    }

    renderHostPort.requestNewFrameRender();
    const captures = failures.length === 0
      ? [
        await captureProof('progress-0', 0, sampleSize, captureMode),
        await captureProof('progress-0.5', midpointTime, sampleSize, captureMode),
        await captureProof('progress-1', endTime, sampleSize, captureMode),
      ]
      : [];
    failures.push(...captureFailures(captures));

    let scrubReseekCapture: CaptureProof | null = null;
    let scrubReseekComparison: FrameFingerprintComparison | null = null;
    if (failures.length === 0) {
      useTimelineStore.getState().setPlayheadPosition(endTime);
      renderHostPort.requestNewFrameRender();
      scrubReseekCapture = await captureProof('progress-0.5-reseek', midpointTime, sampleSize, captureMode);
      const scrubParity = compareCaptureParity('scrub reseek', captures[1] ?? null, scrubReseekCapture);
      scrubReseekComparison = scrubParity.comparison;
      failures.push(...scrubParity.failures);
    }

    let playbackWait: Awaited<ReturnType<typeof waitForPlaybackPosition>> | null = null;
    let playbackCapture: CaptureProof | null = null;
    let playbackDirectCapture: CaptureProof | null = null;
    let playbackComparison: FrameFingerprintComparison | null = null;
    if (failures.length === 0 && includePlaybackParity) {
      const playbackStore = useTimelineStore.getState();
      playbackStore.setPlayheadPosition(0);
      renderHostPort.requestNewFrameRender();
      await new Promise(resolve => setTimeout(resolve, 100));
      await useTimelineStore.getState().play();
      playbackWait = await waitForPlaybackPosition(midpointTime, 2500);
      useTimelineStore.getState().pause();
      await new Promise(resolve => setTimeout(resolve, 120));
      if (!playbackWait.reached) {
        failures.push(`playback did not reach ${midpointTime}s within 2500ms; position=${playbackWait.position}`);
      } else {
        playbackCapture = await captureProof('playback-paused-current', null, sampleSize, captureMode);
        playbackDirectCapture = await captureProof(
          'playback-paused-direct-seek',
          playbackCapture.time,
          sampleSize,
          captureMode,
        );
        const playbackParity = compareCaptureParity(
          'playback direct-seek',
          playbackCapture,
          playbackDirectCapture,
        );
        playbackComparison = playbackParity.comparison;
        failures.push(...playbackParity.failures);
      }
    }

    const reference = captures[1]?.fingerprint ?? null;
    const maxRuntimeMs = Math.round(clampNumber(args.maxRuntimeMs, 45_000, 1_000, 600_000));
    const exportResult = failures.length === 0
      ? await handleDebugExport({
        startTime: 0,
        durationSeconds: endTime,
        width: Math.round(clampNumber(args.exportWidth, 320, 64, 3840)),
        height: Math.round(clampNumber(args.exportHeight, 180, 64, 2160)),
        fps: clampNumber(args.exportFps, 8, 1, 60),
        includeAudio: false,
        exportMode,
        download: false,
        maxRuntimeMs,
      })
      : null;
    const exportBlobSize = exportResult ? getExportBlobSize(exportResult) : 0;
    if (exportResult && !exportResult.success) {
      failures.push(exportResult.error ?? 'debugExport failed');
    }
    if (exportResult && exportBlobSize <= 0) {
      failures.push('debugExport returned an empty blob');
    }

    let exportComparison: FrameFingerprintComparison | null = null;
    const exportSample = selectClosestExportPreviewSample(exportPreviewSamples, midpointTime);
    if (exportResult && reference) {
      if (!exportSample) {
        failures.push('debugExport did not publish an export preview frame sample');
      } else {
        exportComparison = compareFrameFingerprints(reference, exportSample.fingerprint, {
          maxAvgRgbDelta: clampNumber(args.maxAvgRgbDelta, 56, 0, 255),
          maxMeanLumaDelta: clampNumber(args.maxMeanLumaDelta, 44, 0, 255),
          maxNonBlankRatioDelta: clampNumber(args.maxNonBlankRatioDelta, 0.5, 0, 1),
          minReferenceNonBlankRatio: clampNumber(args.minReferenceNonBlankRatio, 0.02, 0, 1),
          minCandidateNonBlankRatio: clampNumber(args.minCandidateNonBlankRatio, 0.02, 0, 1),
          maxColorRangeDelta: clampNumber(args.maxColorRangeDelta, 190, 0, 255),
        });
        failures.push(...exportComparison.failures.map((failure) => `export preview parity ${failure}`));
      }
    }

    const renderDiagnostics = renderHostPort.getDebugInfrastructureState();
    const firstFingerprint = captures[0]?.fingerprint ?? null;
    toolResult = {
      success: failures.length === 0,
      error: failures.length > 0 ? failures.join('; ') : undefined,
      data: {
        clipId: clip?.id ?? null,
        effectId: effectId ?? null,
        captureMode,
        sampleSize,
        captures: captures.map((capture) => ({
          ...capture,
          fingerprint: compactFingerprint(capture.fingerprint),
        })),
        scrubParity: {
          reseekCapture: scrubReseekCapture
            ? {
              ...scrubReseekCapture,
              fingerprint: compactFingerprint(scrubReseekCapture.fingerprint),
            }
            : null,
          comparison: scrubReseekComparison,
          thresholds: CAPTURE_PARITY_THRESHOLDS,
        },
        playbackParity: {
          enabled: includePlaybackParity,
          wait: playbackWait,
          playbackCapture: playbackCapture
            ? {
              ...playbackCapture,
              fingerprint: compactFingerprint(playbackCapture.fingerprint),
            }
            : null,
          directCapture: playbackDirectCapture
            ? {
              ...playbackDirectCapture,
              fingerprint: compactFingerprint(playbackDirectCapture.fingerprint),
            }
            : null,
          comparison: playbackComparison,
          thresholds: CAPTURE_PARITY_THRESHOLDS,
        },
        captureHashDeltas: firstFingerprint && captures.length >= 2
          ? captures.map((capture, index) => index === 0 || !capture.fingerprint
            ? 0
            : round(compareFrameFingerprints(firstFingerprint, capture.fingerprint, {
              maxAvgRgbDelta: 255,
              maxMeanLumaDelta: 255,
              maxNonBlankRatioDelta: 1,
              minReferenceNonBlankRatio: 0,
              minCandidateNonBlankRatio: 0,
              maxColorRangeDelta: 255,
            }).avgRgbDelta))
          : [],
        export: exportResult
          ? {
            success: exportResult.success,
            blobSize: exportBlobSize,
            sampleCount: exportPreviewSamples.length,
            bestSampleTime: exportSample?.previewFrameTime ?? exportSample?.exportCurrentTime ?? null,
            bestSampleFingerprint: compactFingerprint(exportSample?.fingerprint ?? null),
            comparison: exportComparison,
          }
          : null,
        warnings,
        renderDiagnostics,
      },
    };
  } catch (error) {
    toolResult = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      data: {
        warnings,
      },
    };
  } finally {
    unsubscribe();
    try {
      if (restoreState) {
        restoreResult = await restoreTimelineCanvasSmokeState(restoreState);
      }
    } catch (error) {
      restoreError = error instanceof Error ? error.message : String(error);
    } finally {
      endSmokeMutation();
    }
    if (restoreResult) {
      renderHostPort.requestNewFrameRender();
    }
  }

  const data = getResultDataObject(toolResult);
  return {
    ...toolResult,
    success: toolResult.success && !restoreError,
    error: restoreError
      ? appendError(toolResult.error, `restore failed: ${restoreError}`)
      : toolResult.error,
    data: {
      ...data,
      restore: {
        attempted: !!restoreState,
        result: restoreResult,
        error: restoreError,
      },
    },
  };
}
