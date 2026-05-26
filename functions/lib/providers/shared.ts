export type HostedGatewayMode = 'hosted' | 'byo';
export type HostedGatewayKind = 'ai.audio' | 'ai.chat' | 'ai.video';
export type HostedGatewayStatus =
  | 'accepted'
  | 'byo_required'
  | 'completed'
  | 'error'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'requires_auth'
  | 'requires_billing'
  | 'unsupported';

export interface HostedGatewayError {
  code: string;
  details?: Record<string, unknown> | null;
  message: string;
}

export interface HostedGatewaySession {
  authenticated: boolean;
  email?: string | null;
  provider?: string | null;
}

export interface HostedGatewayEnvelope<TData = unknown> {
  byoRequired?: boolean;
  capability?: Record<string, unknown>;
  creditBalance?: number | null;
  creditsCharged?: number | null;
  data?: TData | null;
  error?: HostedGatewayError | null;
  kind: HostedGatewayKind;
  mode: HostedGatewayMode;
  next?: 'auth' | 'poll' | 'pricing' | 'upgrade';
  ok: boolean;
  provider: string;
  requestId: string | null;
  session?: HostedGatewaySession | null;
  status: HostedGatewayStatus;
  streaming?: boolean;
}

export interface HostedGatewaySseEvent {
  data: unknown;
  event: 'delta' | 'done' | 'error' | 'meta' | 'ready';
}

function serializeSseData(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }

  return JSON.stringify(data ?? null);
}

export function createHostedGatewayEnvelope<TData>(
  envelope: HostedGatewayEnvelope<TData>,
): HostedGatewayEnvelope<TData> {
  return envelope;
}

export function createGatewayError(
  code: string,
  message: string,
  details?: Record<string, unknown> | null,
): HostedGatewayError {
  return {
    code,
    details: details ?? null,
    message,
  };
}

export function createSseResponse(events: HostedGatewaySseEvent[], init: ResponseInit = {}): Response {
  const body = events
    .map((event) => `event: ${event.event}\ndata: ${serializeSseData(event.data)}\n\n`)
    .join('');

  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-cache, no-transform');
  headers.set('Content-Type', 'text/event-stream; charset=utf-8');
  headers.set('X-Accel-Buffering', 'no');

  return new Response(body, {
    ...init,
    headers,
  });
}
