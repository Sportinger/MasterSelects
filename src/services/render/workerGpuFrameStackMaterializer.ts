import type { LayerRenderData } from '../../engine/core/types';
import type { Layer, LayerSource } from '../../types/layers';
import type {
  WorkerGpuFrameStackAdmission,
  WorkerGpuFrameStackContractV1,
  WorkerGpuFrameStackSourceBinding,
} from './workerGpuFrameStackContract';

export type WorkerGpuFrameStackMaterializerDiagnosticCode =
  | 'MD7_FRAME_STACK_MATERIALIZER_DUPLICATE_BINDING'
  | 'MD7_FRAME_STACK_MATERIALIZER_ADMISSION_MISMATCH'
  | 'MD7_FRAME_STACK_MATERIALIZER_FRAME_EXPIRED'
  | 'MD7_FRAME_STACK_MATERIALIZER_UNKNOWN_BINDING'
  | 'MD7_FRAME_STACK_MATERIALIZER_ORDER_MISMATCH'
  | 'MD7_FRAME_STACK_MATERIALIZER_SOURCE_CONSUMED'
  | 'MD7_FRAME_STACK_MATERIALIZER_FINALIZED'
  | 'MD7_FRAME_STACK_MATERIALIZER_BITMAP_INVALID'
  | 'MD7_FRAME_STACK_MATERIALIZER_BITMAP_UPLOAD_FAILED'
  | 'MD7_FRAME_STACK_MATERIALIZER_SOLID_COLOR_INVALID'
  | 'MD7_FRAME_STACK_MATERIALIZER_SOLID_UPLOAD_FAILED'
  | 'MD7_FRAME_STACK_MATERIALIZER_WEBCODECS_RESOLVER_MISSING'
  | 'MD7_FRAME_STACK_MATERIALIZER_WEBCODECS_RESOLVE_FAILED'
  | 'MD7_FRAME_STACK_MATERIALIZER_MOTION_RENDERER_MISSING'
  | 'MD7_FRAME_STACK_MATERIALIZER_MOTION_RENDER_FAILED'
  | 'MD7_FRAME_STACK_MATERIALIZER_NESTED_RESOLVER_MISSING'
  | 'MD7_FRAME_STACK_MATERIALIZER_NESTED_RESOLVE_FAILED'
  | 'MD7_FRAME_STACK_MATERIALIZER_RESOLVER_RESULT_INVALID'
  | 'MD7_FRAME_STACK_MATERIALIZER_RESOURCE_REGISTRATION_CLOSED'
  | 'MD7_FRAME_STACK_MATERIALIZER_SUBMISSION_FENCE_REQUIRED'
  | 'MD7_FRAME_STACK_MATERIALIZER_AFTER_SUBMIT_FAILED';

