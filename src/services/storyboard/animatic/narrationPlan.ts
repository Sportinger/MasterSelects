import type { TimelineClip } from '../../../types/timeline';
import { isStoryboardTimelineClip } from '../core/sceneCardOperations';
import type { StoryboardNarrationCue, StoryboardNarrationPlan } from './types';

const DEFAULT_WORDS_PER_MINUTE = 150;

function countWords(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}
function estimateNarrationDuration(text: string, wordsPerMinute: number): number {
  const words = countWords(text);
  return words === 0 ? 0 : (words / wordsPerMinute) * 60;
}

function resolveFit(
  estimated: number,
  target: number,
): StoryboardNarrationCue['fit'] {
  if (estimated <= target * 1.05) return 'fits';
  if (estimated <= target * 1.35) return 'fit-scene-to-narration';
  return 'rewrite-narration-to-fit';
}

export function createStoryboardNarrationPlan(input: {
  readonly clips: readonly TimelineClip[];
  readonly wordsPerMinute?: number;
}): StoryboardNarrationPlan {
  const wordsPerMinute = Number.isFinite(input.wordsPerMinute) && (input.wordsPerMinute ?? 0) > 0
    ? input.wordsPerMinute!
    : DEFAULT_WORDS_PER_MINUTE;
  const cues = input.clips
    .filter(isStoryboardTimelineClip)
    .toSorted((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id))
    .map((clip): StoryboardNarrationCue => {
      const properties = clip.storyboardProperties!;
      const text = (properties.notes || properties.description).trim();
      const estimatedDurationSeconds = estimateNarrationDuration(text, wordsPerMinute);
      return {
        schemaVersion: 1,
        id: `narration:${properties.sceneId}`,
        sceneId: properties.sceneId,
        sceneClipId: clip.id,
        startTime: clip.startTime,
        targetDurationSeconds: properties.targetDurationSeconds,
        estimatedDurationSeconds,
        text,
        ...(properties.audioDirection ? { audioDirection: properties.audioDirection } : {}),
        fit: resolveFit(estimatedDurationSeconds, properties.targetDurationSeconds),
      };
    });

  return {
    schemaVersion: 1,
    kind: 'temporary-storyboard-narration',
    providerSubmission: 'none',
    wordsPerMinute,
    cues,
  };
}

export function restoreStoryboardNarrationPlan(value: unknown): StoryboardNarrationPlan | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoryboardNarrationPlan>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.kind !== 'temporary-storyboard-narration' ||
    candidate.providerSubmission !== 'none' ||
    !Number.isFinite(candidate.wordsPerMinute) ||
    !Array.isArray(candidate.cues)
  ) {
    return null;
  }
  const valid = candidate.cues.every(cue =>
    !!cue &&
    cue.schemaVersion === 1 &&
    typeof cue.id === 'string' &&
    typeof cue.sceneId === 'string' &&
    typeof cue.sceneClipId === 'string' &&
    typeof cue.text === 'string' &&
    Number.isFinite(cue.startTime) &&
    Number.isFinite(cue.targetDurationSeconds) &&
    Number.isFinite(cue.estimatedDurationSeconds) &&
    ['fits', 'fit-scene-to-narration', 'rewrite-narration-to-fit'].includes(cue.fit)
  );
  return valid ? candidate as StoryboardNarrationPlan : null;
}
