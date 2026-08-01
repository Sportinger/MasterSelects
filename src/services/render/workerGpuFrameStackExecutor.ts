import type { LayerRenderData } from '../../engine/core/types';
import type { Layer } from '../../types/layers';
import {
  assertWorkerGpuFrameStackContract,
  closeWorkerGpuFrameStackTransferables,
  type WorkerGpuFrameStackAdmission,
  type WorkerGpuFrameStackContractV1,
} from './workerGpuFrameStackContract';
import {
  createWorkerGpuFrameStackMaterializer,
  type WorkerGpuFrameStackMaterializer,
  type WorkerGpuFrameStackMaterializerResolvers,
} from './workerGpuFrameStackMaterializer';
import {
  encodeWorkerGpuAdjustmentPlan,
  type WorkerGpuAdjustmentExecutionResult,
  type WorkerGpuAdjustmentExecutorResources,
  type WorkerGpuAdjustmentSourceResolveRequest,
} from './workerGpuAdjustmentPlanExecutor';

export type WorkerGpuFrameStackExecutorDiagnosticCode =
  | 'MD7_FRAME_STACK_EXECUTOR_EXPIRED'
  | 'MD7_FRAME_STACK_EXECUTOR_CONTEXT_INVALID'
  | 'MD7_FRAME_STACK_EXECUTOR_SOURCE_CONSUMPTION_MISMATCH'
  | 'MD7_FRAME_STACK_EXECUTOR_ADJUSTMENT_TRACE_MISMATCH'
  | 'MD7_FRAME_STACK_EXECUTOR_FINAL_VIEW_INVALID'
  | 'MD7_FRAME_STACK_EXECUTOR_COMMAND_FINISH_FAILED'
  | 'MD7_FRAME_STACK_EXECUTOR_SUBMISSION_FAILED'
  | 'MD7_FRAME_STACK_EXECUTOR_AFTER_SUBMIT_FAILED'
  | 'MD7_FRAME_STACK_EXECUTOR_CLEANUP_FAILED'
  | 'MD7_FRAME_STACK_EXECUTOR_STATE_INVALID';

const DIAGNOSTIC_MESSAGES = {
  MD7_FRAME_STACK_EXECUTOR_EXPIRED: 'The Worker GPU frame stack expired before execution',
  MD7_FRAME_STACK_EXECUTOR_CONTEXT_INVALID: 'The recursive Worker GPU frame-stack context is invalid',
  MD7_FRAME_STACK_EXECUTOR_SOURCE_CONSUMPTION_MISMATCH: 'The Worker GPU frame stack did not consume every source exactly once',
  MD7_FRAME_STACK_EXECUTOR_ADJUSTMENT_TRACE_MISMATCH: 'The frozen Adjustment executor diverged from its exact pass plan',
  MD7_FRAME_STACK_EXECUTOR_FINAL_VIEW_INVALID: 'The Worker GPU frame-stack executor did not produce a final GPU view',
  MD7_FRAME_STACK_EXECUTOR_COMMAND_FINISH_FAILED: 'The Worker GPU frame-stack command encoder could not be finished',
  MD7_FRAME_STACK_EXECUTOR_SUBMISSION_FAILED: 'The Worker GPU frame-stack command buffer could not be submitted',
  MD7_FRAME_STACK_EXECUTOR_AFTER_SUBMIT_FAILED: 'The Worker GPU frame-stack after-submit fence or cleanup failed',
  MD7_FRAME_STACK_EXECUTOR_CLEANUP_FAILED: 'The Worker GPU frame-stack transient cleanup failed',
  MD7_FRAME_STACK_EXECUTOR_STATE_INVALID: 'The Worker GPU frame-stack submission lifecycle is already closed',
} as const satisfies Record<WorkerGpuFrameStackExecutorDiagnosticCode, string>;

export class WorkerGpuFrameStackExecutorError extends Error {
  readonly code: WorkerGpuFrameStackExecutorDiagnosticCode;
  readonly path: string;