const DIAGNOSTIC_MESSAGES = {
  MD7_FRAME_STACK_MATERIALIZER_DUPLICATE_BINDING: 'The Worker GPU materializer received a duplicate layer binding',
  MD7_FRAME_STACK_MATERIALIZER_ADMISSION_MISMATCH: 'The Worker GPU materializer admission does not match the frozen frame',
  MD7_FRAME_STACK_MATERIALIZER_FRAME_EXPIRED: 'The Worker GPU materializer frame expired before lazy source resolution',
  MD7_FRAME_STACK_MATERIALIZER_UNKNOWN_BINDING: 'The Worker GPU materializer cannot resolve an unknown layer binding',
  MD7_FRAME_STACK_MATERIALIZER_ORDER_MISMATCH: 'The ordered Worker GPU frame stack was resolved outside bottom-to-top order',
  MD7_FRAME_STACK_MATERIALIZER_SOURCE_CONSUMED: 'The Worker GPU materializer source binding was already consumed',
  MD7_FRAME_STACK_MATERIALIZER_FINALIZED: 'The Worker GPU materializer is already finalized',
  MD7_FRAME_STACK_MATERIALIZER_BITMAP_INVALID: 'The Worker GPU materializer bitmap is detached or dimensionally invalid',
  MD7_FRAME_STACK_MATERIALIZER_BITMAP_UPLOAD_FAILED: 'The Worker GPU materializer could not upload the bitmap source',
  MD7_FRAME_STACK_MATERIALIZER_SOLID_COLOR_INVALID: 'The Worker GPU materializer solid color is not canonical hexadecimal RGBA',
  MD7_FRAME_STACK_MATERIALIZER_SOLID_UPLOAD_FAILED: 'The Worker GPU materializer could not upload the solid source',
  MD7_FRAME_STACK_MATERIALIZER_WEBCODECS_RESOLVER_MISSING: 'The Worker GPU materializer has no WebCodecs source resolver',
  MD7_FRAME_STACK_MATERIALIZER_WEBCODECS_RESOLVE_FAILED: 'The Worker GPU materializer could not resolve the WebCodecs source',
  MD7_FRAME_STACK_MATERIALIZER_MOTION_RENDERER_MISSING: 'The Worker GPU materializer has no Motion renderer',
  MD7_FRAME_STACK_MATERIALIZER_MOTION_RENDER_FAILED: 'The Worker GPU materializer could not render the Motion source',
  MD7_FRAME_STACK_MATERIALIZER_NESTED_RESOLVER_MISSING: 'The Worker GPU materializer has no recursive nested-stack resolver',
  MD7_FRAME_STACK_MATERIALIZER_NESTED_RESOLVE_FAILED: 'The Worker GPU materializer could not resolve the nested stack',
  MD7_FRAME_STACK_MATERIALIZER_RESOLVER_RESULT_INVALID: 'An injected Worker GPU source resolver returned invalid layer data',
  MD7_FRAME_STACK_MATERIALIZER_RESOURCE_REGISTRATION_CLOSED: 'Worker GPU resources cannot be registered after materializer finalization',
  MD7_FRAME_STACK_MATERIALIZER_SUBMISSION_FENCE_REQUIRED: 'The Worker GPU materializer requires an explicit post-submit fence',
  MD7_FRAME_STACK_MATERIALIZER_AFTER_SUBMIT_FAILED: 'Worker GPU after-submit cleanup failed',
} as const satisfies Record<WorkerGpuFrameStackMaterializerDiagnosticCode, string>;

export class WorkerGpuFrameStackMaterializerError extends Error {
  readonly code: WorkerGpuFrameStackMaterializerDiagnosticCode;
  readonly path: string;

  constructor(code: WorkerGpuFrameStackMaterializerDiagnosticCode, path: string) {
    super(`[${code}] ${DIAGNOSTIC_MESSAGES[code]} at ${path}`);
    this.name = 'WorkerGpuFrameStackMaterializerError';
    this.code = code;
    this.path = path;
  }
}

export interface WorkerGpuFrameStackMaterializationContext {
  readonly device: GPUDevice;
  readonly commandEncoder: GPUCommandEncoder;
  /** Register an owned transient immediately after allocation. */
  readonly registerTransientResource: (resource: { destroy(): void }) => void;
  /** Runs after the submitted fence, or immediately when the one-shot aborts before submit. */
  readonly registerAfterSubmitCleanup: (cleanup: () => void | Promise<void>) => void;
  /** Runs on normal finalization and on explicit early disposal. */
  readonly registerDisposeCleanup: (cleanup: () => void) => void;
}

interface WorkerGpuFrameStackInjectedResolverInput
  extends WorkerGpuFrameStackMaterializationContext {
  readonly binding: WorkerGpuFrameStackSourceBinding;
  readonly layer: Layer;
  readonly frameStack: WorkerGpuFrameStackContractV1;
}

export interface WorkerGpuFrameStackWebCodecsResolverInput
  extends WorkerGpuFrameStackInjectedResolverInput {
  readonly payload: Extract<WorkerGpuFrameStackSourceBinding['payload'], { kind: 'webcodecs' }>;
}

export interface WorkerGpuFrameStackMotionRendererInput
  extends WorkerGpuFrameStackInjectedResolverInput {
  readonly payload: Extract<WorkerGpuFrameStackSourceBinding['payload'], { kind: 'motion' }>;
}

export interface WorkerGpuFrameStackNestedResolverInput
  extends WorkerGpuFrameStackInjectedResolverInput {
  readonly payload: Extract<WorkerGpuFrameStackSourceBinding['payload'], { kind: 'nested-stack' }>;
  /** Shares the root one-shot ownership ledger with the parent materializer. */
  readonly childMaterializer: WorkerGpuFrameStackMaterializer;
}

