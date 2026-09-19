import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/analytics/csp-report';
import type { AppContext, AppD1Database, AppD1Statement, AppKVNamespace } from '../../functions/lib/env';

// Bind positions of the shared app_diagnostic_events INSERT.
const COLUMN = {
  component: 7,
  contextJson: 27,
  errorName: 18,
  failureCode: 5,
  id: 0,
  kind: 2,
  message: 17,
  outcome: 4,
  pagePath: 22,
  platform: 11,
  stage: 3,
  userAgent: 25,
} as const;

function createKv(): AppKVNamespace {
  const values = new Map<string, string>();
  return {
    delete: async (key) => {
      values.delete(key);
    },
    get: async <T = string>(key: string) => (values.get(key) ?? null) as T | null,
    list: async () => ({ keys: [], list_complete: true }),
    put: async (key, value) => {
      values.set(key, String(value));
    },
  };
}

function makeContext(
  body: string,
  options: { contentType?: string; headers?: Record<string, string>; kv?: AppKVNamespace } = {},
): { context: AppContext; inserted: unknown[][] } {
  const inserted: unknown[][] = [];
  const db: AppD1Database = {
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({})),
    prepare: vi.fn((query: string) => {
      const statement: AppD1Statement = {
        all: vi.fn(async () => ({ results: [] })),
        bind: vi.fn((...values: unknown[]) => {
          if (query.includes('INSERT OR IGNORE INTO app_diagnostic_events')) inserted.push(values);
          return statement;
        }),
        first: vi.fn(async () => null),
        raw: vi.fn(async () => []),
        run: vi.fn(async () => ({})),
      };
      return statement;
    }),
  };
  const request = new Request('https://masterselects.com/api/analytics/csp-report', {
    body,
    headers: {
      'CF-Connecting-IP': '203.0.113.5',
      'Content-Type': options.contentType ?? 'application/csp-report',
      Origin: 'https://masterselects.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0',
      ...options.headers,
    },
    method: 'POST',
  });
  return {
    context: {
      data: {},
      env: { DB: db, KV: options.kv ?? createKv(), MEDIA: {} as AppContext['env']['MEDIA'], SESSION_SECRET: 'secret' },
      next: vi.fn(async () => new Response()),
      params: {},
      request,
      waitUntil: vi.fn(),
    },
    inserted,
  };
}

describe('POST /api/analytics/csp-report', () => {
  it.each([
    ['report', 'reported', 'script-src report-only violation for inline'],
    ['enforce', 'failed', 'script-src blocked inline'],
  ])('distinguishes %s disposition from actual blocking', async (disposition, outcome, message) => {
    const { context, inserted } = makeContext(JSON.stringify({ 'csp-report': {
      'document-uri': 'https://masterselects.com/editor', 'effective-directive': 'script-src',
      'blocked-uri': 'inline', disposition,
    } }));
    expect((await onRequest(context)).status).toBe(204);
    expect(inserted[0][COLUMN.outcome]).toBe(outcome);
    expect(inserted[0][COLUMN.message]).toBe(message);
  });

  it('stores a compact diagnostics row for a legacy report-uri body', async () => {
    const { context, inserted } = makeContext(JSON.stringify({
      'csp-report': {
        'blocked-uri': 'https://evil.example/x.js?token=leak',
        'column-number': 12,
        'document-uri': 'https://masterselects.com/credits/claim?code=secret-code',
        'effective-directive': 'script-src-elem',
        'line-number': 7,
        'source-file': 'https://masterselects.com/assets/app.js',
        'violated-directive': 'script-src',
      },
    }));

    const response = await onRequest(context);

    expect(response.status).toBe(204);
    expect(inserted).toHaveLength(1);
    const row = inserted[0];
    expect(String(row[COLUMN.id])).toMatch(/^csp-report:/);
    expect(row[COLUMN.kind]).toBe('client_runtime');
    expect(row[COLUMN.stage]).toBe('csp_report');
    expect(row[COLUMN.outcome]).toBe('reported');
    expect(row[COLUMN.failureCode]).toBe('csp_violation');
    expect(row[COLUMN.component]).toBe('csp-report');
    expect(row[COLUMN.errorName]).toBe('script-src-elem');
    expect(row[COLUMN.message]).toBe('script-src-elem violation reported for https://evil.example/x.js');
    expect(row[COLUMN.pagePath]).toBe('/credits/claim');
    expect(row[COLUMN.platform]).toBe('windows');
    expect(JSON.parse(String(row[COLUMN.contextJson]))).toEqual({
      blockedUri: 'https://evil.example/x.js',
      columnNumber: 12,
      disposition: null,
      documentUri: 'https://masterselects.com/credits/claim',
      lineNumber: 7,
      sourceFile: 'https://masterselects.com/assets/app.js',
      violatedDirective: 'script-src',
    });
    expect(JSON.stringify(row)).not.toContain('secret-code');
    expect(JSON.stringify(row)).not.toContain('token=leak');
  });

  it('accepts Reporting API batches and drops reports about other origins', async () => {
    const { context, inserted } = makeContext(JSON.stringify([
      {
        age: 10,
        body: { blockedURL: 'inline', documentURL: 'https://masterselects.com/editor', effectiveDirective: 'style-src-attr' },
        type: 'csp-violation',
        url: 'https://masterselects.com/editor',
      },
      {
        age: 10,
        body: { blockedURL: 'inline', documentURL: 'https://other.example/page', effectiveDirective: 'script-src' },
        type: 'csp-violation',
        url: 'https://other.example/page',
      },
      { age: 10, body: { message: 'noise' }, type: 'deprecation', url: 'https://masterselects.com/editor' },
    ]), { contentType: 'application/reports+json' });

    const response = await onRequest(context);

    expect(response.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0][COLUMN.message]).toBe('style-src-attr violation reported for inline');
    expect(inserted[0][COLUMN.pagePath]).toBe('/editor');
  });

  it('rejects other content types, foreign origins, and malformed bodies', async () => {
    expect((await onRequest(makeContext('{}', { contentType: 'application/json' }).context)).status).toBe(415);
    expect((await onRequest(makeContext('{}', { headers: { Origin: 'https://evil.example' } }).context)).status).toBe(403);
    expect((await onRequest(makeContext('not json').context)).status).toBe(400);
  });

  it('rate limits report floods per client address', async () => {
    const kv = createKv();
    const body = JSON.stringify({ 'csp-report': { 'document-uri': 'https://masterselects.com/', 'effective-directive': 'img-src' } });
    let last = 0;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      last = (await onRequest(makeContext(body, { kv }).context)).status;
    }
    expect(last).toBe(429);
  });
});
