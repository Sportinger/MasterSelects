import {
  MOTION_MEDIA_EVALUATION_VERSION,
  MOTION_MEDIA_MAX_ABSOLUTE_CLIP_LOCAL_TIME_SECONDS,
  MOTION_MEDIA_MAX_STABLE_INSTANCE_COUNT,
  MOTION_MEDIA_REQUEST_VERSION,
  type MotionMediaDiagnostic,
  type MotionMediaEvaluationRequest,
  type MotionMediaFrameEvaluation,
  type MotionMediaSourceKind,
} from './contracts';
import {
  assertMotionMediaSourceBinding,
  assertMotionMediaBindingRevision,
  assertMotionMediaSourceIdentity,
} from './sourceReferencePlanner';
import {
  assertMotionMediaRenderParameters,
  assertMotionMediaResolvedTime,
  buildMotionMediaReuseKey,
} from './reuseKeyPlanner';
import {
  assertMotionMediaTimingInputs,
  resolveMotionMediaSourceTime,
} from './timingPlanner';
import { assertMotionMediaInertJson } from './contractSafety';

export function evaluateMotionMediaFrame(
  request: MotionMediaEvaluationRequest,
): MotionMediaFrameEvaluation {
  assertMotionMediaEvaluationRequest(request);
  const base = {
    contractVersion: MOTION_MEDIA_EVALUATION_VERSION,
    sourceId: request.binding.intent.sourceId,
    sourceKind: request.binding.intent.kind,
    bindingRevision: request.binding.availability.state === 'missing'
      ? request.binding.availability.lastBindingRevision
      : request.binding.availability.bindingRevision,
    clipLocalTimeSeconds: request.clipLocalTimeSeconds,
    instanceIndex: request.instanceIndex,
    renderParameters: { ...request.renderParameters },
  };

  if (request.binding.availability.state === 'missing') {
    return {
      ...base,
      status: 'unavailable',
      resolvedTime: null,
      reuseKey: null,
      diagnostics: [createMissingSourceDiagnostic(request)],
    };
  }

  const resolvedTime = resolveMotionMediaSourceTime(
    request.binding.intent,
    request.timing,
    request.quantization,
    request.clipLocalTimeSeconds,
    request.instanceIndex,
  );
  return {
    ...base,
    status: 'ready',
    bindingRevision: request.binding.availability.bindingRevision,
    resolvedTime,
    reuseKey: buildMotionMediaReuseKey(
      request.binding.intent.sourceId,
      resolvedTime,
      request.renderParameters,
    ),
    diagnostics: [],
  };
}

export function serializeMotionMediaEvaluationRequest(
  request: MotionMediaEvaluationRequest,
): string {
  assertMotionMediaEvaluationRequest(request);
  return JSON.stringify(request);
}

export function parseMotionMediaEvaluationRequest(
  serialized: string,
): MotionMediaEvaluationRequest {
  const parsed = parseJson(serialized, 'request');
  assertMotionMediaEvaluationRequest(parsed);
  return parsed;
}

export function serializeMotionMediaFrameEvaluation(
  evaluation: MotionMediaFrameEvaluation,
): string {
  assertMotionMediaFrameEvaluation(evaluation);
  return JSON.stringify(evaluation);
}

export function parseMotionMediaFrameEvaluation(
  serialized: string,
): MotionMediaFrameEvaluation {
  const parsed = parseJson(serialized, 'evaluation');
  assertMotionMediaFrameEvaluation(parsed);
  return parsed;
}

export function assertMotionMediaEvaluationRequest(
  value: unknown,
): asserts value is MotionMediaEvaluationRequest {
  assertMotionMediaInertJson(value);
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, [
      'contractVersion',
      'binding',
      'clipLocalTimeSeconds',
      'instanceIndex',
      'timing',
      'quantization',
      'renderParameters',
    ])
    || value.contractVersion !== MOTION_MEDIA_REQUEST_VERSION
  ) {
    throw new Error('Invalid motion media evaluation request envelope');
  }
  assertMotionMediaSourceBinding(value.binding);
  assertMotionMediaRenderParameters(value.renderParameters);
  assertMotionMediaTimingInputs(
    value.binding.intent,
    value.timing as MotionMediaEvaluationRequest['timing'],
    value.quantization as MotionMediaEvaluationRequest['quantization'],
    value.clipLocalTimeSeconds as number,
    value.instanceIndex as number,
  );
}

