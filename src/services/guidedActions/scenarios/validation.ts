import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types';
import type { GuidedTargetRef, ValidationCheck } from '../types';

type TimelineSnapshot = ReturnType<typeof useTimelineStore.getState>;
type MediaSnapshot = ReturnType<typeof useMediaStore.getState>;

export interface GuidedValidationResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

export interface GuidedValidationReaders {
  timeline?: () => TimelineSnapshot;
  media?: () => MediaSnapshot;
  activePropertiesTab?: () => string | null;
  targetResolved?: (target: GuidedTargetRef) => boolean;
}

interface GuidedValidationClock {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface GuidedValidationWaitOptions extends GuidedValidationReaders {
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  clock?: GuidedValidationClock;
}

const DEFAULT_VALUE_TOLERANCE = 0.001;
const DEFAULT_TIME_TOLERANCE_SECONDS = 0.01;
const DEFAULT_VALIDATION_TIMEOUT_MS = 10000;
const DEFAULT_VALIDATION_POLL_INTERVAL_MS = 100;
const DEFAULT_COMPOSITION_WIDTH = 1920;
const DEFAULT_COMPOSITION_HEIGHT = 1080;

const defaultClock: GuidedValidationClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};

export function validateGuidedCheck(
  check: ValidationCheck,
  readers: GuidedValidationReaders = {},
): GuidedValidationResult {
  switch (check.kind) {
    case 'targetResolved':
      return validateTargetResolved(check, readers);
    case 'clipSelected':
      return validateClipSelected(check, readers);
    case 'propertiesTabOpen':
      return validatePropertiesTabOpen(check, readers);
    case 'playheadAtTime':
      return validatePlayheadAtTime(check, readers);
    case 'clipTransformMatches':
      return validateClipTransformMatches(check, readers);
    case 'maskExists':
      return validateMaskExists(check, readers);
    case 'activeMask':
      return validateActiveMask(check, readers);
    case 'effectExists':
      return validateEffectExists(check, readers);
    case 'keyframeExists':
      return validateKeyframeExists(check, readers);
    case 'mediaItemImported':
      return validateMediaItemImported(check, readers);
    case 'custom':
      return pass({ kind: check.kind, id: check.id });
  }
}

export async function waitForGuidedValidation(
  check: ValidationCheck,
  options: GuidedValidationWaitOptions = {},
): Promise<GuidedValidationResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_VALIDATION_TIMEOUT_MS;
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? DEFAULT_VALIDATION_POLL_INTERVAL_MS);
  const clock = options.clock ?? defaultClock;
  const deadline = clock.now() + Math.max(0, timeoutMs);
  let lastResult = validateGuidedCheck(check, options);

  while (!lastResult.success) {
    throwIfValidationAborted(options.signal);

    if (timeoutMs <= 0 || clock.now() >= deadline) {
      return fail(check, lastResult.message ?? `Timed out waiting for ${check.kind}`, {
        timeoutMs,
      });
    }

    const remainingMs = Math.max(0, deadline - clock.now());
    await delay(Math.min(pollIntervalMs, remainingMs), options.signal, clock);
    lastResult = validateGuidedCheck(check, options);
  }

  return lastResult;
}

function validateTargetResolved(
  check: Extract<ValidationCheck, { kind: 'targetResolved' }>,
  readers: GuidedValidationReaders,
): GuidedValidationResult {
  if (!readers.targetResolved) {
    return fail(check, 'Target resolution validation requires a target reader');
  }

  return readers.targetResolved(check.target)
    ? pass({ kind: check.kind, target: check.target })
    : fail(check, 'Guided target is not resolved', { target: check.target });
}

function validateClipSelected(
  check: Extract<ValidationCheck, { kind: 'clipSelected' }>,
  readers: GuidedValidationReaders,
): GuidedValidationResult {
  const timeline = getTimeline(readers);
  if (!check.clipId) {
    return timeline.selectedClipIds.size > 0
      ? pass({ kind: check.kind, clipIds: [...timeline.selectedClipIds] })
      : fail(check, 'No clip is selected');
  }

  const selected = timeline.selectedClipIds.has(check.clipId);

  return selected
    ? pass({ kind: check.kind, clipId: check.clipId })
    : fail(check, `Clip ${check.clipId} is not selected`);
}

function validatePropertiesTabOpen(
  check: Extract<ValidationCheck, { kind: 'propertiesTabOpen' }>,
  readers: GuidedValidationReaders,
): GuidedValidationResult {
  if (!readers.activePropertiesTab) {
    return fail(check, 'Properties tab validation requires an active tab reader');
  }

  const activeTab = readers.activePropertiesTab();
  return activeTab === check.tab
    ? pass({ kind: check.kind, tab: check.tab })
    : fail(check, `Properties tab ${check.tab} is not active`, { activeTab });
}

