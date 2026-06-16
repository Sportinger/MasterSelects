import { useTimelineStore } from '../../stores/timeline';
import { getLastRenderCapabilityProbe, type RenderCapabilityProbeResult } from '../render/renderCapabilityProbe';
import { renderHostPort, type RenderCaptureCanvas } from '../render/renderHostPort';
import { handleSimulatePlayback } from './handlers/playback';
import { ensureRenderForDiagnostics } from './handlers/renderOnce';
import type { ToolResult } from './types';
import { getDomVisibleDocumentState } from './visiblePixelProof';
import { recordWorkerFirstVisiblePixelCounters } from './workerFirstCounterSources';
import { captureWorkerFirstVisiblePresentationProof } from './workerFirstProofCaptures';
import {
  WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
} from './workerFirstW5Gates';
import {
  isWorkerFirstPresentationStrategy,
  isWorkerFirstProofPlatform,
  resolveWorkerFirstProofPlatformFromProbe,
} from './workerFirstProofPlatform';

type PlaybackRunner = (args: Record<string, unknown>) => Promise<ToolResult>;

export interface WorkerFirstVisibleStressBridgeDeps {
  readonly getCaptureCanvas: () => RenderCaptureCanvas | null;
  readonly getCapabilityProbe: () => RenderCapabilityProbeResult | null;
  readonly runPlayback: PlaybackRunner;
  readonly ensureRender?: () => Promise<{ requested: boolean; waitedMs: number }>;
  readonly setPlayheadPosition?: (timeSeconds: number) => void;
  readonly waitAfterCaptureSeek?: (durationMs: number) => Promise<void>;
}

