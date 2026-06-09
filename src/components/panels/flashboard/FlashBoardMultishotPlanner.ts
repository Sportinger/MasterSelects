export const MAX_MULTI_SHOTS = 5;

export interface FlashBoardMultishotPlannerPrompt {
  duration: number;
  index: number;
  prompt: string;
}

export function rebalanceMultiPrompts(
  shots: FlashBoardMultishotPlannerPrompt[],
  totalDuration: number,
): FlashBoardMultishotPlannerPrompt[] {
  const boundedDuration = Math.max(1, Math.floor(totalDuration));
  const limitedShots = shots
    .slice(0, Math.min(MAX_MULTI_SHOTS, boundedDuration))
    .map((shot, index) => ({
      index: index + 1,
      prompt: shot.prompt ?? '',
      duration: Math.max(1, Math.floor(Number(shot.duration) || 1)),
    }));

  if (limitedShots.length === 0) {
    return [];
  }

  let remaining = boundedDuration;

  return limitedShots.map((shot, index) => {
    const remainingShots = limitedShots.length - index - 1;
    const maxForShot = Math.max(1, remaining - remainingShots);
    const nextDuration = index === limitedShots.length - 1
      ? remaining
      : Math.max(1, Math.min(shot.duration, maxForShot));

    remaining -= nextDuration;

    return {
      index: index + 1,
      prompt: shot.prompt,
      duration: nextDuration,
    };
  });
}

export function createDefaultMultiPrompts(totalDuration: number): FlashBoardMultishotPlannerPrompt[] {
  const firstShotDuration = Math.max(1, Math.floor(totalDuration / 2));

  return rebalanceMultiPrompts([
    { index: 1, prompt: '', duration: firstShotDuration },
    { index: 2, prompt: '', duration: Math.max(1, totalDuration - firstShotDuration) },
  ], totalDuration);
}

export function addMultiPrompt(
  shots: FlashBoardMultishotPlannerPrompt[],
  totalDuration: number,
): FlashBoardMultishotPlannerPrompt[] {
  const normalized = rebalanceMultiPrompts(shots, totalDuration);
  const maxShots = Math.min(MAX_MULTI_SHOTS, Math.max(1, totalDuration));

  if (normalized.length >= maxShots) {
    return normalized;
  }

  const donorIndex = normalized.reduce((bestIndex, shot, index, collection) => (
    shot.duration > collection[bestIndex].duration ? index : bestIndex
  ), 0);

  if (!normalized[donorIndex] || normalized[donorIndex].duration <= 1) {
    return normalized;
  }

  const next = normalized.map((shot, index) => (
    index === donorIndex
      ? { ...shot, duration: shot.duration - 1 }
      : shot
  ));

  next.push({
    index: next.length + 1,
    prompt: '',
    duration: 1,
  });

  return rebalanceMultiPrompts(next, totalDuration);
}

export function removeMultiPrompt(
  shots: FlashBoardMultishotPlannerPrompt[],
  removeIndex: number,
  totalDuration: number,
): FlashBoardMultishotPlannerPrompt[] {
  if (shots.length <= 2) {
    return rebalanceMultiPrompts(shots, totalDuration);
  }

  const removedDuration = shots[removeIndex]?.duration ?? 0;
  const next = shots.filter((_, index) => index !== removeIndex);
  const recipientIndex = Math.max(0, Math.min(removeIndex - 1, next.length - 1));

  if (next[recipientIndex]) {
    next[recipientIndex] = {
      ...next[recipientIndex],
      duration: next[recipientIndex].duration + removedDuration,
    };
  }

  return rebalanceMultiPrompts(next, totalDuration);
}

export function buildFallbackPrompt(shots: FlashBoardMultishotPlannerPrompt[]): string {
  return shots
    .map((shot) => shot.prompt.trim())
    .filter(Boolean)
    .join(' / ');
}
