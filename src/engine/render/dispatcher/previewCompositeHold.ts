import type { Layer } from '../../core/types';
import type { RenderDeps } from '../RenderDispatcher';
import type { RenderOutputRouter } from '../contracts';
import type { RenderSurfaceFrameContext } from '../../../services/render/renderHostTypes';
import { scrubSettleState } from '../../../services/scrubSettleState';
import { Logger } from '../../../services/logger';
import { isCollectableLayer } from '../layerCollector/collectionPredicates';
import type { DispatcherTelemetry, PreviewFrameRecorder } from './dispatcherTelemetry';
import { renderHeldCompositeFrame } from './heldCompositeRenderer';

const log = Logger.create('PreviewCompositeHold');

interface CompositeOwner {
  compositionId: string;
  eventRevision: number;
  ownerRevision: number;
  timelineTimeSeconds: number;
  identities: unknown[][];
  canBridgePlaybackGap: boolean;
}

function captureOwner(layers: Layer[], context?: RenderSurfaceFrameContext): CompositeOwner | null {
  const history = context?.frameHistory;
  if (!context || !history || !Number.isFinite(context.timelineTimeSeconds)
    || !Number.isFinite(history.eventRevision) || !Number.isFinite(history.ownerRevision)) return null;
  const visible = layers.filter(isCollectableLayer);
  return {
    compositionId: context.compositionId,
    eventRevision: history.eventRevision,
    ownerRevision: history.ownerRevision,
    timelineTimeSeconds: context.timelineTimeSeconds,
    identities: visible.map(layer => {
      const source = layer.source!;
      // Snapshot ownership, not media time or VideoFrame identity: both advance normally.
      return [layer.id, layer.sourceClipId, source.type, source.mediaFileId,
        source.runtimeSourceId, source.runtimeSessionKey, source.webCodecsPlayer,
        source.nativeDecoder, source.videoElement, source.videoElement?.currentSrc, source.videoElement?.src,
        source.file, source.filePath, source.imageElement, source.imageElement?.src,
        source.canvasElement, source.textCanvas, source.texture, source.nestedComposition?.compositionId,
        source.modelUrl, source.gaussianSplatRuntimeKey, source.gaussianSplatUrl, source.gaussianAvatarUrl];
    }),
    // Nested/transition sources can change their visible owner inside a stable wrapper.
    // Keep their existing short hold; only directly owned video extends through a long tick.
    canBridgePlaybackGap: visible.length > 0 && visible.every(layer => {
      const source = layer.source!;
      return source.type === 'video' && !source.nestedComposition && !layer.transitionRender
        && !!(source.runtimeSourceId || source.mediaFileId || source.webCodecsPlayer || source.videoElement || source.nativeDecoder);
    }),
  };
}

interface EmptyPreviewInput {
  device: GPUDevice;
  layers: Layer[];
  frameContext?: RenderSurfaceFrameContext;
  frameTimelineTime: number;
  isPlaying: boolean;
  isExporting: boolean;
  isDragging: boolean;
  lastRenderHadContent: boolean;
  lastPreviewTimelineTimeSeconds: number | null;
  renderEmptyFrame: () => void;
}

/** Owns the last submitted composite and the exact playback occurrence it represents. */
export class PreviewCompositeHold {
  private view: GPUTextureView | null = null;
  private owner: CompositeOwner | null = null;
  private readonly deps: RenderDeps;
  private readonly outputRouter: RenderOutputRouter;
  private readonly telemetry: DispatcherTelemetry;
  private readonly recordMainPreviewFrame: PreviewFrameRecorder;

  constructor(
    deps: RenderDeps,
    outputRouter: RenderOutputRouter,
    telemetry: DispatcherTelemetry,
    recordMainPreviewFrame: PreviewFrameRecorder,
  ) {
    this.deps = deps;
    this.outputRouter = outputRouter;
    this.telemetry = telemetry;
    this.recordMainPreviewFrame = recordMainPreviewFrame;
  }