export interface WorkerGpuFrameStackMaterializerResolvers {
  readonly resolveWebCodecs?: (
    input: WorkerGpuFrameStackWebCodecsResolverInput,
  ) => LayerRenderData;
  readonly renderMotion?: (
    input: WorkerGpuFrameStackMotionRendererInput,
  ) => LayerRenderData;
  readonly resolveNested?: (
    input: WorkerGpuFrameStackNestedResolverInput,
  ) => LayerRenderData;
}

export interface WorkerGpuFrameStackMaterializerInput {
  readonly device: GPUDevice;
  /** Must already have passed validateWorkerGpuFrameStackContract. */
  readonly stack: WorkerGpuFrameStackContractV1;
  /** Admission identity supplied by the Worker request envelope. */
  readonly admission: Omit<WorkerGpuFrameStackAdmission, 'nowMs'>;
  /** Worker-owned clock used at creation and before every lazy resolve. */
  readonly clock: () => number;
  readonly resolvers?: WorkerGpuFrameStackMaterializerResolvers;
}

export interface WorkerGpuFrameStackMaterializedSource {
  readonly layerId: string;
  readonly runtimeSourceKind: WorkerGpuFrameStackSourceBinding['runtimeSourceKind'];
  readonly sourceKind: WorkerGpuFrameStackSourceBinding['sourceKind'];
  readonly sourceId: string;
  readonly data: LayerRenderData;
}

export interface WorkerGpuFrameStackMaterializerSnapshot {
  readonly state: 'encoded' | 'submitted' | 'finalized' | 'disposed';
  readonly consumedLayerIds: readonly string[];
  readonly transientResourceCount: number;
  readonly openTransferredBitmapCount: number;
}

interface TransferredBitmapState {
  remainingUses: number;
  closed: boolean;
}

interface MaterializerLedger {
  state: WorkerGpuFrameStackMaterializerSnapshot['state'];
  readonly device: GPUDevice;
  readonly clock: () => number;
  readonly expireAfterMs: number;
  readonly transientResources: Array<{ destroy(): void }>;
  readonly transientResourceSet: Set<{ destroy(): void }>;
  readonly afterSubmitCleanups: Array<() => void | Promise<void>>;
  readonly disposeCleanups: Array<() => void>;
  readonly bitmapStates: Map<ImageBitmap, TransferredBitmapState>;
  finalizationPromise: Promise<void> | null;
}

function fail(
  code: WorkerGpuFrameStackMaterializerDiagnosticCode,
  path: string,
): never {
  throw new WorkerGpuFrameStackMaterializerError(code, path);
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function collectTransferredBitmaps(
  stack: WorkerGpuFrameStackContractV1,
  states: Map<ImageBitmap, TransferredBitmapState>,
): void {
  for (const binding of stack.bindings) {
    if (binding.payload.kind === 'bitmap') {
      const existing = states.get(binding.payload.bitmap);
      if (existing) existing.remainingUses += 1;
      else states.set(binding.payload.bitmap, { remainingUses: 1, closed: false });
    } else if (binding.payload.kind === 'nested-stack') {
      collectTransferredBitmaps(binding.payload.stack, states);
    }
  }
}

function closeBitmapOnce(bitmap: ImageBitmap, state: TransferredBitmapState): void {
  if (state.closed) return;
  state.closed = true;
  try {
    bitmap.close();
  } catch {
    // Ownership is consumed even if an already-detached browser handle throws.
  }
}

function consumeBitmapUse(ledger: MaterializerLedger, bitmap: ImageBitmap): void {
  const state = ledger.bitmapStates.get(bitmap);
  if (!state || state.closed) {
    fail('MD7_FRAME_STACK_MATERIALIZER_BITMAP_INVALID', '$.payload.bitmap');
  }
  state.remainingUses -= 1;
  if (state.remainingUses <= 0) closeBitmapOnce(bitmap, state);
}

function closeAllBitmaps(ledger: MaterializerLedger): void {
  for (const [bitmap, state] of ledger.bitmapStates) closeBitmapOnce(bitmap, state);
}

function destroyTransientResources(ledger: MaterializerLedger): boolean {
  let failed = false;
  const resources = ledger.transientResources.splice(0).reverse();
  ledger.transientResourceSet.clear();
  for (const resource of resources) {
    try {
      resource.destroy();
    } catch {
      failed = true;
    }
  }
  return failed;
}

function runDisposeCleanups(ledger: MaterializerLedger): boolean {
  let failed = false;
  const cleanups = ledger.disposeCleanups.splice(0).reverse();
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      failed = true;
    }
  }
  return failed;
}

