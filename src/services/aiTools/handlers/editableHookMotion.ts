import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import type { ToolResult } from '../types';
import { handleAddKeyframe } from './keyframes';
import { keyframeValueFromStore } from './keyframePositionUnits';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

const ENTRANCE_DIRECTIONS = [
  'from-left',
  'from-right',
  'from-top',
  'from-bottom',
  'fade',
] as const;

const EXIT_DIRECTIONS = [
  'to-left',
  'to-right',
  'to-top',
  'to-bottom',
  'fade',
] as const;

const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'] as const;

type EntranceDirection = typeof ENTRANCE_DIRECTIONS[number];
type ExitDirection = typeof EXIT_DIRECTIONS[number];
type MotionEasing = typeof EASINGS[number];

export interface EditableHookMotionSpec {
  entrance: {
    direction: EntranceDirection;
    distance?: number;
    duration: number;
    easing: MotionEasing;
    overshoot: number;
  };
  exit: {
    direction: ExitDirection;
    distance?: number;
    duration: number;
    easing: MotionEasing;
  };
}

interface MotionVector {
  axis: 'position.x' | 'position.y';
  sign: -1 | 1;
}

interface SequenceKeyframe {
  clipId: string;
  easing: MotionEasing;
  property: 'opacity' | 'position.x' | 'position.y';
  time: number;
  value: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number | Error {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return new Error(`${path} must be a finite number`);
  }
  if (value < minimum || value > maximum) {
    return new Error(`${path} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function optionalFiniteNumber(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number | undefined | Error {
  if (value === undefined || value === null) return undefined;
  return finiteNumber(value, path, minimum, maximum);
}

function parseEasing(value: unknown, path: string): MotionEasing | Error {
  if (value === undefined || value === null) return 'ease-in-out';
  return typeof value === 'string' && EASINGS.includes(value as MotionEasing)
    ? value as MotionEasing
    : new Error(`${path} must be one of: ${EASINGS.join(', ')}`);
}

export function parseEditableHookMotion(
  value: unknown,
  hookDuration: number,
): EditableHookMotionSpec | undefined | Error {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return new Error('motion must be an object');
  if (!isRecord(value.entrance)) return new Error('motion.entrance must be an object');
  if (!isRecord(value.exit)) return new Error('motion.exit must be an object');

  const entranceDirection = value.entrance.direction;
  if (!ENTRANCE_DIRECTIONS.includes(entranceDirection as EntranceDirection)) {
    return new Error(`motion.entrance.direction must be one of: ${ENTRANCE_DIRECTIONS.join(', ')}`);
  }
  const exitDirection = value.exit.direction;
  if (!EXIT_DIRECTIONS.includes(exitDirection as ExitDirection)) {
    return new Error(`motion.exit.direction must be one of: ${EXIT_DIRECTIONS.join(', ')}`);
  }

  const entranceDuration = finiteNumber(
    value.entrance.duration,
    'motion.entrance.duration',
    0.1,
    10,
  );
  const exitDuration = finiteNumber(value.exit.duration, 'motion.exit.duration', 0.1, 10);
  const entranceDistance = optionalFiniteNumber(
    value.entrance.distance,
    'motion.entrance.distance',
    1,
    100_000,
  );
  const exitDistance = optionalFiniteNumber(
    value.exit.distance,
    'motion.exit.distance',
    1,
    100_000,
  );
  const overshoot = optionalFiniteNumber(
    value.entrance.overshoot,
    'motion.entrance.overshoot',
    0,
    2_000,
  );
  const entranceEasing = parseEasing(value.entrance.easing, 'motion.entrance.easing');
  const exitEasing = parseEasing(value.exit.easing, 'motion.exit.easing');
  if (entranceDuration instanceof Error) return entranceDuration;
  if (exitDuration instanceof Error) return exitDuration;
  if (entranceDistance instanceof Error) return entranceDistance;
  if (exitDistance instanceof Error) return exitDistance;
  if (overshoot instanceof Error) return overshoot;
  if (entranceEasing instanceof Error) return entranceEasing;
  if (exitEasing instanceof Error) return exitEasing;
  if (entranceDuration + exitDuration + 0.5 > hookDuration) {
    return new Error('motion requires at least 0.5 seconds of readable hold time');
  }

  return {
    entrance: {
      direction: entranceDirection as EntranceDirection,
      duration: entranceDuration,
      easing: entranceEasing as MotionEasing,
      overshoot: overshoot ?? 0,
      ...(entranceDistance === undefined ? {} : { distance: entranceDistance }),
    },
    exit: {
      direction: exitDirection as ExitDirection,
      duration: exitDuration,
      easing: exitEasing as MotionEasing,
      ...(exitDistance === undefined ? {} : { distance: exitDistance }),
    },
  };
}

function entranceVector(direction: EntranceDirection): MotionVector | null {
  switch (direction) {
    case 'from-left': return { axis: 'position.x', sign: -1 };
    case 'from-right': return { axis: 'position.x', sign: 1 };
    case 'from-top': return { axis: 'position.y', sign: -1 };
    case 'from-bottom': return { axis: 'position.y', sign: 1 };
    case 'fade': return null;
  }
}

function exitVector(direction: ExitDirection): MotionVector | null {
  switch (direction) {
    case 'to-left': return { axis: 'position.x', sign: -1 };
    case 'to-right': return { axis: 'position.x', sign: 1 };
    case 'to-top': return { axis: 'position.y', sign: -1 };
    case 'to-bottom': return { axis: 'position.y', sign: 1 };
    case 'fade': return null;
  }
}

function settledPosition(clip: TimelineClip, axis: MotionVector['axis']): number {
  const storedValue = axis === 'position.x'
    ? clip.transform.position.x
    : clip.transform.position.y;
  return keyframeValueFromStore(clip, axis, storedValue);
}

function defaultDistance(
  vector: MotionVector,
  compositionWidth: number,
  compositionHeight: number,
): number {
  return vector.axis === 'position.x' ? compositionWidth : compositionHeight;
}

function buildClipSequence(input: {
  clip: TimelineClip;
  compositionHeight: number;
  compositionWidth: number;
  duration: number;
  motion: EditableHookMotionSpec;
}): SequenceKeyframe[] {
  const { clip, compositionHeight, compositionWidth, duration, motion } = input;
  const entrance = entranceVector(motion.entrance.direction);
  const exit = exitVector(motion.exit.direction);
  const exitStart = duration - motion.exit.duration;
  const sequence: SequenceKeyframe[] = [
    { clipId: clip.id, property: 'opacity', value: 0, time: 0, easing: motion.entrance.easing },
    {
      clipId: clip.id,
      property: 'opacity',
      value: 1,
      time: motion.entrance.duration,
      easing: motion.entrance.easing,
    },
    { clipId: clip.id, property: 'opacity', value: 1, time: exitStart, easing: motion.exit.easing },
    { clipId: clip.id, property: 'opacity', value: 0, time: duration, easing: motion.exit.easing },
  ];

  if (entrance) {
    const settled = settledPosition(clip, entrance.axis);
    const distance = motion.entrance.distance
      ?? defaultDistance(entrance, compositionWidth, compositionHeight);
    sequence.push({
      clipId: clip.id,
      property: entrance.axis,
      value: settled + entrance.sign * distance,
      time: 0,
      easing: motion.entrance.easing,
    });
    if (motion.entrance.overshoot > 0) {
      sequence.push({
        clipId: clip.id,
        property: entrance.axis,
        value: settled - entrance.sign * motion.entrance.overshoot,
        time: motion.entrance.duration * 0.82,
        easing: motion.entrance.easing,
      });
    }
    sequence.push({
      clipId: clip.id,
      property: entrance.axis,
      value: settled,
      time: motion.entrance.duration,
      easing: motion.entrance.easing,
    });
  }

  if (exit) {
    const settled = settledPosition(clip, exit.axis);
    const distance = motion.exit.distance
      ?? defaultDistance(exit, compositionWidth, compositionHeight);
    sequence.push(
      {
        clipId: clip.id,
        property: exit.axis,
        value: settled,
        time: exitStart,
        easing: motion.exit.easing,
      },
      {
        clipId: clip.id,
        property: exit.axis,
        value: settled + exit.sign * distance,
        time: duration,
        easing: motion.exit.easing,
      },
    );
  }

  return sequence;
}

export async function authorEditableHookMotion(input: {
  clipIds: readonly string[];
  compositionHeight: number;
  compositionWidth: number;
  duration: number;
  motion: EditableHookMotionSpec;
  store: TimelineStore;
}): Promise<ToolResult> {
  const clips: TimelineClip[] = [];
  for (const clipId of input.clipIds) {
    const clip = input.store.clips.find((candidate) => candidate.id === clipId);
    if (!clip) return { success: false, error: `Hook motion clip not found: ${clipId}` };
    clips.push(clip);
  }
  const sequence = clips.flatMap((clip) => buildClipSequence({
    clip,
    compositionHeight: input.compositionHeight,
    compositionWidth: input.compositionWidth,
    duration: input.duration,
    motion: input.motion,
  }));
  const result = await handleAddKeyframe({ sequence }, useTimelineStore.getState());
  if (!result.success) return result;
  return {
    success: true,
    data: {
      animatedClipIds: clips.map((clip) => clip.id),
      keyframeCount: sequence.length,
      entrance: input.motion.entrance,
      exit: input.motion.exit,
      holdDuration: input.duration - input.motion.entrance.duration - input.motion.exit.duration,
    },
  };
}
