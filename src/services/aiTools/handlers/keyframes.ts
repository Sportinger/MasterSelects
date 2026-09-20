import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';
import type { AnimatableProperty, EasingType, TimelineClip } from '../../../types';
import type { KeyframeCreateOperation } from '../../../stores/timeline/editOperations/transactionTypes';
import { animateKeyframe } from '../aiFeedback';
import { normalizeEasingType } from '../../../utils/easing';
import { getKeyframeAtTime } from '../../../utils/keyframeInterpolation';
import { propertyRegistry } from '../../properties';
import { validatePropertyAuthoringValue } from '../../properties/propertyAuthoring';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from './mutationEntityResults';
import {
  keyframeValueFromStore,
  keyframeValueToStore,
} from './keyframePositionUnits';
import { isFlockProperty } from '../../../types/flock';
import { withLegacyKeyframeNodes } from '../../nodeGraph/legacyKeyframeNodes';
import {
  clipLocalToKeyframeTime,
  keyframeTimeToClipLocal,
} from '../../flock/time/flockKeyframeTime';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

/** Snaps time-basis conversions so round trips stay exact (sourceTime 6 is stored as 6, not 5.999999999999999). */
function snapSeconds(seconds: number): number;
function snapSeconds(seconds: number | null): number | null;
function snapSeconds(seconds: number | null): number | null {
  return seconds === null ? null : Math.round(seconds * 1e9) / 1e9;
}

interface KeyframeAuthoringRequest {
  clipId: string;
  property: AnimatableProperty;
  requestedValue: number;
  requestedTime: number | undefined;
  requestedSourceTime: number | undefined;
  easing: EasingType;
}

interface PlannedKeyframe extends KeyframeAuthoringRequest {
  clip: TimelineClip;
  canonicalValue: number;
  storedValue: number;
  resolvedTime: number;
  /** Time as stored: clip-local, or simulation source time for flock graph parameters. */
  storedTime: number;
  existingKeyframeId: string | null;
}

const LEGACY_KEYFRAME_FIELDS = ['clipId', 'property', 'value', 'time', 'sourceTime', 'easing'] as const;
const VALID_EASING_KEYS = new Set([
  'linear',
  'easein',
  'easeout',
  'easeinout',
  'easeinelastic',
  'easeoutelastic',
  'easeinoutelastic',
  'bezier',
]);

export async function handleGetKeyframes(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const property = args.property as string | undefined;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  let keyframes = timelineStore.getClipKeyframes(clipId);
  const graphClip = withLegacyKeyframeNodes(clip, keyframes);
  if (property) {
    keyframes = keyframes.filter(kf => kf.property === property);
  }

  return {
    success: true,
    data: {
      clipId,
      clipStartTime: clip.startTime,
      animationNodes: graphClip.nodeGraph?.keyframeNodes?.map(node => ({ id: node.id, label: node.label, channels: node.channels })),
      keyframes: keyframes.map(kf => ({
        id: kf.id,
        property: kf.property,
        value: keyframeValueFromStore(clip, kf.property, kf.value),
        pathValue: kf.pathValue,
        time: kf.time,
        ...(isFlockProperty(kf.property)
          ? {
              timeBasis: 'source',
              clipLocalTime: snapSeconds(keyframeTimeToClipLocal(clip, kf, timelineStore.getSourceTimeForClip)),
            }
          : {}),
        easing: normalizeEasingType(kf.easing, 'linear'),
        ...(kf.hold ? { hold: true } : {}),
        ...(kf.animationSource ? { animationSource: kf.animationSource } : {}),
        rotationInterpolation: kf.rotationInterpolation,
      })),
    },
  };
}

