import {
  assertMotionAdjustmentWorkerGpuExecutionPlan,
  type MotionAdjustmentWorkerGpuExecutionPlan,
} from '../motionDesign/adjustment/workerGpuAdjustmentPlan';
import type { WorkerGpuWebCodecsFrameLayer } from './workerGpuRuntimeCommands';
import {
  isMotionAdjustmentSourceKind,
  type MotionAdjustmentSourceKind,
} from '../motionDesign/adjustment/sourceContracts';

export type WorkerGpuAdjustmentEnvelopeCommandType =
  | 'gpu.presentWebCodecsFrame'
  | 'gpu.startWebCodecsStream'
  | 'presentGpuTransferredVideoFrames'
  | 'gpu.presentFrameStack';

export type WorkerGpuAdjustmentEnvelopeDiagnosticCode =
  | 'MD7_ADJUSTMENT_STREAM_FORBIDDEN'
  | 'MD7_ADJUSTMENT_COMMAND_ENVELOPE_INVALID'
  | 'MD7_ADJUSTMENT_PLAN_INVALID'
  | 'MD7_ADJUSTMENT_EXACT_FRAME_REQUIRED'
  | 'MD7_ADJUSTMENT_REQUEST_ID_MISMATCH'
  | 'MD7_ADJUSTMENT_TARGET_ID_MISMATCH'
  | 'MD7_ADJUSTMENT_COMPOSITION_ID_MISMATCH'
  | 'MD7_ADJUSTMENT_FRAME_INDEX_MISMATCH'
  | 'MD7_ADJUSTMENT_TIMELINE_TIME_MISMATCH'
  | 'MD7_ADJUSTMENT_PLAN_EXPIRED'
  | 'MD7_ADJUSTMENT_PRIMARY_SOURCE_MISMATCH'
  | 'MD7_ADJUSTMENT_SOURCE_BINDING_COUNT_MISMATCH'
  | 'MD7_ADJUSTMENT_SOURCE_BINDING_MISSING'
  | 'MD7_ADJUSTMENT_SOURCE_BINDING_DUPLICATE'
  | 'MD7_ADJUSTMENT_SOURCE_ID_MISMATCH'
  | 'MD7_ADJUSTMENT_SOURCE_KIND_MISMATCH'
  | 'MD7_ADJUSTMENT_SOURCE_KIND_UNSUPPORTED';

export interface WorkerGpuAdjustmentEnvelopeDiagnostic {
  readonly code: WorkerGpuAdjustmentEnvelopeDiagnosticCode;
  readonly message: string;
}

export interface WorkerGpuAdjustmentEnvelopeInput {
  readonly commandType: WorkerGpuAdjustmentEnvelopeCommandType;
  readonly requestId: string;
  readonly targetId: string;
  readonly compositionId?: string;
  readonly timelineTime: number;
  readonly frameIndex: number;
  readonly nowMs: number;
  readonly primarySourceId?: string;
  /** Legacy video-only command bindings. */
  readonly layers?: readonly WorkerGpuWebCodecsFrameLayer[];
  /** Already validated generic frame-stack bindings. */
  readonly sourceBindings?: readonly WorkerGpuAdjustmentEnvelopeSourceBinding[];
  readonly adjustmentPlan: unknown;
}

export interface WorkerGpuAdjustmentEnvelopeSourceBinding {
  readonly layerId: string;
  readonly sourceKind: MotionAdjustmentSourceKind;
  readonly sourceId: string;
}

export type WorkerGpuAdjustmentEnvelopeValidation =
  | { readonly ok: true; readonly plan: MotionAdjustmentWorkerGpuExecutionPlan }
  | ({ readonly ok: false } & WorkerGpuAdjustmentEnvelopeDiagnostic);