  constructor(code: WorkerGpuFrameStackExecutorDiagnosticCode, path: string) {
    super(`[${code}] ${DIAGNOSTIC_MESSAGES[code]} at ${path}`);
    this.name = 'WorkerGpuFrameStackExecutorError';
    this.code = code;
    this.path = path;
  }
}

export interface WorkerGpuFrameStackExecutionTraceEntry {
  readonly sequence: number;
  readonly depth: number;
  readonly occurrenceNamespace: string;
  readonly stackPath: string;
  readonly event: 'enter-stack' | 'execute-pass' | 'leave-stack';
  readonly executionKind: WorkerGpuFrameStackContractV1['execution']['kind'];
  readonly passId?: string;
  readonly layerId?: string;
}

export interface WorkerGpuFrameStackExecutionSnapshot {
  readonly state: 'encoded' | 'finished' | 'submitted' | 'finalized' | 'disposed';
  readonly transientResourceCount: number;
}

export interface WorkerGpuFrameStackExecution {
  readonly finalView: GPUTextureView;
  readonly commandEncoder: GPUCommandEncoder;
  readonly trace: readonly WorkerGpuFrameStackExecutionTraceEntry[];
  readonly executedPassIds: readonly string[];
  readonly finish: () => GPUCommandBuffer;
  /** Finishes, submits, waits on exactly one queue fence, then releases all owned resources. */
  readonly submit: () => Promise<void>;
  /** Releases an encoded or finished execution that will not be submitted. */
  readonly dispose: () => void;
  readonly snapshot: () => WorkerGpuFrameStackExecutionSnapshot;
}

type WorkerGpuFrameStackSourceResolvers = Pick<
  WorkerGpuFrameStackMaterializerResolvers,
  'resolveWebCodecs' | 'renderMotion'
>;

export type WorkerGpuFrameStackAdjustmentEncoder = (input: {
  readonly plan: Extract<WorkerGpuFrameStackContractV1['execution'], {
    readonly kind: 'frozen-adjustment';
  }>['plan'];
  readonly device: GPUDevice;
  readonly commandEncoder: GPUCommandEncoder;
  readonly resources: WorkerGpuAdjustmentExecutorResources;
  readonly resolveSource: (
    request: WorkerGpuAdjustmentSourceResolveRequest,
  ) => {
    readonly layerId: string;
    readonly sourceId: string;
    readonly data: LayerRenderData;
  };
  readonly width: number;
  readonly height: number;
}) => WorkerGpuAdjustmentExecutionResult;

export interface WorkerGpuFrameStackExecutorDependencies {
  readonly encodeAdjustmentPlan?: WorkerGpuFrameStackAdjustmentEncoder;
}

export interface WorkerGpuFrameStackExecutorInput {
  readonly device: GPUDevice;
  readonly stack: WorkerGpuFrameStackContractV1;
  readonly admission: WorkerGpuFrameStackAdmission;
  /** Worker-owned monotonic clock re-read before every lazy/nested/frozen execution. */
  readonly clock: () => number;
  readonly resources: WorkerGpuAdjustmentExecutorResources;
  readonly sourceResolvers?: WorkerGpuFrameStackSourceResolvers;
  readonly dependencies?: WorkerGpuFrameStackExecutorDependencies;
  readonly commandEncoderLabel?: string;
}

interface MutableTraceEntry {
  sequence: number;
  depth: number;
  occurrenceNamespace: string;
  stackPath: string;
  event: WorkerGpuFrameStackExecutionTraceEntry['event'];
  executionKind: WorkerGpuFrameStackContractV1['execution']['kind'];
  passId?: string;
  layerId?: string;
}

interface ExecutionContext {
  readonly stack: WorkerGpuFrameStackContractV1;
  readonly stackPath: string;
  readonly depth: number;
}