function runAfterSubmitCleanups(ledger: MaterializerLedger): Promise<boolean> {
  const cleanups = ledger.afterSubmitCleanups.splice(0).reverse();
  const results = cleanups.map(async (cleanup) => {
    try {
      await cleanup();
      return false;
    } catch {
      return true;
    }
  });
  return Promise.all(results).then((failed) => failed.some(Boolean));
}

function assertLedgerEncoded(ledger: MaterializerLedger, path: string): void {
  if (ledger.state !== 'encoded') {
    fail('MD7_FRAME_STACK_MATERIALIZER_FINALIZED', path);
  }
}

function currentTime(ledger: MaterializerLedger, path: string): number {
  let nowMs: number;
  try {
    nowMs = ledger.clock();
  } catch {
    return fail('MD7_FRAME_STACK_MATERIALIZER_ADMISSION_MISMATCH', path);
  }
  if (!Number.isFinite(nowMs)) {
    fail('MD7_FRAME_STACK_MATERIALIZER_ADMISSION_MISMATCH', path);
  }
  return nowMs;
}

function assertFrameCurrent(ledger: MaterializerLedger, path: string): void {
  if (currentTime(ledger, path) >= ledger.expireAfterMs) {
    fail('MD7_FRAME_STACK_MATERIALIZER_FRAME_EXPIRED', path);
  }
}

function abortLedger(ledger: MaterializerLedger): Promise<void> {
  if (ledger.state === 'submitted' || ledger.state === 'finalized') {
    return ledger.finalizationPromise ?? Promise.resolve();
  }
  if (ledger.state === 'disposed') {
    return ledger.finalizationPromise ?? Promise.resolve();
  }

  ledger.state = 'disposed';
  const afterSubmitCleanups = runAfterSubmitCleanups(ledger);
  closeAllBitmaps(ledger);
  destroyTransientResources(ledger);
  runDisposeCleanups(ledger);
  const cleanupPromise = afterSubmitCleanups.then(() => undefined);
  ledger.finalizationPromise = cleanupPromise;
  return cleanupPromise;
}

function registerTransientResource(
  ledger: MaterializerLedger,
  resource: { destroy(): void },
): void {
  if (ledger.state !== 'encoded') {
    fail('MD7_FRAME_STACK_MATERIALIZER_RESOURCE_REGISTRATION_CLOSED', '$.resources');
  }
  if (ledger.transientResourceSet.has(resource)) return;
  ledger.transientResourceSet.add(resource);
  ledger.transientResources.push(resource);
}

function createSourceLayer(
  binding: WorkerGpuFrameStackSourceBinding,
  source: LayerSource,
): Layer {
  const renderLayer = binding.renderLayer;
  return {
    id: renderLayer.id,
    name: renderLayer.name,
    sourceClipId: renderLayer.sourceClipId,
    visible: renderLayer.visible,
    opacity: renderLayer.opacity,
    blendMode: renderLayer.blendMode,
    source: source.type === 'video' && renderLayer.videoRotation !== undefined
      ? { ...source, videoRotation: renderLayer.videoRotation }
      : source,
    effects: renderLayer.effects.map((effect) => ({
      ...effect,
      params: { ...effect.params },
    })),
    colorCorrection: renderLayer.colorCorrection,
    position: { ...renderLayer.position },
    scale: { ...renderLayer.scale },
    rotation: typeof renderLayer.rotation === 'number'
      ? renderLayer.rotation
      : { ...renderLayer.rotation },
    maskFeather: renderLayer.maskFeather,
    maskFeatherQuality: renderLayer.maskFeatherQuality,
    maskInvert: renderLayer.maskInvert,
    maskClipId: renderLayer.maskClipId,
    sourceRect: renderLayer.sourceRect ? { ...renderLayer.sourceRect } : undefined,
    transitionRender: renderLayer.transitionRender
      ? { ...renderLayer.transitionRender }
      : undefined,
  };
}

