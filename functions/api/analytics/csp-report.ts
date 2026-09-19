import {
  classifyDiagnosticBrowser,
  classifyDiagnosticDeviceClass,
  classifyDiagnosticPlatform,
  insertAppDiagnosticEvents,
  requestCountry,
  scheduleAppDiagnosticRetentionCleanup,
  type AppDiagnosticEventRecord,
} from '../../lib/appDiagnosticEvents';
import { hasTrustedOrigin, json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import {
  buildRateLimitKey,
  consumeRateLimit,
  getClientIp,
  rateLimitedResponse,
  type RateLimitPolicy,
} from '../../lib/rateLimit';

/**
 * Sink for browser Content-Security-Policy violation reports. Accepts the
 * legacy `report-uri` body (`application/csp-report`) and Reporting API
 * batches (`application/reports+json`), keeps only reports about documents
 * on this origin, and stores a compact row per report in
 * `app_diagnostic_events` so violations show up next to runtime diagnostics.
 */
const MAX_BODY_BYTES = 16_000;
const MAX_REPORTS_PER_REQUEST = 10;
const MAX_TEXT_LENGTH = 300;
const MAX_URL_LENGTH = 1_000;
const MAX_USER_AGENT_LENGTH = 400;
const REPORT_RATE_LIMIT: RateLimitPolicy = { limit: 60, windowSeconds: 10 * 60 };
const ACCEPTED_CONTENT_TYPES = ['application/csp-report', 'application/reports+json'];

interface NormalizedCspReport {
  blockedUri: string;
  columnNumber: number | null;
  disposition: string | null;
  documentUri: string;
  effectiveDirective: string;
  lineNumber: number | null;
  sourceFile: string | null;
  violatedDirective: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Strips query and fragment: they can carry tokens (claim codes, magic links). */
function stripUrlSecrets(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, MAX_URL_LENGTH);
  } catch {
    return value.split(/[?#]/)[0]?.slice(0, MAX_URL_LENGTH) || null;
  }
}

function normalizeReport(value: unknown): NormalizedCspReport | null {
  if (!isPlainObject(value)) return null;
  if (value.type !== undefined && value.type !== 'csp-violation') return null;
  const body = isPlainObject(value['csp-report'])
    ? value['csp-report']
    : isPlainObject(value.body)
      ? value.body
      : value;
  const documentUri = safeText(pick(body, 'document-uri', 'documentURL', 'documentURI'), MAX_URL_LENGTH);
  const effectiveDirective = safeText(
    pick(body, 'effective-directive', 'effectiveDirective') ?? pick(body, 'violated-directive', 'violatedDirective'),
    120,
  );
  if (!documentUri || !effectiveDirective) return null;

  return {
    blockedUri: stripUrlSecrets(safeText(pick(body, 'blocked-uri', 'blockedURL', 'blockedURI'), MAX_URL_LENGTH)) ?? 'unknown',
    columnNumber: safeInteger(pick(body, 'column-number', 'columnNumber')),
    disposition: safeText(body.disposition, 20),
    documentUri,
    effectiveDirective,
    lineNumber: safeInteger(pick(body, 'line-number', 'lineNumber')),
    sourceFile: stripUrlSecrets(safeText(pick(body, 'source-file', 'sourceFile'), MAX_URL_LENGTH)),
    violatedDirective: safeText(pick(body, 'violated-directive', 'violatedDirective'), 120),
  };
}

function parseReports(raw: unknown): NormalizedCspReport[] {
  const entries = Array.isArray(raw) ? raw : [raw];
  return entries
    .slice(0, MAX_REPORTS_PER_REQUEST)
    .map(normalizeReport)
    .filter((report): report is NormalizedCspReport => report !== null);
}

/** Returns the document path when the report is about a page on this origin. */
function sameOriginDocumentPath(documentUri: string, request: Request): string | null {
  try {
    const document = new URL(documentUri);
    return document.origin === new URL(request.url).origin ? document.pathname.slice(0, 300) : null;
  } catch {
    return null;
  }
}

async function fingerprintReport(report: NormalizedCspReport): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${report.effectiveDirective}|${report.blockedUri}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hasAcceptedContentType(request: Request): boolean {
  const contentType = request.headers.get('Content-Type')?.toLowerCase() ?? '';
  return ACCEPTED_CONTENT_TYPES.some((accepted) => contentType.startsWith(accepted));
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!hasAcceptedContentType(context.request)) {
    return json({ error: 'unsupported_media_type', ok: false }, { status: 415 });
  }
  if (!hasTrustedOrigin(context.request)) {
    return json({ error: 'untrusted_origin', ok: false }, { status: 403 });
  }
  const contentLength = Number(context.request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large', ok: false }, { status: 413 });
  }
  const clientIp = getClientIp(context.request);
  if (clientIp) {
    const budget = await consumeRateLimit(
      context.env.KV,
      await buildRateLimitKey('csp-report', clientIp, context.env.SESSION_SECRET),
      REPORT_RATE_LIMIT,
    );
    if (!budget.allowed) return rateLimitedResponse(budget, { ok: false });
  }

  const rawBody = await context.request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large', ok: false }, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_report', ok: false }, { status: 400 });
  }

  const receivedAt = new Date().toISOString();
  const userAgent = safeText(context.request.headers.get('User-Agent'), MAX_USER_AGENT_LENGTH);
  const userAgentText = userAgent ?? '';
  const country = requestCountry(context.request);
  const records: AppDiagnosticEventRecord[] = [];

  for (const report of parseReports(parsed)) {
    const pagePath = sameOriginDocumentPath(report.documentUri, context.request);
    if (pagePath === null) continue;
    records.push({
      appVersion: null,
      browser: classifyDiagnosticBrowser(userAgentText),
      component: 'csp-report',
      contextJson: JSON.stringify({
        blockedUri: report.blockedUri,
        columnNumber: report.columnNumber,
        disposition: report.disposition,
        documentUri: stripUrlSecrets(report.documentUri),
        lineNumber: report.lineNumber,
        sourceFile: report.sourceFile,
        violatedDirective: report.violatedDirective,
      }),
      country,
      deviceClass: classifyDiagnosticDeviceClass(userAgentText),
      deviceId: null,
      errorName: report.effectiveDirective,
      failureCode: 'csp_violation',
      fingerprint: await fingerprintReport(report),
      id: `csp-report:${crypto.randomUUID()}`,
      kind: 'client_runtime',
      message: `${report.effectiveDirective} ${report.disposition === 'enforce' ? 'blocked' : report.disposition === 'report' ? 'report-only violation for' : 'violation reported for'} ${report.blockedUri}`.slice(0, MAX_TEXT_LENGTH),
      model: null,
      occurredAt: receivedAt,
      outcome: report.disposition === 'enforce' ? 'failed' : 'reported',
      outputType: null,
      pagePath,
      platform: classifyDiagnosticPlatform(userAgentText),
      provider: null,
      providerTaskId: null,
      receivedAt,
      repeatCount: 1,
      sessionId: null,
      stack: null,
      stage: 'csp_report',
      userAgent,
      userId: context.data.user?.id ?? null,
    });
  }

  if (records.length > 0) {
    await insertAppDiagnosticEvents(context.env.DB, records);
    context.waitUntil(scheduleAppDiagnosticRetentionCleanup(context).catch(() => {}));
  }

  return new Response(null, { status: 204 });
};
