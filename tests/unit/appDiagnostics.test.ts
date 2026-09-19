import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/analytics/diagnostics';
import type { AppContext, AppD1Database, AppD1Statement } from '../../functions/lib/env';
import { resolveRuntimeDeviceContext } from '../../src/utils/runtimeDeviceContext';
import {
  buildRuntimeFingerprint,
  classifyRuntimeFailure,
  normalizeErrorMessage,
  topStackFrame,
} from '../../src/services/diagnostics/diagnosticFingerprint';

interface ContextOptions {
  body: unknown;
  country?: string;
  ownedTask?: boolean;
  user?: { email: string; id: string } | null;
  userAgent?: string;
}

// Bind positions of the INSERT statement in functions/api/analytics/diagnostics.ts.
const COLUMN = {
  appVersion: 14,
  component: 7,
  contextJson: 27,
  country: 26,
  deviceId: 24,
  errorName: 18,
  failureCode: 5,
  fingerprint: 20,
  id: 0,
  message: 17,
  pagePath: 22,
  repeatCount: 21,
  sessionId: 23,
  stack: 19,
  stage: 3,
  userAgent: 25,
  userId: 1,
} as const;

function makeContext(options: ContextOptions, inserted: unknown[][]): AppContext {
  const db: AppD1Database = {
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({})),
    prepare: vi.fn((query: string) => {
      let bound: unknown[] = [];
      const statement: AppD1Statement = {
        all: vi.fn(async () => ({ results: [] })),
        bind: vi.fn((...values: unknown[]) => {
          bound = values;
          if (query.includes('INSERT OR IGNORE INTO app_diagnostic_events')) inserted.push(bound);
          return statement;
        }),
        first: vi.fn(async () => query.includes('FROM ai_audit_events') && options.ownedTask
          ? { model: 'nano-banana-2', output_type: 'image', provider: 'google' }
          : null),
        raw: vi.fn(async () => []),
        run: vi.fn(async () => ({})),
      };
      return statement;
    }),
  };
  const request = new Request('https://masterselects.com/api/analytics/diagnostics', {
    body: JSON.stringify(options.body),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://masterselects.com',
      'User-Agent': options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0',
    },
    method: 'POST',
  });
  if (options.country) {
    Object.defineProperty(request, 'cf', { value: { country: options.country } });
  }
  return {
    data: options.user === null ? {} : { user: options.user ?? { email: 'editor@example.com', id: 'user-1' } },
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
    request,
    waitUntil: vi.fn(),
  };
}

function validAiEvent() {
  return {
    appVersion: '2.4.5',
    browser: 'safari',
    deviceClass: 'tablet',
    id: 'diagnostic:12345678',
    kind: 'ai_generation',
    occurredAt: new Date().toISOString(),
    outcome: 'failed',
    platform: 'ios',
    stage: 'import',
    failureCode: 'decode_failed',
    taskId: 'task-123456',
  };
}

function validRuntimeEvent(overrides: Record<string, unknown> = {}) {
  return {
    appVersion: '3.1.2',
    breadcrumbs: [
      { level: 'INFO', message: 'console: loading project', source: 'console', t: '2026-09-02T10:00:00.000Z' },
      { level: 'ERROR', message: 'window-error: boom', source: 'window-error', t: '2026-09-02T10:00:01.000Z' },
    ],
    browser: 'chrome',
    context: { pageUrl: '/editor', uptimeMs: 4200, viewport: { dpr: 2, height: 900, width: 1440 }, webgpu: { adapter: null, supported: true } },
    deviceClass: 'desktop',
    deviceId: 'device:4c5f6f4e-1d3a-4d8f-9c2c-1a2b3c4d5e6f',
    errorName: 'TypeError',
    failureCode: 'javascript_error',
    fingerprint: 'a1b2c3d4e5f60718',
    id: 'diagnostic:runtime-1',
    kind: 'client_runtime',
    message: "Cannot read properties of undefined (reading 'clips')",
    occurredAt: new Date().toISOString(),
    outcome: 'failed',
    pagePath: '/editor?project=demo',
    platform: 'windows',
    repeatCount: 4,
    sessionId: 'session:9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f',
    stack: "TypeError: Cannot read properties of undefined (reading 'clips')\n    at useClipDrag (https://www.masterselects.com/assets/index-D_85E1W0.js:12:3456)",
    stage: 'window_error',
    ...overrides,
  };
}