  recordComposite(view: GPUTextureView, layers: Layer[], context?: RenderSurfaceFrameContext, presentedComplete = true): void {
    this.view = view;
    this.owner = presentedComplete ? captureOwner(layers, context) : null;
  }

  clear(): void {
    this.view = null;
    this.owner = null;
  }

  renderHeld(device: GPUDevice): boolean {
    const rendered = renderHeldCompositeFrame({
      device, sourceView: this.view, sampler: this.deps.sampler, outputRouter: this.outputRouter,
      skipOutput: this.deps.exportCanvasManager.shouldSkipPreviewOutput(),
    });
    if (!rendered) this.clear();
    return rendered;
  }

  private canHoldPlayback(input: EmptyPreviewInput, legacyHold: boolean): boolean {
    if (!input.isPlaying || input.isExporting || !input.lastRenderHadContent) return false;
    const previous = this.owner;
    const current = captureOwner(input.layers, input.frameContext);
    // Callers without frame-history metadata retain the established short-stall behavior.
    if (!previous || !current) return legacyHold;
    if (previous.compositionId !== current.compositionId
      || previous.eventRevision !== current.eventRevision
      || previous.ownerRevision !== current.ownerRevision
      || previous.identities.length !== current.identities.length
      || current.identities.some((identity, index) => identity.some((value, key) => !Object.is(value, previous.identities[index][key])))) return false;
    return legacyHold || (previous.canBridgePlaybackGap && current.canBridgePlaybackGap
      && current.timelineTimeSeconds >= previous.timelineTimeSeconds);
  }

  /** Returns true when the previous preview should remain visible; gaps still clear. */
  renderEmpty(input: EmptyPreviewInput): boolean {
    const { layers, frameTimelineTime, isPlaying, isExporting, isDragging, lastRenderHadContent,
      lastPreviewTimelineTimeSeconds } = input;
    const fallback = this.telemetry.getPreviewFallbackFromLayers(layers);
    const displayedTimeMs = this.telemetry.getLastPreviewDisplayedTimeMs();
    const isScrubSettling = !isPlaying && !isDragging && !!fallback.clipId && scrubSettleState.isPending(fallback.clipId);
    const canHoldScrub = !isExporting && (isDragging || isScrubSettling) && lastRenderHadContent;
    const canHoldPaused = !isPlaying && !isDragging && !isScrubSettling && !isExporting
      && this.telemetry.shouldHoldLastFrameOnEmptyPlayback(lastRenderHadContent, fallback.targetTimeMs);
    const continuousTime = lastPreviewTimelineTimeSeconds === null
      || Math.abs(frameTimelineTime - lastPreviewTimelineTimeSeconds) < 0.25;
    const legacyPlaybackHold = continuousTime && (lastPreviewTimelineTimeSeconds !== null
      || this.telemetry.shouldHoldLastFrameOnEmptyPlayback(lastRenderHadContent, fallback.targetTimeMs));
    const shouldHold = this.telemetry.hasVisiblePreviewInputLayer(layers)
      && (this.canHoldPlayback(input, legacyPlaybackHold) || canHoldScrub || canHoldPaused);
    if (shouldHold) {
      const heldCompositeRendered = this.renderHeld(input.device);
      log.debug('Holding last frame during empty preview frame', {
        isPlaying, isDragging, heldCompositeRendered,
        driftMs: typeof fallback.targetTimeMs === 'number' && typeof displayedTimeMs === 'number'
          ? Math.abs(fallback.targetTimeMs - displayedTimeMs) : undefined,
      });
      this.recordMainPreviewFrame(isDragging || isScrubSettling ? 'empty-hold'
        : isPlaying ? 'playback-stall-hold' : 'paused-empty-hold', undefined, { ...fallback, displayedTimeMs });
    } else {
      this.clear();
      input.renderEmptyFrame();
      this.deps.nestedCompRenderer?.cleanupPendingTextures();
      this.recordMainPreviewFrame('empty', undefined, fallback);
    }
    this.deps.performanceStats.setLayerCount(0);
    return shouldHold;
  }
}