function validatePlayheadAtTime(
  check: Extract<ValidationCheck, { kind: 'playheadAtTime' }>,
  readers: GuidedValidationReaders,
): GuidedValidationResult {
  const timeline = getTimeline(readers);
  const tolerance = check.toleranceSeconds ?? DEFAULT_TIME_TOLERANCE_SECONDS;

  return isWithinTolerance(timeline.playheadPosition, check.time, tolerance)
    ? pass({ kind: check.kind, time: check.time, actual: timeline.playheadPosition })
    : fail(check, `Playhead is not at ${check.time}s`, {
        actual: timeline.playheadPosition,
        expected: check.time,
        tolerance,
      });
}

function validateClipTransformMatches(
  check: Extract<ValidationCheck, { kind: 'clipTransformMatches' }>,
  readers: GuidedValidationReaders,
): GuidedValidationResult {
  const timeline = getTimeline(readers);
  const media = getMedia(readers);
  const clip = findClip(timeline, check.clipId);
  if (!clip) {
    return fail(check, `Clip ${check.clipId} does not exist`);
  }

  const actual = getTransformValue(clip, check.property);
  const expected = normalizeExpectedTransformValue(check, media);
  const tolerance = check.tolerance ?? DEFAULT_VALUE_TOLERANCE;

  return isWithinTolerance(actual, expected, tolerance)
    ? pass({ kind: check.kind, clipId: check.clipId, property: check.property, actual, expected })
    : fail(check, `Transform ${check.property} on ${check.clipId} does not match`, {
        actual,
        expected,
        tolerance,
        valueSpace: check.valueSpace ?? 'store',
      });
}

function validateMaskExists(
  check: Extract<ValidationCheck, { kind: 'maskExists' }>,
  readers: GuidedValidationReaders,
): GuidedValidationResult {
  const clip = findRequiredClip(check, readers);
  if (!clip.success) {
    return clip;
  }

  const masks = clip.data.clip.masks ?? [];
  const mask = check.maskId
    ? masks.find((entry) => entry.id === check.maskId)
    : masks[0];

  if (!mask) {
    return fail(check, check.maskId
      ? `Mask ${check.maskId} does not exist on ${check.clipId}`
      : `Clip ${check.clipId} has no mask`);
  }

  if (typeof check.vertexCount === 'number' && mask.vertices.length !== check.vertexCount) {
    return fail(check, `Mask ${mask.id} has ${mask.vertices.length} vertices, expected ${check.vertexCount}`, {
      actual: mask.vertices.length,
      expected: check.vertexCount,
    });
  }

  return pass({ kind: check.kind, clipId: check.clipId, maskId: mask.id });
}

function validateActiveMask(
  check: Extract<ValidationCheck, { kind: 'activeMask' }>,
  readers: GuidedValidationReaders,
): GuidedValidationResult {
  const timeline = getTimeline(readers);
  const clip = findClip(timeline, check.clipId);
  if (!clip) {
    return fail(check, `Clip ${check.clipId} does not exist`);
  }

  const maskExists = (clip.masks ?? []).some((mask) => mask.id === check.maskId);
  if (!maskExists) {
    return fail(check, `Mask ${check.maskId} does not exist on ${check.clipId}`);
  }

  return timeline.activeMaskId === check.maskId
    ? pass({ kind: check.kind, clipId: check.clipId, maskId: check.maskId })
    : fail(check, `Mask ${check.maskId} is not active`, { activeMaskId: timeline.activeMaskId });
}

function validateEffectExists(
  check: Extract<ValidationCheck, { kind: 'effectExists' }>,
  readers: GuidedValidationReaders,
): GuidedValidationResult {
  const clip = findRequiredClip(check, readers);
  if (!clip.success) {
    return clip;
  }

  const effects = clip.data.clip.effects ?? [];
  const effect = effects.find((entry) => (
    (!check.effectId || entry.id === check.effectId)
    && (!check.effectType || entry.type === check.effectType)
  ));

  return effect
    ? pass({ kind: check.kind, clipId: check.clipId, effectId: effect.id, effectType: effect.type })
    : fail(check, `Expected effect does not exist on ${check.clipId}`);
}

function validateKeyframeExists(
  check: Extract<ValidationCheck, { kind: 'keyframeExists' }>,
  readers: GuidedValidationReaders,
): GuidedValidationResult {
  const timeline = getTimeline(readers);
  const keyframes = timeline.clipKeyframes.get(check.clipId) ?? [];
  const tolerance = DEFAULT_TIME_TOLERANCE_SECONDS;
  const keyframe = keyframes.find((entry) => (
    (!check.keyframeId || entry.id === check.keyframeId)
    && (!check.property || String(entry.property) === check.property)
    && (typeof check.time !== 'number' || isWithinTolerance(entry.time, check.time, tolerance))
  ));

  return keyframe
    ? pass({ kind: check.kind, clipId: check.clipId, keyframeId: keyframe.id })
    : fail(check, `Expected keyframe does not exist on ${check.clipId}`);
}

