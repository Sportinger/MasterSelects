import type { FrameHistoryLoopPolicy } from '../frameHistoryTransition';
import type { EffectParam } from '../types';

export const FEEDBACK_HISTORY_LOOP_KEY = 'historyLoop';
export const FEEDBACK_HISTORY_LOOP_PARAM: EffectParam = {
  type: 'select',
  label: 'History Loop',
  default: 'reset',
  options: [
    { value: 'reset', label: 'Reset' },
    { value: 'continuous', label: 'Continuous' },
  ],
  animatable: false,
};
export const FEEDBACK_PARAMETERS: Readonly<Record<typeof FEEDBACK_HISTORY_LOOP_KEY, EffectParam>> = {
  historyLoop: FEEDBACK_HISTORY_LOOP_PARAM,
};

/** Legacy, missing and malformed values fail closed to reset. */
export function resolveFeedbackHistoryLoop(params: Record<string, unknown> | undefined): FrameHistoryLoopPolicy {
  return params?.[FEEDBACK_HISTORY_LOOP_KEY] === 'continuous' ? 'continuous' : 'reset';
}