function sourceLayerForBinding(binding: WorkerGpuFrameStackSourceBinding): Layer {
  const payload = binding.payload;
  switch (payload.kind) {
    case 'webcodecs':
      return createSourceLayer(binding, { type: 'video', mediaTime: payload.mediaTime });
    case 'bitmap':
      return createSourceLayer(binding, {
        type: binding.runtimeSourceKind === 'text'
          ? 'text'
          : binding.runtimeSourceKind === 'video'
            ? 'video'
            : 'image',
        intrinsicWidth: payload.width,
        intrinsicHeight: payload.height,
      });
    case 'solid':
      return createSourceLayer(binding, {
        type: binding.runtimeSourceKind === 'color' ? 'color' : 'solid',
        color: payload.color,
        intrinsicWidth: payload.width,
        intrinsicHeight: payload.height,
      });
    case 'motion':
      return createSourceLayer(binding, {
        type: 'motion',
        motion: payload.definition,
        mediaTime: payload.timelineTime,
      });
    case 'nested-stack':
      return createSourceLayer(binding, {
        type: 'image',
        intrinsicWidth: payload.stack.dimensions.width,
        intrinsicHeight: payload.stack.dimensions.height,
        mediaTime: payload.stack.frame.timelineTime,
      });
  }
}

function parseCanonicalSolidColor(color: string): Uint8Array<ArrayBuffer> | null {
  const match = /^#([\da-f]{6}|[\da-f]{8})$/iu.exec(color);
  if (!match) return null;
  const value = match[1];
  const bytes = new Uint8Array(new ArrayBuffer(4));
  bytes.set([
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) : 255,
  ]);
  return bytes;
}

function validateInjectedResult(
  binding: WorkerGpuFrameStackSourceBinding,
  data: LayerRenderData,
  canonicalLayer: Layer,
  path: string,
): LayerRenderData {
  const layerId = data.layer.sourceClipId ?? data.layer.id;
  const expectsExternalVideo = binding.payload.kind === 'webcodecs';
  const dimensions = binding.payload.kind === 'nested-stack'
    ? binding.payload.stack.dimensions
    : binding.payload;
  if (
    data.layer.id !== binding.renderLayer.id
    || layerId !== binding.layerId
    || data.isVideo !== expectsExternalVideo
    || data.sourceWidth !== dimensions.width
    || data.sourceHeight !== dimensions.height
    || !isPositiveInteger(data.sourceWidth)
    || !isPositiveInteger(data.sourceHeight)
    || (expectsExternalVideo
      ? !data.externalTexture || data.textureView !== null
      : !data.textureView || data.externalTexture !== null)
  ) {
    fail('MD7_FRAME_STACK_MATERIALIZER_RESOLVER_RESULT_INVALID', path);
  }
  // Injected providers own only source pixels/handles. The frozen binding owns
  // transforms, effects, masks, opacity, and blend semantics, so never retain
  // a provider-supplied Layer object after identity admission.
  return { ...data, layer: canonicalLayer };
}

export class WorkerGpuFrameStackMaterializer {
  private readonly stack: WorkerGpuFrameStackContractV1;
  private readonly ledger: MaterializerLedger;
  private readonly resolvers: WorkerGpuFrameStackMaterializerResolvers;
  private readonly bindingsByLayerId = new Map<string, WorkerGpuFrameStackSourceBinding>();
  private readonly consumedLayerIds = new Set<string>();
  private readonly orderedLayerIds: readonly string[] | null;
  private nextOrderedLayerIndex = 0;

  private constructor(input: {
    readonly stack: WorkerGpuFrameStackContractV1;
    readonly ledger: MaterializerLedger;
    readonly resolvers: WorkerGpuFrameStackMaterializerResolvers;
  }) {
    this.stack = input.stack;
    this.ledger = input.ledger;
    this.resolvers = input.resolvers;
    this.orderedLayerIds = input.stack.execution.kind === 'ordered-sources'
      ? [...input.stack.execution.bottomToTopLayerIds]
      : null;
    for (let index = 0; index < input.stack.bindings.length; index += 1) {
      const binding = input.stack.bindings[index];
      if (this.bindingsByLayerId.has(binding.layerId)) {
        fail(
          'MD7_FRAME_STACK_MATERIALIZER_DUPLICATE_BINDING',
          `$.bindings[${index}].layerId`,
        );
      }
      this.bindingsByLayerId.set(binding.layerId, binding);
    }
  }

