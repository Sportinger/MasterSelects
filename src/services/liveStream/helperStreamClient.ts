import { isNativeHelperAvailable } from '../nativeHelper';

export type HelperRtmpState = 'connecting' | 'connected' | 'publishing' | 'ended' | 'error';

export type HelperStreamEvent =
  | { type: 'rtmp-status'; state: HelperRtmpState; message?: string }
  | {
      type: 'rtmp-stats';
      sentBytes: number;
      queuedBytes: number;
      queuedMessages: number;
      uptimeMs: number;
    };

export interface HelperStreamConnection {
  sendControl(command: object): void;
  sendBinary(frame: Uint8Array): void;
  bufferedAmount(): number;
  onEvent(listener: (event: HelperStreamEvent) => void): () => void;
  close(): void;
}

export interface HelperStreamConnectionDeps {
  WebSocketImpl?: typeof WebSocket;
  fetchImpl?: typeof fetch;
  port?: number;
  connectTimeoutMs?: number;
}

const DEFAULT_PORT = 9876;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
let requestSequence = 0;

function nextRequestId(): string {
  requestSequence += 1;
  return `stream_${requestSequence}`;
}

export function parseHelperStreamEvent(value: unknown): HelperStreamEvent | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.type === 'rtmp-status'
    && ['connecting', 'connected', 'publishing', 'ended', 'error'].includes(String(message.state))) {
    return {
      type: 'rtmp-status',
      state: message.state as HelperRtmpState,
      ...(typeof message.message === 'string' ? { message: message.message } : {}),
    };
  }
  if (message.type === 'rtmp-stats') {
    return {
      type: 'rtmp-stats',
      sentBytes: Number(message.sentBytes) || 0,
      queuedBytes: Number(message.queuedBytes) || 0,
      queuedMessages: Number(message.queuedMessages) || 0,
      uptimeMs: Number(message.uptimeMs) || 0,
    };
  }
  return null;
}

export async function openHelperStreamConnection(
  deps: HelperStreamConnectionDeps = {},
): Promise<HelperStreamConnection> {
  const WebSocketImpl = deps.WebSocketImpl ?? globalThis.WebSocket;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  if (!WebSocketImpl) throw new Error('Native Helper WebSocket support is unavailable.');
  if (!fetchImpl) throw new Error('Native Helper authentication is unavailable.');

  const port = deps.port ?? DEFAULT_PORT;
  const timeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const listeners = new Set<(event: HelperStreamEvent) => void>();
  const pendingJson: unknown[] = [];

  return new Promise<HelperStreamConnection>((resolve, reject) => {
    let settled = false;
    let authenticated = false;
    let authId = '';
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

    const connection: HelperStreamConnection = {
      sendControl: command => {
        if (!authenticated || ws.readyState !== WebSocketImpl.OPEN) {
          throw new Error('Native Helper stream connection is not open.');
        }
        ws.send(JSON.stringify(command));
      },
      sendBinary: frame => {
        if (!authenticated || ws.readyState !== WebSocketImpl.OPEN) {
          throw new Error('Native Helper stream connection is not open.');
        }
        ws.send(frame);
      },
      bufferedAmount: () => ws.bufferedAmount,
      onEvent: listener => {
        listeners.add(listener);
        pendingJson.splice(0).forEach(value => {
          const event = parseHelperStreamEvent(value);
          if (event) listener(event);
        });
        return () => listeners.delete(listener);
      },
      close: () => ws.close(),
    };

    const reportSocketFailure = (message: string) => {
      if (!authenticated) {
        finishError(message);
        return;
      }
      if (socketFailureReported) return;
      socketFailureReported = true;
      const event: HelperStreamEvent = { type: 'rtmp-status', state: 'error', message };
      if (listeners.size === 0) pendingJson.push(event);
      else listeners.forEach(listener => listener(event));
    };

    try {
      ws = new WebSocketImpl(`ws://127.0.0.1:${port}`);
      ws.binaryType = 'arraybuffer';
    } catch {
      reject(new Error('Native Helper is unreachable. Start the helper and try again.'));
      return;
    }

    timeout = globalThis.setTimeout(
      () => finishError('Native Helper is unreachable or authentication timed out.'),
      timeoutMs,
    );

    ws.onopen = async () => {
      try {
        const response = await fetchImpl(`http://127.0.0.1:${port + 1}/startup-token`);
        if (!response.ok) throw new Error('startup token request failed');
        const startup = await response.json() as { token?: unknown; auth_disabled?: unknown };
        if (startup.auth_disabled === true) {
          authenticated = true;
          settled = true;
          if (timeout) globalThis.clearTimeout(timeout);
          resolve(connection);
          return;
        }
        if (typeof startup.token !== 'string' || startup.token.length === 0) {
          finishError('Native Helper authentication token is unavailable.');
          return;
        }
        authId = nextRequestId();
        ws.send(JSON.stringify({ cmd: 'auth', id: authId, token: startup.token }));
      } catch {
        finishError('Native Helper authentication could not be completed.');
      }
    };

    ws.onmessage = event => {
      if (typeof event.data !== 'string') return;
      let value: unknown;
      try {
        value = JSON.parse(event.data);
      } catch {
        return;
      }
      const message = value as Record<string, unknown>;
      if (!authenticated && message.id === authId) {
        if (message.ok === true && message.authenticated === true) {
          authenticated = true;
          settled = true;
          if (timeout) globalThis.clearTimeout(timeout);
          resolve(connection);
        } else {
          finishError('Native Helper authentication was rejected.');
        }
        return;
      }
      const parsed = parseHelperStreamEvent(value);
      if (!parsed) return;
      if (listeners.size === 0) pendingJson.push(value);
      else listeners.forEach(listener => listener(parsed));
    };

    ws.onerror = () => reportSocketFailure('Native Helper stream connection failed.');
    ws.onclose = () => reportSocketFailure('Native Helper stream connection closed.');
  });
}

export async function isHelperReachable(): Promise<boolean> {
  return isNativeHelperAvailable();
}
