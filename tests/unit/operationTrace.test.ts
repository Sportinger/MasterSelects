import { afterEach, describe, expect, it, vi } from 'vitest';
const analytics = vi.hoisted(() => ({ track: vi.fn(), flush: vi.fn(async () => {}), getRecentEventNames: () => 'media_import_completed>playback_stopped' }));
vi.mock('../../src/services/productAnalytics/index', () => ({ productAnalytics: analytics }));
vi.mock('../../src/services/productAnalytics/privacy', () => ({ isProductAnalyticsEnabled: () => true }));
import { beginOperationTrace } from '../../src/services/productAnalytics/operationTrace';
import { sanitizeProductAnalyticsProperties } from '../../src/services/productAnalytics/catalog';
afterEach(() => { vi.restoreAllMocks(); analytics.track.mockClear(); });

describe('bounded operation traces', () => {
  it('keeps the reached phase and progress on user cancellation, with one terminal event', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    const trace = beginOperationTrace('export', 'preparing', 'run-test');
    now.mockReturnValue(500); trace.stage('video', 42); trace.stage('video', 49);
    now.mockReturnValue(900); trace.finish('cancelled', 'user_cancel');
    trace.finish('failed', 'exception'); trace.stage('muxing', 100);
    expect(analytics.track).toHaveBeenCalledTimes(3);
    expect(analytics.track.mock.calls.at(-1)).toEqual(['workflow_operation', expect.objectContaining({
      operation_id: 'run-test', stage: 'video', progress_bucket: 4, state: 'cancelled', signal: 'user_cancel',
      elapsed_ms: 800, stage_elapsed_ms: 400, preceding_events: 'media_import_completed>playback_stopped',
    })]);
  });
  it('records page lifecycle signals without deciding that the export failed or was cancelled', () => {
    const trace = beginOperationTrace('export', 'preparing', 'run-page');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(analytics.track.mock.calls.at(-1)?.[1]).toMatchObject({ state: 'interrupted', signal: 'page_cached' });
    trace.finish('completed');
    const count = analytics.track.mock.calls.length;
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    expect(analytics.track).toHaveBeenCalledTimes(count);
  });
  it('accepts only known technical context and drops private or free-text properties', () => {
    expect(sanitizeProductAnalyticsProperties('workflow_operation', {
      operation_id: 'run-123', operation: 'export', stage: 'audio', state: 'failed', signal: 'exception',
      failure_code: 'storage_quota', progress_bucket: 400, preceding_events: '/private/project.mov',
      message: 'Secret project name', project_name: 'Private',
    })).toEqual({ operation_id: 'run-123', operation: 'export', stage: 'audio', state: 'failed', signal: 'exception',
      failure_code: 'storage_quota', progress_bucket: 10 });
  });
});
