import type {
  RenderCommandTarget,
  RenderDeadline,
  RenderGraphId,
} from '../../engine/render/contracts/workerRenderGraph';
import {
  RuntimeJobClient,
  type RuntimeWorkerTransport,
} from '../../runtime/worker';
import {
  WORKER_RENDER_HOST_COMMAND_HANDLER_ID,
  WORKER_RENDER_HOST_PROVIDER_ID,
  type WorkerRenderHostRuntimeJobInput,
  type WorkerRenderHostRuntimeJobOutput,
} from './workerRenderHostRuntimeHandlers';
import type {
  WorkerRenderHostGpuTransferredVideoFrameLayer,
  WorkerRenderHostRuntimeCommand,
  WorkerRenderHostRuntimeCapabilities,
  WorkerRenderHostWebCodecsSeekMode,
  WorkerRenderHostTargetSurfaceCommand,
  WorkerRenderSoftwareFrame,
} from './workerRenderHostRuntimeCommands';
import {
  collectWorkerGpuRuntimeCommandTransferables,
  type WorkerGpuPresentFrameStackCommand,
  type WorkerGpuWebCodecsFrameLayer,
} from './workerGpuRuntimeCommands';
import type { MotionAdjustmentWorkerGpuExecutionPlan } from '../motionDesign/adjustment/workerGpuAdjustmentPlan';

export interface WorkerRenderHostRuntimeBridgeOptions {
  readonly client: RuntimeJobClient;
  readonly now?: () => number;
}

export class WorkerRenderHostRuntimeBridge {
  private readonly client: RuntimeJobClient;
  private readonly now: () => number;

  constructor(options: WorkerRenderHostRuntimeBridgeOptions) {
    this.client = options.client;
    this.now = options.now ?? (() => Date.now());
  }