  static create(input: WorkerGpuFrameStackMaterializerInput): WorkerGpuFrameStackMaterializer {
    const bitmapStates = new Map<ImageBitmap, TransferredBitmapState>();
    collectTransferredBitmaps(input.stack, bitmapStates);
    const ledger: MaterializerLedger = {
      state: 'encoded',
      device: input.device,
      clock: input.clock,
      expireAfterMs: input.stack.frame.expireAfterMs,
      transientResources: [],
      transientResourceSet: new Set(),
      afterSubmitCleanups: [],
      disposeCleanups: [],
      bitmapStates,
      finalizationPromise: null,
    };
    try {
      const nowMs = currentTime(ledger, '$.admission');
      if (
        input.admission.requestId !== input.stack.frame.requestId
        || input.admission.targetId !== input.stack.frame.targetId
        || input.admission.intent !== input.stack.frame.intent
        || input.admission.graphVersion !== input.stack.frame.graphVersion
      ) {
        fail('MD7_FRAME_STACK_MATERIALIZER_ADMISSION_MISMATCH', '$.admission');
      }
      if (nowMs >= input.stack.frame.expireAfterMs) {
        fail('MD7_FRAME_STACK_MATERIALIZER_FRAME_EXPIRED', '$.frame.expireAfterMs');
      }
      return new WorkerGpuFrameStackMaterializer({
        stack: input.stack,
        ledger,
        resolvers: input.resolvers ?? {},
      });
    } catch (error) {
      void abortLedger(ledger);
      throw error;
    }
  }

  resolve(
    layerId: string,
    commandEncoder: GPUCommandEncoder,
  ): WorkerGpuFrameStackMaterializedSource {
    try {
      assertLedgerEncoded(this.ledger, '$');
      assertFrameCurrent(this.ledger, '$.frame.expireAfterMs');
      const binding = this.bindingsByLayerId.get(layerId);
      if (!binding) {
        fail('MD7_FRAME_STACK_MATERIALIZER_UNKNOWN_BINDING', `$.bindings.${layerId}`);
      }
      if (this.consumedLayerIds.has(layerId)) {
        fail('MD7_FRAME_STACK_MATERIALIZER_SOURCE_CONSUMED', `$.bindings.${layerId}`);
      }
      const expectedLayerId = this.orderedLayerIds?.[this.nextOrderedLayerIndex];
      if (this.orderedLayerIds && layerId !== expectedLayerId) {
        fail('MD7_FRAME_STACK_MATERIALIZER_ORDER_MISMATCH', `$.execution.bottomToTopLayerIds[${this.nextOrderedLayerIndex}]`);
      }
      this.consumedLayerIds.add(layerId);

      const data = this.materialize(binding, commandEncoder);
      if (this.orderedLayerIds) this.nextOrderedLayerIndex += 1;
      return {
        layerId: binding.layerId,
        runtimeSourceKind: binding.runtimeSourceKind,
        sourceKind: binding.sourceKind,
        sourceId: binding.sourceId,
        data,
      };
    } catch (error) {
      void abortLedger(this.ledger);
      throw error;
    }
  }

  snapshot(): WorkerGpuFrameStackMaterializerSnapshot {
    let openTransferredBitmapCount = 0;
    for (const state of this.ledger.bitmapStates.values()) {
      if (!state.closed) openTransferredBitmapCount += 1;
    }
    return {
      state: this.ledger.state,
      consumedLayerIds: [...this.consumedLayerIds],
      transientResourceCount: this.ledger.transientResources.length,
      openTransferredBitmapCount,
    };
  }

