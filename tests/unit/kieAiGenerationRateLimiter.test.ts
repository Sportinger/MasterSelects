import { describe, expect, it } from 'vitest';
import {
  KIEAI_GENERATION_START_INTERVAL_MS,
  reserveKieAiGenerationStart,
} from '../../workers/kieai-generation-rate-limiter/src/slotScheduler';

describe('Kie.ai generation start scheduler', () => {
  it('spaces a burst of 100 starts below the provider limit', () => {
    let nextStartAt = 0;
    const scheduledStarts: number[] = [];

    for (let index = 0; index < 100; index += 1) {
      const reservation = reserveKieAiGenerationStart(nextStartAt, 0);
      scheduledStarts.push(reservation.scheduledAt);
      nextStartAt = reservation.nextStartAt;
    }

    expect(scheduledStarts[0]).toBe(0);
    expect(scheduledStarts.at(-1)).toBe(99 * KIEAI_GENERATION_START_INTERVAL_MS);
    expect(scheduledStarts.filter((startAt) => startAt < 10_000)).toHaveLength(19);
    expect(scheduledStarts.slice(1).every((startAt, index) => (
      startAt - scheduledStarts[index] >= KIEAI_GENERATION_START_INTERVAL_MS
    ))).toBe(true);
  });

  it('starts immediately again after an idle period', () => {
    const reservation = reserveKieAiGenerationStart(1_000, 5_000);

    expect(reservation.scheduledAt).toBe(5_000);
    expect(reservation.nextStartAt).toBe(5_000 + KIEAI_GENERATION_START_INTERVAL_MS);
  });
});