const DIAGNOSTIC_MESSAGES = {
  MD7_ADJUSTMENT_STREAM_FORBIDDEN:
    'Autonomous Worker WebCodecs streams cannot carry a frozen adjustment plan',
  MD7_ADJUSTMENT_COMMAND_ENVELOPE_INVALID:
    'The Worker GPU adjustment command envelope is invalid',
  MD7_ADJUSTMENT_PLAN_INVALID:
    'The Worker GPU adjustment plan is invalid',
  MD7_ADJUSTMENT_EXACT_FRAME_REQUIRED:
    'The Worker GPU adjustment plan must require an exact frame',
  MD7_ADJUSTMENT_REQUEST_ID_MISMATCH:
    'The Worker GPU adjustment plan request does not match the command',
  MD7_ADJUSTMENT_TARGET_ID_MISMATCH:
    'The Worker GPU adjustment plan target does not match the command',
  MD7_ADJUSTMENT_COMPOSITION_ID_MISMATCH:
    'The Worker GPU adjustment plan composition does not match the command',
  MD7_ADJUSTMENT_FRAME_INDEX_MISMATCH:
    'The Worker GPU adjustment plan frame index does not match the command',
  MD7_ADJUSTMENT_TIMELINE_TIME_MISMATCH:
    'The Worker GPU adjustment plan timeline time does not match the command',
  MD7_ADJUSTMENT_PLAN_EXPIRED:
    'The Worker GPU adjustment plan expired before admission',
  MD7_ADJUSTMENT_PRIMARY_SOURCE_MISMATCH:
    'The Worker GPU adjustment primary source is not present in the command layers',
  MD7_ADJUSTMENT_SOURCE_BINDING_COUNT_MISMATCH:
    'The Worker GPU adjustment source binding count does not match the command layers',
  MD7_ADJUSTMENT_SOURCE_BINDING_MISSING:
    'A Worker GPU adjustment source layer binding is missing',
  MD7_ADJUSTMENT_SOURCE_BINDING_DUPLICATE:
    'A Worker GPU adjustment source layer binding is duplicated',
  MD7_ADJUSTMENT_SOURCE_ID_MISMATCH:
    'A Worker GPU adjustment source id does not match its command layer binding',
  MD7_ADJUSTMENT_SOURCE_KIND_MISMATCH:
    'A Worker GPU adjustment source kind does not match its frozen resolve pass',
  MD7_ADJUSTMENT_SOURCE_KIND_UNSUPPORTED:
    'A Worker GPU adjustment source kind cannot be bound to a presented video frame',
} as const satisfies Record<WorkerGpuAdjustmentEnvelopeDiagnosticCode, string>;

function reject(
  code: WorkerGpuAdjustmentEnvelopeDiagnosticCode,
): WorkerGpuAdjustmentEnvelopeValidation {
  return {
    ok: false,
    code,
    message: `[${code}] ${DIAGNOSTIC_MESSAGES[code]}`,
  };
}

