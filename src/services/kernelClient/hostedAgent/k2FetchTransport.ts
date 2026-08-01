import {
  HOSTED_AGENT_HEADERS,
  type HostedAgentEvent,
  type HostedAgentK2BatchPostResponse,
  type HostedAgentK2EventReplay,
  type HostedAgentK2SessionStatus,
  type HostedAgentK1TurnRequest,
  type HostedAgentTurnAccepted,
} from './contracts';
import {
  HostedAgentK2ReconnectableError,
  type HostedAgentK2BoundRequest,
  type HostedAgentK2ClientTransport,
} from './k2Client';

function terminalStatus(events: HostedAgentEvent[]): HostedAgentK2SessionStatus {
  const terminal = events.findLast((event) => (
    event.kind === 'turn-complete'
    || event.kind === 'turn-failed'
    || event.kind === 'turn-canceled'
    || event.kind === 'turn-interrupted'
  ));
  if (!terminal) {
    return 'active';
  }
  if (terminal.kind === 'turn-complete') {
    return 'completed';
  }
  if (terminal.kind === 'turn-canceled') {
    return 'cancelled';
  }
  if (terminal.kind === 'turn-interrupted') {
    return 'interrupted';
  }
  return 'failed';
}

function responseError(response: Response): Error {
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return new HostedAgentK2ReconnectableError(
      `The hosted-agent connection is temporarily unavailable (${response.status}).`,
    );
  }
  return new Error(`The hosted-agent request failed safely (${response.status}).`);
}

function isAbortFailure(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || (error instanceof Error && error.name === 'AbortError');
}

async function boundFetch(
  request: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await request(input, init);
  } catch (error) {
    if (isAbortFailure(error, init.signal ?? undefined)) throw error;
    if (error instanceof HostedAgentK2ReconnectableError) throw error;
    throw new HostedAgentK2ReconnectableError(
      'The hosted-agent connection is temporarily unavailable.',
    );
  }
}

export async function startHostedAgentK2Turn(input: {
  apiBasePath?: string;
  fetchImplementation?: typeof fetch;
  request: HostedAgentK1TurnRequest;
  signal?: AbortSignal;
}): Promise<HostedAgentTurnAccepted> {
  const apiBasePath = (input.apiBasePath ?? '/api/kernel').replace(/\/+$/, '');
  const request = input.fetchImplementation ?? fetch;
  const response = await request(`${apiBasePath}/hosted-agent/turns`, {
    body: JSON.stringify(input.request),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal: input.signal,
  });
  if (!response.ok) {
    let message = `The hosted-agent turn could not start (${response.status}).`;
    try {
      const payload = await response.json() as { message?: unknown };
      if (typeof payload.message === 'string' && payload.message.trim()) {
        message = payload.message;
      }
    } catch {
      // Keep the bounded public error when the proxy did not return JSON.
    }
    throw new Error(message);
  }
  const accepted = await response.json() as HostedAgentTurnAccepted;
  if (
    accepted.turnId !== input.request.turnId
    || accepted.sessionId !== accepted.pageLease?.sessionId
    || accepted.route !== 'fast-agent'
  ) {
    throw new Error('The hosted-agent start response is not bound to the requested fast route.');
  }
  return accepted;
}

function boundHeaders(input: HostedAgentK2BoundRequest): Headers {
  return new Headers({
    [HOSTED_AGENT_HEADERS.clientInstanceId]: input.clientInstanceId,
    [HOSTED_AGENT_HEADERS.pageLease]: input.leaseToken,
    [HOSTED_AGENT_HEADERS.sessionId]: input.sessionId,
  });
}

export function parseHostedAgentK2Sse(text: string): HostedAgentEvent[] {
  const events: HostedAgentEvent[] = [];
  for (const block of text.replace(/\r\n/g, '\n').split('\n\n')) {
    if (!block.trim()) {
      continue;
    }
    let eventName = '';
    let id = '';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) {
        id = line.slice(3).trim();
      } else if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).trimStart());
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join('\n')) as unknown;
    } catch {
      throw new Error('The hosted-agent event stream contains invalid JSON.');
    }
    if (
      typeof parsed !== 'object'
      || parsed === null
      || (parsed as Partial<HostedAgentEvent>).eventId !== id
      || (parsed as Partial<HostedAgentEvent>).kind !== eventName
    ) {
      throw new Error('The hosted-agent SSE envelope does not match its event payload.');
    }
    events.push(parsed as HostedAgentEvent);
  }
  return events;
}