function validateMediaItemImported(
  check: Extract<ValidationCheck, { kind: 'mediaItemImported' }>,
  readers: GuidedValidationReaders,
): GuidedValidationResult {
  const media = getMedia(readers);
  if (check.itemId) {
    const item = typeof media.getItemById === 'function'
      ? media.getItemById(check.itemId)
      : getAllMediaItems(media).find((entry) => entry.id === check.itemId);
    return item
      ? pass({ kind: check.kind, itemId: item.id })
      : fail(check, `Media item ${check.itemId} does not exist`);
  }

  const items = getAllMediaItems(media);
  if (check.name) {
    const item = items.find((entry) => entry.name === check.name);
    return item
      ? pass({ kind: check.kind, itemId: item.id, name: item.name })
      : fail(check, `Media item ${check.name} does not exist`);
  }

  return items.length > 0
    ? pass({ kind: check.kind, itemCount: items.length })
    : fail(check, 'No media item has been imported');
}

function getTimeline(readers: GuidedValidationReaders): TimelineSnapshot {
  return readers.timeline?.() ?? useTimelineStore.getState();
}

function getMedia(readers: GuidedValidationReaders): MediaSnapshot {
  return readers.media?.() ?? useMediaStore.getState();
}

function findClip(timeline: TimelineSnapshot, clipId: string): TimelineClip | undefined {
  return timeline.clips.find((clip) => clip.id === clipId);
}

function findRequiredClip(
  check: { kind: ValidationCheck['kind']; clipId: string },
  readers: GuidedValidationReaders,
): GuidedValidationResult & { data: { clip: TimelineClip } } {
  const timeline = getTimeline(readers);
  const clip = findClip(timeline, check.clipId);

  if (!clip) {
    return fail(check, `Clip ${check.clipId} does not exist`) as GuidedValidationResult & { data: { clip: TimelineClip } };
  }

  return pass({ clip }) as GuidedValidationResult & { data: { clip: TimelineClip } };
}

function getTransformValue(clip: TimelineClip, property: Extract<ValidationCheck, { kind: 'clipTransformMatches' }>['property']): number {
  switch (property) {
    case 'position.x':
      return clip.transform.position.x;
    case 'position.y':
      return clip.transform.position.y;
    case 'position.z':
      return clip.transform.position.z;
    case 'scale.x':
      return clip.transform.scale.x;
    case 'scale.y':
      return clip.transform.scale.y;
    case 'scale.z':
      return clip.transform.scale.z ?? 1;
    case 'rotation.x':
      return clip.transform.rotation.x;
    case 'rotation.y':
      return clip.transform.rotation.y;
    case 'rotation.z':
      return clip.transform.rotation.z;
  }
}

function normalizeExpectedTransformValue(
  check: Extract<ValidationCheck, { kind: 'clipTransformMatches' }>,
  media: MediaSnapshot,
): number {
  if (check.valueSpace !== 'toolPixels') {
    return check.value;
  }

  const dimensions = getActiveCompositionDimensions(media);
  if (check.property === 'position.x') {
    return check.value / dimensions.width;
  }
  if (check.property === 'position.y') {
    return check.value / dimensions.height;
  }
  return check.value;
}

function getActiveCompositionDimensions(media: MediaSnapshot): { width: number; height: number } {
  const composition = media.getActiveComposition();
  return {
    width: composition?.width || DEFAULT_COMPOSITION_WIDTH,
    height: composition?.height || DEFAULT_COMPOSITION_HEIGHT,
  };
}

function getAllMediaItems(media: MediaSnapshot): Array<{ id: string; name: string }> {
  return [
    ...readMediaItems(media.files),
    ...readMediaItems(media.compositions),
    ...readMediaItems(media.folders),
    ...readMediaItems(media.textItems),
    ...readMediaItems(media.solidItems),
    ...readMediaItems(media.meshItems),
    ...readMediaItems(media.cameraItems),
    ...readMediaItems(media.lightItems),
    ...readMediaItems(media.splatEffectorItems),
    ...readMediaItems(media.mathSceneItems),
    ...readMediaItems(media.motionShapeItems),
    ...readMediaItems(media.signalAssets),
  ];
}

function readMediaItems(value: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is { id: string; name: string } => (
    typeof item === 'object'
    && item !== null
    && typeof (item as { id?: unknown }).id === 'string'
    && typeof (item as { name?: unknown }).name === 'string'
  ));
}

function pass(data?: Record<string, unknown>): GuidedValidationResult {
  return { success: true, data };
}

function fail(
  check: Pick<ValidationCheck, 'kind'>,
  message: string,
  data?: Record<string, unknown>,
): GuidedValidationResult {
  return {
    success: false,
    message,
    data: {
      kind: check.kind,
      ...data,
    },
  };
}

function isWithinTolerance(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function delay(
  ms: number,
  signal: AbortSignal | undefined,
  clock: GuidedValidationClock,
): Promise<void> {
  if (ms <= 0) {
    throwIfValidationAborted(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Guided validation was aborted'));
      return;
    }

    const timer = clock.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clock.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Guided validation was aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfValidationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Guided validation was aborted');
  }
}