describe('app diagnostics route', () => {
  it('stores the fixed taxonomy plus failure details for an owned AI task', async () => {
    const inserted: unknown[][] = [];
    const response = await onRequest(makeContext({
      body: { events: [{ ...validAiEvent(), message: 'Provider returned 502', rawError: 'not a known field' }] },
      ownedTask: true,
    }, inserted));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: 1, discarded: 0, ok: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.[COLUMN.failureCode]).toBe('decode_failed');
    expect(inserted[0]).toContain('nano-banana-2');
    expect(inserted[0]?.[COLUMN.message]).toBe('Provider returned 502');
    expect(JSON.stringify(inserted[0])).not.toContain('not a known field');
  });

  it('silently discards lifecycle reports for tasks not owned by the user', async () => {
    const inserted: unknown[][] = [];
    const response = await onRequest(makeContext({
      body: { events: [validAiEvent()] },
      ownedTask: false,
    }, inserted));

    expect(await response.json()).toMatchObject({ accepted: 0, discarded: 1, ok: true });
    expect(inserted).toEqual([]);
  });

  it('stores full runtime failure content without a signed-in account', async () => {
    const inserted: unknown[][] = [];
    const response = await onRequest(makeContext({
      body: { events: [validRuntimeEvent()] },
      country: 'de',
      user: null,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/142.0',
    }, inserted));

    expect(response.status).toBe(202);
    const row = inserted[0] ?? [];
    expect(row[COLUMN.userId]).toBeNull();
    expect(row[COLUMN.stage]).toBe('window_error');
    expect(row[COLUMN.failureCode]).toBe('javascript_error');
    expect(row[COLUMN.message]).toContain("reading 'clips'");
    expect(row[COLUMN.errorName]).toBe('TypeError');
    expect(row[COLUMN.stack]).toContain('useClipDrag');
    expect(row[COLUMN.fingerprint]).toBe('a1b2c3d4e5f60718');
    expect(row[COLUMN.repeatCount]).toBe(4);
    expect(row[COLUMN.pagePath]).toBe('/editor?project=demo');
    expect(row[COLUMN.sessionId]).toBe('session:9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f');
    expect(row[COLUMN.deviceId]).toBe('device:4c5f6f4e-1d3a-4d8f-9c2c-1a2b3c4d5e6f');
    expect(row[COLUMN.userAgent]).toContain('Firefox/142.0');
    expect(row[COLUMN.country]).toBe('DE');
    const context = JSON.parse(String(row[COLUMN.contextJson])) as { breadcrumbs: unknown[]; context: { viewport: unknown } };
    expect(context.breadcrumbs).toHaveLength(2);
    expect(context.context.viewport).toEqual({ dpr: 2, height: 900, width: 1440 });
  });

  it('truncates oversized content and sanitizes identifiers instead of dropping the event', async () => {
    const inserted: unknown[][] = [];
    const hugeStack = 'x'.repeat(20_000);
    const response = await onRequest(makeContext({
      body: { events: [validRuntimeEvent({
        component: 'Flash Board/Job!',
        failureCode: 'Some Weird Code',
        fingerprint: 'not-a-fingerprint',
        message: 'm'.repeat(6_000),
        pagePath: 'javascript:alert(1)',
        repeatCount: -3,
        sessionId: 'x',
        stack: hugeStack,
        stage: 'console_error',
      })] },
      user: null,
    }, inserted));

    expect(response.status).toBe(202);
    const row = inserted[0] ?? [];
    expect(row[COLUMN.stage]).toBe('console_error');
    expect(row[COLUMN.component]).toBe('Flash_Board_Job_');
    expect(row[COLUMN.failureCode]).toBe('unknown');
    expect(row[COLUMN.fingerprint]).toBeNull();
    expect(String(row[COLUMN.message]).length).toBeLessThan(4_100);
    expect(String(row[COLUMN.stack]).length).toBeLessThan(12_100);
    expect(row[COLUMN.pagePath]).toBeNull();
    expect(row[COLUMN.repeatCount]).toBe(1);
    expect(row[COLUMN.sessionId]).toBeNull();
  });

  it('rejects events with an unknown stage shape or missing required fields', async () => {
    const inserted: unknown[][] = [];
    const response = await onRequest(makeContext({
      body: { events: [
        validRuntimeEvent({ stage: 'DROP TABLE users' }),
        validRuntimeEvent({ browser: 'netscape' }),
      ] },
      user: null,
    }, inserted));

    expect(await response.json()).toMatchObject({ accepted: 0, discarded: 2, ok: true });
    expect(inserted).toEqual([]);
  });
});