export function assertMotionMediaFrameEvaluation(
  value: unknown,
): asserts value is MotionMediaFrameEvaluation {
  assertMotionMediaInertJson(value);
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, [
      'contractVersion',
      'sourceId',
      'sourceKind',
      'bindingRevision',
      'clipLocalTimeSeconds',
      'instanceIndex',
      'renderParameters',
      'status',
      'resolvedTime',
      'reuseKey',
      'diagnostics',
    ])
    || value.contractVersion !== MOTION_MEDIA_EVALUATION_VERSION
    || !isSourceKind(value.sourceKind)
  ) {
    throw new Error('Invalid motion media frame evaluation envelope');
  }
  assertMotionMediaSourceIdentity(value.sourceId, value.sourceKind);
  assertMotionMediaRenderParameters(value.renderParameters);
  if (
    !isFiniteNumber(value.clipLocalTimeSeconds)
    || Math.abs(value.clipLocalTimeSeconds)
      > MOTION_MEDIA_MAX_ABSOLUTE_CLIP_LOCAL_TIME_SECONDS
    || !Number.isInteger(value.instanceIndex)
    || Number(value.instanceIndex) < 0
    || Number(value.instanceIndex) >= MOTION_MEDIA_MAX_STABLE_INSTANCE_COUNT
  ) {
    throw new Error('Invalid evaluated clip-local time or instance index');
  }

  if (value.status === 'ready') {
    assertMotionMediaBindingRevision(value.bindingRevision);
    assertMotionMediaResolvedTime(value.resolvedTime);
    if (
      !isNonEmptyString(value.reuseKey)
      || !Array.isArray(value.diagnostics)
      || value.diagnostics.length !== 0
      || value.reuseKey !== buildMotionMediaReuseKey(
        value.sourceId,
        value.resolvedTime,
        value.renderParameters,
      )
    ) {
      throw new Error('Invalid ready motion media frame evaluation');
    }
    return;
  }

  if (
    value.status !== 'unavailable'
    || value.resolvedTime !== null
    || value.reuseKey !== null
    || !Array.isArray(value.diagnostics)
    || value.diagnostics.length !== 1
    || !isMissingDiagnostic(value.diagnostics[0], value.sourceId)
  ) {
    throw new Error('Invalid unavailable motion media frame evaluation');
  }
  if (value.bindingRevision !== null) {
    assertMotionMediaBindingRevision(value.bindingRevision);
  }
}

function createMissingSourceDiagnostic(
  request: MotionMediaEvaluationRequest,
): MotionMediaDiagnostic {
  return {
    code: 'SOURCE_MISSING',
    sourceId: request.binding.intent.sourceId,
    message: `Motion media source is unavailable (${request.binding.availability.state === 'missing'
      ? request.binding.availability.reason
      : 'unknown'})`,
  };
}

function isMissingDiagnostic(
  value: unknown,
  sourceId: string,
): value is MotionMediaDiagnostic {
  return isPlainRecord(value)
    && hasExactKeys(value, ['code', 'sourceId', 'message'])
    && value.code === 'SOURCE_MISSING'
    && value.sourceId === sourceId
    && isNonEmptyString(value.message);
}

function parseJson(serialized: string, label: string): unknown {
  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error(`Motion media ${label} is not valid JSON`);
  }
}

function isSourceKind(value: unknown): value is MotionMediaSourceKind {
  return value === 'image' || value === 'video' || value === 'nested-composition';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === allowed.size
    && actual.every((key) => allowed.has(key));
}
