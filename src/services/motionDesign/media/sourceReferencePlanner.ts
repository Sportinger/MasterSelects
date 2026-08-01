import {
  MOTION_MEDIA_MAX_SOURCE_DURATION_SECONDS,
  MOTION_MEDIA_MAX_SOURCE_ID_LENGTH,
  type MotionMediaSourceBinding,
  type MotionMediaSourceKind,
  type MotionMediaSourceReference,
} from './contracts';
import { assertMotionMediaInertJson } from './contractSafety';

const SOURCE_ID_PREFIX = 'motion-media-source/v1';
const STABLE_ASSET_ID_MAX_LENGTH = 256;
const STABLE_ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/u;

export function createMotionMediaSourceReference(
  kind: MotionMediaSourceKind,
  stableAssetId: string,
  durationSeconds: number | null,
): MotionMediaSourceReference {
  if (!isSourceKind(kind) || !isStableAssetId(stableAssetId)) {
    throw new Error('Motion media sources require a stable opaque asset id');
  }
  const reference: MotionMediaSourceReference = {
    kind,
    sourceId: `${SOURCE_ID_PREFIX}:${kind}:${encodeURIComponent(stableAssetId)}`,
    durationSeconds,
  };
  assertMotionMediaSourceReference(reference);
  return reference;
}

export function createAvailableMotionMediaBinding(
  intent: MotionMediaSourceReference,
  bindingRevision: string,
): MotionMediaSourceBinding {
  assertMotionMediaSourceReference(intent);
  assertMotionMediaBindingRevision(bindingRevision);
  return {
    intent: { ...intent },
    availability: { state: 'available', bindingRevision },
  };
}

export function markMotionMediaSourceMissing(
  binding: MotionMediaSourceBinding,
  reason: 'not-found' | 'offline' | 'permission-denied',
): MotionMediaSourceBinding {
  assertMotionMediaSourceBinding(binding);
  const lastBindingRevision = binding.availability.state === 'missing'
    ? binding.availability.lastBindingRevision
    : binding.availability.bindingRevision;
  return {
    intent: { ...binding.intent },
    availability: { state: 'missing', reason, lastBindingRevision },
  };
}

export function relinkMotionMediaSource(
  binding: MotionMediaSourceBinding,
  replacement: {
    kind: MotionMediaSourceKind;
    sourceId: string;
    bindingRevision: string;
  },
): MotionMediaSourceBinding {
  assertMotionMediaSourceBinding(binding);
  assertMotionMediaInertJson(replacement);
  if (
    !isPlainRecord(replacement)
    || !hasExactKeys(replacement, ['kind', 'sourceId', 'bindingRevision'])
  ) {
    throw new Error('Invalid motion media relink replacement');
  }
  assertMotionMediaBindingRevision(replacement.bindingRevision);
  if (
    replacement.kind !== binding.intent.kind
    || replacement.sourceId !== binding.intent.sourceId
  ) {
    throw new Error('Relink must preserve the original source id and source kind');
  }
  const relinkedFromRevision = binding.availability.state === 'missing'
    ? binding.availability.lastBindingRevision
    : binding.availability.bindingRevision;
  const priorRevisions = binding.availability.state === 'relinked'
    ? [binding.availability.bindingRevision, binding.availability.relinkedFromRevision]
    : [relinkedFromRevision];
  if (priorRevisions.includes(replacement.bindingRevision)) {
    throw new Error('Relink must advance to a new binding revision');
  }
  return {
    intent: { ...binding.intent },
    availability: {
      state: 'relinked',
      bindingRevision: replacement.bindingRevision,
      relinkedFromRevision,
    },
  };
}