describe('runtime failure fingerprinting', () => {
  it('groups the same error across builds, line numbers, and ids', () => {
    const first = buildRuntimeFingerprint({
      errorName: 'TypeError',
      message: "Cannot read properties of undefined (reading 'clips') for clip 4f2a1b3c-0000-4000-8000-000000000000",
      stack: 'TypeError: x\n    at useClipDrag (https://www.masterselects.com/assets/index-D_85E1W0.js:12:3456)',
      stage: 'window_error',
    });
    const second = buildRuntimeFingerprint({
      errorName: 'TypeError',
      message: "Cannot read properties of undefined (reading 'clips') for clip 9a8b7c6d-1111-4111-8111-111111111111",
      stack: 'TypeError: x\n    at useClipDrag (https://www.masterselects.com/assets/index-Zq9Lm2Pa.js:98:7)',
      stage: 'window_error',
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(normalizeErrorMessage('clip 12 of 40 failed at 0x1f')).toBe('clip <n> of <n> failed at <hex>');
    expect(topStackFrame('Error: x\n    at foo (https://host/assets/chunk-AbCdEf12.js:1:2)')).toBe('foo (/assets/chunk.js)');
  });

  it('classifies by error name and stage instead of loose text heuristics', () => {
    expect(classifyRuntimeFailure({ errorName: 'TypeError', message: 'x is not a function', stage: 'window_error' })).toBe('javascript_error');
    expect(classifyRuntimeFailure({ errorName: 'TypeError', message: 'Failed to fetch', stage: 'unhandledrejection' })).toBe('network_unavailable');
    expect(classifyRuntimeFailure({ message: 'Failed to fetch dynamically imported module: /assets/App-1.js', stage: 'unhandledrejection' })).toBe('chunk_load_failed');
    expect(classifyRuntimeFailure({ message: 'Validation error: invalid bind group', stage: 'webgpu_uncapturederror' })).toBe('webgpu_uncaptured_error');
    expect(classifyRuntimeFailure({ errorName: 'QuotaExceededError', message: 'The quota has been exceeded.', stage: 'logger_error' })).toBe('storage_quota');
    expect(classifyRuntimeFailure({ message: 'boom', stage: 'react_render' })).toBe('react_render_error');
    expect(classifyRuntimeFailure({ message: 'Something odd', stage: 'unhandledrejection' })).toBe('unhandled_rejection');
  });
});

describe('runtime device classification', () => {
  it('recognizes iPadOS desktop user agents as iOS tablets', () => {
    expect(resolveRuntimeDeviceContext({
      maxTouchPoints: 5,
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    }, 1024)).toEqual({ browser: 'safari', deviceClass: 'tablet', platform: 'ios' });
  });

  it('keeps Android phones distinct from Linux desktop', () => {
    expect(resolveRuntimeDeviceContext({
      userAgentData: { mobile: true, platform: 'Android' },
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
    }, 412)).toEqual({ browser: 'chrome', deviceClass: 'mobile', platform: 'android' });
  });
});