interface RootLedger {
  readonly device: GPUDevice;
  readonly rootStack: WorkerGpuFrameStackContractV1;
  readonly commandEncoder: GPUCommandEncoder;
  readonly resources: WorkerGpuAdjustmentExecutorResources;
  readonly nowMs: () => number;
  readonly encodeAdjustmentPlan: WorkerGpuFrameStackAdjustmentEncoder;
  readonly transientResources: Array<{ destroy(): void }>;
  readonly transientResourceSet: Set<{ destroy(): void }>;
  readonly trace: MutableTraceEntry[];
  readonly executedPassIds: string[];
  materializer: WorkerGpuFrameStackMaterializer | null;
  activeContext: ExecutionContext | null;
}

function fail(
  code: WorkerGpuFrameStackExecutorDiagnosticCode,
  path: string,
): never {
  throw new WorkerGpuFrameStackExecutorError(code, path);
}

function registerTransientResource(
  ledger: RootLedger,
  resource: { destroy(): void },
): void {
  if (ledger.transientResourceSet.has(resource)) return;
  ledger.transientResourceSet.add(resource);
  ledger.transientResources.push(resource);
}

function destroyTransientResources(ledger: RootLedger): boolean {
  let failed = false;
  for (let index = ledger.transientResources.length - 1; index >= 0; index -= 1) {
    try {
      ledger.transientResources[index]?.destroy();
    } catch {
      failed = true;
    }
  }
  ledger.transientResources.length = 0;
  ledger.transientResourceSet.clear();
  return failed;
}

function cleanupImmediately(ledger: RootLedger): boolean {
  let failed = false;
  try {
    const disposal = ledger.materializer?.dispose();
    if (disposal) void disposal.catch(() => undefined);
  } catch {
    failed = true;
  }
  if (destroyTransientResources(ledger)) failed = true;
  return failed;
}

function addTrace(
  ledger: RootLedger,
  context: ExecutionContext,
  event: WorkerGpuFrameStackExecutionTraceEntry['event'],
  passId?: string,
  layerId?: string,
): void {
  ledger.trace.push({
    sequence: ledger.trace.length,
    depth: context.depth,
    occurrenceNamespace: context.stack.occurrenceNamespace,
    stackPath: context.stackPath,
    event,
    executionKind: context.stack.execution.kind,
    ...(passId ? { passId } : {}),
    ...(layerId ? { layerId } : {}),
  });
  if (event === 'execute-pass' && passId) ledger.executedPassIds.push(passId);
}

function orderedPassId(
  context: ExecutionContext,
  kind: 'resolve' | 'composite',
  index?: number,
  layerId?: string,
): string {
  return JSON.stringify([
    'worker-gpu-frame-stack-pass/v1',
    context.stack.occurrenceNamespace,
    'ordered-sources',
    kind,
    ...(index === undefined ? [] : [index, layerId]),
  ]);
}

function assertFresh(
  ledger: RootLedger,
  stack: WorkerGpuFrameStackContractV1,
  path: string,
): void {
  assertClockFresh(ledger.nowMs, stack, path);
}

function assertClockFresh(
  clock: () => number,
  stack: WorkerGpuFrameStackContractV1,
  path: string,
): void {
  let nowMs: number;
  try {
    nowMs = clock();
  } catch {
    return fail('MD7_FRAME_STACK_EXECUTOR_CONTEXT_INVALID', `${path}.clock`);
  }
  if (!Number.isFinite(nowMs)) {
    fail('MD7_FRAME_STACK_EXECUTOR_CONTEXT_INVALID', `${path}.clock`);
  }
  if (nowMs >= stack.frame.expireAfterMs) {
    fail('MD7_FRAME_STACK_EXECUTOR_EXPIRED', `${path}.frame.expireAfterMs`);
  }
}

function freezeResolvedLayer(layer: Layer): Layer {
  const effects = layer.effects.map((effect) => Object.freeze({
    ...effect,
    params: Object.freeze({ ...effect.params }),
  }));
  return Object.freeze({
    ...layer,
    source: layer.source ? Object.freeze({ ...layer.source }) : null,
    effects: Object.freeze(effects) as unknown as Layer['effects'],
    position: Object.freeze({ ...layer.position }),
    scale: Object.freeze({ ...layer.scale }),
    rotation: typeof layer.rotation === 'number'
      ? layer.rotation
      : Object.freeze({ ...layer.rotation }),
    sourceRect: layer.sourceRect ? Object.freeze({ ...layer.sourceRect }) : undefined,
    transitionRender: layer.transitionRender
      ? Object.freeze({ ...layer.transitionRender })
      : undefined,
  });
}

