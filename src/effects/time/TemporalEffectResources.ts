import type { ClipMask } from '../../types/masks';
import { slitScanGeometryBytes } from './slit-scan/geometryParameters';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';
import { useMediaStore } from '../../stores/mediaStore';
import { SLIT_SCAN_PROTECTION_RESOURCE } from '../../services/operators/slitScanProtectionGraph';
import { SLIT_SCAN_TIME_MAP_RESOURCE } from '../../services/operators/slitScanTimeMapGraph';
import { SLIT_SCAN_TIME_MASK_RESOURCE } from '../../services/operators/slitScanTimeFieldsGraph';
import { alignedTimeMapTime } from './slit-scan/timeMapAlignment';
import { needsSlitScanTimeMedia } from './slit-scan/timeFieldResources';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { SlitScanMaskRuntime } from './SlitScanMaskRuntime';
import { TimeMapMediaRuntime } from './TimeMapMediaRuntime';
import { isCollectingTemporalPreparations, setTemporalStatus } from './temporalResourcePreparation';
import { temporalSourceTime, type TemporalClipSource } from './temporalClipSource';
import { SourceTemporalRuntime, sourceTemporalWindow } from './SourceTemporalRuntime';
import { useTimelineStore } from '../../stores/timeline';
import { useTrackingStore } from '../../stores/trackingStore';
import { SlitScanTrackingGap, slitScanSourceTransform, slitScanStabilization } from './slit-scan/stabilization';
import type { SourceTemporalRequest } from './SourceTemporalRuntime';
import { HybridTemporalRuntime, type HybridTemporalContext } from './HybridTemporalRuntime';
import { hybridTemporalBudget } from './hybridTemporalWindow';
import { hybridTemporalSampleLimit } from './sourceTemporalLimits';
import { slitScanNumber } from './slit-scan/parameters';
import { recordSlitScanPresentation, recordSlitScanRequest } from './slit-scan/playbackDiagnostics';
import { ResidentGpuMemoryError, ResidentTemporalRuntime } from './ResidentTemporalRuntime';
import { ResidentTemporalCapacityError } from './residentTemporalLayout';
import { adaptiveTemporalPreview } from './adaptiveTemporalPreview';
import { TemporalPreviewFrames } from './TemporalPreviewFrames';
import { SourceMotionHistory } from './SourceMotionHistory';
import type { ImageOperatorExternalResource } from '../../services/operators/imageOperatorExternalResources';

interface ResolvedTemporalHistory {
  atlas: ResolvedImageGraphExternalResource;
  ages: ResolvedImageGraphExternalResource;
  current?: ResolvedImageGraphExternalResource;
  queries?: Record<string, { atlas: ResolvedImageGraphExternalResource; ages: ResolvedImageGraphExternalResource }>;
}

/** Device-local resource ownership for temporal graphs and their node previews. */
export class TemporalEffectResources {
  private masks: SlitScanMaskRuntime;
  private maps: TimeMapMediaRuntime;
  private native: SourceTemporalRuntime;
  private hybrid?: HybridTemporalRuntime;
  private resident?: ResidentTemporalRuntime;
  private interactiveResident?: ResidentTemporalRuntime;
  private residentFallbacks = new Map<string, { signature: string; allocationFailed: boolean }>();
  private device: GPUDevice;
  private onReady?: () => void;
  readonly previewFrames: TemporalPreviewFrames;
  private motionHistory?: SourceMotionHistory;
  constructor(device: GPUDevice, onReady?: () => void) {
    this.masks = new SlitScanMaskRuntime(device);
    this.maps = new TimeMapMediaRuntime(device, onReady);
    this.native = new SourceTemporalRuntime(device, onReady);
    this.device = device; this.onReady = onReady;
    this.previewFrames = new TemporalPreviewFrames(device);
  }

