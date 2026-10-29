// App version, update check and a short, sanitized diagnostics report for the phone Settings sheet.
// The update check compares the loaded build with the server's /build-info.json (services/appUpdate);
// a build without that file (the dev server) says so instead of claiming to be current.

import { APP_VERSION } from '../../../version';
import { APP_BUILD_ID, APP_RELEASE_ID, APP_SOURCE_REVISION } from '../../../services/appBuild';
import { compareAppBuild, fetchServerBuildInfo } from '../../../services/appUpdate/appUpdateCheck';
import { Logger, type LogEntry } from '../../../services/logger';
import type { PhoneRuntimeStatus } from '../contracts';

export type PhoneUpdateState =
  | { kind: 'current'; message: string }
  | { kind: 'available'; message: string; serverVersion: string }
  | { kind: 'unknown'; message: string };

export function describePhoneBuild(): string {
  const revision = APP_SOURCE_REVISION ? ` · ${APP_SOURCE_REVISION.slice(0, 7)}` : '';
  return `Version ${APP_VERSION}${revision}${APP_RELEASE_ID ? '' : ' · local build'}`;
}

interface BuildInfo { version?: unknown; buildId?: unknown; releaseId?: unknown }

/** Pure comparison of the loaded build with the server's build info (same rule as the top bar's check). */
export function comparePhoneBuild(loaded: { version: string; buildId: string; releaseId?: string | null }, server: BuildInfo | null): PhoneUpdateState {
  const comparison = compareAppBuild({ version: loaded.version, buildId: loaded.buildId, releaseId: loaded.releaseId ?? null }, server);
  if (comparison.kind === 'unknown') {
    return { kind: 'unknown', message: 'This build cannot check for updates (no build info on the server).' };
  }
  if (comparison.kind === 'current') return { kind: 'current', message: `You have the latest version (${loaded.version}).` };
  return {
    kind: 'available',
    message: `Version ${comparison.version} is ready. Reload to update; your project is saved first.`,
    serverVersion: comparison.version,
  };
}

export async function checkPhoneAppUpdate(fetcher: typeof fetch = fetch): Promise<PhoneUpdateState> {
  const loaded = { version: APP_VERSION, buildId: APP_BUILD_ID, releaseId: APP_RELEASE_ID };
  try {
    return comparePhoneBuild(loaded, await fetchServerBuildInfo(fetcher, Date.now()) as BuildInfo | null);
  } catch {
    return { kind: 'unknown', message: 'The update check needs a connection. Try again when you are online.' };
  }
}

/** Strips query strings, tokens and long ids so a diagnostics line can be shared safely. */
export function sanitizePhoneLogLine(text: string): string {
  return text
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1')
    .replace(/\b(Bearer|token|key)[=:\s]+[^\s,;]+/gi, '$1 [hidden]')
    .replace(/\b[a-f0-9]{24,}\b/gi, '[id]')
    .slice(0, 200);
}

export interface PhoneDiagnostics { rows: Array<[string, string]>; errors: string[] }

async function storageRow(): Promise<string> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota) return 'Unknown';
    const persisted = await navigator.storage.persisted?.().catch(() => false);
    const mb = (value: number | undefined) => `${Math.round((value ?? 0) / 1_048_576)} MB`;
    return `${mb(estimate.usage)} of ${mb(estimate.quota)}${persisted ? ' · kept by the browser' : ' · the browser may clear it'}`;
  } catch {
    return 'Unknown';
  }
}

export async function collectPhoneDiagnostics(status: PhoneRuntimeStatus, entries: readonly LogEntry[] = Logger.errors()): Promise<PhoneDiagnostics> {
  const engine = status.engineError ? `Problem: ${sanitizePhoneLogLine(status.engineError)}` : status.engineReady ? 'Ready' : 'Starting';
  const rows: Array<[string, string]> = [
    ['App', describePhoneBuild()],
    ['Preview engine', engine],
    ['WebGPU', typeof navigator !== 'undefined' && 'gpu' in navigator ? 'Available' : 'Not available'],
    ['Video encoder', typeof VideoEncoder === 'function' ? 'Available' : 'Not available'],
    ['Storage', await storageRow()],
    ['Screen', `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`],
    ['Errors this session', String(entries.length)],
  ];
  const errors = entries.slice(-5).map((entry) => sanitizePhoneLogLine(`${entry.module}: ${entry.message}`));
  return { rows, errors };
}

export function formatPhoneDiagnostics(diagnostics: PhoneDiagnostics): string {
  return [
    ...diagnostics.rows.map(([label, value]) => `${label}: ${value}`),
    ...(diagnostics.errors.length ? ['Recent errors:', ...diagnostics.errors.map((line) => `- ${line}`)] : []),
  ].join('\n');
}
