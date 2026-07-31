import { useCallback, useState } from 'react';

import {
  persistStoredTimelineCurveMode,
  readStoredTimelineCurveMode,
  type TimelineCurveMode,
} from '../../../stores/timeline/viewPreferences';

export interface TimelineCurveModeController {
  timelineCurveMode: TimelineCurveMode;
  setTimelineCurveMode: (mode: TimelineCurveMode) => void;
  toggleTimelineCurveMode: () => void;
}

/**
 * Owns the per-user Timeline/Graph view toggle without adding project state or
 * another animation source of truth to the timeline store.
 */
export function useTimelineCurveMode(): TimelineCurveModeController {
  const [timelineCurveMode, setTimelineCurveModeState] = useState<TimelineCurveMode>(
    () => readStoredTimelineCurveMode('timeline'),
  );

  const setTimelineCurveMode = useCallback((mode: TimelineCurveMode) => {
    persistStoredTimelineCurveMode(mode);
    setTimelineCurveModeState(mode);
  }, []);

  const toggleTimelineCurveMode = useCallback(() => {
    setTimelineCurveModeState(current => {
      const next = current === 'timeline' ? 'graph' : 'timeline';
      persistStoredTimelineCurveMode(next);
      return next;
    });
  }, []);

  return {
    timelineCurveMode,
    setTimelineCurveMode,
    toggleTimelineCurveMode,
  };
}