export async function handleAddKeyframe(
  args: Record<string, unknown>,
  _timelineStore: TimelineStore
): Promise<ToolResult> {
  try {
    const requests = parseKeyframeRequests(args);
    const timeline = useTimelineStore.getState();
    const planned = requests.map((request) => planKeyframe(request, timeline));
    assertNoDuplicateSequenceTargets(planned);

    const mutationSnapshot = captureMutationEntitySnapshot(
      'keyframe',
      getAllKeyframes(),
    );
    const transactionId = createKeyframeTransactionId();
    const operations: KeyframeCreateOperation[] = planned.map((keyframe) => ({
      type: 'keyframe-create',
      clipId: keyframe.clipId,
      property: keyframe.property,
      value: { value: keyframe.storedValue },
      time: keyframe.resolvedTime,
      easing: keyframe.easing,
    }));
    const result = useTimelineStore.getState().applyTimelineEditOperation({
      id: `${transactionId}:commit`,
      type: 'keyframe-transaction-commit',
      phase: 'commit',
      transactionId,
      historyBatchId: transactionId,
      source: 'ai-tool',
      clipId: planned[0].clipId,
      property: planned.length === 1 ? planned[0].property : undefined,
      keyframeIds: planned
        .map((keyframe) => keyframe.existingKeyframeId)
        .filter((id): id is string => id !== null),
      operations,
    }, {
      source: 'ai-tool',
      historyLabel: planned.length === 1 ? 'Add keyframe' : 'Author keyframe sequence',
    });

    const onlyNoopWarnings = result.warnings.length > 0
      && result.warnings.every((warning) => warning.code === 'no-op');
    if (!result.success && !onlyNoopWarnings) {
      return {
        success: false,
        error: result.warnings.map((warning) => warning.message).join('; ')
          || 'Keyframe transaction failed',
      };
    }

    const finalTimeline = useTimelineStore.getState();
    const keyframes = planned.map((keyframe) => {
      const actual = getKeyframeAtTime(
        finalTimeline.getClipKeyframes(keyframe.clipId),
        keyframe.property,
        keyframe.storedTime,
      );
      if (!actual) {
        throw new Error(`Keyframe was not written: ${keyframe.clipId}/${keyframe.property}`);
      }
      const status = keyframe.existingKeyframeId ? 'updated' : 'created';
      return {
        clipId: keyframe.clipId,
        keyframeId: actual.id,
        property: keyframe.property,
        requestedValue: keyframe.requestedValue,
        canonicalValue: keyframe.canonicalValue,
        storedValue: actual.value,
        requestedTime: keyframe.requestedTime,
        resolvedTime: actual.time,
        ...(isFlockProperty(keyframe.property)
          ? { timeBasis: 'source', clipLocalTime: keyframe.resolvedTime }
          : {}),
        easing: normalizeEasingType(actual.easing, keyframe.easing),
        status,
        created: status === 'created',
        updated: status === 'updated',
      };
    });

    [...new Set(planned.map((keyframe) => keyframe.clipId))]
      .forEach((clipId) => animateKeyframe(clipId, 'add'));

    const mutationDescription = describeMutationEntities(
      mutationSnapshot,
      getAllKeyframes(),
    );
    if (keyframes.length === 1 && args.sequence === undefined) {
      const [keyframe] = keyframes;
      return {
        success: true,
        data: {
          clipId: keyframe.clipId,
          keyframeId: keyframe.keyframeId,
          property: keyframe.property,
          value: keyframe.canonicalValue,
          time: keyframe.resolvedTime,
          easing: keyframe.easing,
          requestedValue: keyframe.requestedValue,
          canonicalValue: keyframe.canonicalValue,
          storedValue: keyframe.storedValue,
          requestedTime: keyframe.requestedTime,
          resolvedTime: keyframe.resolvedTime,
          ...('timeBasis' in keyframe ? { timeBasis: keyframe.timeBasis, clipLocalTime: keyframe.clipLocalTime } : {}),
          status: keyframe.status,
          created: keyframe.created,
          updated: keyframe.updated,
          ...mutationDescription,
        },
      };
    }

    return {
      success: true,
      data: {
        mode: 'sequence',
        keyframes,
        createdCount: keyframes.filter((keyframe) => keyframe.created).length,
        updatedCount: keyframes.filter((keyframe) => keyframe.updated).length,
        ...mutationDescription,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseKeyframeRequests(args: Record<string, unknown>): KeyframeAuthoringRequest[] {
  const hasSequence = Object.prototype.hasOwnProperty.call(args, 'sequence');
  const hasLegacyField = LEGACY_KEYFRAME_FIELDS.some((field) => (
    Object.prototype.hasOwnProperty.call(args, field)
  ));

  if (hasSequence) {
    if (hasLegacyField) {
      throw new Error('Use either legacy single-keyframe fields or sequence, not both');
    }
    if (!Array.isArray(args.sequence)) {
      throw new Error('sequence must be an array');
    }
    if (args.sequence.length < 1) {
      throw new Error('sequence must contain at least one keyframe');
    }
    return args.sequence.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`sequence[${index}] must be an object`);
      }
      return parseKeyframeRequest(item as Record<string, unknown>, `sequence[${index}]`);
    });
  }

  return [parseKeyframeRequest(args, 'keyframe')];
}

function parseKeyframeRequest(
  input: Record<string, unknown>,
  label: string,
): KeyframeAuthoringRequest {
  const clipId = requireNonEmptyString(input.clipId, `${label}.clipId`);
  const property = requireNonEmptyString(
    input.property,
    `${label}.property`,
  ) as AnimatableProperty;
  if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
    throw new Error(`${label}.value must be a finite number`);
  }
  if (input.time !== undefined && (
    typeof input.time !== 'number' || !Number.isFinite(input.time)
  )) {
    throw new Error(`${label}.time must be a finite number`);
  }
  if (input.sourceTime !== undefined) {
    if (typeof input.sourceTime !== 'number' || !Number.isFinite(input.sourceTime) || input.sourceTime < 0) {
      throw new Error(`${label}.sourceTime must be a finite number >= 0`);
    }
    if (input.time !== undefined) {
      throw new Error(`${label}: use either time or sourceTime, not both`);
    }
    if (!isFlockProperty(property)) {
      throw new Error(`${label}.sourceTime is only supported for flock graph properties (flock.node.*)`);
    }
  }
  return {
    clipId,
    property,
    requestedValue: input.value,
    requestedTime: input.time as number | undefined,
    requestedSourceTime: input.sourceTime as number | undefined,
    easing: parseEasing(input.easing, `${label}.easing`),
  };
}

