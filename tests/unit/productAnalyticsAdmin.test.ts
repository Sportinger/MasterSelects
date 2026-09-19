import { describe, expect, it } from 'vitest';

import type { AppD1Database, AppD1Statement } from '../../functions/lib/env';
import { getProductAnalyticsAdminSnapshot } from '../../functions/lib/productAnalyticsAdmin';

const FUNNEL_COUNTS = {
  app_opened: 34,
  export_completed: 1,
  export_started: 2,
  landing_option_selected: 34,
  landing_viewed: 229,
  media_import_completed: 10,
  timeline_edit_committed: 10,
};

class AnalyticsStatement implements AppD1Statement {
  constructor(private readonly query: string) {}

  bind(): AppD1Statement {
    return this;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }

  async first<T>(): Promise<T | null> {
    if (this.query.includes('AS landing_viewed')) return FUNNEL_COUNTS as T;
    return null;
  }

  async raw<T>(): Promise<T[]> {
    return [];
  }

  async run(): Promise<unknown> {
    return {};
  }
}

function createAnalyticsDb(queries: string[]): AppD1Database {
  return {
    async batch<T>(): Promise<T[]> {
      return [];
    },
    async exec(): Promise<unknown> {
      return {};
    },
    prepare(query: string): AppD1Statement {
      queries.push(query);
      return new AnalyticsStatement(query);
    },
  };
}

describe('product analytics admin snapshot', () => {
  it('loads the seven-step funnel without exceeding the D1 compound-select limit', async () => {
    const queries: string[] = [];

    const snapshot = await getProductAnalyticsAdminSnapshot(createAnalyticsDb(queries));

    expect(snapshot.available).toBe(true);
    expect(snapshot.funnel30d.map(({ count, step }) => ({ count, step }))).toEqual([
      { count: 229, step: 'landing_viewed' },
      { count: 34, step: 'landing_option_selected' },
      { count: 34, step: 'app_opened' },
      { count: 10, step: 'media_import_completed' },
      { count: 10, step: 'timeline_edit_committed' },
      { count: 2, step: 'export_started' },
      { count: 1, step: 'export_completed' },
    ]);

    const funnelQuery = queries.find((query) => query.includes('WITH base AS'));
    expect(funnelQuery).toBeDefined();
    expect(funnelQuery).not.toContain('UNION ALL');
    expect(funnelQuery).toContain('(SELECT COUNT(*) FROM export_completed) AS export_completed');
  });
});