function hasExactFrameFlag(value: unknown): value is {
  readonly frame: { readonly exact: unknown };
} {
  return typeof value === 'object'
    && value !== null
    && 'frame' in value
    && typeof value.frame === 'object'
    && value.frame !== null
    && 'exact' in value.frame;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCommandType(value: unknown): value is WorkerGpuAdjustmentEnvelopeCommandType {
  return value === 'gpu.presentWebCodecsFrame'
    || value === 'gpu.startWebCodecsStream'
    || value === 'presentGpuTransferredVideoFrames'
    || value === 'gpu.presentFrameStack';
}

function validateCommandEnvelope(
  input: unknown,
): WorkerGpuAdjustmentEnvelopeValidation | null {
  if (
    !isPlainRecord(input)
    || !isCommandType(input.commandType)
    || typeof input.requestId !== 'string'
    || input.requestId.length === 0
    || typeof input.targetId !== 'string'
    || input.targetId.length === 0
    || (input.compositionId !== undefined && typeof input.compositionId !== 'string')
    || !Number.isFinite(input.timelineTime)
    || !Number.isSafeInteger(input.frameIndex)
    || (input.frameIndex as number) < 0
    || !Number.isFinite(input.nowMs)
    || (input.primarySourceId !== undefined && typeof input.primarySourceId !== 'string')
    || (input.layers !== undefined && !Array.isArray(input.layers))
    || (input.sourceBindings !== undefined && !Array.isArray(input.sourceBindings))
    || (input.layers !== undefined && input.sourceBindings !== undefined)
    || !Object.prototype.hasOwnProperty.call(input, 'adjustmentPlan')
  ) {
    return reject('MD7_ADJUSTMENT_COMMAND_ENVELOPE_INVALID');
  }
  return null;
}

function validateSourceBindings(
  plan: MotionAdjustmentWorkerGpuExecutionPlan,
  input: WorkerGpuAdjustmentEnvelopeInput,
): WorkerGpuAdjustmentEnvelopeValidation | null {
  const resolvePasses = plan.passes.filter((pass) => pass.kind === 'resolve-source');
  const bindings: WorkerGpuAdjustmentEnvelopeSourceBinding[] = [];
  if (input.sourceBindings) {
    for (const binding of input.sourceBindings) {
      if (
        !isPlainRecord(binding)
        || typeof binding.layerId !== 'string'
        || !isMotionAdjustmentSourceKind(binding.sourceKind)
        || typeof binding.sourceId !== 'string'
      ) {
        return reject('MD7_ADJUSTMENT_COMMAND_ENVELOPE_INVALID');
      }
      bindings.push({
        layerId: binding.layerId,
        sourceKind: binding.sourceKind,
        sourceId: binding.sourceId,
      });
    }
  } else {
    for (const layer of input.layers ?? []) {
      if (
        !isPlainRecord(layer)
        || typeof layer.sourceId !== 'string'
        || (layer.sourceKind !== undefined && !isMotionAdjustmentSourceKind(layer.sourceKind))
        || (layer.renderLayer !== undefined && !isPlainRecord(layer.renderLayer))
      ) {
        return reject('MD7_ADJUSTMENT_COMMAND_ENVELOPE_INVALID');
      }
      const sourceKind = layer.sourceKind ?? 'timeline-media';
      if (sourceKind !== 'timeline-media' && sourceKind !== 'motion-media') {
        return reject('MD7_ADJUSTMENT_SOURCE_KIND_UNSUPPORTED');
      }
      const renderLayer = layer.renderLayer;
      const sourceClipId = renderLayer?.sourceClipId;
      const runtimeId = renderLayer?.id;
      if (
        (sourceClipId !== undefined && typeof sourceClipId !== 'string')
        || (runtimeId !== undefined && typeof runtimeId !== 'string')
      ) {
        return reject('MD7_ADJUSTMENT_COMMAND_ENVELOPE_INVALID');
      }
      bindings.push({
        layerId: sourceClipId ?? runtimeId ?? '',
        sourceKind,
        sourceId: layer.sourceId,
      });
    }
  }
  if (resolvePasses.length !== bindings.length) {
    return reject('MD7_ADJUSTMENT_SOURCE_BINDING_COUNT_MISMATCH');
  }

  if (
    input.primarySourceId !== undefined
    && !bindings.some((binding) => binding.sourceId === input.primarySourceId)
  ) {
    return reject('MD7_ADJUSTMENT_PRIMARY_SOURCE_MISMATCH');
  }

  const bindingsByLayerId = new Map<string, WorkerGpuAdjustmentEnvelopeSourceBinding>();
  for (const binding of bindings) {
    if (binding.layerId.length === 0) {
      return reject('MD7_ADJUSTMENT_SOURCE_BINDING_MISSING');
    }
    if (bindingsByLayerId.has(binding.layerId)) {
      return reject('MD7_ADJUSTMENT_SOURCE_BINDING_DUPLICATE');
    }
    bindingsByLayerId.set(binding.layerId, binding);
  }

  for (const pass of resolvePasses) {
    const binding = bindingsByLayerId.get(pass.layerId);
    if (!binding) {
      return reject('MD7_ADJUSTMENT_SOURCE_BINDING_MISSING');
    }
    if (binding.sourceKind !== pass.sourceKind) {
      return reject('MD7_ADJUSTMENT_SOURCE_KIND_MISMATCH');
    }
    if (binding.sourceId !== pass.sourceId) {
      return reject('MD7_ADJUSTMENT_SOURCE_ID_MISMATCH');
    }
  }
  return null;
}

/**
 * Admits an adjustment plan at the Worker boundary before decoder or GPU work.
 * The plan is usable only for the exact one-shot command and exact source
 * bindings that produced it.
 */
export function validateWorkerGpuAdjustmentEnvelope(
  value: unknown,
): WorkerGpuAdjustmentEnvelopeValidation {
  const invalidCommand = validateCommandEnvelope(value);
  if (invalidCommand) return invalidCommand;
  const input = value as WorkerGpuAdjustmentEnvelopeInput;
  if (input.commandType === 'gpu.startWebCodecsStream') {
    return reject('MD7_ADJUSTMENT_STREAM_FORBIDDEN');
  }

  if (
    hasExactFrameFlag(input.adjustmentPlan)
    && input.adjustmentPlan.frame.exact !== true
  ) {
    return reject('MD7_ADJUSTMENT_EXACT_FRAME_REQUIRED');
  }

  const plan = input.adjustmentPlan;
  try {
    assertMotionAdjustmentWorkerGpuExecutionPlan(plan);
  } catch {
    return reject('MD7_ADJUSTMENT_PLAN_INVALID');
  }

  if (plan.frame.exact !== true) {
    return reject('MD7_ADJUSTMENT_EXACT_FRAME_REQUIRED');
  }
  if (plan.frame.requestId !== input.requestId) {
    return reject('MD7_ADJUSTMENT_REQUEST_ID_MISMATCH');
  }
  if (plan.frame.targetId !== input.targetId) {
    return reject('MD7_ADJUSTMENT_TARGET_ID_MISMATCH');
  }
  if (plan.frame.compositionId !== input.compositionId) {
    return reject('MD7_ADJUSTMENT_COMPOSITION_ID_MISMATCH');
  }
  if (plan.frame.frameIndex !== input.frameIndex) {
    return reject('MD7_ADJUSTMENT_FRAME_INDEX_MISMATCH');
  }
  if (plan.frame.timelineTime !== input.timelineTime) {
    return reject('MD7_ADJUSTMENT_TIMELINE_TIME_MISMATCH');
  }
  if (input.nowMs >= plan.frame.expireAfterMs) {
    return reject('MD7_ADJUSTMENT_PLAN_EXPIRED');
  }

  const invalidBindings = validateSourceBindings(plan, input);
  if (invalidBindings) return invalidBindings;

  return { ok: true, plan };
}