  resolveNative(effect: { id: string; type: string; params: Record<string, unknown> },
    scopeId: string, source: TemporalClipSource | undefined, encoder: GPUCommandEncoder,
    currentInput?: { view: GPUTextureView; width: number; height: number }, hybridContext?: HybridTemporalContext): ResolvedTemporalHistory | undefined {
    if (!source) throw new Error('Full-resolution temporal sampling requires a source video clip.');
    if (!isCollectingTemporalPreparations()) recordSlitScanRequest(effect.id, source.localTime);
    const media = useMediaStore.getState().files.find(file => file.id === source.mediaId);
    if (!media || media.type !== 'video') throw new Error('Full-resolution source video is unavailable.');
    const resident = effect.params.temporalStorage === 'resident';
    const limit = effect.params.temporalStorage === 'hybrid' || resident ? hybridTemporalSampleLimit(media.width, media.height) : 256;
    const timeFactor = slitScanNumber(effect.params, 'timeFactor');
    const request: SourceTemporalRequest = { key: JSON.stringify([scopeId, effect.id]), effectId: effect.id, media, source,
      horizon: slitScanNumber(effect.params, 'delay') * timeFactor, timeFactor,
      samples: Math.max(2, Math.min(limit, Math.round(Number(effect.params.temporalSamples ?? 32)) || 32)),
      nearest: effect.params.temporalInterpolation === 'nearest', encoder, currentInput, keepPending: useTimelineStore.getState().isPlaying,
      completeWindow: ['time-surface', 'motion-band', 'motion-surface'].includes(String(effect.params.geometryMode)),
      useProxy: useMediaStore.getState().proxyEnabled && !isCollectingTemporalPreparations(),
      stabilization: slitScanStabilization(effect.params, useTrackingStore.getState().assets, source.mediaId, media.width!, media.height!),
      maxEdge: effect.params.temporalResolution === 'native' ? undefined : 160 };
    const hybrid = effect.params.temporalStorage === 'hybrid';
    const timeline = useTimelineStore.getState();
    const exporting = isCollectingTemporalPreparations();
    const adaptive = resident && effect.params.temporalPreview === 'adaptive' && !request.maxEdge && !exporting;
    const interactive = adaptive && (timeline.isPlaying || timeline.isDraggingPlayhead);
    if (!adaptive) this.interactiveResident?.release(request.key);
    if (hybrid || resident) this.native.release(request.key);
    if (!hybrid && !resident) this.hybrid?.release(request.key);
    if (!resident) { this.resident?.release(request.key); this.residentFallbacks.delete(request.key); }
    const resolve = (input: SourceTemporalRequest) => {
      let fallback = false;
      const geometryBytes = slitScanGeometryBytes(effect.params, currentInput?.width ?? 0, currentInput?.height ?? 0);
      let hybridBudget = 640 * 1024 * 1024 - geometryBytes;
      let fast: ReturnType<ResidentTemporalRuntime['resolve']>;
      if (resident) {
        const selectedMemory = Number(effect.params.temporalMemory ?? 640);
        const memoryMiB = ([640, 1024, 2048, 4096].includes(selectedMemory) ? selectedMemory : 640) - Math.ceil(geometryBytes / 1024 / 1024);
        if (memoryMiB <= 0) throw new Error('Slit Scan geometry exceeds the selected GPU memory budget.');
        // Paused parameter edits need a fresh adaptive result too. Prepare it
        // alongside full quality, rather than returning an old window's views.
        if (adaptive && !interactive) {
          const quick = adaptiveTemporalPreview(input, memoryMiB);
          this.interactiveResident ??= new ResidentTemporalRuntime(this.device, this.onReady);
          try {
            fast = this.interactiveResident.resolve({ ...input, maxEdge: quick.maxEdge,
              reserveFrames: quick.reserveFrames, retainCurrentInput: true }, quick.budgetMiB);
            // Finish the interactive window first. Competing full-size requests
            // seek the shared decoder away from the preview that playback needs.
            if (!fast) return undefined;
          } catch (error) {
            if (!(error instanceof ResidentTemporalCapacityError) && !(error instanceof ResidentGpuMemoryError)) throw error;
            this.interactiveResident.release(input.key);
          }
        }
        const preview = interactive ? adaptiveTemporalPreview(input, memoryMiB) : undefined;
        if (preview) this.resident?.suspend(request.key);
        if (preview && (this.resident?.allocatedBytes ?? 0) + preview.budgetMiB * 1024 * 1024 > memoryMiB * 1024 * 1024) {
          // A paused full-quality cache can stay warm across Play/Pause when
          // its allocation plus the interactive ceiling fit the shared budget.
          this.resident?.release(request.key);
        }
        if (preview) input = { ...input, maxEdge: preview.maxEdge, reserveFrames: preview.reserveFrames, retainCurrentInput: true };
        // Keep the interactive cache warm at pause. Full quality may stream
        // alongside it; both resident owners share the selected memory ceiling.
        const budgetMiB = preview?.budgetMiB ?? Math.max(1, Math.floor(memoryMiB - (this.interactiveResident?.allocatedBytes ?? 0) / 1024 / 1024));
        if (!interactive) hybridBudget = hybridTemporalBudget(budgetMiB * 1024 * 1024);
        const runtime = interactive
          ? (this.interactiveResident ??= new ResidentTemporalRuntime(this.device, this.onReady))
          : (this.resident ??= new ResidentTemporalRuntime(this.device, this.onReady));
        // Keep streaming after a capacity miss; advancing playback must not try
        // the same failed allocation and throw away its Hybrid cache each frame.
        const signature = JSON.stringify([media.id, media.url, media.width, media.height,
          budgetMiB, interactive, input.horizon, input.samples, input.nearest, input.maxEdge,
          input.currentInput?.width, input.currentInput?.height, input.stabilization?.identity]);
        const previousFallback = this.residentFallbacks.get(input.key);
        fallback = previousFallback?.signature === signature;
        if (fallback && previousFallback?.allocationFailed) hybridBudget = hybridTemporalBudget(hybridBudget, true);
        if (!fallback) {
          this.residentFallbacks.delete(input.key);
          this.hybrid?.release(input.key);
          try {
            const result = runtime.resolve(input, budgetMiB);
            if (!result && fast) {
              setTemporalStatus(effect.id, 'GPU history · restoring full quality…');
              return fast;
            }
            return result;
          } catch (error) {
            if (!(error instanceof ResidentTemporalCapacityError) && !(error instanceof ResidentGpuMemoryError)) throw error;
            const allocationFailed = error instanceof ResidentGpuMemoryError;
            this.residentFallbacks.set(input.key, { signature, allocationFailed });
            if (allocationFailed) hybridBudget = hybridTemporalBudget(hybridBudget, true);
            runtime.release(input.key);
            fallback = true;
          }
        }
      }
      if (!hybrid && !fallback) return this.native.resolve(input);
      if (!hybridContext) throw new Error('Hybrid graph context is unavailable.');
      this.hybrid ??= new HybridTemporalRuntime(this.device, this.onReady);
      const result = this.hybrid.resolve(input, hybridContext, hybridBudget);
      // Geometry must never combine a previously completed Hybrid image with
      // the new frame's numeric query. Export's existing barrier owns the wait.
      if (['time-surface', 'motion-band', 'motion-surface'].includes(String(effect.params.geometryMode)) && !this.hybrid.isCurrent(input.key)) {
        setTemporalStatus(effect.id, 'Preparing Slit Scan geometry and color…');
        return undefined;
      }
      if (fallback) setTemporalStatus(effect.id, 'GPU history · Hybrid streaming fallback · window exceeds available GPU memory');
      if (adaptive && !interactive && !this.hybrid.isCurrent(input.key)) {
        setTemporalStatus(effect.id, 'GPU history · adaptive preview · restoring full quality…');
        return fast;
      }
      return result;
    };
    try {
      // Validate before replacing the cache, so an unavailable track does not
      // evict the working, unstabilized history on every preview frame.
      if (request.stabilization) {
        slitScanSourceTransform(request.stabilization, temporalSourceTime(source, source.localTime));
        if (request.horizon > 0) for (const sample of sourceTemporalWindow(request, limit)) {
          slitScanSourceTransform(request.stabilization, sample.time);
        }
      }
      return resolve(request);
    }
    catch (error) {
      if (!(error instanceof SlitScanTrackingGap)) throw error;
      // One coordinate space for the whole window: never mix corrected and raw
      // frames. Preview and export use the same fallback for tracking gaps;
      // export still waits for every requested source frame in the collector.
      const history = resolve({ ...request, stabilization: undefined });
      setTemporalStatus(effect.id, `Stabilization paused: ${error.message} Slit Scan remains active.`);
      return history ? { ...history, current: currentInput ? { view: currentInput.view, identity: 'unstabilized-input' } : undefined } : undefined;
    }
  }