  markSubmitted(submissionFence: PromiseLike<unknown>): Promise<void> {
    if (!submissionFence || typeof submissionFence.then !== 'function') {
      fail('MD7_FRAME_STACK_MATERIALIZER_SUBMISSION_FENCE_REQUIRED', '$.submissionFence');
    }
    if (this.ledger.state === 'submitted' || this.ledger.state === 'finalized') {
      return this.ledger.finalizationPromise ?? Promise.resolve();
    }
    if (this.ledger.state !== 'encoded') {
      fail('MD7_FRAME_STACK_MATERIALIZER_FINALIZED', '$.submissionFence');
    }
    this.ledger.state = 'submitted';
    this.ledger.finalizationPromise = this.finalizeAfterSubmit(submissionFence);
    return this.ledger.finalizationPromise;
  }

  /** Compatibility alias; callers must provide the promise created after queue.submit(). */
  afterSubmittedWorkDone(submissionFence?: PromiseLike<unknown>): Promise<void> {
    if (!submissionFence) {
      fail('MD7_FRAME_STACK_MATERIALIZER_SUBMISSION_FENCE_REQUIRED', '$.submissionFence');
    }
    return this.markSubmitted(submissionFence);
  }

  dispose(): Promise<void> {
    if (this.ledger.state === 'submitted' || this.ledger.state === 'finalized') {
      return this.ledger.finalizationPromise ?? Promise.resolve();
    }
    return abortLedger(this.ledger);
  }

  private createChild(stack: WorkerGpuFrameStackContractV1): WorkerGpuFrameStackMaterializer {
    return new WorkerGpuFrameStackMaterializer({
      stack,
      ledger: this.ledger,
      resolvers: this.resolvers,
    });
  }

  private context(commandEncoder: GPUCommandEncoder): WorkerGpuFrameStackMaterializationContext {
    return {
      device: this.ledger.device,
      commandEncoder,
      registerTransientResource: (resource) => registerTransientResource(this.ledger, resource),
      registerAfterSubmitCleanup: (cleanup) => {
        assertLedgerEncoded(this.ledger, '$.afterSubmitCleanups');
        this.ledger.afterSubmitCleanups.push(cleanup);
      },
      registerDisposeCleanup: (cleanup) => {
        assertLedgerEncoded(this.ledger, '$.disposeCleanups');
        this.ledger.disposeCleanups.push(cleanup);
      },
    };
  }

  private materialize(
    binding: WorkerGpuFrameStackSourceBinding,
    commandEncoder: GPUCommandEncoder,
  ): LayerRenderData {
    const payload = binding.payload;
    const layer = sourceLayerForBinding(binding);
    switch (payload.kind) {
      case 'bitmap':
        return this.materializeBitmap(binding, layer, payload);
      case 'solid':
        return this.materializeSolid(binding, layer, payload);
      case 'webcodecs':
        return this.resolveInjected(
          binding,
          '$.payload.webcodecs',
          'MD7_FRAME_STACK_MATERIALIZER_WEBCODECS_RESOLVER_MISSING',
          'MD7_FRAME_STACK_MATERIALIZER_WEBCODECS_RESOLVE_FAILED',
          this.resolvers.resolveWebCodecs,
          { ...this.context(commandEncoder), binding, layer, payload, frameStack: this.stack },
        );
      case 'motion':
        return this.resolveInjected(
          binding,
          '$.payload.motion',
          'MD7_FRAME_STACK_MATERIALIZER_MOTION_RENDERER_MISSING',
          'MD7_FRAME_STACK_MATERIALIZER_MOTION_RENDER_FAILED',
          this.resolvers.renderMotion,
          { ...this.context(commandEncoder), binding, layer, payload, frameStack: this.stack },
        );
      case 'nested-stack':
        return this.resolveInjected(
          binding,
          '$.payload.nested-stack',
          'MD7_FRAME_STACK_MATERIALIZER_NESTED_RESOLVER_MISSING',
          'MD7_FRAME_STACK_MATERIALIZER_NESTED_RESOLVE_FAILED',
          this.resolvers.resolveNested,
          {
            ...this.context(commandEncoder),
            binding,
            layer,
            payload,
            frameStack: this.stack,
            childMaterializer: this.createChild(payload.stack),
          },
        );
    }
  }