function freezeResolvedSource(
  context: ExecutionContext,
  request: WorkerGpuAdjustmentSourceResolveRequest,
  source: ReturnType<WorkerGpuFrameStackMaterializer['resolve']>,
): {
  readonly layerId: string;
  readonly sourceId: string;
  readonly data: LayerRenderData;
} {
  const binding = context.stack.bindings.find((entry) => entry.layerId === request.layerId);
  const innerLayerId = source.data.layer.sourceClipId ?? source.data.layer.id;
  if (
    !binding
    || innerLayerId !== request.layerId
    || source.data.layer.id !== binding.renderLayer.id
  ) {
    return fail(
      'MD7_FRAME_STACK_EXECUTOR_ADJUSTMENT_TRACE_MISMATCH',
      `${context.stackPath}.bindings.${request.layerId}.renderLayer`,
    );
  }
  const data = Object.freeze({
    ...source.data,
    layer: freezeResolvedLayer(source.data.layer),
  });
  return Object.freeze({
    layerId: source.layerId,
    sourceId: source.sourceId,
    data,
  });
}

function nestedStackPath(context: ExecutionContext, layerId: string): string {
  return `${context.stackPath}.nested[${JSON.stringify(layerId)}]`;
}

function assertNestedFreshAtResolve(
  ledger: RootLedger,
  context: ExecutionContext,
  layerId: string,
): void {
  const binding = context.stack.bindings.find((entry) => entry.layerId === layerId);
  if (binding?.payload.kind !== 'nested-stack') return;
  assertFresh(ledger, binding.payload.stack, nestedStackPath(context, layerId));
}

function createRenderTexture(
  ledger: RootLedger,
  stack: WorkerGpuFrameStackContractV1,
  kind: string,
): GPUTexture {
  const texture = ledger.device.createTexture({
    label: `worker-gpu-frame-stack:${stack.occurrenceNamespace}:${kind}`,
    size: stack.dimensions,
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_SRC
      | GPUTextureUsage.COPY_DST,
  });
  registerTransientResource(ledger, texture);
  return texture;
}

function encodeOrderedStack(
  ledger: RootLedger,
  context: ExecutionContext,
  materializer: WorkerGpuFrameStackMaterializer,
): GPUTextureView {
  const execution = context.stack.execution;
  if (execution.kind !== 'ordered-sources') {
    return fail('MD7_FRAME_STACK_EXECUTOR_CONTEXT_INVALID', context.stackPath);
  }
  const layers: LayerRenderData[] = [];
  execution.bottomToTopLayerIds.forEach((layerId, index) => {
    const passId = orderedPassId(context, 'resolve', index, layerId);
    addTrace(ledger, context, 'execute-pass', passId, layerId);
    assertNestedFreshAtResolve(ledger, context, layerId);
    layers.push(materializer.resolve(layerId, ledger.commandEncoder).data);
  });

  const pingTexture = createRenderTexture(ledger, context.stack, 'ordered-ping');
  const pongTexture = createRenderTexture(ledger, context.stack, 'ordered-pong');
  const effectTexture = createRenderTexture(ledger, context.stack, 'ordered-effect-a');
  const effectTexture2 = createRenderTexture(ledger, context.stack, 'ordered-effect-b');
  const pingView = pingTexture.createView();
  const pongView = pongTexture.createView();
  const effectView = effectTexture.createView();
  const effectView2 = effectTexture2.createView();

  ledger.resources.compositorPipeline.beginFrame();
  const result = ledger.resources.compositor.composite(layers, ledger.commandEncoder, {
    device: ledger.device,
    sampler: ledger.resources.sampler,
    pingView,
    pongView,
    outputWidth: context.stack.dimensions.width,
    outputHeight: context.stack.dimensions.height,
    effectTempTexture: effectTexture,
    effectTempView: effectView,
    effectTempTexture2: effectTexture2,
    effectTempView2: effectView2,
    motionTime: context.stack.frame.timelineTime,
    particleQuality: context.stack.frame.intent === 'export' ? 'export' : 'preview',
    resourceNamespace: context.stack.occurrenceNamespace,
  });
  const passId = orderedPassId(context, 'composite');
  addTrace(ledger, context, 'execute-pass', passId);
  if (!result.finalView) {
    return fail('MD7_FRAME_STACK_EXECUTOR_FINAL_VIEW_INVALID', context.stackPath);
  }
  return result.finalView;
}