  finishImage(effectId: string, time: number, encoder: GPUCommandEncoder, view: GPUTextureView,
    width: number, height: number, previewKey?: string) {
    if (!isCollectingTemporalPreparations()) recordSlitScanPresentation(effectId, time);
    this.previewFrames.capture(previewKey, encoder, view, width, height);
    return view;
  }

  resolveNamed(resources: Map<string, ResolvedImageGraphExternalResource>, requested: readonly string[],
    effect: { id: string; params: Record<string, unknown> }, scopeId: string,
    time: number, masks: readonly ClipMask[] | undefined, width: number, height: number, encoder: GPUCommandEncoder,
    source?: TemporalClipSource, input?: { view: GPUTextureView; width: number; height: number }, descriptors: readonly ImageOperatorExternalResource[] = [],
    graph?: EffectOperatorGraph) {
    const key = JSON.stringify([scopeId, effect.id]);
    if (requested.includes(SLIT_SCAN_TIME_MAP_RESOURCE)) {
      const mediaId = effect.params.mapMediaId;
      let map: ResolvedImageGraphExternalResource | undefined;
      if (typeof mediaId === 'string' && mediaId && needsSlitScanTimeMedia(graph, effect.params)) {
        const media = useMediaStore.getState().files.find(file => file.id === mediaId);
        if (!media) {
          setTemporalStatus(effect.id, 'Time map asset is missing. Select an available image or video.');
          throw new Error('Time map asset is missing.');
        }
        const sourceMedia = source && useMediaStore.getState().files.find(file => file.id === source.mediaId);
        try {
          const aligned = alignedTimeMapTime(effect.params, time, media, source, sourceMedia);
          let transform: number[] | undefined;
          if (aligned.sourceTime !== undefined && source && sourceMedia) {
            const stabilization = slitScanStabilization(effect.params, useTrackingStore.getState().assets,
              source.mediaId, sourceMedia.width!, sourceMedia.height!);
            if (stabilization) {
              // A depth map must never remain stabilized when native history falls
              // back to raw frames because another sample is outside the track.
              const limit = ['hybrid', 'resident'].includes(String(effect.params.temporalStorage))
                ? hybridTemporalSampleLimit(sourceMedia.width, sourceMedia.height) : 256;
              const horizon = slitScanNumber(effect.params, 'delay') * slitScanNumber(effect.params, 'timeFactor');
              if (horizon > 0) for (const sample of sourceTemporalWindow({ source, horizon,
                samples: Math.max(2, Math.min(limit, Math.round(Number(effect.params.temporalSamples ?? 32)) || 32)) }, limit)) {
                slitScanSourceTransform(stabilization, sample.time);
              }
              transform = slitScanSourceTransform(stabilization, aligned.sourceTime);
            }
          }
          map = this.maps.resolve(key, effect.id, media, aligned.time, encoder, transform);
        } catch (error) {
          setTemporalStatus(effect.id, error instanceof Error ? error.message : String(error));
          throw error;
        }
        if (!map) return false;
      }
      resources.set(SLIT_SCAN_TIME_MAP_RESOURCE, map ?? this.masks.resolve('empty-map', '', undefined, width, height, encoder));
    }
    if (requested.includes(SLIT_SCAN_PROTECTION_RESOURCE)) {
      resources.set(SLIT_SCAN_PROTECTION_RESOURCE,
        this.masks.resolve(key, effect.params.protectionMask, masks, width, height, encoder));
    }
    if (requested.includes(SLIT_SCAN_TIME_MASK_RESOURCE)) {
      resources.set(SLIT_SCAN_TIME_MASK_RESOURCE,
        this.masks.resolveField(`${key}:time-mask`, effect.params.mapMaskId, masks, width, height, encoder));
      if (effect.params.mapSource === 'mask' && Number(effect.params.mapAmount ?? 0) > 0
        && !masks?.some(mask => mask.id === effect.params.mapMaskId)) {
        setTemporalStatus(effect.id, 'Time mask is missing. Using the scan profile.');
      }
    }
    if (!this.motionHistory && !descriptors.some(resource => resource.kind === 'source-motion')) return true;
    this.motionHistory ??= new SourceMotionHistory(this.device, this.onReady);
    return this.motionHistory.resolve(resources, descriptors, scopeId, effect, source, encoder, input);
  }

  destroy() { this.motionHistory?.destroy(); this.native.destroy(); this.hybrid?.destroy(); this.resident?.destroy(); this.interactiveResident?.destroy();
    this.previewFrames.destroy(); this.residentFallbacks.clear(); this.maps.destroy(); this.masks.destroy(); }
}