  private materializeBitmap(
    binding: WorkerGpuFrameStackSourceBinding,
    layer: Layer,
    payload: Extract<WorkerGpuFrameStackSourceBinding['payload'], { kind: 'bitmap' }>,
  ): LayerRenderData {
    try {
      if (
        !isPositiveInteger(payload.width)
        || !isPositiveInteger(payload.height)
        || payload.bitmap.width !== payload.width
        || payload.bitmap.height !== payload.height
      ) {
        fail('MD7_FRAME_STACK_MATERIALIZER_BITMAP_INVALID', '$.payload.bitmap');
      }
      const texture = this.ledger.device.createTexture({
        label: `worker-gpu-frame-stack-bitmap:${binding.layerId}`,
        size: { width: payload.width, height: payload.height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      registerTransientResource(this.ledger, texture);
      this.ledger.device.queue.copyExternalImageToTexture(
        { source: payload.bitmap },
        { texture },
        { width: payload.width, height: payload.height },
      );
      return {
        layer,
        isVideo: false,
        isDynamic: true,
        externalTexture: null,
        textureView: texture.createView(),
        sourceWidth: payload.width,
        sourceHeight: payload.height,
        previewPath: 'worker-gpu-frame-stack:bitmap',
      };
    } catch (error) {
      if (error instanceof WorkerGpuFrameStackMaterializerError) throw error;
      fail('MD7_FRAME_STACK_MATERIALIZER_BITMAP_UPLOAD_FAILED', '$.payload.bitmap');
    } finally {
      consumeBitmapUse(this.ledger, payload.bitmap);
    }
  }

  private materializeSolid(
    binding: WorkerGpuFrameStackSourceBinding,
    layer: Layer,
    payload: Extract<WorkerGpuFrameStackSourceBinding['payload'], { kind: 'solid' }>,
  ): LayerRenderData {
    const color = parseCanonicalSolidColor(payload.color);
    if (!color) {
      fail('MD7_FRAME_STACK_MATERIALIZER_SOLID_COLOR_INVALID', '$.payload.solid.color');
    }
    try {
      const texture = this.ledger.device.createTexture({
        label: `worker-gpu-frame-stack-solid:${binding.layerId}`,
        size: { width: 1, height: 1 },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      registerTransientResource(this.ledger, texture);
      this.ledger.device.queue.writeTexture(
        { texture },
        color,
        { bytesPerRow: 4, rowsPerImage: 1 },
        { width: 1, height: 1 },
      );
      return {
        layer,
        isVideo: false,
        externalTexture: null,
        textureView: texture.createView(),
        sourceWidth: payload.width,
        sourceHeight: payload.height,
        previewPath: 'worker-gpu-frame-stack:solid',
      };
    } catch (error) {
      if (error instanceof WorkerGpuFrameStackMaterializerError) throw error;
      fail('MD7_FRAME_STACK_MATERIALIZER_SOLID_UPLOAD_FAILED', '$.payload.solid');
    }
  }

  private resolveInjected<TInput extends WorkerGpuFrameStackInjectedResolverInput>(
    binding: WorkerGpuFrameStackSourceBinding,
    path: string,
    missingCode: WorkerGpuFrameStackMaterializerDiagnosticCode,
    failureCode: WorkerGpuFrameStackMaterializerDiagnosticCode,
    resolver: ((input: TInput) => LayerRenderData) | undefined,
    input: TInput,
  ): LayerRenderData {
    if (!resolver) fail(missingCode, path);
    try {
      return validateInjectedResult(binding, resolver(input), input.layer, path);
    } catch (error) {
      if (error instanceof WorkerGpuFrameStackMaterializerError) throw error;
      fail(failureCode, path);
    }
  }

  private async finalizeAfterSubmit(submissionFence: PromiseLike<unknown>): Promise<void> {
    let failed = false;
    try {
      await submissionFence;
    } catch {
      failed = true;
    }
    if (await runAfterSubmitCleanups(this.ledger)) failed = true;
    closeAllBitmaps(this.ledger);
    if (destroyTransientResources(this.ledger)) failed = true;
    if (runDisposeCleanups(this.ledger)) failed = true;
    this.ledger.state = 'finalized';
    if (failed) {
      fail('MD7_FRAME_STACK_MATERIALIZER_AFTER_SUBMIT_FAILED', '$.afterSubmittedWorkDone');
    }
  }
}

export function createWorkerGpuFrameStackMaterializer(
  input: WorkerGpuFrameStackMaterializerInput,
): WorkerGpuFrameStackMaterializer {
  return WorkerGpuFrameStackMaterializer.create(input);
}
