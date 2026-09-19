// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppD1Database, AppD1Statement } from '../../functions/lib/env';
import { loadExportRunAnalytics } from '../../functions/lib/exportRunAnalytics';
import { getDiagnosticsAdminSnapshot } from '../../functions/lib/diagnosticsAdmin';
import { loadDiagnosticBuildComparison } from '../../functions/lib/diagnosticBuildComparison';

let sqlite: DatabaseSync;
let db: AppD1Database;
let receivedAt: string;
const currentBuild = '2026-09-06T07:00:00.000Z';
const previousBuild = '2026-09-05T07:00:00.000Z';

beforeEach(() => {
  receivedAt = new Date().toISOString();
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE product_analytics_events (
    id TEXT, session_id TEXT, event_name TEXT, properties_json TEXT, received_at TEXT);
    CREATE TABLE app_diagnostic_events (
    kind TEXT, received_at TEXT, context_json TEXT, session_id TEXT, fingerprint TEXT,
    repeat_count INTEGER, message TEXT, component TEXT, user_agent TEXT);`);
  db = { prepare(sql: string) {
    let values: Array<string | number | null> = [];
    const statement = {
      bind(...input: typeof values) { values = input; return statement; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    };
    return statement as AppD1Statement;
  } } as AppD1Database;
});
afterEach(() => sqlite.close());

function event(name: string, runId: string | null, session = 'session-a') {
  sqlite.prepare('INSERT INTO product_analytics_events VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), session, name, JSON.stringify({ run_id: runId }), receivedAt);
}
function open(build: string, session: string) {
  sqlite.prepare('INSERT INTO product_analytics_events VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), session, 'app_opened', JSON.stringify({ build_id: build }), receivedAt);
}
function failure(build: string | null, fingerprint: string, session: string, repeats = 1) {
  sqlite.prepare('INSERT INTO app_diagnostic_events (kind, received_at, context_json, session_id, fingerprint, repeat_count, message, component) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('client_runtime', receivedAt, JSON.stringify({ context: { buildId: build } }), session,
      fingerprint, repeats, 'Example failure', 'ClipWaveformAnalysis');
}

describe('export run outcomes', () => {
  it('counts runs once, separates cancellation and keeps missing outcomes unresolved', async () => {
    event('export_started', 'success'); event('export_started', 'success');
    event('export_completed', 'success'); event('export_completed', 'success');
    event('export_started', 'cancel'); event('export_cancelled', 'cancel');
    event('export_started', 'fail'); event('export_failed', 'fail');
    event('export_started', 'pending');
    event('export_completed', 'orphan');
    event('export_started', null);
    expect(await loadExportRunAnalytics(db)).toEqual({
      available: true, started: 4, completed: 1, cancelled: 1, failed: 1,
      withoutOutcome: 1, eventsWithoutRunId: 1,
    });
  });
  it('does not merge equal run IDs from different sessions', async () => {
    event('export_started', 'shared', 'a'); event('export_completed', 'shared', 'a');
    event('export_started', 'shared', 'b');
    expect(await loadExportRunAnalytics(db)).toMatchObject({ started: 2, completed: 1, withoutOutcome: 1 });
  });
  it('uses the latest received terminal outcome when reports conflict', async () => {
    event('export_started', 'run'); event('export_failed', 'run');
    receivedAt = new Date(Date.now() + 1000).toISOString();
    event('export_completed', 'run');
    expect(await loadExportRunAnalytics(db)).toMatchObject({ started: 1, completed: 1, failed: 0 });
  });
});

describe('diagnostic build comparison', () => {
  it('retains enforced and unknown CSP failures while excluding report-only observations', async () => {
    open(previousBuild, 'previous-build');
    for (const disposition of ['report', 'enforce', 'unknown']) {
      failure(currentBuild, disposition, disposition);
      sqlite.prepare('UPDATE app_diagnostic_events SET component = ?, context_json = ? WHERE session_id = ?')
        .run('csp-report', JSON.stringify({ disposition, context: { buildId: currentBuild } }), disposition);
    }
    const result = await loadDiagnosticBuildComparison(db);
    expect(result.builds[0].errorSessions).toBe(2);
    expect(result.errors.map(error => error.fingerprint).toSorted()).toEqual(['enforce', 'unknown']);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM app_diagnostic_events').get()?.n).toBe(3);
  });

  it('includes a new build with no errors using app-open observations', async () => {
    open(previousBuild, 'old'); failure(previousBuild, 'waveform', 'old-errors', 20);
    open(currentBuild, 'new');
    failure(null, 'legacy', 'legacy-errors');
    const result = await loadDiagnosticBuildComparison(db);
    expect(result.available).toBe(true);
    expect(result.builds.map(build => build.id)).toEqual([currentBuild, previousBuild]);
    expect(result.builds[0]).toMatchObject({ appSessions: 1, errorSessions: 0 });
    expect(result.errors[0]).toMatchObject({
      fingerprint: 'waveform', currentOccurrences: 0, previousOccurrences: 20,
      currentSessions: 0, previousSessions: 1,
    });
    expect(result.legacyEvents).toBe(1);
  });
  it('compares sessions independently of repeated reports', async () => {
    failure(previousBuild, 'shared', 'old-a', 500);
    failure(currentBuild, 'shared', 'new-a', 1);
    failure(currentBuild, 'shared', 'new-b', 1);
    failure(currentBuild, 'shared', 'new-b', 1);
    const result = await loadDiagnosticBuildComparison(db);
    expect(result.errors[0]).toMatchObject({
      previousOccurrences: 500, currentOccurrences: 3, previousSessions: 1, currentSessions: 2,
    });
  });
  it('excludes recognizable automated errors without deleting their reports', async () => {
    failure(currentBuild, 'gpu', 'person');
    failure(currentBuild, 'gpu', 'crawler', 100);
    failure(previousBuild, 'gpu', 'old');
    sqlite.prepare('UPDATE app_diagnostic_events SET user_agent = ? WHERE session_id = ?')
      .run('Mozilla/5.0 (compatible; bingbot/2.0)', 'crawler');
    const result = await loadDiagnosticBuildComparison(db);
    expect(result.builds[0].errorSessions).toBe(1);
    expect(result.errors[0]).toMatchObject({ currentSessions: 1, currentOccurrences: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM app_diagnostic_events').get()?.n).toBe(3);
  });
  it('does not fabricate a comparison from version-only or development data', async () => {
    failure(null, 'legacy', 'a'); failure('development', 'dev', 'b');
    const result = await loadDiagnosticBuildComparison(db);
    expect(result).toEqual({ available: true, builds: [], errors: [], legacyEvents: 2 });
  });
});


describe('runtime traffic separation', () => {
  it('separates automation consistently in totals, groups, trends and recent errors', async () => {
    for (const name of ['id', 'stage', 'failure_code', 'error_name', 'app_version', 'country',
      'device_class', 'platform', 'browser', 'occurred_at', 'user_id', 'stack', 'device_id', 'page_path']) {
      sqlite.exec(`ALTER TABLE app_diagnostic_events ADD COLUMN ${name} TEXT`);
    }
    failure(currentBuild, 'gpu', 'visitor', 2);
    failure(currentBuild, 'gpu', 'unknown-agent');
    const agents = ['Googlebot/2.1', 'bingbot/2.0', 'HeadlessChrome/146.0',
      'meta-externalads/1.1', 'meta-webindexer/1.1', 'Baiduspider-render/2.0'];
    agents.forEach((agent, index) => {
      failure(currentBuild, 'gpu', `automated-${index}`, 10);
      sqlite.prepare('UPDATE app_diagnostic_events SET user_agent = ? WHERE session_id = ?')
        .run(agent, `automated-${index}`);
    });
    sqlite.prepare('UPDATE app_diagnostic_events SET user_agent = ? WHERE session_id = ?')
      .run('Mozilla/5.0 Chrome/151.0', 'visitor');
    sqlite.exec("UPDATE app_diagnostic_events SET platform='windows', browser='chrome', stage='logger_error'");
    failure(currentBuild, 'csp', 'report-only-observation', 100);
    sqlite.prepare('UPDATE app_diagnostic_events SET component = ?, context_json = ? WHERE session_id = ?')
      .run('csp-report', JSON.stringify({ disposition: 'report', context: { buildId: currentBuild } }), 'report-only-observation');
    const { clientRuntime: result } = await getDiagnosticsAdminSnapshot(db);
    expect(result.available).toBe(true);
    expect(result.stats).toMatchObject({
      events7d: 2, sessions7d: 2, occurrences7d: 3,
      excludedAutomatedEvents7d: 6, excludedAutomatedSessions7d: 6,
    });
    expect(result.topErrors7d[0]).toMatchObject({ sessions: 2, occurrences: 3 });
    expect(result.daily14d[0]).toMatchObject({ events: 2, sessions: 2 });
    expect(result.breakdowns.platforms).toEqual([{ value: 'windows', count: 2 }]);
    expect(result.recentErrors).toHaveLength(2);
    expect(result.buildComparison?.builds[0].errorSessions).toBe(2);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM app_diagnostic_events').get()?.n).toBe(9);
  });
});
