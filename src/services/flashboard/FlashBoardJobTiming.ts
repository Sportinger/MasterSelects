import type { FlashBoardJobState } from '../../stores/flashboardStore/types';

function finiteTimestamp(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function resolveFlashBoardJobStartedAt(input: {
  currentStartedAt?: number;
  nextStartedAt?: number;
  nextStatus: FlashBoardJobState['status'];
  now: number;
}): number | undefined {
  const currentStartedAt = finiteTimestamp(input.currentStartedAt);
  const nextStartedAt = finiteTimestamp(input.nextStartedAt);

  if (input.nextStatus !== 'processing') {
    return nextStartedAt ?? currentStartedAt;
  }

  if (currentStartedAt !== undefined && nextStartedAt !== undefined) {
    return Math.min(currentStartedAt, nextStartedAt);
  }

  return nextStartedAt ?? currentStartedAt ?? input.now;
}

export function getProviderTaskStartedAt(task: { createdAt?: Date }): number | undefined {
  const startedAt = task.createdAt?.getTime();
  return typeof startedAt === 'number' && Number.isFinite(startedAt)
    ? startedAt
    : undefined;
}
