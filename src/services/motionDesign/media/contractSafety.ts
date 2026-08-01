import { MOTION_MEDIA_MAX_JSON_DEPTH } from './contracts';

const FORBIDDEN_RUNTIME_FIELDS = new Set([
  'runtimeHandle',
  'decoderHandle',
  'textureHandle',
  'fileHandle',
  'videoFrame',
  'gpuTexture',
  'canvas',
  'localPath',
  'blobUrl',
  'objectUrl',
]);

/** Descriptor-only, getter-free JSON admission used by every public MD5 boundary. */
export function assertMotionMediaInertJson(value: unknown): void {
  visit(value, 1, new WeakSet<object>());
}

function visit(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): void {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Motion media contracts require finite JSON numbers');
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new Error('Motion media contracts require inert JSON data only');
  }
  if (depth > MOTION_MEDIA_MAX_JSON_DEPTH) {
    throw new Error('Motion media contract JSON depth exceeds its hard budget');
  }
  if (ancestors.has(value)) {
    throw new Error('Motion media contracts cannot contain cycles');
  }

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    throw new Error('Motion media contracts require plain JSON containers');
  }

  ancestors.add(value);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    throw new Error('Motion media contracts cannot contain symbol fields');
  }
  if (isArray) {
    const array = value as unknown[];
    const dataKeys = ownKeys.filter((key) => key !== 'length');
    if (
      dataKeys.length !== array.length
      || dataKeys.some((key, index) => key !== String(index))
    ) {
      throw new Error('Motion media contracts require dense JSON arrays');
    }
  }

  for (const key of ownKeys) {
    if (isArray && key === 'length') continue;
    if (typeof key === 'string' && FORBIDDEN_RUNTIME_FIELDS.has(key)) {
      throw new Error(`Motion media runtime field is forbidden: ${key}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor
      || !('value' in descriptor)
      || descriptor.enumerable !== true
    ) {
      throw new Error('Motion media contract accessors/non-data fields are forbidden');
    }
    visit(descriptor.value, depth + 1, ancestors);
  }
  ancestors.delete(value);
}