function encodeFrozenStack(
  ledger: RootLedger,
  context: ExecutionContext,
  materializer: WorkerGpuFrameStackMaterializer,
): GPUTextureView {
  const execution = context.stack.execution;
  if (execution.kind !== 'frozen-adjustment') {
    return fail('MD7_FRAME_STACK_EXECUTOR_CONTEXT_INVALID', context.stackPath);
  }
  const planPasses = execution.plan.passes;
  const passIndexes = new Map(planPasses.map((pass, index) => [pass.passId, index]));
  let tracedThrough = -1;
  const traceThrough = (passId: string): void => {
    const targetIndex = passIndexes.get(passId);
    if (targetIndex === undefined || targetIndex <= tracedThrough) {
      fail('MD7_FRAME_STACK_EXECUTOR_ADJUSTMENT_TRACE_MISMATCH', context.stackPath);
    }
    for (let index = tracedThrough + 1; index <= targetIndex; index += 1) {
      const pass = planPasses[index];
      if (!pass) {
        fail('MD7_FRAME_STACK_EXECUTOR_ADJUSTMENT_TRACE_MISMATCH', context.stackPath);
      }
      addTrace(
        ledger,
        context,
        'execute-pass',
        pass.passId,
        'layerId' in pass ? pass.layerId : undefined,
      );
    }
    tracedThrough = targetIndex;
  };

  const result = ledger.encodeAdjustmentPlan({
    plan: execution.plan,
    device: ledger.device,
    commandEncoder: ledger.commandEncoder,
    resources: ledger.resources,
    resolveSource: (request) => {
      traceThrough(request.passId);
      assertNestedFreshAtResolve(ledger, context, request.layerId);
      const source = materializer.resolve(request.layerId, ledger.commandEncoder);
      if (source.sourceId !== request.sourceId || source.sourceKind !== request.sourceKind) {
        return fail(
          'MD7_FRAME_STACK_EXECUTOR_ADJUSTMENT_TRACE_MISMATCH',
          `${context.stackPath}.bindings.${request.layerId}`,
        );
      }
      return freezeResolvedSource(context, request, source);
    },
    width: context.stack.dimensions.width,
    height: context.stack.dimensions.height,
  });
  for (const resource of result.transientResources) {
    registerTransientResource(ledger, resource);
  }
  if (
    result.executedPassIds.length !== planPasses.length
    || result.executedPassIds.some((passId, index) => passId !== planPasses[index]?.passId)
  ) {
    return fail('MD7_FRAME_STACK_EXECUTOR_ADJUSTMENT_TRACE_MISMATCH', context.stackPath);
  }
  if (tracedThrough < planPasses.length - 1) {
    traceThrough(planPasses[planPasses.length - 1]?.passId ?? '');
  }
  if (!result.finalView) {
    return fail('MD7_FRAME_STACK_EXECUTOR_FINAL_VIEW_INVALID', context.stackPath);
  }
  return result.finalView;
}

