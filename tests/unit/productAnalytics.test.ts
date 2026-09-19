import { describe, expect, it, vi } from 'vitest';
import type { AppContext, AppD1Database, AppD1Statement } from '../../functions/lib/env';
import { onRequest } from '../../functions/api/analytics/events';
import {
  sanitizeProductAnalyticsProperties,
} from '../../src/services/productAnalytics/catalog';
import { classifyProductAnalyticsFailure } from '../../src/services/productAnalytics/failureClassification';
import { productAnalytics } from '../../src/services/productAnalytics';
import {
  isEditorExperienceAnalyticsActive,
  trackTimelineEdit,
} from '../../src/services/productAnalytics/domainEvents';
import { readAcquisitionAttribution } from '../../src/services/productAnalytics/acquisitionAttribution';
import { withMediaImportAnalytics } from '../../src/services/productAnalytics/mediaImportEvents';
import { classifyTimelineEdit } from '../../src/services/productAnalytics/timelineEditClassification';

describe('product analytics allowlist', () => {
  it('keeps bounded aggregate properties and drops content-bearing fields', () => {
    expect(sanitizeProductAnalyticsProperties('media_import_started', {
      file_count: 4,
      fileName: 'private-client-film.mov',
      image_count: 1,
      other_count: 0,
      path: 'C:/private/client-film.mov',
      prompt: 'confidential launch script',
      size_bucket: '100mb_1gb',
      source: 'picker',
      video_count: 3,
    })).toEqual({
      file_count: 4,
      image_count: 1,
      other_count: 0,
      size_bucket: '100mb_1gb',
      source: 'picker',
      video_count: 3,
    });
  });

  it('rejects invalid identifiers and enum values and clamps counts', () => {
    expect(sanitizeProductAnalyticsProperties('tutorial_step_viewed', {
      step_count: 999_999,
      step_id: 'contains private spaces',
      step_index: -20,
      tutorial_id: 'timeline-basics',
    })).toEqual({
      step_count: 500,
      step_index: 0,
      tutorial_id: 'timeline-basics',
    });

    expect(sanitizeProductAnalyticsProperties('export_started', {
      container: 'mp4',
      kind: 'private-custom-format',
      run_id: 'run-valid-1234',
    })).toEqual({
      container: 'mp4',
      run_id: 'run-valid-1234',
    });
  });

  it('keeps precise semantic edit fields while dropping raw labels', () => {
    expect(sanitizeProductAnalyticsProperties('timeline_edit_committed', {
      action: 'move',
      history_label: 'Move secret-client-film.mov',
      operation: 'timing',
      origin: 'user',
      target: 'clip',
    })).toEqual({
      action: 'move',
      operation: 'timing',
      origin: 'user',
      target: 'clip',
    });
  });

  it('keeps semantic control metadata but never parameter values or project content', () => {
    expect(sanitizeProductAnalyticsProperties('editor_control_committed', {
      area: 'effect',
      clip_id: 'private-clip-id',
      control_id: 'blurRadius',
      control_kind: 'slider',
      file_name: 'secret-client-film.mov',
      input_method: 'drag',
      interaction: 'change',
      item_id: 'gaussian-blur',
      item_kind: 'effect',
      parameter_value: 42.75,
    })).toEqual({
      area: 'effect',
      control_id: 'blurRadius',
      control_kind: 'slider',
      input_method: 'drag',
      interaction: 'change',
      item_id: 'gaussian-blur',
      item_kind: 'effect',
    });
  });

  it('keeps only allowlisted failure diagnostics and drops raw error content', () => {
    expect(sanitizeProductAnalyticsProperties('media_import_failed', {
      error_message: 'Could not read private-client-film.mov from C:/secret',
      failure_code: 'file_unreadable',
      failure_stage: 'planning',
      requested_count: 1,
      source: 'picker',
      stack: 'private stack trace',
    })).toEqual({
      failure_code: 'file_unreadable',
      failure_stage: 'planning',
      requested_count: 1,
      source: 'picker',
    });
  });

  it('keeps bounded campaign attribution without accepting arbitrary source labels', () => {
    expect(readAcquisitionAttribution(
      '?utm_source=Instagram&utm_medium=organic-social&utm_campaign=browser-proof-01&utm_content=proof-vertical-01',
    )).toEqual({
      acquisition_campaign: 'browser-proof-01',
      acquisition_content: 'proof-vertical-01',
      acquisition_medium: 'organic-social',
      acquisition_source: 'instagram',
    });

    expect(readAcquisitionAttribution(
      '?utm_source=private customer name&utm_medium=paid-social&utm_campaign=has spaces',
    )).toEqual({});
  });
});

