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

/** Which clips and sources a composite shows: ownership, not media time or VideoFrame identity (both advance normally). */
function captureIdentities(visible: Layer[]): unknown[][] {
  return visible.map(layer => {
    const source = layer.source!;
    return [layer.id, layer.sourceClipId, source.type, source.mediaFileId,
      source.runtimeSourceId, source.runtimeSessionKey, source.webCodecsPlayer,
      source.nativeDecoder, source.videoElement, source.videoElement?.currentSrc, source.videoElement?.src,
      source.file, source.filePath, source.imageElement, source.imageElement?.src,
      source.canvasElement, source.textCanvas, source.texture, source.nestedComposition?.compositionId,
      source.modelUrl, source.gaussianSplatRuntimeKey, source.gaussianSplatUrl, source.gaussianAvatarUrl];
  });
}

function sameIdentities(previous: unknown[][], current: unknown[][]): boolean {
  return previous.length === current.length
    && current.every((identity, index) => identity.length === previous[index].length
      && identity.every((value, key) => Object.is(value, previous[index][key])));
}

/** Canvas and image rasters have no decoder callback that wakes an idle preview once they upload. */
function isRasterSource(layer: Layer): boolean {
  const source = layer.source;
  return !!(source && !source.nestedComposition && (source.textCanvas || source.canvasElement || source.imageElement));
}

/** Follow-up frames for a raster that was not ready; ~1 s at display rate, then the preview reports it. */
export const MISSING_RASTER_FOLLOW_UP_FRAMES = 60;

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
    identities: captureIdentities(visible),
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
  /** Clips and sources of the held view, recorded even without frame-history metadata. */
  private shown: { compositionId?: string; identities: unknown[][] } | null = null;
  private missingRasterFrames = 0;
  private missingRasterReported = false;
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
    this.shown = { compositionId: context?.compositionId, identities: captureIdentities(layers.filter(isCollectableLayer)) };
  }

  clear(): void {
    this.view = null;
    this.owner = null;
    this.shown = null;
  }

  /**
   * True when the held view shows exactly the clips and sources these layers would.
   * A different clip's picture is never a stand-in: one empty frame is better than
   * wrong content (a new text clip must not show the previous clip's raster).
   */
  showsSameSources(layers: Layer[], context?: RenderSurfaceFrameContext): boolean {
    const shown = this.shown;
    if (!shown || !this.view) return false;
    if (context && shown.compositionId !== undefined && shown.compositionId !== context.compositionId) return false;
    return sameIdentities(shown.identities, captureIdentities(layers.filter(isCollectableLayer)));
  }

  /**
   * A visible canvas or image raster that could not be collected (its GPU upload is not
   * ready yet) gets follow-up frames, because a paused preview would otherwise stay idle
   * on an incomplete or empty picture. A raster that never becomes ready is reported once.
   */
  requestFrameForMissingRasters(layers: Layer[], collected: readonly { layer: Layer }[], continuous: boolean): void {
    const collectedLayers = new Set(collected.map(data => data.layer));
    const missing = layers.filter(layer => isCollectableLayer(layer) && isRasterSource(layer) && !collectedLayers.has(layer));
    if (missing.length === 0) {
      this.missingRasterFrames = 0;
      this.missingRasterReported = false;
      return;
    }
    // Playback and export render continuously or exactly; they need no extra wake.
    if (continuous) return;
    if (this.missingRasterFrames >= MISSING_RASTER_FOLLOW_UP_FRAMES) {
      if (!this.missingRasterReported) {
        this.missingRasterReported = true;
        log.warn('Preview raster source is still not ready; the preview leaves it out', {
          clipIds: missing.map(layer => layer.sourceClipId ?? layer.id), frames: this.missingRasterFrames,
        });
      }
      return;
    }
    this.missingRasterFrames += 1;
    this.deps.renderLoop?.requestRender();
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
      || !sameIdentities(previous.identities, current.identities)) return false;
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
    // Paused and settling holds bridge a not-yet-ready frame of the same clips only.
    // Interactive dragging keeps its continuity hold; the next drag frame replaces it.
    const sameSources = !isPlaying && !isDragging && this.showsSameSources(layers, input.frameContext);
    const canHoldScrub = !isExporting && (isDragging || (isScrubSettling && sameSources)) && lastRenderHadContent;
    const canHoldPaused = !isPlaying && !isDragging && !isScrubSettling && !isExporting && sameSources
      && this.telemetry.shouldHoldLastFrameOnEmptyPlayback(lastRenderHadContent, fallback.targetTimeMs);
    if (!isPlaying && !isDragging && !isExporting && lastRenderHadContent && !sameSources && this.view) {
      log.debug('Not holding the previous preview frame: it shows other clips', { clipId: fallback.clipId });
    }
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
