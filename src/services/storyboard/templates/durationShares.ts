import type { StoryboardTemplate } from '../contracts';
import type { StoryboardExpandedTemplateBeat } from './types';
import { assertStoryboardTemplateSemantics } from './validation';

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function expandStoryboardTemplateDurationShares(
  template: StoryboardTemplate,
  targetDurationSeconds = template.targetDurationSeconds,
): StoryboardExpandedTemplateBeat[] {
  assertStoryboardTemplateSemantics(template);
  if (!Number.isFinite(targetDurationSeconds) || (targetDurationSeconds ?? 0) <= 0) {
    throw new Error(`Template ${template.id} requires a positive target duration.`);
  }

  const specified = template.beats.filter(beat => beat.targetShare !== undefined);
  const specifiedTotal = specified.reduce((total, beat) => total + beat.targetShare!, 0);
  const unspecifiedCount = template.beats.length - specified.length;
  const remainingShare = Math.max(0, 1 - specifiedTotal);
  const fallbackShare = unspecifiedCount > 0
    ? remainingShare / unspecifiedCount
    : 0;
  const expanded = template.beats.map(beat => ({
    beat: structuredClone(beat),
    targetShare: beat.targetShare ?? fallbackShare,
    targetDurationSeconds: roundSeconds(
      (beat.targetShare ?? fallbackShare) * targetDurationSeconds!,
    ),
  }));
  const roundedTotal = expanded.reduce((total, beat) => total + beat.targetDurationSeconds, 0);
  const residual = roundSeconds(targetDurationSeconds! - roundedTotal);
  const last = expanded.at(-1)!;
  expanded[expanded.length - 1] = {
    ...last,
    targetDurationSeconds: roundSeconds(last.targetDurationSeconds + residual),
  };
  return expanded;
}