export function createHostedAgentK2FetchTransport(input: {
  apiBasePath?: string;
  fetchImplementation?: typeof fetch;
  signal?: AbortSignal;
} = {}): HostedAgentK2ClientTransport {
  const apiBasePath = (input.apiBasePath ?? '/api/kernel').replace(/\/+$/, '');
  const request = input.fetchImplementation ?? fetch;
  const turnPath = (turnId: string) => (
    `${apiBasePath}/hosted-agent/turns/${encodeURIComponent(turnId)}`
  );

  async function terminalRequest(
    binding: HostedAgentK2BoundRequest,
    keepalive: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await boundFetch(request, `${turnPath(binding.turnId)}/cancel`, {
      headers: boundHeaders(binding),
      keepalive,
      method: 'POST',
      signal,
    });
    if (!response.ok) {
      throw responseError(response);
    }
  }

  return {
    async cancel({ signal, ...binding }) {
      await terminalRequest(binding, false, signal);
    },
    async interrupt(binding) {
      await terminalRequest(binding, true);
    },
    async postToolResults({ batch, ...binding }) {
      const headers = boundHeaders(binding);
      headers.set('Content-Type', 'application/json');
      const response = await boundFetch(request, `${turnPath(binding.turnId)}/tool-results`, {
        body: JSON.stringify(batch),
        headers,
        method: 'POST',
      });
      if (!response.ok) {
        throw responseError(response);
      }
      return await response.json() as HostedAgentK2BatchPostResponse;
    },
    async postOperationResult({ result, ...binding }) {
      const headers = boundHeaders(binding);
      headers.set('Content-Type', 'application/json');
      const response = await boundFetch(request, `${turnPath(binding.turnId)}/operation-results`, {
        body: JSON.stringify({ result }),
        headers,
        method: 'POST',
      });
      if (!response.ok) throw responseError(response);
      return await response.json() as HostedAgentK2BatchPostResponse;
    },
    async postOperationSettlement({ receipt, ...binding }) {
      const headers = boundHeaders(binding);
      headers.set('Content-Type', 'application/json');
      const response = await boundFetch(request, `${turnPath(binding.turnId)}/operation-settlements`, {
        body: JSON.stringify({ receipt }),
        headers,
        method: 'POST',
      });
      if (!response.ok) throw responseError(response);
      return await response.json() as HostedAgentK2BatchPostResponse;
    },
    async replayEvents({ afterEventId, signal, ...binding }): Promise<HostedAgentK2EventReplay> {
      const headers = boundHeaders(binding);
      headers.set('Accept', 'text/event-stream');
      if (afterEventId) {
        headers.set(HOSTED_AGENT_HEADERS.lastEventId, afterEventId);
      }
      const response = await boundFetch(request, `${turnPath(binding.turnId)}/events`, {
        headers,
        method: 'GET',
        signal: signal ?? input.signal,
      });
      if (!response.ok) {
        throw responseError(response);
      }
      const events = parseHostedAgentK2Sse(await response.text());
      const cursor = response.headers.get(HOSTED_AGENT_HEADERS.eventCursor)
        ?? events.at(-1)?.eventId
        ?? afterEventId;
      const leaseMs = Number(response.headers.get(HOSTED_AGENT_HEADERS.streamLeaseMs));
      return {
        cursor,
        events,
        leaseExpiresAt: new Date(
          Date.now() + (Number.isFinite(leaseMs) && leaseMs > 0 ? leaseMs : 55_000),
        ).toISOString(),
        sessionId: binding.sessionId,
        status: terminalStatus(events),
        turnId: binding.turnId,
      };
    },
  };
}
