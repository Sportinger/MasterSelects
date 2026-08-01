import type { RenderCommandTarget } from '../../engine/render/contracts/workerRenderGraph';
import {
  recordWorkerFirstCacheSnapshot,
  recordWorkerFirstSchedulerSnapshot,
  recordWorkerFirstTimingCounters,
} from '../aiTools/workerFirstCounterSources';
import { Logger } from '../logger';
import type { RenderHostSelectionTelemetry } from './renderHostSelection';
import type { RenderHostPort, RenderHostTelemetry } from './renderHostTypes';
import type { WorkerRenderHostRuntimeJobOutput } from './workerRenderHostRuntimeHandlers';
import {
  createBrowserWorkerRenderHostRuntimeBridge,
  type WorkerRenderHostRuntimeBridge,
} from './workerRenderHostRuntimeBridge';

const log = Logger.create('WorkerShadowRenderHostPort');

export interface WorkerShadowRenderHostPortOptions {
  readonly fallback: RenderHostPort;
  readonly getSelectionTelemetry: () => RenderHostSelectionTelemetry;
  readonly createBridge?: () => WorkerRenderHostRuntimeBridge;
}

class WorkerShadowRenderHostPortCore {
  private readonly fallback: RenderHostPort;
  private readonly getSelectionTelemetry: () => RenderHostSelectionTelemetry;
  private readonly createBridge: () => WorkerRenderHostRuntimeBridge;
  private bridge: WorkerRenderHostRuntimeBridge | null = null;
  private bridgeFailed = false;
  private requestSequence = 0;

  constructor(options: WorkerShadowRenderHostPortOptions) {
    this.fallback = options.fallback;
    this.getSelectionTelemetry = options.getSelectionTelemetry;
    this.createBridge = options.createBridge ?? createBrowserWorkerRenderHostRuntimeBridge;
  }

  getTelemetry(): RenderHostTelemetry {
    return {
      mode: 'worker-shadow',
      presentationStrategy: 'worker-cpu-present',
      lifecycleOwner: 'renderHostPort',
      statsOwner: 'renderHostPort',
      watchdogOwner: 'renderHostPort',
      selection: this.getSelectionTelemetry(),
    };
  }

  async initialize(): Promise<boolean> {
    const success = await this.fallback.initialize();
    if (success) {
      void this.withBridge((bridge) => bridge.initialize('worker-shadow-render-host', 'worker-cpu-present'));
    }
    return success;
  }

  registerTargetCanvas(targetId: string, canvas: HTMLCanvasElement): GPUCanvasContext | null {
    const context = this.fallback.registerTargetCanvas(targetId, canvas);
    this.sendRegisterTarget(targetId, canvas);
    return context;
  }

  unregisterTargetCanvas(targetId: string): void {
    this.fallback.unregisterTargetCanvas(targetId);
    void this.withBridge((bridge) => bridge.sendCommand({ type: 'unregisterTarget', targetId }));
  }

  renderToPreviewCanvas(
    canvasId: string,
    layers: Parameters<RenderHostPort['renderToPreviewCanvas']>[1],
    frameContext?: Parameters<RenderHostPort['renderToPreviewCanvas']>[2],
  ): void {
    this.sendRenderNow(canvasId, 'render-to-preview-canvas');
    this.fallback.renderToPreviewCanvas(canvasId, layers, frameContext);
  }

  requestRender(): void {
    this.sendRenderNow('preview', 'request-render');
    this.fallback.requestRender();
  }

  requestNewFrameRender(): void {
    this.sendRenderNow('preview', 'request-new-frame-render');
    this.fallback.requestNewFrameRender();
  }

  render(
    layers: Parameters<RenderHostPort['render']>[0],
    frameContext?: Parameters<RenderHostPort['render']>[1],
  ): void {
    this.sendRenderNow('preview', 'render');
    this.fallback.render(layers, frameContext);
  }

  private getBridge(): WorkerRenderHostRuntimeBridge | null {
    if (this.bridge) return this.bridge;
    if (this.bridgeFailed) return null;
    try {
      this.bridge = this.createBridge();
      return this.bridge;
    } catch (error) {
      this.bridgeFailed = true;
      log.warn('Worker render host runtime bridge unavailable', error);
      return null;
    }
  }

  private async withBridge(
    action: (bridge: WorkerRenderHostRuntimeBridge) => Promise<unknown>,
  ): Promise<void> {
    const bridge = this.getBridge();
    if (!bridge) return;
    try {
      this.recordRuntimeOutput(await action(bridge));
    } catch (error) {
      log.warn('Worker render host runtime command failed', error);
    }
  }

  private recordRuntimeOutput(output: unknown): void {
    if (!output || typeof output !== 'object') {
      return;
    }
    const result = output as Partial<WorkerRenderHostRuntimeJobOutput>;
    if (!result.scheduler || !result.cache) {
      return;
    }
    const capturedAt = Date.now();
    recordWorkerFirstSchedulerSnapshot(result.scheduler, capturedAt);
    recordWorkerFirstCacheSnapshot(result.cache, capturedAt);
    recordWorkerFirstTimingCounters({
      transferLatencyMs: result.transferLatencyMs ?? null,
      providerWaitMs: result.providerWaitMs ?? null,
      presentedFrameId: result.presentedFrameId ?? null,
    }, capturedAt);
  }

  private sendRegisterTarget(targetId: string, canvas: HTMLCanvasElement): void {
    const target: RenderCommandTarget = {
      id: targetId,
      compositionId: 'active',
      size: {
        x: canvas.width || canvas.clientWidth || 1,
        y: canvas.height || canvas.clientHeight || 1,
      },
      devicePixelRatio: globalThis.devicePixelRatio || 1,
      showTransparencyGrid: false,
      presentation: 'main-canvas',
    };
    void this.withBridge((bridge) => bridge.registerTarget(target));
  }

  private sendRenderNow(targetId: string, source: string): void {
    const requestId = `worker-shadow:${source}:${this.requestSequence++}`;
    void this.withBridge((bridge) => bridge.renderNow(requestId, targetId, 0));
  }
}

export function createWorkerShadowRenderHostPort(options: WorkerShadowRenderHostPortOptions): RenderHostPort {
  const core = new WorkerShadowRenderHostPortCore(options);
  const fallback = options.fallback;
  return new Proxy({} as RenderHostPort, {
    get(_target, propertyKey: keyof RenderHostPort) {
      const shadowValue = (core as unknown as Record<keyof RenderHostPort, unknown>)[propertyKey];
      if (typeof shadowValue === 'function') {
        return shadowValue.bind(core);
      }
      if (shadowValue !== undefined) {
        return shadowValue;
      }
      const fallbackValue = fallback[propertyKey];
      return typeof fallbackValue === 'function'
        ? fallbackValue.bind(fallback)
        : fallbackValue;
    },
  });
}
