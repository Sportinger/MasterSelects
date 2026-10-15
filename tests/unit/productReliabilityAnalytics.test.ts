// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppD1Database, AppD1Statement } from '../../functions/lib/env';
import { loadProductFunnels } from '../../functions/lib/productAnalyticsFunnels';
import { loadProductReliabilityAnalytics } from '../../functions/lib/productReliabilityAnalytics';

let sqlite: DatabaseSync;
let db: AppD1Database;
let now: number;

beforeEach(() => {
  now = Date.now();
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE product_analytics_events (
    id TEXT, user_id TEXT, session_id TEXT, event_name TEXT, app_version TEXT,
    properties_json TEXT, occurred_at TEXT, received_at TEXT)`);
  db = { prepare(sql: string) {
    let args: Array<string | number | null> = [];
    const statement = {
      bind(...values: typeof args) { args = values; return statement; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    };
    return statement as AppD1Statement;
  } } as AppD1Database;
});
afterEach(() => sqlite.close());

function event(name: string, session: string, properties: object = {}, offset = 0, received = now) {
  sqlite.prepare('INSERT INTO product_analytics_events VALUES (?, NULL, ?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), session, name, '3.1.9', JSON.stringify(properties),
      new Date(now + offset).toISOString(), new Date(received).toISOString());
}

describe('activation and acquisition funnels', () => {
  it('includes direct editor entry and keeps sequential steps despite batched delivery', async () => {
    for (const [index, name] of ['app_opened', 'media_import_completed', 'timeline_edit_committed',
      'export_started', 'export_completed'].entries()) event(name, 'direct', {}, index * 1000);
    event('app_opened', 'out-of-order', {}, 1000);
    event('media_import_completed', 'out-of-order', {}, 0); // Same received_at, before open.
    event('timeline_edit_committed', 'out-of-order', {}, 2000);
    event('app_opened', 'repeat'); event('app_opened', 'repeat');
    event('landing_viewed', 'acquisition');
    event('landing_option_selected', 'acquisition', {}, 1000);
    event('landing_option_selected', 'selection-only');
    event('app_opened', 'expired', {}, -31 * 86400000, now - 31 * 86400000);
    const result = await loadProductFunnels(db);
    expect(result.editor.map(step => step.count)).toEqual([3, 1, 1, 1, 1]);
    expect(result.editor[1].conversionFromStart).toBeCloseTo(1 / 3);
    expect(result.editor[1].dropoffFromPrevious).toBeCloseTo(2 / 3);
    expect(result.landing.map(step => step.count)).toEqual([1, 1]);
  });
  it('does not require landing events and reports an empty cohort without NaN', async () => {
    event('app_opened', 'direct');
    const result = await loadProductFunnels(db);
    expect(result.editor[0]).toMatchObject({ count: 1, conversionFromStart: 1 });
    expect(result.landing.every(step => step.count === 0 && step.conversionFromStart === 0)).toBe(true);
  });
});

describe('project action reliability', () => {
  it('separates historical and new cancellations from failures without duplicating sessions', async () => {
    event('app_opened', 'a', { platform: 'linux', build_id: 'build-a' });
    event('app_opened', 'a', { platform: 'windows', build_id: 'build-b' }, 1000, now + 1000);
    event('project_action_failed', 'a', { action: 'create', reason: 'cancelled' });
    event('project_action_failed', 'a', { action: 'open', failure_code: 'cancelled' });
    event('project_action_cancelled', 'b', { action: 'open' });
    event('project_action_failed', 'a', { action: 'open', failure_code: 'permission_denied', failure_stage: 'load' });
    event('project_action_failed', 'a', { action: 'create', failure_code: 'unknown' });
    event('project_action_failed', 'c');
    event('project_action_failed', 'expired', {}, -8 * 86400000, now - 8 * 86400000);
    const { projectActions: result } = await loadProductReliabilityAnalytics(db);
    expect(result).toMatchObject({ available: true, events: 6, sessions: 3, cancelled: 3,
      failed: 3, failedSessions: 2, unclassified: 2, groupsTruncated: false });
    expect(result.groups.find(group => group.failureCode === 'permission_denied'))
      .toMatchObject({ events: 1, platform: 'linux', buildId: 'build-a', outcome: 'failed' });
    expect(result.groups.find(group => group.platform === 'unknown')).toBeDefined();
    expect(JSON.stringify(result)).not.toContain('session_id');
  });
  it('keeps full totals when bounded breakdowns are truncated', async () => {
    for (let i = 0; i < 55; i++) {
      event('app_opened', `s${i}`, { build_id: `build-${i}` });
      event('project_action_failed', `s${i}`, { failure_code: 'unknown' });
    }
    const result = (await loadProductReliabilityAnalytics(db)).projectActions;
    expect(result).toMatchObject({ events: 55, failedSessions: 55, groupsTruncated: true });
    expect(result.groups).toHaveLength(50);
  });
});

describe('playback health aggregates', () => {
  it('weights FPS by samples, distinguishes missing data, and excludes alerts from windows', async () => {
    event('app_opened', 'a', { platform: 'linux', build_id: 'build-a' });
    event('app_opened', 'a', { platform: 'linux', build_id: 'build-a' });
    const common = { kind: 'window', decoder: 'none', fps_target: 30, layers: 1 };
    event('preview_health', 'a', { ...common, samples: 2, fps_avg: 10, fps_min: 0, drops: 3 });
    event('preview_health', 'a', { ...common, samples: 5, fps_avg: 30, fps_min: 20, drops: 2 });
    event('preview_health', 'a', { ...common, samples: 0, fps_avg: 0, fps_min: 0 });
    event('preview_health', 'a', { ...common, kind: 'black_alert', samples: 10, fps_avg: 0, drops: 99 });
    event('preview_health', 'b', { ...common, layers: 0, samples: 2, fps_avg: 0, fps_min: 0 });
    event('preview_health', 'b', { ...common, samples: 4, fps_avg: 5, fps_min: 0,
      telemetry_version: 2, build_id: 'build-b', renderer: 'worker-only', compared_samples: 3,
      slow_samples: 2, idle_samples: 1 });
    const { previewHealth: result } = await loadProductReliabilityAnalytics(db);
    expect(result).toMatchObject({ available: true, windows: 5, sessions: 2, invalidWindows: 1, instrumentedWindows: 1 });
    expect(result.groups.find(group => group.buildId === 'build-a')).toMatchObject({
      windows: 3, sessions: 1, sampleWeightedFps: 24.3, samples: 7, comparableWindows: 2,
      lowFpsWindows: 1, lowFpsSessions: 1, drops: 5,
    });
    expect(result.groups.find(group => group.buildId === 'build-b')).toMatchObject({
      renderer: 'worker-only', comparedSamples: 3, slowSamples: 2, idleSamples: 1,
    });
    expect(result.groups.find(group => group.buildId === 'unknown')).toMatchObject({
      emptyLayerWindows: 1, comparableWindows: 0, lowFpsWindows: 0,
    });
  });
  it('reports missing tables as unavailable, rather than zero failures', async () => {
    sqlite.exec('DROP TABLE product_analytics_events');
    const result = await loadProductReliabilityAnalytics(db);
    expect(result.projectActions.available).toBe(false);
    expect(result.previewHealth.available).toBe(false);
  });
});
