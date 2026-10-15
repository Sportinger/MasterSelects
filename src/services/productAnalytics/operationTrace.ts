import { productAnalytics } from './index';
import { isProductAnalyticsEnabled } from './privacy';
import type { OPERATION_STAGES, ProductAnalyticsProperties } from './catalog';
import type { ProductAnalyticsFailureCode } from './failureClassification';

export type OperationStage = typeof OPERATION_STAGES[number];
export type OperationSignal = 'user_cancel' | 'picker_cancel' | 'runner_no_result' | 'exception';
export interface OperationTrace {
  stage(stage: OperationStage, percent?: number): void;
  finish(state: 'completed' | 'cancelled' | 'failed', signal?: OperationSignal, failureCode?: ProductAnalyticsFailureCode): void;
}

/** Ephemeral, technical milestones only. No paths, project IDs, names, or exception text. */
export function beginOperationTrace(operation: 'project_create' | 'project_open' | 'export', stage: OperationStage, id: string = crypto.randomUUID()): OperationTrace {
  const started = performance.now();
  let current = stage, stageStarted = started, progress = -1, step = 0, finished = false;
  const context = productAnalytics.getRecentEventNames?.() ?? '';
  const emit = (state: string, extra: ProductAnalyticsProperties = {}) => {
    productAnalytics.track('workflow_operation', {
      operation, operation_id: id, stage: current, state, step,
      elapsed_ms: performance.now() - started, stage_elapsed_ms: performance.now() - stageStarted,
      ...(progress >= 0 ? { progress_bucket: progress } : {}),
      ...(context ? { preceding_events: context } : {}), ...extra,
    });
  };
  const visibility = () => {
    emit(document.hidden ? 'interrupted' : 'resumed', { signal: document.hidden ? 'page_hidden' : 'page_visible' });
    if (document.hidden) void productAnalytics.flush({ keepalive: true });
  };
  const pagehide = (event: PageTransitionEvent) => {
    emit('interrupted', { signal: event.persisted ? 'page_cached' : 'page_left' });
    void productAnalytics.flush({ keepalive: true });
    // A cached page may resume. Neither event proves a user cancellation or failure.
  };
  const observing = typeof window !== 'undefined' && isProductAnalyticsEnabled();
  if (observing) {
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
  }
  emit('started');
  return {
    stage(next, percent) {
      if (finished) return;
      const bucket = percent !== undefined && Number.isFinite(percent) ? Math.min(10, Math.max(0, Math.floor(percent / 10))) : progress;
      if (next === current && bucket === progress) return;
      if (next !== current) { current = next; stageStarted = performance.now(); progress = -1; }
      if (percent !== undefined && Number.isFinite(percent)) progress = bucket;
      if (step++ < 100) emit('progress');
    },
    finish(state, signal, failureCode) {
      if (finished) return;
      finished = true;
      if (observing) {
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('pagehide', pagehide);
      }
      emit(state, { ...(signal ? { signal } : {}), ...(failureCode ? { failure_code: failureCode } : {}) });
    },
  };
}