describe('privacy-safe failure classification', () => {
  it.each([
    [new DOMException('The user aborted a request', 'AbortError'), 'cancelled'],
    [new DOMException('Permission denied', 'NotAllowedError'), 'permission_denied'],
    [new DOMException('The file cannot be read', 'NotReadableError'), 'file_unreadable'],
    [new DOMException('Database quota exceeded', 'QuotaExceededError'), 'storage_quota'],
    [new Error('Network error while contacting MasterSelects Cloud'), 'network_unavailable'],
    [new Error('Request timed out after 10000ms'), 'request_timeout'],
    [new Error('Checkout session did not return a URL'), 'invalid_response'],
    [new Error('Unrecognized implementation detail'), 'unknown'],
  ] as const)('maps an exception to %s without returning its message', (error, expected) => {
    expect(classifyProductAnalyticsFailure(error)).toBe(expected);
  });
});

describe('media import failure diagnostics', () => {
  it('records the classified code and exact stage without sending the raw exception', async () => {
    const trackSpy = vi.spyOn(productAnalytics, 'track').mockImplementation(() => undefined);
    const error = new DOMException('Private file path could not be read', 'NotReadableError');

    try {
      await expect(withMediaImportAnalytics(
        [new File(['content'], 'private-client-film.mov', { type: 'video/quicktime' })],
        'picker',
        async ({ withStage }) => withStage('planning', async () => {
          throw error;
        }),
      )).rejects.toBe(error);

      expect(trackSpy).toHaveBeenCalledWith('media_import_failed', {
        failure_code: 'file_unreadable',
        failure_stage: 'planning',
        requested_count: 1,
        runtime_bucket: 'under_1s',
        source: 'picker',
      });
      expect(JSON.stringify(trackSpy.mock.calls)).not.toContain(error.message);
      expect(JSON.stringify(trackSpy.mock.calls)).not.toContain('private-client-film.mov');
    } finally {
      trackSpy.mockRestore();
    }
  });
});

