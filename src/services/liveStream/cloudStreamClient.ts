import { CLOUD_STREAM_RELAY_PATH } from './streamTypes';
import {
  parseHelperStreamEvent,
  type HelperStreamConnection,
  type HelperStreamEvent,
} from './helperStreamClient';

export interface CloudStreamConnectionDeps {
  WebSocketImpl?: typeof WebSocket;
  baseUrl?: string;
  connectTimeoutMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const CLOUD_RELAY_UNREACHABLE_MESSAGE = 'Cloud relay unreachable.';
const CLOUD_RELAY_SIGN_IN_MESSAGE = 'Not signed in / session expired — sign in to use cloud streaming.';

function resolveRelayUrl(baseUrl: string): string {
  const url = new URL(CLOUD_STREAM_RELAY_PATH, baseUrl);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  return url.toString();
}

export async function openCloudStreamConnection(
  deps: CloudStreamConnectionDeps = {},
): Promise<HelperStreamConnection> {
  const WebSocketImpl = deps.WebSocketImpl ?? globalThis.WebSocket;
  if (!WebSocketImpl) throw new Error(CLOUD_RELAY_UNREACHABLE_MESSAGE);

  const baseUrl = deps.baseUrl ?? globalThis.location?.origin;
  if (!baseUrl) throw new Error(CLOUD_RELAY_UNREACHABLE_MESSAGE);

  const listeners = new Set<(event: HelperStreamEvent) => void>();
  const pendingEvents: HelperStreamEvent[] = [];
  const timeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

  return new Promise<HelperStreamConnection>((resolve, reject) => {
    let settled = false;
    let relayReady = false;
    let socketFailureReported = false;
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    let ws: WebSocket;

    const finishError = (message: string) => {
      if (settled) return;
      settled = true;
      if (timeout) globalThis.clearTimeout(timeout);
      try { ws.close(); } catch { /* best-effort unwind */ }
      reject(new Error(message));
    };

    const emitEvent = (event: HelperStreamEvent) => {
      if (listeners.size === 0) pendingEvents.push(event);
      else listeners.forEach(listener => listener(event));
    };

    const reportSocketFailure = (message: string) => {
      if (!relayReady) {
        finishError(message);
        return;
      }
      if (socketFailureReported) return;
      socketFailureReported = true;
      emitEvent({ type: 'rtmp-status', state: 'error', message });
    };

    try {
      ws = new WebSocketImpl(resolveRelayUrl(baseUrl));
      ws.binaryType = 'arraybuffer';
    } catch {
      reject(new Error(CLOUD_RELAY_UNREACHABLE_MESSAGE));
      return;
    }

    const assertReady = () => {
      if (!relayReady || ws.readyState !== WebSocketImpl.OPEN) {
        throw new Error('Cloud relay stream connection is not open.');
      }
    };

    const connection: HelperStreamConnection = {
      sendControl: command => {
        assertReady();
        ws.send(JSON.stringify(command));
      },
      sendBinary: frame => {
        assertReady();
        ws.send(frame);
      },
      bufferedAmount: () => ws.bufferedAmount,
      onEvent: listener => {
        listeners.add(listener);
        pendingEvents.splice(0).forEach(listener);
        return () => listeners.delete(listener);
      },
      close: () => ws.close(),
    };

    timeout = globalThis.setTimeout(
      () => finishError(CLOUD_RELAY_UNREACHABLE_MESSAGE),
      timeoutMs,
    );

    ws.onmessage = event => {
      if (typeof event.data !== 'string') return;
      let value: unknown;
      try {
        value = JSON.parse(event.data);
      } catch {
        return;
      }
      const message = value as Record<string, unknown>;
      if (!relayReady && message.ok === true && message.type === 'relay-hello') {
        relayReady = true;
        settled = true;
        if (timeout) globalThis.clearTimeout(timeout);
        resolve(connection);
        return;
      }
      if (!relayReady) return;
      const parsed = parseHelperStreamEvent(value);
      if (parsed) emitEvent(parsed);
    };

    ws.onerror = () => reportSocketFailure(CLOUD_RELAY_UNREACHABLE_MESSAGE);
    ws.onclose = () => reportSocketFailure(
      relayReady ? 'Cloud relay stream connection closed.' : CLOUD_RELAY_SIGN_IN_MESSAGE,
    );
  });
}