const DEFAULT_DEPS: WorkerFirstVisibleStressBridgeDeps = {
  getCaptureCanvas: () => renderHostPort.getCaptureCanvas(),
  getCapabilityProbe: () => getLastRenderCapabilityProbe(),
  runPlayback: (args: Record<string, unknown>) =>
    handleSimulatePlayback(args, useTimelineStore.getState()),
  ensureRender: () => ensureRenderForDiagnostics(),
  setPlayheadPosition: (timeSeconds) => useTimelineStore.getState().setPlayheadPosition(timeSeconds),
  waitAfterCaptureSeek: (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
};

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readDurationMsArg(
  args: Record<string, unknown>,
  key: string,
  defaultValue: number,
  minValue: number,
  maxValue: number,
): number {
  const parsed = readFiniteNumber(args[key]);
  const rawValue = parsed ?? defaultValue;
  return Math.max(minValue, Math.min(maxValue, Math.round(rawValue)));
}

function readPositiveIntegerArg(
  args: Record<string, unknown>,
  key: string,
  defaultValue: number,
  minValue: number,
  maxValue: number,
): number {
  const parsed = readFiniteNumber(args[key]);
  const rawValue = parsed ?? defaultValue;
  return Math.max(minValue, Math.min(maxValue, Math.round(rawValue)));
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function readNonNegativeInteger(value: unknown): number {
  const parsed = readFiniteNumber(value);
  return parsed === null ? 0 : Math.max(0, Math.round(parsed));
}

function hasCallerStressFields(args: Record<string, unknown>): boolean {
  return args.playbackDurationMs !== undefined
    || args.frameCount !== undefined
    || args.staleVisibleFrameCount !== undefined;
}

function buildPlaybackArgs(args: Record<string, unknown>): Record<string, unknown> {
  const playbackArgs: Record<string, unknown> = {
    durationMs: readDurationMsArg(args, 'durationMs', 5000, 250, 60000),
    settleMs: readDurationMsArg(args, 'settleMs', 150, 0, 5000),
    resetDiagnostics: args.resetDiagnostics !== false,
    restorePlaybackState: false,
  };
  const startTime = readFiniteNumber(args.startTime);
  if (startTime !== null) {
    playbackArgs.startTime = startTime;
  }
  const playbackSpeed = readFiniteNumber(args.playbackSpeed);
  if (playbackSpeed !== null && playbackSpeed !== 0) {
    playbackArgs.playbackSpeed = playbackSpeed;
  }
  return playbackArgs;
}

function deriveStress(
  playbackData: Record<string, unknown>,
): {
  readonly playbackDurationMs: number;
  readonly frameCount: number;
  readonly staleVisibleFrameCount: number;
  readonly diagnostics: Record<string, unknown>;
} | null {
  const runDiagnostics = getRecord(playbackData.runDiagnostics);
  const playback = getRecord(runDiagnostics?.playback);
  const startup = getRecord(runDiagnostics?.startup);
  if (!runDiagnostics || !playback) {
    return null;
  }

  const playbackDurationMs = readNonNegativeInteger(
    playbackData.actualDurationMs ?? playbackData.requestedDurationMs ?? runDiagnostics.windowMs,
  );
  const frameCount = readNonNegativeInteger(playback.previewFrames ?? playbackData.framesObserved);
  const staleVisibleFrameCount = readNonNegativeInteger(playback.stalePreviewWhileTargetMoved)
    + readNonNegativeInteger(playback.previewFreezeFrames)
    + readNonNegativeInteger(startup?.initialTargetMovedStaleFrames);

  return {
    playbackDurationMs,
    frameCount,
    staleVisibleFrameCount,
    diagnostics: {
      status: playback.status,
      pipeline: playback.pipeline,
      previewFrames: playback.previewFrames,
      previewUpdates: playback.previewUpdates,
      stalePreviewFrames: playback.stalePreviewFrames,
      stalePreviewWhileTargetMoved: playback.stalePreviewWhileTargetMoved,
      previewFreezeFrames: playback.previewFreezeFrames,
      previewFreezeEvents: playback.previewFreezeEvents,
      initialTargetMovedStaleFrames: startup?.initialTargetMovedStaleFrames,
    },
  };
}

export async function handleRunWorkerFirstVisiblePresentationStressProof(
  args: Record<string, unknown>,
  deps: WorkerFirstVisibleStressBridgeDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (!isWorkerFirstProofPlatform(args.platform)) {
    return {
      success: false,
      error: 'A valid W5 proof platform is required.',
      data: {
        allowedPlatforms: WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
      },
    };
  }

  if (hasCallerStressFields(args)) {
    return {
      success: false,
      error: 'Playback stress counters must come from the controlled playback run, not caller-supplied tool arguments.',
    };
  }

  const documentState = getDomVisibleDocumentState();
  if (!documentState.visible) {
    return {
      success: false,
      error: 'Visible-presentation stress proof requires a foreground browser tab.',
      data: {
        document: documentState,
      },
    };
  }

  const captureCanvas = deps.getCaptureCanvas();
  if (!captureCanvas) {
    return {
      success: false,
      error: 'No active render capture canvas is available.',
    };
  }

  const capabilityProbe = deps.getCapabilityProbe();
  if (!capabilityProbe) {
    return {
      success: false,
      error: 'A render capability probe is required before recording visible-presentation stress evidence.',
    };
  }

  const probePlatform = resolveWorkerFirstProofPlatformFromProbe(capabilityProbe);
  if (probePlatform !== args.platform) {
    return {
      success: false,
      error: 'Requested proof platform does not match the current render capability probe.',
      data: {
        requestedPlatform: args.platform,
        probePlatform,
        probeOs: capabilityProbe.os,
        probeBrowserEngine: capabilityProbe.browserEngine,
      },
    };
  }

  if (args.strategy !== undefined && (
    !isWorkerFirstPresentationStrategy(args.strategy) || args.strategy !== capabilityProbe.selectedStrategy
  )) {
    return {
      success: false,
      error: 'Requested presentation strategy does not match the current render capability probe.',
      data: {
        requestedStrategy: args.strategy,
        probeStrategy: capabilityProbe.selectedStrategy,
      },
    };
  }

  const playbackArgs = buildPlaybackArgs(args);
  const playbackResult = await deps.runPlayback(playbackArgs);
  if (!playbackResult.success) {
    return {
      success: false,
      error: playbackResult.error ?? 'Controlled playback stress run failed.',
      data: {
        playback: playbackResult,
      },
    };
  }

  const playbackData = getRecord(playbackResult.data);
  const stress = playbackData ? deriveStress(playbackData) : null;
  if (!stress) {
    return {
      success: false,
      error: 'Controlled playback stress run did not return usable diagnostics.',
      data: {
        playback: playbackResult,
      },
    };
  }

  const minPreviewFrames = readPositiveIntegerArg(args, 'minPreviewFrames', 3, 1, 10000);
  if (stress.frameCount < minPreviewFrames) {
    return {
      success: false,
      error: 'Controlled playback stress run did not observe enough visible preview frames.',
      data: {
        minPreviewFrames,
        stress,
        playback: playbackResult,
      },
    };
  }

  const captureTimeSeconds = readFiniteNumber(args.captureTimeSeconds)
    ?? readFiniteNumber(args.startTime)
    ?? 0;
  const captureSettleMs = readDurationMsArg(
    args,
    'captureSettleMs',
    readDurationMsArg(args, 'settleMs', 750, 0, 5000),
    0,
    5000,
  );
  deps.setPlayheadPosition?.(captureTimeSeconds);
  if (captureSettleMs > 0) {
    await deps.waitAfterCaptureSeek?.(captureSettleMs);
  }
  const renderDiagnostics = deps.ensureRender
    ? await deps.ensureRender()
    : { requested: false, waitedMs: 0 };
  const postPlaybackDocumentState = getDomVisibleDocumentState();
  if (!postPlaybackDocumentState.visible) {
    return {
      success: false,
      error: 'Visible-presentation stress proof requires a foreground browser tab after playback.',
      data: {
        document: postPlaybackDocumentState,
        renderDiagnostics,
        playback: playbackResult,
      },
    };
  }

  const refreshedCaptureCanvas = deps.getCaptureCanvas();
  if (!refreshedCaptureCanvas) {
    return {
      success: false,
      error: 'No active render capture canvas is available after playback refresh.',
      data: {
        renderDiagnostics,
        playback: playbackResult,
      },
    };
  }

  const proof = captureWorkerFirstVisiblePresentationProof({
    platform: args.platform,
    canvas: refreshedCaptureCanvas.canvas,
    strategy: capabilityProbe.selectedStrategy,
    capabilityProbe,
    stress: {
      playbackDurationMs: stress.playbackDurationMs,
      frameCount: stress.frameCount,
      staleVisibleFrameCount: stress.staleVisibleFrameCount,
    },
    proofOptions: {
      includeFingerprint: true,
    },
  });
  const nonBlankRatio = proof.proof?.fingerprint?.nonBlankRatio ?? null;
  recordWorkerFirstVisiblePixelCounters({
    ...(nonBlankRatio !== null
      ? {
          nonBlankRatio,
          blackFrameCount: nonBlankRatio < 0.05 ? 1 : 0,
        }
      : {}),
    freezeCount: readNonNegativeInteger(stress.diagnostics.previewFreezeEvents),
    staleVisibleFrameCount: stress.staleVisibleFrameCount,
  });

  return {
    success: true,
    data: {
      source: refreshedCaptureCanvas.source,
      renderDiagnostics,
      captureTimeSeconds,
      captureSettleMs,
      playbackArgs,
      playback: playbackResult.data,
      stress,
      proof,
      w5StartPermissionsRemainStatsGuarded: true,
    },
  };
}
