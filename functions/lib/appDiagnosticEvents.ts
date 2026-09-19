import type { AppContext, AppD1Database, AppD1Statement } from './env';

export const APP_DIAGNOSTICS_RETENTION_DAYS = 90;
const RETENTION_GUARD_KEY = 'app-diagnostics:retention-cleanup';

export type AppDiagnosticPlatform = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'other';
export type AppDiagnosticDeviceClass = 'desktop' | 'tablet' | 'mobile';
export type AppDiagnosticBrowser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

/** One row of `app_diagnostic_events` (migrations 0025 + 0027). */
export interface AppDiagnosticEventRecord {
  appVersion: string | null;
  browser: string;
  component: string | null;
  contextJson: string | null;
  country: string | null;
  deviceClass: string;
  deviceId: string | null;
  errorName: string | null;
  failureCode: string | null;
  fingerprint: string | null;
  id: string;
  kind: 'ai_generation' | 'client_runtime';
  message: string | null;
  model: string | null;
  occurredAt: string;
  outcome: string;
  outputType: string | null;
  pagePath: string | null;
  platform: string;
  provider: string | null;
  providerTaskId: string | null;
  receivedAt: string;
  repeatCount: number;
  sessionId: string | null;
  stack: string | null;
  stage: string;
  userAgent: string | null;
  userId: string | null;
}

export function prepareAppDiagnosticEventInsert(
  db: AppD1Database,
  event: AppDiagnosticEventRecord,
): AppD1Statement {
  return db.prepare(
    `INSERT OR IGNORE INTO app_diagnostic_events (
       id, user_id, kind, stage, outcome, failure_code, provider_task_id, component,
       provider, model, output_type, platform, device_class, browser,
       app_version, occurred_at, received_at,
       message, error_name, stack, fingerprint, repeat_count, page_path,
       session_id, device_id, user_agent, country, context_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    event.id,
    event.userId,
    event.kind,
    event.stage,
    event.outcome,
    event.failureCode,
    event.providerTaskId,
    event.component,
    event.provider,
    event.model,
    event.outputType,
    event.platform,
    event.deviceClass,
    event.browser,
    event.appVersion,
    event.occurredAt,
    event.receivedAt,
    event.message,
    event.errorName,
    event.stack,
    event.fingerprint,
    event.repeatCount,
    event.pagePath,
    event.sessionId,
    event.deviceId,
    event.userAgent,
    event.country,
    event.contextJson,
  );
}

export async function insertAppDiagnosticEvents(
  db: AppD1Database,
  events: AppDiagnosticEventRecord[],
): Promise<void> {
  if (events.length === 0) return;
  await db.batch(events.map((event) => prepareAppDiagnosticEventInsert(db, event)));
}

/** Runs the retention delete at most once per hour across all writers. */
export async function scheduleAppDiagnosticRetentionCleanup(context: AppContext): Promise<void> {
  if (await context.env.KV.get(RETENTION_GUARD_KEY)) return;
  await context.env.KV.put(RETENTION_GUARD_KEY, '1', { expirationTtl: 60 * 60 });
  const cutoff = new Date(Date.now() - APP_DIAGNOSTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await context.env.DB.prepare(
    'DELETE FROM app_diagnostic_events WHERE received_at < ?',
  ).bind(cutoff).run();
}

export function requestCountry(request: Request): string | null {
  const cf = (request as Request & { cf?: { country?: unknown } }).cf;
  const country = typeof cf?.country === 'string' ? cf.country.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

export function classifyDiagnosticBrowser(userAgent: string): AppDiagnosticBrowser {
  if (/Edg\//i.test(userAgent)) return 'edge';
  if (/Chrome\/|CriOS\//i.test(userAgent)) return 'chrome';
  if (/Firefox\/|FxiOS\//i.test(userAgent)) return 'firefox';
  if (/Safari\//i.test(userAgent)) return 'safari';
  return 'other';
}

export function classifyDiagnosticDeviceClass(userAgent: string): AppDiagnosticDeviceClass {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) return 'tablet';
  if (/Mobile|iPhone|Android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

export function classifyDiagnosticPlatform(userAgent: string): AppDiagnosticPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macos';
  if (/Linux|X11/i.test(userAgent)) return 'linux';
  return 'other';
}
