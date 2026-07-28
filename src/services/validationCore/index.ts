import {
  checkAvLinkAlignment,
  checkNoGaps,
  checkNoOverlaps,
  checkObjectCount,
  checkOccupiedEnd,
  checkSourceOrderMonotonic,
  type TimelineObjectKind,
  type TimelineValidationCheckId,
  type TimelineValidationResult,
  type TimelineValidationState,
} from './timelineChecks';

export * from './timelineChecks';

export type TimelineValidationCheck =
  | { check: 'objectCount'; kind: TimelineObjectKind; expected: number }
  | { check: 'noGaps' }
  | { check: 'noOverlaps' }
  | { check: 'sourceOrderMonotonic'; trackId?: string }
  | { check: 'avLinkAlignment' }
  | { check: 'occupiedEnd'; expected: number; tolerance?: number };

export type TimelineValidationRegistry = {
  [CheckId in TimelineValidationCheckId]: (
    check: Extract<TimelineValidationCheck, { check: CheckId }>,
    state: TimelineValidationState,
  ) => TimelineValidationResult;
};

export const validationCheckRegistry: TimelineValidationRegistry = {
  objectCount: (check, state) => checkObjectCount(state, check.kind, check.expected),
  noGaps: (_check, state) => checkNoGaps(state),
  noOverlaps: (_check, state) => checkNoOverlaps(state),
  sourceOrderMonotonic: (check, state) =>
    checkSourceOrderMonotonic(state, check.trackId),
  avLinkAlignment: (_check, state) => checkAvLinkAlignment(state),
  occupiedEnd: (check, state) =>
    checkOccupiedEnd(state, check.expected, check.tolerance),
};

export function evaluateChecks(
  checks: readonly TimelineValidationCheck[],
  state: TimelineValidationState,
): TimelineValidationResult[] {
  return checks.map((check) => {
    switch (check.check) {
      case 'objectCount':
        return validationCheckRegistry.objectCount(check, state);
      case 'noGaps':
        return validationCheckRegistry.noGaps(check, state);
      case 'noOverlaps':
        return validationCheckRegistry.noOverlaps(check, state);
      case 'sourceOrderMonotonic':
        return validationCheckRegistry.sourceOrderMonotonic(check, state);
      case 'avLinkAlignment':
        return validationCheckRegistry.avLinkAlignment(check, state);
      case 'occupiedEnd':
        return validationCheckRegistry.occupiedEnd(check, state);
    }
  });
}
