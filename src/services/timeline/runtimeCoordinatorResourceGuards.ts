import type {
  RenderResourceDescriptor,
  TimelineRuntimeCoordinatorBridgeStats,
} from './runtimeCoordinatorTypes';
import { isRenderResourceKind, isTimelineRuntimePolicyId } from './runtimeCoordinatorPolicyCatalog';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRenderResourceDescriptor(value: unknown): value is RenderResourceDescriptor {
  if (!isObjectRecord(value)) {
    return false;
  }
  if (typeof value.id !== 'string' || !isRenderResourceKind(String(value.kind))) {
    return false;
  }
  if (!isTimelineRuntimePolicyId(String(value.policyId))) {
    return false;
  }
  if (!isObjectRecord(value.owner) || typeof value.owner.ownerId !== 'string') {
    return false;
  }

  switch (value.kind) {
    case 'video-frame-provider':
      return typeof value.providerId === 'string' && typeof value.providerKind === 'string';
    case 'html-media':
      return (
        typeof value.elementId === 'string' &&
        (value.mediaElementKind === 'video' || value.mediaElementKind === 'audio')
      );
    case 'image-canvas':
      return typeof value.imageId === 'string' && typeof value.imageKind === 'string';
    case 'native-decoder':
      return typeof value.decoderId === 'string';
    case 'nested-composition-texture':
      return (
        typeof value.compositionId === 'string' &&
        typeof value.textureId === 'string' &&
        typeof value.depth === 'number'
      );
    case 'gpu-texture':
      return typeof value.textureId === 'string' && typeof value.textureKind === 'string';
    case 'model':
      return typeof value.modelId === 'string' && typeof value.modelKind === 'string';
    case 'gaussian-splat':
      return typeof value.splatId === 'string';
    case 'motion-data':
      return typeof value.payloadId === 'string' && typeof value.payloadKind === 'string';
    case 'audio-source-clock':
      return typeof value.audioSourceId === 'string';
    case 'runtime-binding':
      return (
        isObjectRecord(value.runtime) &&
        typeof value.runtime.runtimeSourceId === 'string' &&
        typeof value.runtime.runtimeSessionKey === 'string'
      );
    case 'job':
      return typeof value.jobId === 'string' && typeof value.jobKind === 'string';
    default:
      return false;
  }
}

function isPlainDataValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null) return true;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') {
    return false;
  }
  if (typeof value !== 'object') {
    return true;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const isPlainArray = value.every((entry) => isPlainDataValue(entry, seen));
    seen.delete(value);
    return isPlainArray;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(value);
    return false;
  }

  const isPlainObject = Object.values(value).every((entry) => isPlainDataValue(entry, seen));
  seen.delete(value);
  return isPlainObject;
}

export function isPlainTimelineRuntimeBridgeStats(
  value: unknown
): value is TimelineRuntimeCoordinatorBridgeStats {
  if (!isObjectRecord(value)) {
    return false;
  }
  return value.schemaVersion === 1 && isPlainDataValue(value);
}