describe('precise timeline edit classification', () => {
  it.each([
    ['Move clip', { action: 'move', operation: 'timing', origin: 'user', target: 'clip' }],
    ['AI: trim clip', { action: 'trim', operation: 'trim', origin: 'agent', target: 'clip' }],
    ['Adjust effect', { action: 'adjust', operation: 'visual', origin: 'user', target: 'effect' }],
    ['Bypass effect', { action: 'bypass', operation: 'visual', origin: 'user', target: 'effect' }],
    ['Add MIDI note', { action: 'add', operation: 'music', origin: 'user', target: 'midi' }],
    ['Resize dock split', { action: 'resize', operation: 'organize', origin: 'user', target: 'dock' }],
    ['Add storyboard scene', { action: 'add', operation: 'storyboard', origin: 'user', target: 'scene' }],
    ['Add text', { action: 'add', operation: 'text', origin: 'user', target: 'text' }],
    ['Adjust transform', { action: 'adjust', operation: 'visual', origin: 'user', target: 'transform' }],
  ] as const)('classifies %s', (label, expected) => {
    expect(classifyTimelineEdit(label)).toEqual(expected);
  });

  it('drops scaffolding and non-committed preview labels', () => {
    expect(classifyTimelineEdit('initial')).toBeNull();
    expect(classifyTimelineEdit('Timeline tutorial sandbox')).toBeNull();
    expect(classifyTimelineEdit('Preview transition drop')).toBeNull();
    expect(classifyTimelineEdit('Cancel keyframe move')).toBeNull();
  });

  it('suppresses hidden landing-preview edits and records real editor edits', () => {
    const trackSpy = vi.spyOn(productAnalytics, 'track').mockImplementation(() => undefined);

    window.history.replaceState(null, '', '/landing');
    trackTimelineEdit('Move clip');
    expect(trackSpy).not.toHaveBeenCalled();

    window.history.replaceState(null, '', '/editor');
    trackTimelineEdit('Move clip');
    expect(trackSpy).toHaveBeenCalledWith('timeline_edit_committed', {
      action: 'move',
      operation: 'timing',
      origin: 'user',
      target: 'clip',
    });
    expect(isEditorExperienceAnalyticsActive('/chat')).toBe(true);
    expect(isEditorExperienceAnalyticsActive('/landing')).toBe(false);

    trackSpy.mockRestore();
    window.history.replaceState(null, '', '/');
  });
});
function makeStatement(query: string, boundRows: unknown[][]): AppD1Statement {
  let bound: unknown[] = [];
  return {
    all: vi.fn(async () => ({ results: [] })),
    bind: vi.fn((...values: unknown[]) => {
      bound = values;
      if (query.includes('INSERT OR IGNORE')) boundRows.push(bound);
      return makeStatement(query, boundRows);
    }),
    first: vi.fn(async () => null),
    raw: vi.fn(async () => []),
    run: vi.fn(async () => ({})),
  };
}

function makeContext(body: unknown, boundRows: unknown[][]): AppContext {
  const db: AppD1Database = {
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({})),
    prepare: vi.fn((query: string) => makeStatement(query, boundRows)),
  };
  return {
    data: { user: { email: 'editor@example.com', id: 'user-1' } },
    env: {
      DB: db,
      KV: {
        delete: vi.fn(async () => {}),
        get: vi.fn(async () => '1'),
        list: vi.fn(async () => ({ cursor: undefined, keys: [], list_complete: true })),
        put: vi.fn(async () => {}),
      },
      MEDIA: {} as AppContext['env']['MEDIA'],
    },
    next: vi.fn(async () => new Response()),
    params: {},
    request: new Request('https://masterselects.com/api/analytics/events', {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://masterselects.com',
      },
      method: 'POST',
    }),
    waitUntil: vi.fn(),
  };
}

describe('product analytics route', () => {
  it('stores valid events under the authenticated user after re-sanitizing properties', async () => {
    const boundRows: unknown[][] = [];
    const response = await onRequest(makeContext({
      events: [{
        appVersion: '2.4.5',
        eventVersion: 1,
        id: 'event:12345678',
        name: 'media_import_completed',
        occurredAt: new Date().toISOString(),
        properties: {
          fileName: 'secret.mov',
          imported_count: 2,
          requested_count: 2,
          runtime_bucket: '1_5s',
          source: 'picker',
        },
        sessionId: 'session:12345678',
      }],
    }, boundRows));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: 1, discarded: 0, ok: true });
    expect(boundRows).toHaveLength(1);
    expect(boundRows[0]?.[1]).toBe('user-1');
    expect(JSON.parse(String(boundRows[0]?.[6]))).toEqual({
      imported_count: 2,
      requested_count: 2,
      runtime_bucket: '1_5s',
      source: 'picker',
    });
  });

  it('rejects foreign origins before touching D1', async () => {
    const boundRows: unknown[][] = [];
    const context = makeContext({ events: [{}] }, boundRows);
    context.request = new Request('https://masterselects.com/api/analytics/events', {
      body: JSON.stringify({ events: [{}] }),
      headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      method: 'POST',
    });
    const response = await onRequest(context);
    expect(response.status).toBe(403);
    expect(boundRows).toEqual([]);
  });
});