function executeStack(
  ledger: RootLedger,
  stack: WorkerGpuFrameStackContractV1,
  materializer: WorkerGpuFrameStackMaterializer,
  stackPath: string,
  depth: number,
): GPUTextureView {
  const context: ExecutionContext = { stack, stackPath, depth };
  if (depth > 0 || stack.execution.kind === 'frozen-adjustment') {
    assertFresh(ledger, stack, stackPath);
  }
  const parentContext = ledger.activeContext;
  ledger.activeContext = context;
  addTrace(ledger, context, 'enter-stack');
  try {
    const finalView = stack.execution.kind === 'ordered-sources'
      ? encodeOrderedStack(ledger, context, materializer)
      : encodeFrozenStack(ledger, context, materializer);
    const consumedLayerIds = materializer.snapshot().consumedLayerIds;
    const consumedLayerIdSet = new Set(consumedLayerIds);
    if (
      consumedLayerIds.length !== stack.bindings.length
      || consumedLayerIdSet.size !== consumedLayerIds.length
      || stack.bindings.some((binding) => !consumedLayerIdSet.has(binding.layerId))
    ) {
      fail('MD7_FRAME_STACK_EXECUTOR_SOURCE_CONSUMPTION_MISMATCH', stackPath);
    }
    addTrace(ledger, context, 'leave-stack');
    return finalView;
  } finally {
    ledger.activeContext = parentContext;
  }
}

class EncodedWorkerGpuFrameStackExecution implements WorkerGpuFrameStackExecution {
  readonly finalView: GPUTextureView;
  readonly commandEncoder: GPUCommandEncoder;
  readonly trace: readonly WorkerGpuFrameStackExecutionTraceEntry[];
  readonly executedPassIds: readonly string[];
  private readonly ledger: RootLedger;
  private state: WorkerGpuFrameStackExecutionSnapshot['state'] = 'encoded';
  private commandBuffer: GPUCommandBuffer | null = null;
  private submissionPromise: Promise<void> | null = null;

  constructor(ledger: RootLedger, finalView: GPUTextureView) {
    this.ledger = ledger;
    this.finalView = finalView;
    this.commandEncoder = ledger.commandEncoder;
    this.trace = Object.freeze(ledger.trace.map((entry) => Object.freeze({ ...entry })));
    this.executedPassIds = Object.freeze([...ledger.executedPassIds]);
  }

  readonly finish = (): GPUCommandBuffer => {
    if (this.commandBuffer) return this.commandBuffer;
    if (this.state !== 'encoded') {
      return fail('MD7_FRAME_STACK_EXECUTOR_STATE_INVALID', '$.submission.finish');
    }
    try {
      this.commandBuffer = this.commandEncoder.finish();
      this.state = 'finished';
      return this.commandBuffer;
    } catch {
      cleanupImmediately(this.ledger);
      this.state = 'disposed';
      return fail('MD7_FRAME_STACK_EXECUTOR_COMMAND_FINISH_FAILED', '$.submission.finish');
    }
  };

  readonly submit = (): Promise<void> => {
    if (this.submissionPromise) return this.submissionPromise;
    if (this.state === 'submitted' || this.state === 'finalized' || this.state === 'disposed') {
      return Promise.reject(new WorkerGpuFrameStackExecutorError(
        'MD7_FRAME_STACK_EXECUTOR_STATE_INVALID',
        '$.submission.submit',
      ));
    }
    let commandBuffer: GPUCommandBuffer;
    try {
      commandBuffer = this.finish();
      assertFresh(this.ledger, this.ledger.rootStack, '$');
      this.ledger.device.queue.submit([commandBuffer]);
      this.state = 'submitted';
    } catch (error) {
      if (error instanceof WorkerGpuFrameStackExecutorError) {
        cleanupImmediately(this.ledger);
        this.state = 'disposed';
        return Promise.reject(error);
      }
      cleanupImmediately(this.ledger);
      this.state = 'disposed';
      return Promise.reject(new WorkerGpuFrameStackExecutorError(
        'MD7_FRAME_STACK_EXECUTOR_SUBMISSION_FAILED',
        '$.submission.submit',
      ));
    }
    this.submissionPromise = this.finalizeAfterSubmit();
    return this.submissionPromise;
  };

