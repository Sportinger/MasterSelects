import type {
  AssessStoryboardDurationInput,
  StoryboardDurationAssessment,
  StoryboardDurationInterval,
  StoryboardDurationUnionSegment,
} from './types';

const UNION_EPSILON_SECONDS = 0.000_001;

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
function roundDisplay(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildUnion(
  intervals: readonly StoryboardDurationInterval[],
): StoryboardDurationUnionSegment[] {
  const union: StoryboardDurationUnionSegment[] = [];
  for (const interval of intervals.toSorted((left, right) =>
    left.startTime - right.startTime ||
    left.endTime - right.endTime ||
    left.clipId.localeCompare(right.clipId)
  )) {
    const previous = union.at(-1);
    if (previous && interval.startTime <= previous.endTime + UNION_EPSILON_SECONDS) {
      union[union.length - 1] = {
        startTime: previous.startTime,
        endTime: Math.max(previous.endTime, interval.endTime),
        clipIds: [...new Set([...previous.clipIds, interval.clipId])].sort(),
      };
      continue;
    }
    union.push({
      startTime: interval.startTime,
      endTime: interval.endTime,
      clipIds: [interval.clipId],
    });
  }
  return union;
}

function violatesConstraint(
  actual: number,
  tolerance: number,
  constraint: AssessStoryboardDurationInput['constraint'],
): boolean {
  if (!constraint) return false;
  if (Number.isFinite(constraint.minSeconds) && actual < constraint.minSeconds! - tolerance) return true;
  return Number.isFinite(constraint.maxSeconds) && actual > constraint.maxSeconds! + tolerance;
}

export function assessStoryboardDuration(
  input: AssessStoryboardDurationInput,
): StoryboardDurationAssessment {
  const properties = input.sceneClip.storyboardProperties;
  const targetSeconds = finitePositive(
    properties?.targetDurationSeconds ?? input.sceneClip.duration,
    Math.max(0, input.sceneClip.duration),
  );
  const scopeStart = input.sceneClip.startTime;
  const scopeEnd = scopeStart + Math.max(0, input.sceneClip.duration);
  const filledIds = new Set(properties?.filledClipIds ?? []);
  const intervals = input.clips
    .filter(clip => filledIds.has(clip.id))
    .map((clip): StoryboardDurationInterval | null => {
      const startTime = Math.max(scopeStart, clip.startTime);
      const endTime = Math.min(scopeEnd, clip.startTime + Math.max(0, clip.duration));
      return endTime > startTime + UNION_EPSILON_SECONDS
        ? {
            clipId: clip.id,
            clipName: clip.name,
            startTime,
            endTime,
          }
        : null;
    })
    .filter((interval): interval is StoryboardDurationInterval => interval !== null);
  const unionSegments = buildUnion(intervals);
  const actualSeconds = roundDisplay(unionSegments.reduce(
    (total, segment) => total + segment.endTime - segment.startTime,
    0,
  ));
  const deltaSeconds = roundDisplay(actualSeconds - targetSeconds);
  const deltaPercent = targetSeconds > 0
    ? roundDisplay((deltaSeconds / targetSeconds) * 100)
    : null;
  const toleranceSeconds = finitePositive(
    input.toleranceSeconds ?? Math.max(0.25, targetSeconds * 0.05),
    0.25,
  );
  const isUnfilled = intervals.length === 0;
  const tone = isUnfilled
    ? 'neutral'
    : violatesConstraint(actualSeconds, toleranceSeconds, input.constraint)
      ? 'red'
      : Math.abs(deltaSeconds) <= toleranceSeconds
        ? 'green'
        : 'yellow';
  const toneLabel = tone === 'neutral'
    ? 'Unfilled'
    : tone === 'green'
      ? 'Within tolerance'
      : tone === 'yellow'
        ? 'Duration differs from target'
        : `Outside ${input.constraint?.label || 'format constraint'}`;
  const badgeLabel = `${targetSeconds.toFixed(1)}s target / ${actualSeconds.toFixed(1)}s actual`;
  const deltaLabel = `${deltaSeconds >= 0 ? '+' : '−'}${Math.abs(deltaSeconds).toFixed(1)}s`;

  return {
    targetSeconds,
    actualSeconds,
    deltaSeconds,
    deltaPercent,
    toleranceSeconds,
    tone,
    toneLabel,
    badgeLabel,
    accessibleLabel: `${badgeLabel}; ${deltaLabel}; ${toneLabel}.`,
    intervals,
    unionSegments,
    ...(input.constraint ? { constraint: { ...input.constraint } } : {}),
  };
}