export function assertMotionMediaSourceBinding(
  value: unknown,
): asserts value is MotionMediaSourceBinding {
  assertMotionMediaInertJson(value);
  if (!isPlainRecord(value) || !hasExactKeys(value, ['intent', 'availability'])) {
    throw new Error('Invalid motion media source binding');
  }
  assertMotionMediaSourceReference(value.intent);
  const availability = value.availability;
  if (!isPlainRecord(availability) || typeof availability.state !== 'string') {
    throw new Error('Invalid motion media source availability');
  }
  if (availability.state === 'available') {
    if (!hasExactKeys(availability, ['state', 'bindingRevision'])) {
      throw new Error('Invalid available motion media binding');
    }
    assertMotionMediaBindingRevision(availability.bindingRevision);
    return;
  }
  if (availability.state === 'missing') {
    if (
      !hasExactKeys(availability, ['state', 'reason', 'lastBindingRevision'])
      || !['not-found', 'offline', 'permission-denied'].includes(String(availability.reason))
    ) {
      throw new Error('Invalid missing motion media binding');
    }
    if (availability.lastBindingRevision !== null) {
      assertMotionMediaBindingRevision(availability.lastBindingRevision);
    }
    return;
  }
  if (availability.state === 'relinked') {
    if (
      !hasExactKeys(availability, [
        'state',
        'bindingRevision',
        'relinkedFromRevision',
      ])
    ) {
      throw new Error('Invalid relinked motion media binding');
    }
    assertMotionMediaBindingRevision(availability.bindingRevision);
    if (availability.relinkedFromRevision !== null) {
      assertMotionMediaBindingRevision(availability.relinkedFromRevision);
      if (availability.bindingRevision === availability.relinkedFromRevision) {
        throw new Error('Relinked motion media binding must change revision');
      }
    }
    return;
  }
  throw new Error('Unknown motion media source availability state');
}

export function assertMotionMediaSourceReference(
  value: unknown,
): asserts value is MotionMediaSourceReference {
  assertMotionMediaInertJson(value);
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ['kind', 'sourceId', 'durationSeconds'])
    || !isSourceKind(value.kind)
    || !isCanonicalSourceId(value.sourceId, value.kind)
  ) {
    throw new Error('Invalid motion media source reference');
  }
  if (value.kind === 'image') {
    if (value.durationSeconds !== null) {
      throw new Error('Image sources must use a null duration');
    }
    return;
  }
  if (
    !isFiniteNumber(value.durationSeconds)
    || value.durationSeconds <= 0
    || value.durationSeconds > MOTION_MEDIA_MAX_SOURCE_DURATION_SECONDS
  ) {
    throw new Error('Temporal motion media source duration is out of bounds');
  }
}

export function assertMotionMediaSourceIdentity(
  sourceId: unknown,
  kind: unknown,
): asserts sourceId is string {
  if (!isSourceKind(kind) || !isCanonicalSourceId(sourceId, kind)) {
    throw new Error('Invalid motion media source identity');
  }
}

export function assertMotionMediaSourceId(
  sourceId: unknown,
): asserts sourceId is string {
  if (
    !isCanonicalSourceId(sourceId, 'image')
    && !isCanonicalSourceId(sourceId, 'video')
    && !isCanonicalSourceId(sourceId, 'nested-composition')
  ) {
    throw new Error('Invalid canonical motion media source id');
  }
}

function isCanonicalSourceId(
  value: unknown,
  kind: MotionMediaSourceKind,
): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOTION_MEDIA_MAX_SOURCE_ID_LENGTH
  ) {
    return false;
  }
  const prefix = `${SOURCE_ID_PREFIX}:${kind}:`;
  if (!value.startsWith(prefix)) return false;
  const encodedId = value.slice(prefix.length);
  if (!encodedId) return false;
  try {
    const decoded = decodeURIComponent(encodedId);
    return isStableAssetId(decoded) && encodeURIComponent(decoded) === encodedId;
  } catch {
    return false;
  }
}

function isStableAssetId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= STABLE_ASSET_ID_MAX_LENGTH
    && STABLE_ASSET_ID_PATTERN.test(value)
    && !/^[A-Za-z]:/u.test(value)
    && !/^file:/iu.test(value);
}

function isSourceKind(value: unknown): value is MotionMediaSourceKind {
  return value === 'image' || value === 'video' || value === 'nested-composition';
}

export function assertMotionMediaBindingRevision(
  value: unknown,
): asserts value is string {
  if (!isNonEmptyString(value) || value.length > 256) {
    throw new Error('Motion media binding revision must be a bounded string');
  }
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
  const actualKeys = Object.keys(value);
  const allowedKeys = new Set(keys);
  return actualKeys.length === allowedKeys.size
    && actualKeys.every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
