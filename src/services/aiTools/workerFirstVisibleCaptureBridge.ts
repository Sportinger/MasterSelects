import { renderHostPort, type RenderCaptureCanvas } from '../render/renderHostPort';
import {
  getLastRenderCapabilityProbe,
  type RenderCapabilityProbeResult,
} from '../render/renderCapabilityProbe';
import type { ToolResult } from './types';
import { ensureRenderForDiagnostics } from './handlers/renderOnce';
import { getDomVisibleDocumentState } from './visiblePixelProof';
import { recordWorkerFirstVisiblePixelCounters } from './workerFirstCounterSources';
import {
  captureWorkerFirstVisiblePresentationProof,
} from './workerFirstProofCaptures';
import {
  WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
} from './workerFirstW5Gates';
import {
  isWorkerFirstPresentationStrategy,
  isWorkerFirstProofPlatform,
  resolveWorkerFirstProofPlatformFromProbe,
} from './workerFirstProofPlatform';

export interface WorkerFirstVisibleCaptureBridgeDeps {
  readonly getCaptureCanvas: () => RenderCaptureCanvas | null;
  readonly getCapabilityProbe: () => RenderCapabilityProbeResult | null;
  readonly ensureRender?: () => Promise<{ requested: boolean; waitedMs: number }>;
}

const DEFAULT_DEPS: WorkerFirstVisibleCaptureBridgeDeps = {
  getCaptureCanvas: () => renderHostPort.getCaptureCanvas(),
  getCapabilityProbe: () => getLastRenderCapabilityProbe(),
  ensureRender: () => ensureRenderForDiagnostics(),
};

function hasCallerStressFields(args: Record<string, unknown>): boolean {
  return args.playbackDurationMs !== undefined
    || args.frameCount !== undefined
    || args.staleVisibleFrameCount !== undefined;
}

export async function handleCaptureWorkerFirstVisiblePresentationProof(
  args: Record<string, unknown>,
  deps: WorkerFirstVisibleCaptureBridgeDeps = DEFAULT_DEPS,
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
      error: 'Playback stress counters must come from a dedicated playback smoke, not caller-supplied tool arguments.',
    };
  }

  const capabilityProbe = deps.getCapabilityProbe();
  if (!capabilityProbe) {
    return {
      success: false,
      error: 'A render capability probe is required before recording visible-presentation evidence.',
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

  const renderDiagnostics = deps.ensureRender
    ? await deps.ensureRender()
    : { requested: false, waitedMs: 0 };
  const documentState = getDomVisibleDocumentState();
  if (!documentState.visible) {
    return {
      success: false,
      error: 'Visible-presentation proof requires a foreground browser tab.',
      data: {
        document: documentState,
        renderDiagnostics,
      },
    };
  }
  const captureCanvas = deps.getCaptureCanvas();
  if (!captureCanvas) {
    return {
      success: false,
      error: 'No active render capture canvas is available.',
      data: {
        renderDiagnostics,
      },
    };
  }

  const proof = captureWorkerFirstVisiblePresentationProof({
    platform: args.platform,
    canvas: captureCanvas.canvas,
    strategy: capabilityProbe.selectedStrategy,
    capabilityProbe,
    stress: null,
    proofOptions: {
      includeFingerprint: args.includeFingerprint !== false,
    },
  });
  const nonBlankRatio = proof.proof?.fingerprint?.nonBlankRatio ?? null;
  recordWorkerFirstVisiblePixelCounters(nonBlankRatio !== null
    ? {
        nonBlankRatio,
        blackFrameCount: nonBlankRatio < 0.05 ? 1 : 0,
      }
    : {});

  return {
    success: true,
    data: {
      source: captureCanvas.source,
      proof,
      renderDiagnostics,
      w5StartPermissionsRemainStatsGuarded: true,
    },
  };
}