function parseEasing(value: unknown, label: string): EasingType {
  if (value === undefined) return 'ease-in-out';
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a supported easing string`);
  }
  const compact = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!VALID_EASING_KEYS.has(compact)) {
    throw new Error(`${label} must be one of: linear, ease-in, ease-out, ease-in-out, bezier`);
  }
  return normalizeEasingType(value, 'ease-in-out');
}

function planKeyframe(
  request: KeyframeAuthoringRequest,
  timeline: TimelineStore,
): PlannedKeyframe {
  const clip = timeline.clips.find((candidate) => candidate.id === request.clipId);
  if (!clip) throw new Error(`Clip not found: ${request.clipId}`);
  if (timeline.tracks.find((track) => track.id === clip.trackId)?.locked) {
    throw new Error(`Clip is on a locked track: ${request.clipId}`);
  }

  const descriptorClip = clip.effects
    ? clip
    : { ...clip, effects: [] };
  const descriptor = propertyRegistry
    .getAllDescriptors(descriptorClip)
    .find((candidate) => candidate.path === request.property);
  if (!descriptor) {
    throw new Error(`Property not found for clip: ${request.property}`);
  }
  if (!descriptor.animatable) {
    throw new Error(`Property is not animatable: ${request.property}`);
  }
  if (descriptor.valueType !== 'number') {
    throw new Error(`${request.property} requires a numeric keyframe value`);
  }

  const canonicalValue = validatePropertyAuthoringValue(
    descriptor,
    request.requestedValue,
  );
  if (typeof canonicalValue !== 'number') {
    throw new Error(`${request.property} requires a numeric keyframe value`);
  }
  const storedValue = keyframeValueToStore(
    clip,
    request.property,
    canonicalValue,
  );
  if (!Number.isFinite(storedValue)) {
    throw new Error(`${request.property} resolved to a non-finite stored value`);
  }
  let requestedLocalTime = request.requestedTime ?? (timeline.playheadPosition - clip.startTime);
  if (request.requestedSourceTime !== undefined) {
    const local = keyframeTimeToClipLocal(
      clip,
      { property: request.property, time: request.requestedSourceTime },
      timeline.getSourceTimeForClip,
    );
    if (local === null || local < -1e-6 || local > clip.duration + 1e-6) {
      throw new Error(
        `sourceTime ${request.requestedSourceTime}s is outside the visible source window of clip ${clip.id}; extend or slip the clip, or choose a source time it shows`,
      );
    }
    requestedLocalTime = snapSeconds(local);
  }
  const resolvedTime = Math.max(0, Math.min(requestedLocalTime, clip.duration));
  // Flock graph parameters store keyframes in source time; lookups must match.
  const storedTime = clipLocalToKeyframeTime(clip, request.property, resolvedTime, timeline.getSourceTimeForClip);
  const existing = getKeyframeAtTime(
    timeline.getClipKeyframes(clip.id),
    request.property,
    storedTime,
  );
  return {
    ...request,
    clip,
    canonicalValue,
    storedValue,
    resolvedTime,
    storedTime,
    existingKeyframeId: existing?.id ?? null,
  };
}

function assertNoDuplicateSequenceTargets(planned: readonly PlannedKeyframe[]): void {
  for (let index = 0; index < planned.length; index += 1) {
    const current = planned[index];
    const duplicate = planned.slice(0, index).find((candidate) => (
      candidate.clipId === current.clipId
      && candidate.property === current.property
      && Math.abs(candidate.resolvedTime - current.resolvedTime) < 0.01
    ));
    if (duplicate) {
      throw new Error(
        `Duplicate keyframe target: ${current.clipId}/${current.property} at ${current.resolvedTime}s`,
      );
    }
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function createKeyframeTransactionId(): string {
  return `ai-keyframes:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
}

export async function handleRemoveKeyframe(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const keyframeId = args.keyframeId as string;

  const mutationSnapshot = captureMutationEntitySnapshot('keyframe', getAllKeyframes());
  const { removeKeyframe, invalidateCache } = useTimelineStore.getState();
  removeKeyframe(keyframeId);
  invalidateCache();

  // Visual feedback: keyframe remove animation
  animateKeyframe('', 'remove');

  return {
    success: true,
    data: {
      removedKeyframeId: keyframeId,
      ...describeMutationEntities(
        mutationSnapshot,
        getAllKeyframes(),
      ),
    },
  };
}

function getAllKeyframes() {
  return [...useTimelineStore.getState().clipKeyframes.values()].flat();
}
