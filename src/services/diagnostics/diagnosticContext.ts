/**
 * Environment context attached to every runtime diagnostic event: session and
 * device identity, page, browser/device capabilities, memory, network, WebGPU
 * adapter, and the recent console/log breadcrumbs that led up to the failure.
 */

import { APP_BUILD_ID } from '../appBuild';
import {
  getRecentRuntimeDiagnosticEntries,
  getRuntimeGpuInfo,
} from '../runtimeDiagnostics';

const SESSION_STORAGE_KEY = 'ms.diagnostics.session';
const DEVICE_STORAGE_KEY = 'ms.diagnostics.device';
const BREADCRUMB_LIMIT = 30;
const BREADCRUMB_MESSAGE_LENGTH = 240;
const BOOT_AT_MS = Date.now();

let memorySessionId: string | null = null;
let memoryDeviceId: string | null = null;
let storageEstimate: { quotaMb?: number; usageMb?: number } | null = null;

type NavigatorWithExtras = Navigator & {
  connection?: { downlink?: number; effectiveType?: string; rtt?: number; saveData?: boolean };
  deviceMemory?: number;
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>;
    mobile?: boolean;
    platform?: string;
  };
};

type PerformanceWithMemory = Performance & {
  memory?: { jsHeapSizeLimit: number; totalJSHeapSize: number; usedJSHeapSize: number };
};

export interface DiagnosticBreadcrumb {
  level: string;
  message: string;
  source: string;
  t: string;
}

export interface DiagnosticContext {
  buildId?: string;
  connection?: { downlink?: number; effectiveType?: string; rtt?: number; saveData?: boolean };
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  hasFocus?: boolean;
  jsHeapMb?: { limit: number; total: number; used: number };
  language?: string;
  languages?: string[];
  online?: boolean;
  pageUrl?: string;
  performanceNow?: number;
  referrer?: string;
  screen?: { height: number; width: number };
  storageMb?: { quotaMb?: number; usageMb?: number };
  timezone?: string;
  uptimeMs: number;
  userAgent?: string;
  userAgentData?: { brands?: string[]; mobile?: boolean; platform?: string };
  viewport?: { dpr: number; height: number; width: number };
  visibility?: string;
  webgpu?: { adapter: Record<string, unknown> | null; supported: boolean };
}

function randomId(prefix: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}:${suffix}`;
}

function readStoredId(storage: Storage | undefined, key: string, prefix: string): string {
  try {
    const existing = storage?.getItem(key);
    if (existing && /^[a-z0-9][a-z0-9:_-]{7,99}$/i.test(existing)) return existing;
    const created = randomId(prefix);
    storage?.setItem(key, created);
    return created;
  } catch {
    return randomId(prefix);
  }
}

/** Stable for the lifetime of the browser tab, survives reloads (sessionStorage). */
export function getDiagnosticSessionId(): string {
  if (memorySessionId) return memorySessionId;
  memorySessionId = readStoredId(
    typeof sessionStorage !== 'undefined' ? sessionStorage : undefined,
    SESSION_STORAGE_KEY,
    'session',
  );
  return memorySessionId;
}

/** Stable per browser profile (localStorage) so recurring failures can be correlated. */
export function getDiagnosticDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  memoryDeviceId = readStoredId(
    typeof localStorage !== 'undefined' ? localStorage : undefined,
    DEVICE_STORAGE_KEY,
    'device',
  );
  return memoryDeviceId;
}

function roundMb(bytes: number | undefined): number | undefined {
  return typeof bytes === 'number' && Number.isFinite(bytes)
    ? Math.round(bytes / 1024 / 1024)
    : undefined;
}

/** Kicks off the asynchronous probes whose results later events should carry. */
export function primeDiagnosticContext(): void {
  if (typeof navigator === 'undefined') return;
  getDiagnosticSessionId();
  getDiagnosticDeviceId();
  try {
    void navigator.storage?.estimate?.().then((estimate) => {
      storageEstimate = { quotaMb: roundMb(estimate.quota), usageMb: roundMb(estimate.usage) };
    }).catch(() => undefined);
  } catch {
    // Storage estimation is best-effort.
  }
}

export function collectDiagnosticBreadcrumbs(limit = BREADCRUMB_LIMIT): DiagnosticBreadcrumb[] {
  return getRecentRuntimeDiagnosticEntries(limit).map((entry) => ({
    level: entry.level,
    message: entry.message.length > BREADCRUMB_MESSAGE_LENGTH
      ? `${entry.message.slice(0, BREADCRUMB_MESSAGE_LENGTH)}…`
      : entry.message,
    source: entry.source,
    t: entry.timestamp,
  }));
}

export function collectDiagnosticContext(): DiagnosticContext {
  const context: DiagnosticContext = { buildId: APP_BUILD_ID, uptimeMs: Date.now() - BOOT_AT_MS };
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return context;

  const nav = navigator as NavigatorWithExtras;
  const perf = (typeof performance !== 'undefined' ? performance : undefined) as PerformanceWithMemory | undefined;

  context.pageUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`.slice(0, 500);
  context.referrer = document.referrer ? document.referrer.slice(0, 300) : undefined;
  context.userAgent = nav.userAgent?.slice(0, 400);
  if (nav.userAgentData) {
    context.userAgentData = {
      brands: nav.userAgentData.brands?.map((brand) => `${brand.brand} ${brand.version}`),
      mobile: nav.userAgentData.mobile,
      platform: nav.userAgentData.platform,
    };
  }
  context.language = nav.language;
  context.languages = Array.isArray(nav.languages) ? nav.languages.slice(0, 5) : undefined;
  try {
    context.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Intl may be unavailable in exotic embeddings.
  }
  context.viewport = {
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    height: window.innerHeight,
    width: window.innerWidth,
  };
  if (typeof screen !== 'undefined') {
    context.screen = { height: screen.height, width: screen.width };
  }
  context.hardwareConcurrency = nav.hardwareConcurrency;
  if (perf?.memory) {
    context.jsHeapMb = {
      limit: roundMb(perf.memory.jsHeapSizeLimit) ?? 0,
      total: roundMb(perf.memory.totalJSHeapSize) ?? 0,
      used: roundMb(perf.memory.usedJSHeapSize) ?? 0,
    };
  }
  if (typeof nav.deviceMemory === 'number') {
    context.deviceMemoryGb = nav.deviceMemory;
  }
  if (storageEstimate) {
    context.storageMb = storageEstimate;
  }
  if (nav.connection) {
    context.connection = {
      downlink: nav.connection.downlink,
      effectiveType: nav.connection.effectiveType,
      rtt: nav.connection.rtt,
      saveData: nav.connection.saveData,
    };
  }
  context.online = nav.onLine;
  context.visibility = typeof document !== 'undefined' ? document.visibilityState : undefined;
  context.hasFocus = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
    ? document.hasFocus()
    : undefined;
  context.performanceNow = perf ? Math.round(perf.now()) : undefined;
  context.webgpu = {
    adapter: getRuntimeGpuInfo(),
    supported: 'gpu' in nav,
  };
  return context;
}
