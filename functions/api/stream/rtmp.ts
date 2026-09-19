import { connect } from 'cloudflare:sockets';

import { loadSessionFromRequest } from '../../lib/auth';
import { json } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import { isAllowedRelayOrigin } from '../../lib/rtmp/guards';
import { CloudRtmpRelaySession } from '../../lib/rtmp/relaySession';
import type { RelayLease, RtmpTarget, RtmpTransport } from '../../lib/rtmp/types';

const CONNECT_TIMEOUT_MS = 10_000;
const RELAY_TTL_SECONDS = 120;

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  const { request } = context;
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return json({ error: 'websocket_upgrade_required' }, { status: 426 });
  }
  if (!isAllowedRelayOrigin(request.headers.get('Origin'), context.env)) {
    return json({ error: 'origin_not_allowed' }, { status: 403 });
  }

  const session = await loadSessionFromRequest(request, context.env).catch(() => null);
  if (!session || !context.data.user || context.data.user.id !== session.userId) {
    return json({ error: 'authentication_required' }, { status: 401 });
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  const connectionId = crypto.randomUUID();
  const lease = createRelayLease(context, session.userId, connectionId);
  const relay = new CloudRtmpRelaySession({
    close: (code, reason) => safeClose(server, code, reason),
    debug: (message) => console.debug('[Cloud RTMP relay]', message),
    lease,
    revalidateSession: async () => {
      const current = await loadSessionFromRequest(request, context.env).catch(() => null);
      return current?.userId === session.userId;
    },
    sendJson: (value) => {
      if (server.readyState === 1) server.send(JSON.stringify(value));
    },
    transportFactory: createWorkerdTransport,
  });

  let processing = Promise.resolve();
  server.accept();
  relay.sendHello();
  server.addEventListener('message', (event) => {
    processing = processing.then(async () => {
      if (typeof event.data === 'string') {
        await relay.handleText(event.data);
        return;
      }
      const bytes = await toBytes(event.data);
      await relay.handleBinary(bytes);
    }).catch(async () => {
      safeClose(server, 1011, 'Relay processing failed');
      await relay.dispose();
    });
  });
  server.addEventListener('close', () => context.waitUntil(relay.dispose()));
  server.addEventListener('error', () => context.waitUntil(relay.dispose()));

  return new Response(null, { status: 101, webSocket: client });
};

function createRelayLease(context: AppContext, userId: string, connectionId: string): RelayLease {
  const prefix = `stream:relay:${userId}:`;
  const key = `${prefix}${connectionId}`;
  let acquired = false;
  return {
    async acquire() {
      const listed = await context.env.KV.list({ limit: 4, prefix });
      const liveOthers = listed.keys.filter((entry) => entry.name !== key);
      if (liveOthers.length >= 3) return false;
      await context.env.KV.put(key, '', { expirationTtl: RELAY_TTL_SECONDS });
      acquired = true;
      return true;
    },
    async refresh() {
      if (acquired) await context.env.KV.put(key, '', { expirationTtl: RELAY_TTL_SECONDS });
    },
    async release() {
      if (!acquired) return;
      acquired = false;
      await context.env.KV.delete(key);
    },
  };
}

async function createWorkerdTransport(target: RtmpTarget, signal: AbortSignal): Promise<RtmpTransport> {
  const socket = connect(
    { hostname: target.connectHost, port: target.port },
    { secureTransport: target.secure ? 'on' : 'off' },
  );
  const abort = (): void => socket.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    await withTimeout(socket.opened, CONNECT_TIMEOUT_MS);
    if (signal.aborted) throw new Error('RTMP connection cancelled');
    const writer = socket.writable.getWriter();
    let closed = false;
    return {
      close() {
        if (closed) return;
        closed = true;
        socket.close();
        try {
          writer.releaseLock();
        } catch {
          // A pending write releases when the socket close rejects it.
        }
      },
      readable: socket.readable,
      write(bytes) {
        return writer.write(bytes);
      },
    };
  } catch (error) {
    socket.close();
    throw error instanceof Error ? error : new Error('RTMP TCP connection failed');
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function toBytes(value: unknown): Promise<Uint8Array> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  throw new Error('Unsupported WebSocket binary frame');
}

function safeClose(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === 0 || socket.readyState === 1) socket.close(code, reason.slice(0, 123));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RTMP TCP connection timed out')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('RTMP TCP connection failed'));
      },
    );
  });
}