  initialize(rendererId: string, strategy: string): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({
      type: 'initialize',
      rendererId,
      strategy,
    });
  }

  registerTarget(target: RenderCommandTarget): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({ type: 'registerTarget', target });
  }

  attachTargetSurface(surface: WorkerRenderHostTargetSurfaceCommand): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({ type: 'attachTargetSurface', surface }, [surface.canvas]);
  }

  detachTargetSurface(targetId: RenderGraphId): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({ type: 'detachTargetSurface', targetId });
  }

  renderNow(
    requestId: string,
    targetId: RenderGraphId,
    timelineTime: number,
  ): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({ type: 'RenderNow', requestId, targetId, timelineTime });
  }

  renderDeadline(deadline: RenderDeadline): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({ type: 'RenderDeadline', deadline });
  }

  collectStats(requestId: string): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({ type: 'collectStats', requestId }, undefined, { priority: -10 });
  }

  probeCapabilities(requestId: string): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({ type: 'probeCapabilities', requestId });
  }

  loadWebCodecsSource(
    requestId: string,
    sourceId: string,
    buffer: ArrayBuffer,
    options: {
      readonly hardwareAcceleration?: HardwareAcceleration;
      readonly returnBitmap?: boolean;
    } = {},
  ): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({
      type: 'loadWebCodecsSource',
      requestId,
      sourceId,
      buffer,
      hardwareAcceleration: options.hardwareAcceleration,
      returnBitmap: options.returnBitmap,
    }, [buffer]);
  }

  readWebCodecsFrame(
    requestId: string,
    sourceId: string,
    timeSeconds: number,
    mode: WorkerRenderHostWebCodecsSeekMode,
    timeoutMs?: number,
  ): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({
      type: 'readWebCodecsFrame',
      requestId,
      sourceId,
      timeSeconds,
      mode,
      timeoutMs,
    });
  }

  disposeWebCodecsSource(requestId: string, sourceId: string): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({ type: 'disposeWebCodecsSource', requestId, sourceId });
  }

  presentSoftwareFrame(
    requestId: string,
    targetId: RenderGraphId,
    timelineTime: number,
    frame: WorkerRenderSoftwareFrame,
    transfer?: Transferable[],
    options: { readonly readback?: boolean } = {},
  ): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({
      type: 'presentSoftwareFrame',
      requestId,
      targetId,
      timelineTime,
      frame,
      readback: options.readback,
    }, transfer);
  }

  presentGpuTestPattern(
    requestId: string,
    targetId: RenderGraphId,
    timelineTime: number,
    frameIndex: number,
  ): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({
      type: 'gpu.presentTestPattern',
      commandId: requestId,
      targetId,
      timelineTime,
      frameIndex,
      pattern: {
        kind: 'frame-index-gradient',
        frameIndex,
        firstColor: { r: 0.02, g: 0.08, b: 0.24, a: 1 },
        secondColor: { r: 0.12, g: 0.84, b: 0.48, a: 1 },
      },
    });
  }

  presentGpuWebCodecsFrame(
    requestId: string,
    targetId: RenderGraphId,
    sourceId: string,
    timelineTime: number,
    mediaTime: number,
    frameIndex: number,
    options: {
      readonly mode?: 'seek' | 'scrub' | 'fast' | 'advance' | 'reverse';
      readonly timeoutMs?: number;
      readonly layers?: readonly WorkerGpuWebCodecsFrameLayer[];
      readonly adjustmentPlan?: MotionAdjustmentWorkerGpuExecutionPlan;
      readonly compositionId?: string;
    } = {},
  ): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({
      type: 'gpu.presentWebCodecsFrame',
      commandId: requestId,
      targetId,
      compositionId: options.compositionId,
      sourceId,
      timelineTime,
      mediaTime,
      frameIndex,
      mode: options.mode ?? 'advance',
      timeoutMs: options.timeoutMs,
      layers: options.layers,
      adjustmentPlan: options.adjustmentPlan,
    }, undefined, { priority: 20 });
  }

  presentGpuFrameStack(
    command: WorkerGpuPresentFrameStackCommand,
  ): Promise<WorkerRenderHostRuntimeJobOutput> {
    const transfer = collectWorkerGpuRuntimeCommandTransferables(command);
    return this.sendCommand(command, [...transfer], { priority: 20 });
  }

  startGpuWebCodecsStream(
    requestId: string,
    targetId: RenderGraphId,
    sourceId: string,
    timelineTime: number,
    mediaTime: number,
    frameIndex: number,
    options: {
      readonly playbackRate?: number;
      readonly targetFps?: number;
      readonly timeoutMs?: number;
      readonly layers?: readonly WorkerGpuWebCodecsFrameLayer[];
      readonly adjustmentPlan?: MotionAdjustmentWorkerGpuExecutionPlan;
      readonly compositionId?: string;
    } = {},
  ): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({
      type: 'gpu.startWebCodecsStream',
      commandId: requestId,
      targetId,
      compositionId: options.compositionId,
      sourceId,
      timelineTime,
      mediaTime,
      frameIndex,
      playbackRate: options.playbackRate ?? 1,
      targetFps: options.targetFps ?? 60,
      timeoutMs: options.timeoutMs,
      layers: options.layers,
      adjustmentPlan: options.adjustmentPlan,
    }, undefined, { priority: 30 });
  }

  stopGpuWebCodecsStream(
    requestId: string,
    targetId: RenderGraphId,
    options: {
      readonly sourceId?: string;
      readonly reason?: string;
    } = {},
  ): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({
      type: 'gpu.stopWebCodecsStream',
      commandId: requestId,
      targetId,
      sourceId: options.sourceId,
      reason: options.reason ?? 'host stopped stream',
    }, undefined, { priority: 40 });
  }

  presentGpuTransferredVideoFrames(
    requestId: string,
    targetId: RenderGraphId,
    timelineTime: number,
    frameIndex: number,
    layers: readonly WorkerRenderHostGpuTransferredVideoFrameLayer[],
    transfer: Transferable[],
    adjustmentPlan?: MotionAdjustmentWorkerGpuExecutionPlan,
    compositionId?: string,
  ): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({
      type: 'presentGpuTransferredVideoFrames',
      requestId,
      targetId,
      compositionId,
      timelineTime,
      frameIndex,
      layers,
      adjustmentPlan,
    }, transfer, { priority: 20 });
  }

  disposeRenderer(reason: string): Promise<WorkerRenderHostRuntimeJobOutput> {
    return this.sendCommand({ type: 'dispose', reason });
  }

  sendCommand(
    command: WorkerRenderHostRuntimeCommand,
    transfer?: Transferable[],
    options: { readonly priority?: number } = {},
  ): Promise<WorkerRenderHostRuntimeJobOutput> {
    const sentAtMs = this.now();
    const handle = this.client.runJob<WorkerRenderHostRuntimeJobInput, WorkerRenderHostRuntimeJobOutput>({
      providerId: WORKER_RENDER_HOST_PROVIDER_ID,
      handlerId: WORKER_RENDER_HOST_COMMAND_HANDLER_ID,
      input: {
        command,
        sentAtMs,
        nowMs: this.now(),
      },
      priority: options.priority,
    }, transfer ? { transfer } : undefined);
    return handle.promise.then((result) => result.output);
  }

  dispose(): void {
    this.client.dispose();
  }
}

export function createBrowserWorkerRenderHostRuntimeBridge(): WorkerRenderHostRuntimeBridge {
  if (!isBrowserWorkerRenderHostRuntimeSupported()) {
    throw new Error('Worker render host runtime requires browser Worker support');
  }
  const worker = new Worker(new URL('../../workers/runtimeHost.worker.ts', import.meta.url), {
    type: 'module',
    name: 'masterselects-render-host-runtime',
  });
  return new WorkerRenderHostRuntimeBridge({
    client: new RuntimeJobClient(worker as RuntimeWorkerTransport),
  });
}

export function isBrowserWorkerRenderHostRuntimeSupported(): boolean {
  return typeof Worker !== 'undefined';
}

export type { WorkerRenderHostRuntimeCapabilities };