  readonly dispose = (): void => {
    if (this.state === 'disposed' || this.state === 'finalized') return;
    if (this.state === 'submitted') return;
    const failed = cleanupImmediately(this.ledger);
    this.state = 'disposed';
    if (failed) fail('MD7_FRAME_STACK_EXECUTOR_CLEANUP_FAILED', '$.submission.dispose');
  };

  readonly snapshot = (): WorkerGpuFrameStackExecutionSnapshot => ({
    state: this.state,
    transientResourceCount: this.ledger.transientResources.length,
  });

  private async finalizeAfterSubmit(): Promise<void> {
    let afterSubmitFailed = false;
    try {
      const fence = this.ledger.device.queue.onSubmittedWorkDone();
      await this.ledger.materializer?.markSubmitted(fence);
    } catch {
      afterSubmitFailed = true;
    }
    const cleanupFailed = destroyTransientResources(this.ledger);
    this.state = 'finalized';
    if (afterSubmitFailed) {
      fail('MD7_FRAME_STACK_EXECUTOR_AFTER_SUBMIT_FAILED', '$.submission.afterSubmittedWorkDone');
    }
    if (cleanupFailed) {
      fail('MD7_FRAME_STACK_EXECUTOR_CLEANUP_FAILED', '$.submission.afterSubmittedWorkDone');
    }
  }
}

export function encodeWorkerGpuFrameStack(
  input: WorkerGpuFrameStackExecutorInput,
): WorkerGpuFrameStackExecution {
  try {
    assertWorkerGpuFrameStackContract(input.stack, input.admission);
  } catch (error) {
    closeWorkerGpuFrameStackTransferables(input.stack);
    throw error;
  }
  let commandEncoder: GPUCommandEncoder;
  try {
    assertClockFresh(input.clock, input.stack, '$');
    commandEncoder = input.device.createCommandEncoder({
      label: input.commandEncoderLabel
        ?? `worker-gpu-frame-stack:${input.stack.occurrenceNamespace}`,
    });
  } catch (error) {
    closeWorkerGpuFrameStackTransferables(input.stack);
    throw error;
  }
  const ledger: RootLedger = {
    device: input.device,
    rootStack: input.stack,
    commandEncoder,
    resources: input.resources,
    nowMs: input.clock,
    encodeAdjustmentPlan: input.dependencies?.encodeAdjustmentPlan
      ?? encodeWorkerGpuAdjustmentPlan,
    transientResources: [],
    transientResourceSet: new Set(),
    trace: [],
    executedPassIds: [],
    materializer: null,
    activeContext: null,
  };
  try {
    const materializer = createWorkerGpuFrameStackMaterializer({
      device: input.device,
      stack: input.stack,
      admission: {
        requestId: input.admission.requestId,
        targetId: input.admission.targetId,
        intent: input.admission.intent,
        graphVersion: input.admission.graphVersion,
      },
      clock: ledger.nowMs,
      resolvers: {
        ...input.sourceResolvers,
        resolveNested: (resolverInput) => {
          const parentContext = ledger.activeContext;
          if (!parentContext) {
            return fail('MD7_FRAME_STACK_EXECUTOR_CONTEXT_INVALID', '$.nested');
          }
          return {
            layer: resolverInput.layer,
            isVideo: false,
            externalTexture: null,
            textureView: executeStack(
              ledger,
              resolverInput.payload.stack,
              resolverInput.childMaterializer,
              nestedStackPath(parentContext, resolverInput.binding.layerId),
              parentContext.depth + 1,
            ),
            sourceWidth: resolverInput.payload.stack.dimensions.width,
            sourceHeight: resolverInput.payload.stack.dimensions.height,
            previewPath: 'worker-gpu-frame-stack:nested',
          };
        },
      },
    });
    ledger.materializer = materializer;
    const finalView = executeStack(ledger, input.stack, materializer, '$', 0);
    return new EncodedWorkerGpuFrameStackExecution(ledger, finalView);
  } catch (error) {
    cleanupImmediately(ledger);
    throw error;
  }
}
