import type { TimelineRuntimeAdmissionDecision } from './runtimeCoordinatorTypes';

const REPEAT_INTERVAL_MS = 10_000;
const lastWarningAtBySubject = new Map<string, number>();

interface WarningLogger {
  warn: (message: string, data?: unknown) => void;
}

/**
 * A refused admission leaves a clip dark or silent, so it must be visible at the default log level.
 * Admission is checked every frame, hence one warning per subject and interval.
 */
export function warnRuntimeAdmissionRefused(
  log: WarningLogger,
  subject: string,
  decision: TimelineRuntimeAdmissionDecision,
  details?: Record<string, unknown>,
): void {
  const now = Date.now();
  const lastWarningAt = lastWarningAtBySubject.get(subject);
  if (lastWarningAt !== undefined && now - lastWarningAt < REPEAT_INTERVAL_MS) return;
  lastWarningAtBySubject.set(subject, now);
  log.warn(`${subject} refused by the runtime budget, its clip stays dark or silent`, {
    ...details,
    policyId: decision.policyId,
    reason: decision.reason,
    rejectedUnits: decision.rejectedUnits.map(({ unit, used, limit }) => ({ unit, used, limit })),
  });
}

export function resetRuntimeAdmissionWarningsForTests(): void {
  lastWarningAtBySubject.clear();
}
