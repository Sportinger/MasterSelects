/** Keep one request below Kie.ai's 20 new-generation requests per 10 seconds. */
export const KIEAI_GENERATION_START_INTERVAL_MS = 550;

export interface KieAiGenerationStartReservation {
  nextStartAt: number;
  scheduledAt: number;
}

export function reserveKieAiGenerationStart(
  nextStartAt: number,
  now: number,
): KieAiGenerationStartReservation {
  const scheduledAt = Math.max(now, nextStartAt);

  return {
    scheduledAt,
    nextStartAt: scheduledAt + KIEAI_GENERATION_START_INTERVAL_MS,
  };
}
