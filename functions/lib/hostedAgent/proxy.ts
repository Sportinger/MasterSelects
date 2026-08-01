import type { Env } from '../env';
import {
  HOSTED_AGENT_HEADERS,
  HOSTED_AGENT_PROTOCOL_VERSION,
} from '../../../src/services/kernelClient/hostedAgent/contracts';

const DEFAULT_KERNEL_ORIGIN = 'https://fassandra.de';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const HOSTED_AGENT_STREAM_LEASE_MS = 55_000;

interface HostedAgentProxyEnv extends Env {
  HOSTED_AGENT_KERNEL_ORIGIN?: string;
}

const SAFE_UPSTREAM_RESPONSE_HEADERS = [
  'Cache-Control',
  'Content-Language',
  'Content-Type',
  'ETag',
  'Retry-After',
  HOSTED_AGENT_HEADERS.eventCursor,
  HOSTED_AGENT_HEADERS.pageLease,
  HOSTED_AGENT_HEADERS.sessionId,
  'X-Accel-Buffering',
] as const;

export class HostedAgentProxyError extends Error {
  readonly code: 'invalid_upstream_stream' | 'upstream_timeout' | 'upstream_unreachable';

  constructor(
    code: 'invalid_upstream_stream' | 'upstream_timeout' | 'upstream_unreachable',
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'HostedAgentProxyError';
  }
}

function resolveOrigin(env: Env): string {
  const hostedEnv = env as HostedAgentProxyEnv;
  return (
    hostedEnv.HOSTED_AGENT_KERNEL_ORIGIN?.trim()
    || env.KERNEL_ORIGIN?.trim()
    || DEFAULT_KERNEL_ORIGIN
  ).replace(/\/+$/, '');
}

function responseHeaders(upstream: Response, metadata: {
  protocolVersion?: string;
  sessionId: string;
  streamLeaseMs?: number;
  turnId: string;
}): Headers {
  const headers = new Headers();
  for (const name of SAFE_UPSTREAM_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  headers.set('Cache-Control', 'no-store');
  headers.set(
    HOSTED_AGENT_HEADERS.protocolVersion,
    metadata.protocolVersion ?? HOSTED_AGENT_PROTOCOL_VERSION,
  );
  headers.set(HOSTED_AGENT_HEADERS.sessionId, metadata.sessionId);
  headers.set(HOSTED_AGENT_HEADERS.turnId, metadata.turnId);
  if (metadata.streamLeaseMs !== undefined) {
    headers.set(HOSTED_AGENT_HEADERS.streamLeaseMs, String(metadata.streamLeaseMs));
  }
  return headers;
}

export async function forwardHostedAgentRequest(input: {
  accept: 'application/json' | 'text/event-stream';
  assertion: string;
  body?: string;
  clientInstanceId: string;
  contentType?: string;
  env: Env;
  expectedEventStream?: boolean;
  lastEventId?: string;
  method: 'GET' | 'POST';
  pageLease?: string;
  protocolVersion?: string;
  requestSignal: AbortSignal;
  sessionId: string;
  timeoutMs?: number;
  turnId: string;
  upstreamPath: string;
}): Promise<Response> {
  const token = input.env.KERNEL_AUTH_TOKEN?.trim();
  if (!token) {
    throw new HostedAgentProxyError(
      'upstream_unreachable',
      'The kernel origin authentication token is unavailable.',
    );
  }
  const headers = new Headers({
    Accept: input.accept,
    Authorization: `Bearer ${token}`,
    [HOSTED_AGENT_HEADERS.clientInstanceId]: input.clientInstanceId,
    [HOSTED_AGENT_HEADERS.protocolVersion]: input.protocolVersion ?? HOSTED_AGENT_PROTOCOL_VERSION,
    [HOSTED_AGENT_HEADERS.serviceAssertion]: input.assertion,
    [HOSTED_AGENT_HEADERS.sessionId]: input.sessionId,
    [HOSTED_AGENT_HEADERS.turnId]: input.turnId,
  });
  if (input.body !== undefined) {
    headers.set('Content-Type', input.contentType ?? 'application/json; charset=utf-8');
  }
  if (input.lastEventId) {
    headers.set(HOSTED_AGENT_HEADERS.lastEventId, input.lastEventId);
  }
  if (input.pageLease) {
    headers.set(HOSTED_AGENT_HEADERS.pageLease, input.pageLease);
  }

  const timeoutMs = input.timeoutMs
    ?? (input.expectedEventStream ? HOSTED_AGENT_STREAM_LEASE_MS : DEFAULT_REQUEST_TIMEOUT_MS);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([input.requestSignal, timeoutSignal]);
  let upstream: Response;
  try {
    upstream = await fetch(`${resolveOrigin(input.env)}${input.upstreamPath}`, {
      body: input.body,
      headers,
      method: input.method,
      redirect: 'manual',
      signal,
    });
  } catch (error) {
    console.error('[hosted-agent] upstream fetch failed', {
      message: error instanceof Error ? error.message : 'non-error rejection',
      name: error instanceof Error ? error.name : typeof error,
      origin: resolveOrigin(input.env),
    });
    throw new HostedAgentProxyError(
      timeoutSignal.aborted ? 'upstream_timeout' : 'upstream_unreachable',
      timeoutSignal.aborted
        ? 'The bounded hosted-agent stream lease expired.'
        : 'The hosted-agent origin is unreachable.',
    );
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel();
    throw new HostedAgentProxyError(
      'upstream_unreachable',
      'The hosted-agent origin returned a redirect that was rejected.',
    );
  }

  const contentType = upstream.headers.get('Content-Type') ?? '';
  if (
    input.expectedEventStream
    && upstream.ok
    && !contentType.toLowerCase().startsWith('text/event-stream')
  ) {
    await upstream.body?.cancel();
    throw new HostedAgentProxyError(
      'invalid_upstream_stream',
      'The hosted-agent origin did not return an event stream.',
    );
  }
  return new Response(upstream.body, {
    headers: responseHeaders(upstream, {
      ...(input.protocolVersion === undefined ? {} : { protocolVersion: input.protocolVersion }),
      sessionId: input.sessionId,
      streamLeaseMs: input.expectedEventStream ? timeoutMs : undefined,
      turnId: input.turnId,
    }),
    status: upstream.status,
    statusText: upstream.statusText,
  });
}
